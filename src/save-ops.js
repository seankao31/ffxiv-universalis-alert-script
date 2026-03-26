const SaveOps = (() => {
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
    const skippedWorlds = [];

    const existingByWorldId = new Map();
    if (group) {
      for (const w of group.worlds) {
        existingByWorldId.set(w.worldId, w);
      }
    }

    const newTriggerKey = _Grouping.normalizeTrigger(formState.trigger);
    const existingTriggerKey = group ? _Grouping.normalizeTrigger(group.trigger) : null;

    for (const world of worlds) {
      const existing = existingByWorldId.get(world.worldId);
      const isSelected = formState.selectedWorldIds.has(world.worldId);

      if (isSelected && !existing) {
        postsNeeded.push(world);
      } else if (!isSelected && existing) {
        deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
      } else if (isSelected && existing) {
        const triggerChanged = newTriggerKey !== existingTriggerKey;
        const nameChanged = formState.name !== group.name;
        if (triggerChanged || nameChanged) {
          // Rule or name changed → POST new, DELETE old
          postsNeeded.push(world);
          deletesAfterSuccess.push({ alertId: existing.alertId, worldId: existing.worldId, worldName: existing.worldName || '' });
        } else {
          // Identical — already covered, skip
          skippedWorlds.push({ worldId: existing.worldId, worldName: existing.worldName || '' });
        }
      }
    }

    const netChange = postsNeeded.length - deletesAfterSuccess.length;
    const available = MAX_ALERTS - (currentAlertCount || 0);
    let capacityError = null;
    if (postsNeeded.length > 0 && (currentAlertCount || 0) + netChange > MAX_ALERTS) {
      // available + deletesAfterSuccess.length: deletes free slots during interleaved execution,
      // so effective capacity = unused slots + slots that will be reclaimed by deletes.
      capacityError = `Not enough alert slots (need ${postsNeeded.length}, only ${available + deletesAfterSuccess.length} available)`;
    }

    return { postsNeeded, deletesAfterSuccess, skippedWorlds, netChange, capacityError };
  }

  function getFailedIndices(results) {
    return results
      .map((r, i) => r.status === 'rejected' ? i : -1)
      .filter(i => i !== -1);
  }

  function sortDeletesByReplacement(deletes, postedWorldIds) {
    deletes.sort((a, b) => {
      const aReplaced = postedWorldIds.has(a.worldId) ? 0 : 1;
      const bReplaced = postedWorldIds.has(b.worldId) ? 0 : 1;
      return aReplaced - bReplaced;
    });
  }

  async function runDeleteBatch(batch, onEachDone) {
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        try {
          return await _API.deleteAlert(entry.alertId);
        } finally {
          onEachDone();
        }
      })
    );
    const failed = getFailedIndices(results);
    if (failed.length > 0) {
      const names = failed.map(i => batch[i].worldName || batch[i].worldId).join(', ');
      throw new Error(`Alerts saved, but failed to remove old alerts for: ${names}. These may need manual cleanup.`);
    }
  }

  async function executeSaveOps(ops, itemId, formState, { onProgress, availableSlots } = {}) {
    let slots = typeof availableSlots === 'number' ? availableSlots : ops.postsNeeded.length;

    const pendingPosts = ops.postsNeeded.map((world, i) => ({ world, index: i }));
    const pendingDeletes = [...ops.deletesAfterSuccess];
    const postedWorldIds = new Set();
    const totalPosts = ops.postsNeeded.length;
    const totalDeletes = ops.deletesAfterSuccess.length;
    let postCompleted = 0;
    let deleteCompleted = 0;

    const onDeleteDone = () => {
      deleteCompleted++;
      onProgress?.({ phase: 'removing', completed: deleteCompleted, total: totalDeletes });
    };

    while (pendingPosts.length > 0 || pendingDeletes.length > 0) {
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

        const failed = getFailedIndices(results);
        if (failed.length > 0) {
          const names = failed.map(i => batch[i].world.worldName || batch[i].world.worldId).join(', ');
          throw new Error(`Failed to save alerts for: ${names}`);
        }

        for (const { world } of batch) {
          postedWorldIds.add(world.worldId);
        }
        slots -= batch.length;
      }

      if (pendingPosts.length === 0) break;

      sortDeletesByReplacement(pendingDeletes, postedWorldIds);

      const deleteBatchSize = Math.min(pendingDeletes.length, pendingPosts.length);
      if (deleteBatchSize === 0) break;

      const deleteBatch = pendingDeletes.splice(0, deleteBatchSize);
      await runDeleteBatch(deleteBatch, onDeleteDone);
      slots += deleteBatch.length;
    }

    if (pendingDeletes.length > 0) {
      sortDeletesByReplacement(pendingDeletes, postedWorldIds);
      await runDeleteBatch(pendingDeletes, onDeleteDone);
    }
  }

  return { computeSaveOps, executeSaveOps, MAX_ALERTS };
})();

if (typeof module !== 'undefined') module.exports = SaveOps;
