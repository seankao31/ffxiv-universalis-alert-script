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

  test('checked world with identical existing alert → in skippedWorlds', () => {
    const ops = computeSaveOps(existingGroup, formState([4030]), WORLDS);
    expect(ops.skippedWorlds).toEqual([
      expect.objectContaining({ worldId: 4030, worldName: '利維坦' }),
    ]);
  });

  test('skippedWorlds empty when no worlds are skipped', () => {
    const ops = computeSaveOps(null, formState([4028, 4029]), WORLDS);
    expect(ops.skippedWorlds).toEqual([]);
  });

  test('mixed new and existing worlds → skippedWorlds has only the existing ones', () => {
    const ops = computeSaveOps(existingGroup, formState([4028, 4030]), WORLDS);
    expect(ops.postsNeeded.map(w => w.worldId)).toContain(4028);
    expect(ops.skippedWorlds).toEqual([
      expect.objectContaining({ worldId: 4030 }),
    ]);
  });

  test('trigger change → skippedWorlds empty (world needs re-creation)', () => {
    const newTrigger = { ...trigger, comparison: { lt: { target: 200 } } };
    const ops = computeSaveOps(existingGroup, formState([4030], newTrigger), WORLDS);
    expect(ops.skippedWorlds).toEqual([]);
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

  test('returns netChange = postsNeeded.length - deletesAfterSuccess.length', () => {
    const ops = computeSaveOps(null, formState([4028, 4029]), WORLDS, 0);
    expect(ops.netChange).toBe(2);
  });

  test('returns capacityError null when new alerts fit within limit', () => {
    const ops = computeSaveOps(null, formState([4028, 4029]), WORLDS, 38);
    expect(ops.capacityError).toBeNull();
  });

  test('returns capacityError when new alerts would exceed MAX_ALERTS', () => {
    const ops = computeSaveOps(null, formState([4028, 4029, 4030]), WORLDS, 38);
    expect(ops.capacityError).toBe('Not enough alert slots (need 3, only 2 available)');
  });

  test('returns capacityError at exactly MAX_ALERTS with posts needed', () => {
    const ops = computeSaveOps(null, formState([4028]), WORLDS, 40);
    expect(ops.capacityError).toBe('Not enough alert slots (need 1, only 0 available)');
  });

  test('no capacityError when no posts are needed', () => {
    // All worlds unchecked → nothing to post
    const ops = computeSaveOps(null, formState([]), WORLDS, 40);
    expect(ops.capacityError).toBeNull();
  });

  test('edit with net zero change at full capacity → no capacityError', () => {
    const group8 = {
      name: 'My Alert', itemId: 44015, trigger,
      worlds: WORLDS.map(w => ({ worldId: w.worldId, alertId: `alert-${w.worldId}`, worldName: w.worldName })),
    };
    const newTrigger = { ...trigger, comparison: { lt: { target: 999 } } };
    const ops = computeSaveOps(group8, formState(WORLDS.map(w => w.worldId), newTrigger), WORLDS, 40);
    expect(ops.netChange).toBe(0); // 8 posts - 8 deletes
    expect(ops.capacityError).toBeNull();
  });

  test('edit that adds more worlds than it removes → capacityError when exceeds limit', () => {
    const ops = computeSaveOps(existingGroup, formState([4028, 4029, 4030, 4031, 4032]), WORLDS, 37);
    // net = 4 posts (4028, 4029, 4031, 4032) - 0 deletes = +4; 37 + 4 = 41 > 40
    expect(ops.capacityError).toBe('Not enough alert slots (need 4, only 3 available)');
  });

  test('edit that adds more worlds than it removes → no error when fits', () => {
    const ops = computeSaveOps(existingGroup, formState([4028, 4029, 4030, 4031, 4032]), WORLDS, 36);
    expect(ops.capacityError).toBeNull();
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

// --- executeSaveOps — interleaved execution ---
describe('executeSaveOps — interleaved execution', () => {
  beforeEach(() => jest.resetAllMocks());

  const formState = {
    name: 'Test',
    webhook: 'https://discord.com/wh',
    trigger: { filters: [], mapper: 'pricePerUnit', reducer: 'min', comparison: { lt: { target: 130 } } },
    selectedWorldIds: new Set([4028, 4029, 4030]),
  };

  test('with ample slots, all POSTs run before any DELETEs', async () => {
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
      ],
    };
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });

    await executeSaveOps(ops, 44015, formState, { availableSlots: 10 });

    const firstDelete = callOrder.indexOf('delete');
    const lastPost = callOrder.lastIndexOf('post');
    expect(firstDelete).toBeGreaterThan(lastPost);
  });

  test('with 0 available slots, deletes run before posts to free capacity', async () => {
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
      ],
    };
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });

    await executeSaveOps(ops, 44015, formState, { availableSlots: 0 });

    // With 0 slots, must delete before posting
    expect(callOrder[0]).toBe('delete');
    // All operations complete
    expect(callOrder.filter(c => c === 'post')).toHaveLength(2);
    expect(callOrder.filter(c => c === 'delete')).toHaveLength(2);
  });

  test('with limited slots, interleaves POST and DELETE batches', async () => {
    // 3 POSTs + 3 DELETEs (replacements), only 1 slot available
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
        { worldId: 4030, worldName: '利維坦' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
        { alertId: 'old-3', worldId: 4030, worldName: '利維坦' },
      ],
    };
    const callOrder = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => { callOrder.push('post'); return { id: 'x' }; });
    jest.spyOn(API, 'deleteAlert').mockImplementation(async () => { callOrder.push('delete'); });

    await executeSaveOps(ops, 44015, formState, { availableSlots: 1 });

    // Should interleave: post, delete, post, delete, post, delete
    expect(callOrder).toHaveLength(6);
    // First action must be a post (we have 1 slot)
    expect(callOrder[0]).toBe('post');
    // Verify interleaving pattern
    expect(callOrder.filter(c => c === 'post')).toHaveLength(3);
    expect(callOrder.filter(c => c === 'delete')).toHaveLength(3);
  });

  test('prefers deleting replaced alerts (matched by worldId) over unreplaced ones', async () => {
    // 2 POSTs for worlds 4028+4029, 3 DELETEs for 4028+4029+4030
    // 4028 and 4029 are replacements, 4030 is a pure removal
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
        { alertId: 'old-3', worldId: 4030, worldName: '利維坦' },
      ],
    };
    const deletedAlertIds = [];
    jest.spyOn(API, 'createAlert').mockImplementation(async () => ({ id: 'x' }));
    jest.spyOn(API, 'deleteAlert').mockImplementation(async (alertId) => { deletedAlertIds.push(alertId); });

    // Only 1 slot: post 1, need to delete to continue
    // After posting 4028, should prefer deleting old-1 (4028, replaced) over old-3 (4030, unreplaced)
    await executeSaveOps(ops, 44015, formState, { availableSlots: 1 });

    // The pure removal (old-3, worldId 4030) should be deleted last
    expect(deletedAlertIds[deletedAlertIds.length - 1]).toBe('old-3');
  });

  test('stops after current batch on POST failure mid-interleave', async () => {
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
      ],
    };
    // First batch: 1 slot → POST 4028 succeeds
    // After delete old-1 → POST 4029 fails
    let postCount = 0;
    jest.spyOn(API, 'createAlert').mockImplementation(async () => {
      postCount++;
      if (postCount === 2) throw new Error('Server error');
      return { id: 'x' };
    });
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();

    await expect(executeSaveOps(ops, 44015, formState, { availableSlots: 1 }))
      .rejects.toThrow('Failed to save alerts for: 迦樓羅');

    // Only 1 delete should have run (to free space for second POST attempt)
    expect(API.deleteAlert).toHaveBeenCalledTimes(1);
  });

  test('reports progress across interleaved batches', async () => {
    const ops = {
      postsNeeded: [
        { worldId: 4028, worldName: '伊弗利特' },
        { worldId: 4029, worldName: '迦樓羅' },
      ],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
        { alertId: 'old-2', worldId: 4029, worldName: '迦樓羅' },
      ],
    };
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'x' });
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();
    const progressCalls = [];

    await executeSaveOps(ops, 44015, formState, {
      availableSlots: 1,
      onProgress: (p) => progressCalls.push(p),
    });

    // With 1 slot: post, delete, post, delete — progress should track totals
    expect(progressCalls).toEqual([
      { phase: 'creating', completed: 1, total: 2 },
      { phase: 'removing', completed: 1, total: 2 },
      { phase: 'creating', completed: 2, total: 2 },
      { phase: 'removing', completed: 2, total: 2 },
    ]);
  });

  test('handles pure deletes with no posts (all worlds unchecked)', async () => {
    const ops = {
      postsNeeded: [],
      deletesAfterSuccess: [
        { alertId: 'old-1', worldId: 4028, worldName: '伊弗利特' },
      ],
    };
    jest.spyOn(API, 'createAlert').mockResolvedValue({ id: 'x' });
    jest.spyOn(API, 'deleteAlert').mockResolvedValue();

    await executeSaveOps(ops, 44015, formState, { availableSlots: 0 });

    expect(API.createAlert).not.toHaveBeenCalled();
    expect(API.deleteAlert).toHaveBeenCalledTimes(1);
  });
});
