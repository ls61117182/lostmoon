// Add the Ausf. M as a separate visual unit; never rewrite the original Panzer III.
const fs = require('fs');
const crypto = require('crypto');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');
function addRow(file, key, edits) {
  const rows = chooseParsedRows(decodeTable(file).text, []).rows;
  if (rows.some(r => r[0] === key)) return;
  const row = [...rows.find(r => r[0] === 'panzer3')];
  for (const [name, value] of Object.entries(edits)) row[rows[0].indexOf(name)] = String(value);
  rows.push(row);
  fs.writeFileSync(file, '\ufeff' + rowsToCsv(rows));
}
addRow('data/units.csv', 'panzer3_m', {unitKind:'panzer3_m', displayName:'三号坦克M型', notes:'独立M型美术单位；战斗参数暂沿用panzer3，待单独平衡'});
addRow('data/tank_visuals.csv', 'panzer3_m', {
  kind:'panzer3_m', displayName:'Panzer III Ausf. M',
  ...Object.fromEntries([['topSpritePath','top'],['hullSpritePath','top_hull'],['turretSpritePath','top_turret'],['destroyedSpritePath','top_destroyed']].map(([k,v])=>[k,`textures/units/panzer3_m_${v}/spriteFrame`])),
  turretScale:1, turretOffsetForward:0, commanderHatchScale:20,
  notes:'Independent Ausf M; user technical reference; sand and olive camouflage; spaced skirts; common-scale layers'
});
for (const file of ['tools/buildTankVisualDB.js','tools/buildUnitDB.js']) {
  let s=fs.readFileSync(file,'utf8');
  if(!s.includes("'panzer3_m'")) s=s.replaceAll("'panzer3',", "'panzer3', 'panzer3_m',");
  fs.writeFileSync(file,s);
}
const types='assets/scripts/core/types.ts';
let s=fs.readFileSync(types,'utf8');
if(!s.includes("| 'panzer3_m'")) s=s.replace("  | 'panzer3'", "  | 'panzer3'\n  | 'panzer3_m'");
if(!s.includes("kind === 'panzer3_m'")) s=s.replace("|| kind === 'panzer3'", "|| kind === 'panzer3'\n    || kind === 'panzer3_m'");
fs.writeFileSync(types,s);
const menu='assets/scripts/view/MainMenuScene.ts';
s=fs.readFileSync(menu,'utf8');
if(!s.includes("panzer3_m: 'Pz III M'")) s=s.replace("panzer3: 'Pz III',", "panzer3: 'Pz III',\n      panzer3_m: 'Pz III M',");
fs.writeFileSync(menu,s);
const lang='data/lang.csv';
s=fs.readFileSync(lang,'utf8');
if(!s.includes('unit.name.panzer3_m,')) fs.appendFileSync(lang,'\nunit.name.panzer3_m,三号M型,Panzer III Ausf. M\n');
for(const suffix of ['top','top_hull','top_turret','top_destroyed']) {
  const old=`assets/resources/textures/units/panzer3_${suffix}.png`;
  const dest=`assets/resources/textures/units/panzer3_m_${suffix}.png`;
  if(fs.existsSync(dest)) continue;
  fs.copyFileSync(old,dest);
  let meta=fs.readFileSync(old+'.meta','utf8');
  const uuid=JSON.parse(meta).uuid;
  meta=meta.replaceAll(uuid,crypto.randomUUID()).replaceAll(`panzer3_${suffix}`,`panzer3_m_${suffix}`);
  fs.writeFileSync(dest+'.meta',meta);
}
