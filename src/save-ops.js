const SaveOps = (() => {
  // Requires: Grouping (for normalizeTrigger), API — injected via globals in TM context
  // In test context, required via module.exports
  const _Grouping = typeof Grouping !== 'undefined' ? Grouping : require('./grouping');
  const _API = typeof API !== 'undefined' ? API : require('./api');

  /**
   * Pure function. Returns { postsNeeded, deletesAfterSuccess }.
   * @param {object|null} group  - existing logical alert group, or null
   * @param {object} formState   - { name, webhook, trigger, selectedWorldIds: Set<number> }
   * @param {Array}  worlds      - full world list (WORLDS)
   */
  function computeSaveOps(group, formState, worlds) {
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
        deletesAfterSuccess.push(existing.alertId);
      } else if (isSelected && existing) {
        const existingTriggerKey = _Grouping.normalizeTrigger(group.trigger);
        const triggerChanged = newTriggerKey !== existingTriggerKey;
        const nameChanged = formState.name !== group.name;
        if (triggerChanged || nameChanged) {
          // Rule or name changed → POST new, DELETE old
          postsNeeded.push(world);
          deletesAfterSuccess.push(existing.alertId);
        }
        // else: identical — no-op
      }
    }

    return { postsNeeded, deletesAfterSuccess };
  }

  /**
   * Executes save ops: all POSTs first, then DELETEs only if all POSTs succeed.
   * Throws if any POST fails (no deletes will have run).
   */
  async function executeSaveOps(ops, itemId, formState) {
    if (ops.postsNeeded.length > 0) {
      const results = await Promise.allSettled(
        ops.postsNeeded.map(world =>
          _API.createAlert({
            name: formState.name,
            itemId,
            worldId: world.worldId,
            discordWebhook: formState.webhook,
            triggerVersion: 0,
            trigger: formState.trigger,
          })
        )
      );

      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`Failed to create ${failures.length} alert(s). No deletions performed.`);
      }
    }

    if (ops.deletesAfterSuccess.length > 0) {
      const deleteResults = await Promise.allSettled(ops.deletesAfterSuccess.map(id => _API.deleteAlert(id)));
      const deleteFailures = deleteResults.filter(r => r.status === 'rejected');
      if (deleteFailures.length > 0) {
        throw new Error(`Failed to delete ${deleteFailures.length} alert(s). Some alerts may need manual cleanup.`);
      }
    }
  }

  return { computeSaveOps, executeSaveOps };
})();

if (typeof module !== 'undefined') module.exports = SaveOps;
