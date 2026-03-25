const SaveOps = (() => {
  // Requires: Grouping (for normalizeTrigger), API — injected via globals in TM context
  // In test context, required via module.exports
  const _Grouping = typeof Grouping !== 'undefined' ? Grouping : require('./grouping');
  const _API = typeof API !== 'undefined' ? API : require('./api');

  const MAX_ALERTS = 40;

  /**
   * Pure function. Returns { postsNeeded, deletesAfterSuccess, netChange, capacityError }.
   * @param {object|null} group  - existing logical alert group, or null
   * @param {object} formState   - { name, webhook, trigger, selectedWorldIds: Set<number> }
   * @param {Array}  worlds      - full world list (WORLDS)
   * @param {number} [currentAlertCount] - current total alert count for capacity check
   */
  function computeSaveOps(group, formState, worlds, currentAlertCount) {
    const postsNeeded = [];
    const deletesAfterSuccess = [];

    const existingByWorldId = new Map();
    if (group) {
      for (const w of group.worlds) {
        existingByWorldId.set(w.worldId, w);
      }
    }

    const newTriggerKey = _Grouping.normalizeTrigger(formState.trigger);

    for (const world of worlds) {
      const existing = existingByWorldId.get(world.worldId);
      const isSelected = formState.selectedWorldIds.has(world.worldId);

      if (isSelected && !existing) {
        // Newly checked, no existing alert → POST
        postsNeeded.push(world);
      } else if (!isSelected && existing) {
        // Unchecked, had existing alert → DELETE after success
        deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
      } else if (isSelected && existing) {
        const existingTriggerKey = _Grouping.normalizeTrigger(group.trigger);
        const triggerChanged = newTriggerKey !== existingTriggerKey;
        const nameChanged = formState.name !== group.name;
        if (triggerChanged || nameChanged) {
          // Rule or name changed → POST new, DELETE old
          postsNeeded.push(world);
          deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
        }
        // else: identical — no-op
      }
    }

    const netChange = postsNeeded.length - deletesAfterSuccess.length;
    const available = MAX_ALERTS - (currentAlertCount || 0);
    let capacityError = null;
    if (postsNeeded.length > 0 && (currentAlertCount || 0) + netChange > MAX_ALERTS) {
      capacityError = `Not enough alert slots (need ${postsNeeded.length}, only ${available + deletesAfterSuccess.length} available)`;
    }

    return { postsNeeded, deletesAfterSuccess, netChange, capacityError };
  }

  /**
   * Executes save ops with capacity-aware interleaving.
   * When slots are limited, interleaves POST and DELETE batches to stay within capacity.
   * When availableSlots is not provided, defaults to posting all at once (backward compat).
   * Throws if any POST fails (no further operations will run).
   * @param {object}   ops
   * @param {number}   itemId
   * @param {object}   formState
   * @param {object}   [options]
   * @param {function} [options.onProgress] - called after each request settles: ({ phase, completed, total })
   * @param {number}   [options.availableSlots] - how many new alerts can be created before hitting capacity
   */
  async function executeSaveOps(ops, itemId, formState, { onProgress, availableSlots } = {}) {
    // Default to unlimited slots when not specified (backward compat)
    let slots = typeof availableSlots === 'number' ? availableSlots : ops.postsNeeded.length;

    const pendingPosts = ops.postsNeeded.map((world, i) => ({ world, index: i }));
    const pendingDeletes = [...ops.deletesAfterSuccess];
    const postedWorldIds = new Set();
    const totalPosts = ops.postsNeeded.length;
    const totalDeletes = ops.deletesAfterSuccess.length;
    let postCompleted = 0;
    let deleteCompleted = 0;

    while (pendingPosts.length > 0 || pendingDeletes.length > 0) {
      // Phase 1: POST as many as slots allow
      const postBatchSize = Math.min(pendingPosts.length, slots);
      if (postBatchSize > 0) {
        const batch = pendingPosts.splice(0, postBatchSize);
        const results = await Promise.allSettled(
          batch.map(async ({ world }) => {
            try {
              return await _API.createAlert({
                name: formState.name,
                itemId,
                worldId: world.worldId,
                discordWebhook: formState.webhook,
                triggerVersion: 0,
                trigger: formState.trigger,
              });
            } finally {
              postCompleted++;
              onProgress?.({ phase: 'creating', completed: postCompleted, total: totalPosts });
            }
          })
        );

        const failedIndices = results
          .map((r, i) => r.status === 'rejected' ? i : -1)
          .filter(i => i !== -1);
        if (failedIndices.length > 0) {
          const names = failedIndices.map(i => batch[i].world.worldName || batch[i].world.worldId).join(', ');
          throw new Error(`Failed to save alerts for: ${names}`);
        }

        // Track which worlds have been successfully posted
        for (const { world } of batch) {
          postedWorldIds.add(world.worldId);
        }
        slots -= batch.length;
      }

      // If no more POSTs needed, break to final DELETE phase
      if (pendingPosts.length === 0) break;

      // Phase 2: Need more slots — DELETE to free capacity
      // Prefer "safe" deletes: old alerts whose replacements have been POSTed
      pendingDeletes.sort((a, b) => {
        const aReplaced = postedWorldIds.has(a.worldId) ? 0 : 1;
        const bReplaced = postedWorldIds.has(b.worldId) ? 0 : 1;
        return aReplaced - bReplaced;
      });

      // Delete enough to make room for remaining POSTs (at least 1)
      const deleteBatchSize = Math.min(pendingDeletes.length, pendingPosts.length);
      if (deleteBatchSize === 0) break; // safety: no deletes possible, avoid infinite loop

      const deleteBatch = pendingDeletes.splice(0, deleteBatchSize);
      const deleteResults = await Promise.allSettled(
        deleteBatch.map(async (entry) => {
          try {
            return await _API.deleteAlert(entry.alertId);
          } finally {
            deleteCompleted++;
            onProgress?.({ phase: 'removing', completed: deleteCompleted, total: totalDeletes });
          }
        })
      );

      const failedDeleteIndices = deleteResults
        .map((r, i) => r.status === 'rejected' ? i : -1)
        .filter(i => i !== -1);
      if (failedDeleteIndices.length > 0) {
        const names = failedDeleteIndices.map(i => deleteBatch[i].worldName || deleteBatch[i].worldId).join(', ');
        throw new Error(`Alerts saved, but failed to remove old alerts for: ${names}. These may need manual cleanup.`);
      }

      slots += deleteBatch.length;
    }

    // Final phase: delete remaining old alerts (pure removals + remaining replacements)
    if (pendingDeletes.length > 0) {
      // Sort: replaced alerts first (safe), unreplaced last
      pendingDeletes.sort((a, b) => {
        const aReplaced = postedWorldIds.has(a.worldId) ? 0 : 1;
        const bReplaced = postedWorldIds.has(b.worldId) ? 0 : 1;
        return aReplaced - bReplaced;
      });

      const deleteResults = await Promise.allSettled(
        pendingDeletes.map(async (entry) => {
          try {
            return await _API.deleteAlert(entry.alertId);
          } finally {
            deleteCompleted++;
            onProgress?.({ phase: 'removing', completed: deleteCompleted, total: totalDeletes });
          }
        })
      );

      const failedDeleteIndices = deleteResults
        .map((r, i) => r.status === 'rejected' ? i : -1)
        .filter(i => i !== -1);
      if (failedDeleteIndices.length > 0) {
        const names = failedDeleteIndices.map(i => pendingDeletes[i].worldName || pendingDeletes[i].worldId).join(', ');
        throw new Error(`Alerts saved, but failed to remove old alerts for: ${names}. These may need manual cleanup.`);
      }
    }
  }

  return { computeSaveOps, executeSaveOps, MAX_ALERTS };
})();

if (typeof module !== 'undefined') module.exports = SaveOps;
