const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');
const source = 'source_art/tanks/elefant';
function add(file, base, key, edits) {
  const rows = chooseParsedRows(decodeTable(file).text, []).rows;
  let row = rows.find(r => r[0] === key);
  if (!row) { row = [...rows.find(r => r[0] === base)]; rows.push(row); }
  for (const [name, value] of Object.entries(edits)) {
    const index = rows[0].indexOf(name);
    if (index < 0) throw Error('Missing column ' + name);
    row[index] = String(value);
  }
  fs.writeFileSync(file, '\ufeff' + rowsToCsv(rows));
}
async function main() {
  const geometry = JSON.parse(fs.readFileSync(`${source}/geometry.json`, 'utf8'));
  const { width, height, crop } = geometry;
  for (const suffix of ['top', 'top_destroyed']) {
    const dest = `assets/resources/textures/units/elefant_${suffix}.png`;
    await sharp(`${source}/${suffix}-aligned.png`).extract(crop).resize(width, height).png().toFile(dest);
    const original = fs.readFileSync('assets/resources/textures/units/jagdtiger_top.png.meta', 'utf8');
    const old = JSON.parse(original).uuid;
    const uuid = fs.existsSync(dest + '.meta') ? JSON.parse(fs.readFileSync(dest + '.meta', 'utf8')).uuid : crypto.randomUUID();
    const meta = JSON.parse(original.replaceAll(old, uuid).replaceAll('jagdtiger_top', `elefant_${suffix}`));
    const u = meta.subMetas.f9941.userData;
    Object.assign(u, { width, height, rawWidth: width, rawHeight: height, trimX: 0, trimY: 0, offsetX: 0, offsetY: 0 });
    u.vertices = { rawPosition: [-width/2,-height/2,0,width/2,-height/2,0,-width/2,height/2,0,width/2,height/2,0], indexes: [0,1,2,2,1,3], uv: [0,height,width,height,0,0,width,0], nuv: [0,0,1,0,0,1,1,1], minPos: [-width/2,-height/2,0], maxPos: [width/2,height/2,0] };
    fs.writeFileSync(dest + '.meta', JSON.stringify(meta, null, 2) + '\n');
  }
  add('data/tank_visuals.csv', 'jagdtiger', 'elefant', {
    kind: 'elefant', displayName: 'Elefant', topSpritePath: 'textures/units/elefant_top/spriteFrame', destroyedSpritePath: 'textures/units/elefant_top_destroyed/spriteFrame',
    fitScale: 1.02, offsetForward: 0.08, topTrimW: width, topTrimH: height,
    muzzleSpriteX: geometry.muzzle[0], muzzleSpriteY: geometry.muzzle[1], commanderHatchSpriteX: geometry.hatch[0], commanderHatchSpriteY: geometry.hatch[1], commanderHatchScale: 18,
    destroyedOffsetForward: 0, destroyedOffsetRight: 0, destroyedFitScale: 1,
    trackBodyLengthScale: geometry.trackBodyLengthScale, exhaustPort1Forward: 0.05, exhaustPort1Right: 0.29, exhaustPort2Forward: 0.05, exhaustPort2Right: -0.29,
    notes: '1944 Elefant structure; uniform game German gray; rear fixed casemate; forward three-grille engine deck; cupola; PaK43/2 L71; shared normal/wreck canvas'
  });
  add('data/units.csv', 'tigerking', 'elefant', {
    unitKind: 'elefant', displayName: '象式坦克歼击车', size: 2, mobility: 1,
    armorFront: 16, armorFrontSide: 12, armorRearSide: 11, armorRear: 11,
    visionType: 'fixed', turretTraverseSpeed: 0, penetration: 8, highExplosivePower: 3, firepower: 3,
    crewMembers: '1|2|3|4|5|6', crewRoleAssignments: 'loader=3|6',
    notes: '1944象式；固定88毫米PaK43/2 L71；六人双装填手；200毫米正面与80毫米侧后装甲映射为暂定游戏值，待平衡'
  });
  for (const file of ['tools/buildUnitDB.js', 'tools/buildTankVisualDB.js']) {
    let text = fs.readFileSync(file, 'utf8');
    if (!text.includes("'elefant'")) text = text.replaceAll("'jagdtiger',", "'jagdtiger', 'elefant',");
    fs.writeFileSync(file, text);
  }
  const types = 'assets/scripts/core/types.ts';
  let text = fs.readFileSync(types, 'utf8');
  if (!text.includes("| 'elefant'")) text = text.replace("  | 'jagdtiger'", "  | 'jagdtiger'\n  | 'elefant'");
  if (!text.includes("kind === 'elefant'")) text = text.replace("|| kind === 'jagdtiger'", "|| kind === 'jagdtiger'\n    || kind === 'elefant'");
  fs.writeFileSync(types, text);
  const menu = 'assets/scripts/view/MainMenuScene.ts';
  text = fs.readFileSync(menu, 'utf8');
  if (!text.includes("elefant: '象式'")) text = text.replace("jagdtiger: '猎虎',", "jagdtiger: '猎虎',\n      elefant: '象式',");
  fs.writeFileSync(menu, text);
  if (!fs.readFileSync('data/lang.csv', 'utf8').includes('unit.name.elefant,')) fs.appendFileSync('data/lang.csv', '\nunit.name.elefant,象式坦克歼击车,Elefant\n');
  const imgs = await Promise.all(['top', 'top_destroyed'].map(s => sharp(`assets/resources/textures/units/elefant_${s}.png`).toBuffer()));
  await sharp({create: {width: width*2+30, height: height+20, channels:4, background:'#4b5156'}}).composite(imgs.map((input,i) => ({input,left:5+i*(width+20),top:10}))).png().toFile(`${source}/game-size-preview.png`);
  await sharp(`${source}/game-size-preview.png`).resize((width*2+30)*3,(height+20)*3,{kernel:'nearest'}).toFile(`${source}/game-size-preview-3x.png`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
