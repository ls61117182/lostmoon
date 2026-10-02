// Register Ausf. N with and without Schurzen, using the matching Ausf. M hulls.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const variants = [
  { kind: 'panzer3_n', source: 'panzer3_m_no_schurzen', name: '3号坦克N型', english: 'Panzer III Ausf. N' },
  { kind: 'panzer3_n_schurzen', source: 'panzer3_m', name: '3号坦克N型（附加装甲）', english: 'Panzer III Ausf. N (Additional Armor)' },
];

function updateTable(relativePath, edits) {
  const file = path.join(ROOT, relativePath);
  const rows = chooseParsedRows(decodeTable(file).text, ['kind', 'unitKind', 'displayName']).rows;
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, ''));
  const keyColumn = headers.includes('unitKind') ? 'unitKind' : 'kind';
  for (const variant of variants) {
    if (rows.some(row => row[headers.indexOf(keyColumn)] === variant.kind)) continue;
    const source = rows.find(row => row[headers.indexOf(keyColumn)] === variant.source);
    if (!source) throw Error(`${relativePath}: missing ${variant.source}`);
    const row = [...source];
    for (const [column, value] of Object.entries(edits(variant))) {
      const index = headers.indexOf(column);
      if (index < 0) throw Error(`${relativePath}: missing ${column}`);
      row[index] = String(value);
    }
    rows.push(row);
  }
  fs.writeFileSync(file, `\uFEFF${rowsToCsv(rows)}`);
}

updateTable('data/units.csv', variant => ({
  unitKind: variant.kind,
  displayName: variant.name,
  penetration: 1,
  highExplosivePower: 2,
  notes: '三号坦克N型；短75毫米KwK 37 L/24；沿用对应M型车身及装甲数据',
}));

updateTable('data/tank_visuals.csv', variant => ({
  kind: variant.kind,
  displayName: variant.english,
  topSpritePath: `textures/units/${variant.kind}_top/spriteFrame`,
  hullSpritePath: `textures/units/${variant.kind}_top_hull/spriteFrame`,
  turretSpritePath: `textures/units/${variant.kind}_top_turret/spriteFrame`,
  destroyedSpritePath: `textures/units/${variant.kind}_top_destroyed/spriteFrame`,
  notes: 'Ausf. N turret redrawn from user three-view; short 7.5 cm L/24 gun; corresponding Ausf. M hull retained',
}));

const langFile = path.join(ROOT, 'data/lang.csv');
let lang = fs.readFileSync(langFile, 'utf8');
for (const variant of variants) {
  const key = `unit.name.${variant.kind},`;
  if (!lang.includes(key)) lang += `${key}${variant.name},${variant.english}\n`;
}
fs.writeFileSync(langFile, lang);

const artDir = path.join(ROOT, 'assets/resources/textures/units');
for (const variant of variants) {
  for (const suffix of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
    const oldName = `${variant.source}_${suffix}`;
    const newName = `${variant.kind}_${suffix}`;
    const oldFile = path.join(artDir, `${oldName}.png`);
    const newFile = path.join(artDir, `${newName}.png`);
    if (!fs.existsSync(newFile)) fs.copyFileSync(oldFile, newFile);
    if (!fs.existsSync(`${newFile}.meta`)) {
      const meta = fs.readFileSync(`${oldFile}.meta`, 'utf8');
      const oldUuid = JSON.parse(meta).uuid;
      const newUuid = crypto.randomUUID();
      fs.writeFileSync(`${newFile}.meta`, meta.replaceAll(oldUuid, newUuid).replaceAll(oldName, newName));
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, `data/tank_art/${variant.source}.json`), 'utf8'));
  manifest.kind = variant.kind;
  manifest.notes = `Ausf. N turret independently redrawn from user three-view; short 7.5 cm gun. Matching Ausf. M hull and wreck retained. ${variant.kind === 'panzer3_n_schurzen' ? 'External Schurzen rails and supports included.' : 'No external Schurzen rails or supports.'}`;
  manifest.inputs.turret.path = `source_art/tanks/panzer3_n/${variant.kind}-turret-selected.png`;
  manifest.sourceGeometry.muzzle = [518, 505];
  manifest.sourceGeometry.commanderHatch = [1174, 505];
  fs.writeFileSync(path.join(ROOT, `data/tank_art/${variant.kind}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}
