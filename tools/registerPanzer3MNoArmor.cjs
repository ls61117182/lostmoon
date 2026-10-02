// Register a separate Panzer III M variant while retaining the existing unit.
const fs = require('fs');
const crypto = require('crypto');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');

const kind = 'panzer3_m_no_schurzen';
function cloneCsvRow(file, edits) {
  const rows = chooseParsedRows(decodeTable(file).text, []).rows;
  if (rows.some(row => row[0] === kind)) return;
  const source = rows.find(row => row[0] === 'panzer3_m');
  if (!source) throw Error(`${file}: missing panzer3_m`);
  const row = [...source];
  for (const [key, value] of Object.entries(edits)) {
    const column = rows[0].indexOf(key);
    if (column < 0) throw Error(`${file}: missing column ${key}`);
    row[column] = String(value);
  }
  rows.push(row);
  fs.writeFileSync(file, `\ufeff${rowsToCsv(rows)}`);
}

cloneCsvRow('data/units.csv', {
  unitKind: kind,
  displayName: '3号坦克M型',
  notes: '仅移除标注的外围附加装甲横条与支架；本体装甲和M型战斗参数沿用原单位',
});
cloneCsvRow('data/tank_visuals.csv', {
  kind,
  displayName: 'Panzer III Ausf. M',
  topSpritePath: `textures/units/${kind}_top/spriteFrame`,
  hullSpritePath: `textures/units/${kind}_top_hull/spriteFrame`,
  turretSpritePath: `textures/units/${kind}_top_turret/spriteFrame`,
  destroyedSpritePath: `textures/units/${kind}_top_destroyed/spriteFrame`,
  notes: 'Original Ausf. M pixels retained on armored hull and turret; peripheral Schurzen removed',
});

for (const suffix of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
  const src = `assets/resources/textures/units/panzer3_m_${suffix}.png`;
  const dest = `assets/resources/textures/units/${kind}_${suffix}.png`;
  if (fs.existsSync(dest)) continue;
  fs.copyFileSync(src, dest);
  const meta = JSON.parse(fs.readFileSync(`${src}.meta`, 'utf8'));
  const oldId = meta.uuid;
  const newId = crypto.randomUUID();
  let contents = JSON.stringify(meta, null, 2)
    .replaceAll(oldId, newId)
    .replaceAll(`panzer3_m_${suffix}`, `${kind}_${suffix}`);
  fs.writeFileSync(`${dest}.meta`, `${contents}\n`);
}

const langFile = 'data/lang.csv';
const lang = fs.readFileSync(langFile, 'utf8');
if (!lang.includes(`unit.name.${kind},`))
  fs.appendFileSync(langFile, `\nunit.name.${kind},3号坦克M型,Panzer III Ausf. M\n`);
