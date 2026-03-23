const WorldMap = (() => {
  const WORLDS = [
    { worldId: 4028, worldName: '伊弗利特' },
    { worldId: 4029, worldName: '迦樓羅' },
    { worldId: 4030, worldName: '利維坦' },
    { worldId: 4031, worldName: '鳳凰' },
    { worldId: 4032, worldName: '奧汀' },
    { worldId: 4033, worldName: '巴哈姆特' },
    { worldId: 4034, worldName: '拉姆' },
    { worldId: 4035, worldName: '泰坦' },
  ];

  function worldById(id) {
    return WORLDS.find(w => w.worldId === id) || null;
  }

  return { WORLDS, worldById };
})();

if (typeof module !== 'undefined') module.exports = WorldMap;
