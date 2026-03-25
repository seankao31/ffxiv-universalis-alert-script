const SaveOps = require('../src/save-ops');
const API = require('../src/api');
const WorldMap = require('../src/worldmap');
const { computeSaveOps, executeSaveOps } = SaveOps;
const { WORLDS } = WorldMap;

// --- computeSaveOps ---
describe('computeSaveOps', () => {
  const trigger = { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } };
  const formState = (selectedWorldIds, overrideTrigger) => ({
    name: 'My Alert',
    webhook: 'https://discord.com/wh',
    trigger: overrideTrigger || trigger,
    selectedWorldIds: new Set(selectedWorldIds),
  });

  const existingGroup = {
    name: 'My Alert',
    itemId: 44015,
    trigger,
    worlds: [{ worldId: 4030, alertId: 'alert-4030', worldName: '利維坦' }],
  };

  test('newly checked world not in existing group → in postsNeeded', () => {
    const ops = computeSaveOps(existingGroup, formState([4030, 4031]), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toContain(4031);
  });

  test('unchecked world that had existing alert → in deletesAfterSuccess', () => {
    const ops = computeSaveOps(existingGroup, formState([4031]), WORLDS); // 4030 unchecked
    expect(ops.deletesAfterSuccess).toContainEqual(
      expect.objectContaining({ alertId: 'alert-4030', worldId: 4030, worldName: '利維坦' })
    );
    expect(ops.postsNeeded.map(w => w.worldId)).not.toContain(4030);
  });

  test('checked world with identical existing alert → no-op (not in either list)', () => {
    const ops = computeSaveOps(existingGroup, formState([4030]), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).not.toContain(4030);
    expect(ops.deletesAfterSuccess.map(d => d.alertId)).not.toContain('alert-4030');
  });

  test('checked world with different trigger → in both postsNeeded and deletesAfterSuccess', () => {
    const newTrigger = { ...trigger, comparison: { lt: { target: 200 } } };
    const ops = computeSaveOps(existingGroup, formState([4030], newTrigger), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toContain(4030);
    expect(ops.deletesAfterSuccess).toContainEqual(
      expect.objectContaining({ alertId: 'alert-4030', worldId: 4030, worldName: '利維坦' })
    );
  });

  test('null group (no existing alerts) → all selected worlds in postsNeeded', () => {
    const ops = computeSaveOps(null, formState([4028, 4029]), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toEqual([4028, 4029]);
    expect(ops.deletesAfterSuccess).toHaveLength(0);
  });

  test('name change on otherwise identical alert → world is in postsNeeded and deletesAfterSuccess', () => {
    const state = { ...formState([4030]), name: 'New Name' };
    const ops = computeSaveOps(existingGroup, state, WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toContain(4030);
    expect(ops.deletesAfterSuccess).toContainEqual(
      expect.objectContaining({ alertId: 'alert-4030', worldId: 4030, worldName: '利維坦' })
    );
  });
});

// --- executeSaveOps ---
describe('executeSaveOps', () => {
  beforeEach(() => jest.resetAllMocks());

  const ops = {
    postsNeeded: [
      { worldId: 4030, worldName: '利維坦' },
      { worldId: 4031, worldName: '鳳凰' },
    ],
    deletesAfterSuccess: [{ alertId: 'old-alert-1', worldId: 4028, worldName: '伊弗利特' }],
  };
  const formState = {
    name: 'Test',
    webhook: 'https://discord.com/wh',
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    selectedWorldIds: new Set([4030, 4031]),
  };

  test('calls createAlert for each world in postsNeeded', async () => {
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'new' });
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    await executeSaveOps(ops, 44015, formState);
    expect(API.createAlert).toHaveBeenCalledTimes(2);
    expect(API.createAlert).toHaveBeenCalledWith(expect.objectContaining({ worldId: 4030, itemId: 44015 }));
  });

  test('calls deleteAlert only after all POSTs succeed', async () => {
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });
    await executeSaveOps(ops, 44015, formState);
    const firstDelete = callOrder.indexOf('delete');
    const lastPost = callOrder.lastIndexOf('post');
    expect(firstDelete).toBeGreaterThan(lastPost);
  });

  test('throws with world names when a POST fails', async () => {
    jest.spyOn(API, 'createAlert').mockRejectedValue(new Error('Network error'));
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    await expect(executeSaveOps(ops, 44015, formState)).rejects.toThrow(
      'Failed to save alerts for: 利維坦, 鳳凰'
    );
    expect(API.deleteAlert).not.toHaveBeenCalled();
  });

  test('throws with world names when a DELETE fails', async () => {
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'new' });
    jest.spyOn(API, 'deleteAlert').mockRejectedValue(new Error('500'));
    await expect(executeSaveOps(ops, 44015, formState)).rejects.toThrow(
      'Alerts saved, but failed to remove old alerts for: 伊弗利特'
    );
  });

  test('no-op when postsNeeded and deletesAfterSuccess are both empty', async () => {
    jest.spyOn(API, 'createAlert').mockResolvedValue({});
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    await executeSaveOps({ postsNeeded: [], deletesAfterSuccess: [] }, 44015, formState);
    expect(API.createAlert).not.toHaveBeenCalled();
    expect(API.deleteAlert).not.toHaveBeenCalled();
  });

  test('calls onProgress for each POST and DELETE', async () => {
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'new' });
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    const progressCalls = [];
    const onProgress = (p) => progressCalls.push(p);

    await executeSaveOps(ops, 44015, formState, { onProgress });

    expect(progressCalls).toEqual([
      { phase: 'creating', completed: 1, total: 2 },
      { phase: 'creating', completed: 2, total: 2 },
      { phase: 'removing', completed: 1, total: 1 },
    ]);
  });

  test('calls onProgress even when a POST fails', async () => {
    jest.spyOn(API, 'createAlert').mockRejectedValue(new Error('fail'));
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    const progressCalls = [];
    const onProgress = (p) => progressCalls.push(p);

    await expect(executeSaveOps(ops, 44015, formState, { onProgress })).rejects.toThrow();

    // Both POSTs should have reported progress despite failures
    expect(progressCalls).toEqual([
      { phase: 'creating', completed: 1, total: 2 },
      { phase: 'creating', completed: 2, total: 2 },
    ]);
  });

  test('partial POST failure: error only names the failed worlds', async () => {
    // First POST succeeds, second fails
    jest.spyOn(API, 'createAlert')
      .mockResolvedValueOnce({ id: 'new1' })
      .mockRejectedValueOnce(new Error('500'));
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();

    await expect(executeSaveOps(ops, 44015, formState)).rejects.toThrow(
      'Failed to save alerts for: 鳳凰'
    );
    // Deletes should NOT have run since POSTs partially failed
    expect(API.deleteAlert).not.toHaveBeenCalled();
  });

  test('partial DELETE failure: error only names the failed worlds', async () => {
    const multiDeleteOps = {
      postsNeeded: [],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '泰坦' },
        { alertId: 'old-3', worldId: 4030, worldName: '利維坦' },
      ],
    };
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'new' });
    // First delete succeeds, second fails, third succeeds
    jest.spyOn(API, 'deleteAlert')
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce();

    await expect(executeSaveOps(multiDeleteOps, 44015, formState)).rejects.toThrow(
      'Alerts saved, but failed to remove old alerts for: 泰坦'
    );
  });

  test('works without onProgress callback', async () => {
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'new' });
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    // Should not throw when onProgress is undefined
    await expect(executeSaveOps(ops, 44015, formState)).resolves.toBeUndefined();
  });

  test('uses worldId as fallback name when worldName is missing', async () => {
    const opsNoNames = {
      postsNeeded: [
        { worldId: 4030 },
        { worldId: 4031 },
      ],
      deletesAfterSuccess: [],
    };
    jest.spyOn(API, 'createAlert').mockRejectedValue(new Error('fail'));
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();

    await expect(executeSaveOps(opsNoNames, 44015, formState)).rejects.toThrow(
      'Failed to save alerts for: 4030, 4031'
    );
  });
});
