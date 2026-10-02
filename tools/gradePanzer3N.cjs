// Lift the approved N turret art to the M turret's sampled mid-grey tone.
// Process RGB only so every silhouette and transparency pixel stays fixed.
'use strict';
const path = require('path');
const sharp = require('sharp');

const source = path.resolve(__dirname, '../source_art/tanks/panzer3_n');
const gamma = 0.77;

async function grade(kind) {
  const input = path.join(source, `${kind}-turret-color-matched.png`);
  const output = path.join(source, `${kind}-turret-matched-midgrey.png`);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    for (let channel = 0; channel < 3; channel++) {
      data[i + channel] = Math.round(255 * Math.pow(data[i + channel] / 255, gamma));
    }
  }
  await sharp(data, { raw: info }).png().toFile(output);
}

Promise.all(['panzer3_n', 'panzer3_n_schurzen'].map(grade))
  .catch(error => { console.error(error); process.exitCode = 1; });
