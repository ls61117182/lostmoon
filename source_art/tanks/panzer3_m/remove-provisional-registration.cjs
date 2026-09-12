// Remove this task's provisional registration while the rejected art is redrawn.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
process.chdir(root);
for (const file of ['data/tank_visuals.csv', 'data/units.csv', 'data/lang.csv']) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/^(?:panzer3_m|unit\.name\.panzer3_m),[^\r\n]*(?:\r?\n|$)/gm, '');
  fs.writeFileSync(file, text);
}
for (const file of ['tools/buildTankVisualDB.js', 'tools/buildUnitDB.js']) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll("'panzer3', 'panzer3_m',", "'panzer3',"));
}
const types = 'assets/scripts/core/types.ts';
fs.writeFileSync(types, fs.readFileSync(types, 'utf8').replace("\n  | 'panzer3_m'", '').replace("\n    || kind === 'panzer3_m'", ''));
const menu = 'assets/scripts/view/MainMenuScene.ts';
fs.writeFileSync(menu, fs.readFileSync(menu, 'utf8').replace("      panzer3_m: 'Pz III M',\n", ''));
// Only these exact new placeholder files were created by registerPanzer3M.cjs.
for (const suffix of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
  for (const ext of ['.png', '.png.meta']) {
    const p = path.join(root, `assets/resources/textures/units/panzer3_m_${suffix}${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
