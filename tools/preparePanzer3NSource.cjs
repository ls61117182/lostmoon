// Fit the independently drawn Ausf. N turrets to the approved M hull scale.
// No M turret pixels are used in either N turret.
'use strict';
const assert = require('assert');
const path = require('path');
const sharp = require('sharp');

const source = path.resolve(__dirname, '../source_art/tanks/panzer3_n');
const width = 1746;
const height = 901;
// The generated cutout is 1565x1005. Its solid body spans about x=445..1506.
// In the original overhead reference the solid turret spans x=202..455 while
// the M hull spans x=50..590. The hull source is 1456px wide, so the turret
// body should be about 682px wide. Scaling x by 0.643 gives that footprint;
// x=480 aligns the original gun tip, front, cupola and rear with the M hull.
// The y transform follows the reference's approximately 600px turret height.
const sourceWidth = 1565;
const sourceHeight = 1005;
const scaleX = 0.643;
const scaleY = 0.72;
const left = 480;
const top = 145;

async function fit(kind) {
  const input = path.join(source, `${kind}-turret-matched-midgrey.png`);
  const output = path.join(source, `${kind}-turret-selected.png`);
  const meta = await sharp(input).metadata();
  assert.equal(meta.width, sourceWidth);
  assert.equal(meta.height, sourceHeight);
  const scaledWidth = Math.round(sourceWidth * scaleX);
  const scaledHeight = Math.round(sourceHeight * scaleY);
  const resized = await sharp(input).resize(scaledWidth, scaledHeight, { fit: 'fill' }).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite([{ input: resized, left, top }]).png().toFile(output);
}

Promise.all(['panzer3_n', 'panzer3_n_schurzen'].map(fit))
  .catch(error => { console.error(error); process.exitCode = 1; });
