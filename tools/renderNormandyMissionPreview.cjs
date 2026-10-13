// Render the authored mission using its runtime ground and obstacle routines.
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { loadMission } = require('../assets/scripts/core/MissionLoader.ts');
const { offsetToAxial, neighbor, HexMap } = require('../assets/scripts/core/HexGrid.ts');
const { isAttachedATGunCrew } = require('../assets/scripts/core/types.ts');
const { Graphics, art, raster } = require('./renderNormandyTerrainPreview.cjs');
const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/missions/mission_13.json'), 'utf8'));
const mission = loadMission(data), radius = 48, ox = 105, oy = 184;
const project = pos => ({ x: Math.sqrt(3) * radius * (pos.q + pos.r / 2), y: 1.5 * radius * pos.r });
const point = (c, r) => project(offsetToAxial({ col: c, row: r }));
const uri = file => `data:image/png;base64,${fs.readFileSync(path.join(root, file)).toString('base64')}`;
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
async function main() {
  const chunk = raster.renderChunk(mission.map.all(), false, -50, -52, 900, 610);
  const ground = await sharp(Buffer.from(chunk.pixels), { raw: { width: chunk.textureWidth, height: chunk.textureHeight, channels: 4 } }).extract({ left: 1, top: 1, width: chunk.width, height: chunk.height }).png().toBuffer();
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="860"><rect width="1280" height="860" fill="#efe9dc"/><g font-family="Microsoft YaHei,sans-serif" fill="#333c32">';
  svg += '<text x="40" y="46" font-size="30">欧洲第 13 关 · 诺曼底登陆</text><text x="40" y="77" font-size="17">摧毁重炮碉堡与 Pak 38 → 打通内陆出口 → 向东驶离</text>';
  svg += `<image x="${ox-50}" y="${oy-52}" width="900" height="610" href="data:image/png;base64,${ground.toString('base64')}"/>`;
  const label = (c, r, text, color = '#273d32', dy = -29) => { const p = point(c, r); svg += `<text x="${ox+p.x}" y="${oy+p.y+dy}" text-anchor="middle" font-size="14" fill="${color}" stroke="#f7f0db" stroke-width="3" paint-order="stroke">${escape(text)}</text>`; };
  const edges = new Set();
  for (const tile of mission.map.all()) {
    const p = project(tile.pos), g = new Graphics();
    art.drawBeachOverlays(g, 0, 0, radius, !!tile.crater, !!tile.steelHedgehogs);
    // Native Graphics has Y-up coordinates; map preview has Y-down coordinates.
    svg += `<g transform="translate(${ox+p.x} ${oy+p.y}) scale(1 -1)">${g.items.join('')}</g>`;
    for (let dir = 0; dir < 6; dir++) {
      const to = neighbor(tile.pos, dir), key = [HexMap.keyOf(tile.pos), HexMap.keyOf(to)].sort().join('|');
      if (edges.has(key)) continue;
      edges.add(key);
      const wall = tile.seawalls?.[dir] || mission.map.get(to)?.seawalls?.[(dir+3)%6];
      const wire = mission.map.barbedWireBetween(tile.pos, to);
      if (!wire && !wall) continue;
      const angle = [-0, -60, -120, 180, 120, 60][dir];
      const a = (angle-30)*Math.PI/180, b = (angle+30)*Math.PI/180;
      const g = new Graphics(), x0=radius*Math.cos(a), y0=radius*Math.sin(a), x1=radius*Math.cos(b), y1=radius*Math.sin(b);
      if (wall) art.drawBeachEdge(g,x0,y0,x1,y1,radius,'seawall');
      if (wire) art.drawBeachEdge(g,x0,y0,x1,y1,radius,'wire',wire);
      svg += `<g transform="translate(${ox+p.x} ${oy+p.y}) scale(1 -1)">${g.items.join('')}</g>`;
    }
    if (tile.terrain === 'forest') {
      const tree = uri('assets/resources/textures/terrain/redesign_v3/europe_tree_01.png');
      for (const [dx, dy] of [[-18,-9],[18,-9],[0,20]]) svg += `<image href="${tree}" x="${ox+p.x+dx-27}" y="${oy+p.y+dy-27}" width="54" height="54"/>`;
    }
    if (tile.hasBuilding) svg += `<image href="${uri('assets/resources/textures/terrain/redesign_v3/rural_roof_01.png')}" x="${ox+p.x-25}" y="${oy+p.y-25}" width="50" height="50"/>`;
    if (!tile.displayOnly) {
      const points=Array.from({length:6},(_,i)=>{const a=(-30+i*60)*Math.PI/180;return `${ox+p.x+Math.cos(a)*radius},${oy+p.y+Math.sin(a)*radius}`;}).join(' ');
      svg += `<polygon points="${points}" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width=".7"/>`;
    }
  }
  for (const unit of [mission.sherman,...mission.allies,...mission.enemies].filter(unit=>!isAttachedATGunCrew(unit))) {
    const p = project(unit.pos), friendly = unit.sideId === 'player';
    const color = friendly ? '#37795b' : '#a44536';
    svg += `<circle cx="${ox+p.x}" cy="${oy+p.y}" r="28" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    const sprite = unit.kind === 'sherman' ? 'sherman_top.png' : unit.kind === 'german_heavy_artillery' ? 'heavy_artillery_top.png' : unit.kind === 'pak38' ? 'pak38_top.png' : null;
    if (sprite) svg += `<g transform="translate(${ox+p.x} ${oy+p.y}) rotate(${unit.kind==='sherman'?180:0})"><image href="${uri('assets/resources/textures/units/'+sprite)}" x="-31" y="-31" width="62" height="62"/></g>`;
    else for (const [dx,dy] of [[-8,-6],[8,-6],[0,8]]) svg += `<circle cx="${ox+p.x+dx}" cy="${oy+p.y+dy}" r="5" fill="${color}" stroke="#363a31" stroke-width="1"/>`;
  }
  label(2,3,'登陆起点','#245c43',-35); label(7,1,'重炮碉堡','#933827',-37); label(7,4,'Pak 38','#933827',-35);
  label(6,2,'上方缺口','#285e42',-35); label(6,5,'下方缺口','#285e42',32); label(9,3,'内陆出口','#a13b28',-35);
  const exit=point(9,3); svg+=`<path d="M${ox+exit.x+28} ${oy+exit.y} h42 m-12 -9 l12 9 -12 9" fill="none" stroke="#b43e2f" stroke-width="4"/>`;
  svg += '<text x="1000" y="158" font-size="23">关卡配置</text>';
  const notes = [
    ['地图','10 × 8 六角格'],['玩家','谢尔曼 × 1'],['友军','美军步兵 × 2'],['目标守军','重炮碉堡 / Pak 38'],['其他守军','德军步兵 × 3'],['第 3 回合末','车长额外行动'],['第 6 回合末','IV 号坦克增援 × 1'],['胜利条件','清除两类目标后撤离'],['路线选择','上路较短，有拒马'],['','下路较远，弹坑较多']
  ];
  notes.forEach(([a,b],i)=>{const y=202+i*49;svg+=`<text x="1000" y="${y}" font-size="14" fill="#777866">${a}</text><text x="1000" y="${y+22}" font-size="17">${b}</text>`;});
  svg += '<text x="40" y="803" font-size="16">绿色圈：玩家／友军　红色圈：敌军　钢梁交叉：拒马　暗色凹心：弹坑　窄灰条：海堤</text><text x="40" y="830" font-size="14" fill="#777866">由关卡 JSON、连续地形材质及原生障碍绘制代码生成；此图是配置预览。</text></g></svg>';
  const output=path.join(root,'source_art/terrain/normandy-concept-20261013');
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'mission-13-preview.svg'),svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(output,'mission-13-preview.png'));
  console.log('Saved mission-13-preview.svg and .png');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
