// Prepare generated Sturmtiger art and register its fixed-gun unit.
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');
const source = 'source_art/tanks/sturmtiger';
function add(file, base, key, edits, update = false) {
  const rows = chooseParsedRows(decodeTable(file).text, []).rows;
  const existing = rows.find(r => r[0] === key);
  if (existing && !update) return;
  const row = existing ?? [...rows.find(r => r[0] === base)];
  for (const [name, value] of Object.entries(edits)) row[rows[0].indexOf(name)] = String(value);
  if (!existing) rows.push(row);
  fs.writeFileSync(file, '\ufeff' + rowsToCsv(rows));
}
async function main() {
  // Both generated states use the same source canvas and crop, never independent trims.
  const crop = { left: 0, top: 0, width: 1622, height: 970 };
  for (const [state, suffix] of [['normal', 'top'], ['destroyed', 'top_destroyed']]) {
    const dest = `assets/resources/textures/units/sturmtiger_${suffix}.png`;
    await sharp(`${source}/${state}-generated.png`).extract(crop).resize(150, 90).png().toFile(dest);
    let text = fs.readFileSync('assets/resources/textures/units/su152_top.png.meta', 'utf8');
    const uuid = JSON.parse(text).uuid;
    const targetUuid = fs.existsSync(dest + '.meta') ? JSON.parse(fs.readFileSync(dest + '.meta', 'utf8')).uuid : crypto.randomUUID();
    const meta = JSON.parse(text.replaceAll(uuid, targetUuid).replaceAll('su152_top', `sturmtiger_${suffix}`));
    const u = meta.subMetas.f9941.userData;
    Object.assign(u, { width: 150, height: 90, rawWidth: 150, rawHeight: 90 });
    u.vertices = { rawPosition: [-75,-45,0,75,-45,0,-75,45,0,75,45,0], indexes: [0,1,2,2,1,3], uv: [0,90,150,90,0,0,150,0], nuv: [0,0,1,0,0,1,1,1], minPos: [-75,-45,0], maxPos: [75,45,0] };
    fs.writeFileSync(dest + '.meta', JSON.stringify(meta, null, 2) + '\n');
  }
  const imgs = await Promise.all(['top','top_destroyed'].map(s => sharp(`assets/resources/textures/units/sturmtiger_${s}.png`).toBuffer()));
  await sharp({create:{width:320,height:107,channels:4,background:'#777777'}}).composite(imgs.map((input,i)=>({input,left:5+i*160,top:10}))).png().toFile(`${source}/game-size-preview.png`);
  await sharp(`${source}/game-size-preview.png`).resize(1280,428,{kernel:'nearest'}).toFile(`${source}/game-size-preview-4x.png`);
  add('data/units.csv', 'stug3', 'sturmtiger', { unitKind:'sturmtiger', displayName:'突击虎', notes:'独立突击虎美术单位；固定主炮；战斗参数暂沿用stug3，待单独平衡' });
  add('data/tank_visuals.csv', 'stug3', 'sturmtiger', { kind:'sturmtiger', displayName:'Sturmtiger', topSpritePath:'textures/units/sturmtiger_top/spriteFrame', destroyedSpritePath:'textures/units/sturmtiger_top_destroyed/spriteFrame', fitScale:0.82, offsetForward:0, topTrimW:150, topTrimH:90, muzzleSpriteX:8, muzzleSpriteY:40, commanderHatchSpriteX:56, commanderHatchSpriteY:26, commanderHatchScale:20, trackBodyLengthScale:0.96, notes:'Direct colorization of user top plan; small rectangular mortar and oval shield; covered tracks; shared-canvas wreck' }, true);
  for (const file of ['tools/buildUnitDB.js','tools/buildTankVisualDB.js']) {
    let s = fs.readFileSync(file,'utf8');
    if (!s.includes("'sturmtiger'")) s = s.replaceAll("'stug3',", "'stug3', 'sturmtiger',");
    fs.writeFileSync(file,s);
  }
  const types = 'assets/scripts/core/types.ts';
  let s = fs.readFileSync(types,'utf8');
  if (!s.includes("| 'sturmtiger'")) s = s.replace("  | 'stug3'", "  | 'stug3'\n  | 'sturmtiger'");
  if (!s.includes("kind === 'sturmtiger'")) s = s.replace("|| kind === 'stug3'", "|| kind === 'stug3'\n    || kind === 'sturmtiger'");
  fs.writeFileSync(types,s);
  const menu = 'assets/scripts/view/MainMenuScene.ts';
  s = fs.readFileSync(menu,'utf8');
  if (!s.includes("sturmtiger: '突击虎'")) s = s.replace("stug3: 'StuG III G',", "stug3: 'StuG III G',\n      sturmtiger: '突击虎',");
  fs.writeFileSync(menu,s);
  if (!fs.readFileSync('data/lang.csv','utf8').includes('unit.name.sturmtiger,')) fs.appendFileSync('data/lang.csv','\nunit.name.sturmtiger,突击虎,Sturmtiger\n');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
