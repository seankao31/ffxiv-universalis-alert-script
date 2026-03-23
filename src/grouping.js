const Grouping = (() => {
  const TRIGGER_KEY_ORDER = ['filters', 'mapper', 'reducer', 'comparison'];

  function normalizeTrigger(trigger) {
    const triggerKeys = Object.keys(trigger).sort();
    const allowedKeys = [...TRIGGER_KEY_ORDER].sort();
    if (JSON.stringify(triggerKeys) !== JSON.stringify(allowedKeys)) return null;

    const normalized = {};
    for (const key of TRIGGER_KEY_ORDER) {
      normalized[key] = trigger[key];
    }
    return JSON.stringify(normalized);
  }

  function groupAlerts(alerts) {
    const groups = new Map(); // key: `${itemId}::${normalizedTrigger}` → group object

    for (const alert of alerts) {
      const normalized = normalizeTrigger(alert.trigger);
      // Use alert id as a unique fallback key for ungroupable alerts
      const key = normalized !== null
        ? `${alert.itemId}::${normalized}`
        : `ungroupable::${alert.id}`;

      if (!groups.has(key)) {
        groups.set(key, {
          itemId: alert.itemId,
          name: alert.name,
          trigger: alert.trigger,
          worlds: [],
        });
      }

      groups.get(key).worlds.push({
        worldId: alert.worldId,
        alertId: alert.id,
        worldName: null, // filled in by callers who have WorldMap access
      });
    }

    return Array.from(groups.values());
  }

  return { normalizeTrigger, groupAlerts };
})();

if (typeof module !== 'undefined') module.exports = Grouping;
