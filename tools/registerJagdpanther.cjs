const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');
const source = 'source_art/tanks/jagdpanther';
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
    const dest = `assets/resources/textures/units/jagdpanther_${suffix}.png`;
    await sharp(`${source}/${suffix}-aligned.png`).extract(crop).resize(width, height).png().toFile(dest);
    const original = fs.readFileSync('assets/resources/textures/units/jagdtiger_top.png.meta', 'utf8');
    const old = JSON.parse(original).uuid;
    const uuid = fs.existsSync(dest + '.meta') ? JSON.parse(fs.readFileSync(dest + '.meta', 'utf8')).uuid : crypto.randomUUID();
    const meta = JSON.parse(original.replaceAll(old, uuid).replaceAll('jagdtiger_top', `jagdpanther_${suffix}`));
    const u = meta.subMetas.f9941.userData;
    Object.assign(u, { width, height, rawWidth: width, rawHeight: height, trimX: 0, trimY: 0, offsetX: 0, offsetY: 0 });
    u.vertices = { rawPosition: [-width/2,-height/2,0,width/2,-height/2,0,-width/2,height/2,0,width/2,height/2,0], indexes: [0,1,2,2,1,3], uv: [0,height,width,height,0,0,width,0], nuv: [0,0,1,0,0,1,1,1], minPos: [-width/2,-height/2,0], maxPos: [width/2,height/2,0] };
    fs.writeFileSync(dest + '.meta', JSON.stringify(meta, null, 2) + '\n');
  }
  add('data/tank_visuals.csv', 'jagdtiger', 'jagdpanther', {
    kind: 'jagdpanther', displayName: '追猎者', topSpritePath: 'textures/units/jagdpanther_top/spriteFrame', destroyedSpritePath: 'textures/units/jagdpanther_top_destroyed/spriteFrame',
    fitScale: 1.02, offsetForward: 0.12, topTrimW: width, topTrimH: height,
    muzzleSpriteX: geometry.muzzle[0], muzzleSpriteY: geometry.muzzle[1], commanderHatchSpriteX: geometry.hatch[0], commanderHatchSpriteY: geometry.hatch[1], commanderHatchScale: 16,
    destroyedOffsetForward: 0, destroyedOffsetRight: 0, destroyedFitScale: 1,
    trackBodyLengthScale: geometry.trackBodyLengthScale, exhaustPort1Forward: -0.43, exhaustPort1Right: 0.08, exhaustPort2Forward: -0.43, exhaustPort2Right: -0.08,
    notes: 'Direct simplified recolor of user overhead plan; reference proportions; fully covered side tracks; offset gun axis; common normal and wreck canvas'
  });
  add('data/units.csv', 'panther', 'jagdpanther', {
    unitKind: 'jagdpanther', displayName: '追猎者', size: 3, mobility: 3,
    armorFront: 14, armorFrontSide: 11, armorRearSide: 9, armorRear: 8,
    visionType: 'fixed', turretTraverseSpeed: 0, penetration: 8, highExplosivePower: 3, firepower: 4,
    crewMembers: '1|2|3|4|5', crewRoleAssignments: '',
    notes: '追猎者固定主炮；五人乘员；装甲机动沿用豹式、穿甲沿用象式的暂定游戏值，待平衡'
  });
  for (const file of ['tools/buildUnitDB.js', 'tools/buildTankVisualDB.js']) {
    let text = fs.readFileSync(file, 'utf8');
    if (!text.includes("'jagdpanther'")) text = text.replaceAll("'jagdtiger',", "'jagdtiger', 'jagdpanther',");
    fs.writeFileSync(file, text);
  }
  const types = 'assets/scripts/core/types.ts';
  let text = fs.readFileSync(types, 'utf8');
  if (!text.includes("| 'jagdpanther'")) text = text.replace("  | 'jagdtiger'", "  | 'jagdtiger'\n  | 'jagdpanther'");
  if (!text.includes("kind === 'jagdpanther'")) text = text.replace("|| kind === 'jagdtiger'", "|| kind === 'jagdtiger'\n    || kind === 'jagdpanther'");
  fs.writeFileSync(types, text);
  const menu = 'assets/scripts/view/MainMenuScene.ts';
  text = fs.readFileSync(menu, 'utf8');
  if (!text.includes("jagdpanther: '追猎者'")) text = text.replace("jagdtiger: '猎虎',", "jagdtiger: '猎虎',\n      jagdpanther: '追猎者',");
  fs.writeFileSync(menu, text);
  if (!fs.readFileSync('data/lang.csv', 'utf8').includes('unit.name.jagdpanther,')) fs.appendFileSync('data/lang.csv', '\nunit.name.jagdpanther,追猎者,Hetzer\n');
  const imgs = await Promise.all(['top', 'top_destroyed'].map(s => sharp(`assets/resources/textures/units/jagdpanther_${s}.png`).toBuffer()));
  await sharp({create: {width: width*2+30, height: height+20, channels:4, background:'#4b5156'}}).composite(imgs.map((input,i) => ({input,left:5+i*(width+20),top:10}))).png().toFile(`${source}/game-size-preview.png`);
  await sharp(`${source}/game-size-preview.png`).resize((width*2+30)*3,(height+20)*3,{kernel:'nearest'}).toFile(`${source}/game-size-preview-3x.png`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
