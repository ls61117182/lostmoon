// Normalize generated artwork to the original King Tiger source geometry.
// Run from the project root, then: pnpm run tank:prepare -- --kind tigerking
const sharp = require('sharp');
const path = require('path');
const { alphaBounds } = require('../../../../tools/prepareTankArt.cjs');
const file = name => path.join(__dirname, name);
async function bounds(name) {
  const rgba = await sharp(file(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return alphaBounds(rgba, 32);
}
(async () => {
  const hullBounds = await bounds('hull-generated.png');
  // Wreck uses exactly the normal hull crop and scale, never its own tight crop.
  for (const role of ['hull', 'destroyed']) {
    await sharp(file(`${role}-generated.png`)).extract(hullBounds)
      .resize(198, 98, { fit: 'fill' })
      .extend({ left: 1, right: 1, top: 1, bottom: 1, background: '#00000000' })
      .png().toFile(file(`${role}-selected.png`));
  }
  await sharp(file('turret-generated.png')).extract(await bounds('turret-generated.png'))
    .resize(238, 76, { fit: 'fill' })
    .extend({ left: 1, right: 1, top: 12, bottom: 12, background: '#00000000' })
    .png().toFile(file('turret-selected.png'));
})().catch(error => { console.error(error); process.exitCode = 1; });
