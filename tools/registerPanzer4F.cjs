'use strict';
// Register the short-gun Ausf. F; geometry is finalized by tank:prepare.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');
const root = path.resolve(__dirname, '..');
function addRow(file, key, edits) {
  const target = path.join(root, file);
  const rows = chooseParsedRows(decodeTable(target).text, [key]).rows;
  const headers = rows[0].map(v => v.replace(/^\uFEFF/, ''));
  if (rows.some(r => r[headers.indexOf(key)] === 'panzer4_f')) return;
  const row = [...rows.find(r => r[headers.indexOf(key)] === 'panzer4')];
  for (const [column, value] of Object.entries(edits)) {
    const index = headers.indexOf(column);
    if (index < 0) throw Error(`Missing ${column}`);
    row[index] = String(value);
  }
  rows.push(row);
  fs.writeFileSync(target, '\uFEFF' + rowsToCsv(rows));
}
addRow('data/units.csv', 'unitKind', {
  unitKind: 'panzer4_f', displayName: '4号F',
  armorFront: 9, armorFrontSide: 8, armorRearSide: 8, armorRear: 7,
  penetration: 1, highExplosivePower: 2, effectiveRange: 2,
  notes: '四号F型（F1）；短75毫米KwK 37 L/24；50毫米正面装甲；车身美术复用G型；短炮数值沿用三号N型尺度',
});
addRow('data/tank_visuals.csv', 'kind', {
  kind: 'panzer4_f', displayName: 'Panzer IV Ausf. F1',
  topSpritePath: 'textures/units/panzer4_f_top/spriteFrame',
  hullSpritePath: 'textures/units/panzer4_f_top_hull/spriteFrame',
  turretSpritePath: 'textures/units/panzer4_f_top_turret/spriteFrame',
  destroyedSpritePath: 'textures/units/panzer4_f_top_destroyed/spriteFrame',
  notes: 'Ausf. F1 turret redrawn against three-view; short KwK 37 L/24 without muzzle brake; G hull and hull wreck reused exactly',
});
const langFile = path.join(root, 'data/lang.csv');
const lang = fs.readFileSync(langFile, 'utf8');
if (!lang.includes('unit.name.panzer4_f,')) fs.appendFileSync(langFile, '\nunit.name.panzer4_f,4号F,Panzer IV Ausf. F1\n');
for (const suffix of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
  const oldName = `panzer4_${suffix}`;
  const newName = `panzer4_f_${suffix}`;
  const oldFile = path.join(root, `assets/resources/textures/units/${oldName}.png`);
  const newFile = path.join(root, `assets/resources/textures/units/${newName}.png`);
  if (!fs.existsSync(newFile)) fs.copyFileSync(oldFile, newFile);
  if (!fs.existsSync(`${newFile}.meta`)) {
    const meta = fs.readFileSync(`${oldFile}.meta`, 'utf8');
    fs.writeFileSync(`${newFile}.meta`, meta.replaceAll(JSON.parse(meta).uuid, crypto.randomUUID()).replaceAll(oldName, newName));
  }
}
