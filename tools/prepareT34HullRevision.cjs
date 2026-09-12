// Correct the interior rear-deck geometry while retaining live calibrated pivots.
const fs = require('fs');
const path = require('path');
const { register } = require('./prepareT34SimplifiedArt.cjs');
const { chooseParsedRows, decodeTable } = require('./csvSmart');
const root = path.resolve(__dirname, '..');
(async () => {
  for (const kind of ['t34', 't34_85']) {
    await register(kind, 'hull', 'before-top_hull.png', 'hull-v2');
    await register(kind, 'destroyed', 'before-top_hull.png', 'hull-v2');
    const rows = chooseParsedRows(decodeTable(path.join(root, 'source_art/tanks', kind, 'hull-v2/before-tank_visuals.csv')).text, []).rows;
    const row = rows.find(r => r[0] === kind), n = key => Number(row[rows[0].indexOf(key)]);
    const p = path.join(root, 'data/tank_art', `${kind}.json`);
    const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
    manifest.inputs.hull.path = `source_art/tanks/${kind}/hull-v2/hull-source.png`;
    manifest.inputs.destroyed.path = `source_art/tanks/${kind}/hull-v2/destroyed-source.png`;
    manifest.inputs.turret.path = `source_art/tanks/${kind}/hull-v2/before-top_turret.png`;
    manifest.sourceGeometry = { hullPivot: [n('turretPivotX'), n('turretPivotY')], turretPivot: [n('turretSpritePivotX'), n('turretSpritePivotY')], muzzle: [n('muzzleSpriteX'), n('muzzleSpriteY')], commanderHatch: [n('commanderHatchSpriteX'), n('commanderHatchSpriteY')] };
    manifest.notes = 'Rear-deck correction from pre-simplification approved hulls and blueprints. Rectangular rear fender end caps restored; rear panel seams meet inner cap corners. Matching T34 family hull proportions, variant fuel layouts. Current turret art and calibrated display geometry retained.';
    fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
