/** Compact European railway village, using mission 01's dimensions and playable outline. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dirs = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
const step = (p, d) => ({ q: p.q + dirs[d][0], r: p.r + dirs[d][1] });
const offset = p => ({ col: p.q + Math.floor(p.r / 2), row: p.r });
const direction = (a, b) => dirs.findIndex(([q, r]) => a.q + q === b.q && a.r + r === b.r);
const village = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/missions/mission_01.json'), 'utf8'));
const tiles = village.tiles.map(row => row.map(tile => tile ? { t: 'f' } : null));
const axial = at => ({ q: at.col - Math.floor(at.row / 2), r: at.row });
const tileAt = at => {
  const tile = tiles[at.row]?.[at.col];
  if (!tile) throw new Error(`Layout leaves the village outline at ${at.col},${at.row}`);
  return tile;
};
const port = (tile, field, d) => {
  if (d < 0) throw new Error('Non-adjacent route cells');
  const flags = (tile[field] ?? '000000').split(''); flags[d] = '1'; tile[field] = flags.join('');
};

// A 3/2/2-sided elongated hexagon: 14 cells for the 11-car consist, plus three empty cells.
let p = { q: 2, r: 0 }; const ring = [];
for (const [d, length] of [3, 2, 2, 3, 2, 2].entries()) {
  for (let i = 0; i < length; i++) { ring.push(p); p = step(p, d); }
}
ring.forEach((p, i) => {
  const tile = tileAt(offset(p));
  port(tile, 'rl', direction(p, ring[(i + ring.length - 1) % ring.length]));
  port(tile, 'rl', direction(p, ring[(i + 1) % ring.length]));
});

// Southwest approach, village street, east exit; two level crossings on the loop.
const road = [[1, 5], [2, 4], [2, 3], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2]].map(([col, row]) => ({ col, row }));
road.forEach((at, i) => {
  const tile = tileAt(at); tile.t = 'r';
  port(tile, 'rd', i ? direction(axial(at), axial(road[i - 1])) : 2);
  port(tile, 'rd', i + 1 < road.length ? direction(axial(at), axial(road[i + 1])) : 0);
});
for (const [col, row] of [[3, 2], [4, 1], [3, 3]]) tileAt({ col, row }).bd = 1;
for (const [col, row] of [[6, 0], [6, 4], [1, 4]]) {
  const tile = tileAt({ col, row });
  if (tile.rl || tile.rd) throw new Error('Forest must not replace road or railway');
  tile.t = 'F';
}
for (const [col, row] of [[2, 2], [4, 5]]) tileAt({ col, row }).t = 'm';
const modules = ['panzerjaeger', 'howitzer', 'artillery_flak', 'command', 'tender', 'locomotive', 'tender', 'command', 'artillery_flak', 'howitzer', 'panzerjaeger'];
const mission = {
  id: 'mission_destroy_train', name: '击毁列车', theater: 'europe', season: 'summer', weather: 'clear',
  description: '沿西南公路接近铁路村庄，利用两处平交道口截击绕村行驶的装甲列车。摧毁全部机车即可完成目标，无需消灭支援敌军。列车采用 11 节对称 BP44 编组；防空炮闲置。村内有 2 队德军步兵和 2 辆三号 N 型坦克。',
  _comment: '地图尺寸及 36 格可用边界参考欧洲第一关“村庄”（8×6）；地形与部署重新设计，不继承第一关的掷骰部署、天气池、增援或任务。14 格闭环容纳 11 节列车并留出 3 格空轨。',
  cols: village.cols, rows: village.rows, tiles,
  sherman: { kind: 'sherman', at: { col: 1, row: 5 }, facing: 5, loaded: true },
  enemies: [
    { kind: 'german_infantry', at: { col: 3, row: 2 } },
    { kind: 'german_infantry', at: { col: 3, row: 3 } },
    { kind: 'panzer3_n', at: { col: 5, row: 2 }, facing: 3 },
    { kind: 'panzer3_n', at: { col: 4, row: 3 }, facing: 2 },
  ],
  trainRoutes: [{ id: 'bp44_loop', loop: true, cells: ring.map(offset) }],
  trains: [{ id: 'bp44', sideId: 'enemy', faction: 'german', routeId: 'bp44_loop', headIndex: 10,
    carriages: modules.map((module, index) => ({ id: `bp44_${index + 1}`, kind: `train_${module}` })) }],
  objective: { type: 'destroy_train', trainId: 'bp44' },
};
const out = path.join(root, 'assets/resources/missions/mission_destroy_train.json');
fs.writeFileSync(out, JSON.stringify(mission, null, 2) + '\n');
console.log(`Created ${path.relative(root, out)}: ${mission.cols}x${mission.rows}, ${tiles.flat().filter(Boolean).length} playable cells, ${ring.length} railway cells, 11 carriages, 2 infantry, 2 Panzer III N.`);
