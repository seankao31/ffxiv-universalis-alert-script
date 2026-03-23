const WorldMap = require('../src/worldmap');

describe('WorldMap', () => {
  test('WORLDS contains exactly 8 worlds', () => {
    expect(WorldMap.WORLDS).toHaveLength(8);
  });

  test('worldById returns correct name for known ID', () => {
    expect(WorldMap.worldById(4030)).toEqual({ worldId: 4030, worldName: '利維坦' });
  });

  test('worldById returns null for unknown ID', () => {
    expect(WorldMap.worldById(9999)).toBeNull();
  });

  test('all world IDs are in range 4028–4035', () => {
    WorldMap.WORLDS.forEach(w => {
      expect(w.worldId).toBeGreaterThanOrEqual(4028);
      expect(w.worldId).toBeLessThanOrEqual(4035);
    });
  });
});
