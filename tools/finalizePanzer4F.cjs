'use strict';
// tank:prepare normalizes edge alpha. Restore exact shared hull/wreck pixels,
// then deterministically recompose the complete F sprite from runtime layers.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {composeTop} = require('./prepareTankArt.cjs');
const {chooseParsedRows,decodeTable} = require('./csvSmart');
const root = path.resolve(__dirname,'..');
const art = path.join(root,'assets/resources/textures/units');
async function main() {
  for(const suffix of ['top_hull','top_destroyed']) fs.copyFileSync(path.join(art,`panzer4_${suffix}.png`),path.join(art,`panzer4_f_${suffix}.png`));
  const hull = await sharp(path.join(art,'panzer4_f_top_hull.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const turret = await sharp(path.join(art,'panzer4_f_top_turret.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const rows = chooseParsedRows(decodeTable(path.join(root,'data/tank_visuals.csv')).text,['kind']).rows;
  const headers = rows[0].map(value=>value.replace(/^\uFEFF/,''));
  const row = rows.find(value=>value[headers.indexOf('kind')]==='panzer4_f');
  const value = name=>Number(row[headers.indexOf(name)]);
  await composeTop(hull,turret,[value('turretPivotX'),value('turretPivotY')],[value('turretSpritePivotX'),value('turretSpritePivotY')],path.join(art,'panzer4_f_top.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
