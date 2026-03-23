const Grouping = require('../src/grouping');
const { normalizeTrigger, groupAlerts } = Grouping;

// --- normalizeTrigger ---
describe('normalizeTrigger', () => {
  const validTrigger = {
    reducer: 'min',
    comparison: { lt: { target: 130 } },
    filters: [],
    mapper: 'pricePerUnit',
  };

  test('returns keys in canonical order regardless of input order', () => {
    const result = normalizeTrigger(validTrigger);
    expect(Object.keys(JSON.parse(result))).toEqual(['filters', 'mapper', 'reducer', 'comparison']);
  });

  test('two triggers with same values but different key order produce identical string', () => {
    const t2 = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
    expect(normalizeTrigger(validTrigger)).toBe(normalizeTrigger(t2));
  });

  test('returns null for trigger with unknown extra keys', () => {
    const bad = { ...validTrigger, unknownKey: 'value' };
    expect(normalizeTrigger(bad)).toBeNull();
  });

  test('different comparison targets produce different strings', () => {
    const t200 = { ...validTrigger, comparison: { lt: { target: 200 } } };
    expect(normalizeTrigger(validTrigger)).not.toBe(normalizeTrigger(t200));
  });
});

// --- groupAlerts ---
describe('groupAlerts', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };

  const makeAlert = (overrides) => ({
    id: 'alert1',
    itemId: 44015,
    worldId: 4030,
    name: 'Test alert',
    discordWebhook: 'https://discord.com/wh',
    triggerVersion: 0,
    trigger,
    ...overrides,
  });

  test('two alerts for same item and trigger merge into one group', () => {
    const alerts = [makeAlert(), makeAlert({ id: 'alert2', worldId: 4031 })];
    const groups = groupAlerts(alerts);
    expect(groups).toHaveLength(1);
    expect(groups[0].worlds).toHaveLength(2);
  });

  test('two alerts for same item but different triggers produce two groups', () => {
    const alerts = [
      makeAlert(),
      makeAlert({ id: 'alert2', trigger: { ...trigger, comparison: { lt: { target: 200 } } } }),
    ];
    const groups = groupAlerts(alerts);
    expect(groups).toHaveLength(2);
  });

  test('alerts for different itemIds produce separate groups', () => {
    const alerts = [makeAlert(), makeAlert({ id: 'alert2', itemId: 99999 })];
    const groups = groupAlerts(alerts);
    expect(groups).toHaveLength(2);
  });

  test('group name is taken from the first alert in the group', () => {
    const alerts = [makeAlert({ name: 'First' }), makeAlert({ id: 'alert2', worldId: 4031, name: 'Second' })];
    const groups = groupAlerts(alerts);
    expect(groups[0].name).toBe('First');
  });

  test('alert with unknown trigger keys is a standalone single-world group', () => {
    const bad = makeAlert({ trigger: { ...trigger, extra: 'x' } });
    const groups = groupAlerts([bad]);
    expect(groups).toHaveLength(1);
    expect(groups[0].worlds).toHaveLength(1);
  });

  test('worlds include worldId and alertId from original alert', () => {
    const alert = makeAlert({ id: 'abc', worldId: 4030 });
    const groups = groupAlerts([alert]);
    expect(groups[0].worlds[0]).toMatchObject({ worldId: 4030, alertId: 'abc' });
  });

  test('empty array returns empty array', () => {
    expect(groupAlerts([])).toEqual([]);
  });
});
