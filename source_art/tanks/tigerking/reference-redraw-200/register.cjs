// Register generated layers to the proportions of the user's top-view blueprint.
// All final layers then use the same manifest commonScale; no axis stretching.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { alphaBounds } = require('../../../../tools/prepareTankArt.cjs');
const file = name => path.join(__dirname, name);
async function measure(name) {
  const r = await sharp(file(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { bounds: alphaBounds(r, 32), info: r.info };
}
(async () => {
  const hull = await measure('hull-selected.png');
  const turret = await measure('turret-generated.png');
  // Blueprint: hull with rear fittings spans x=139..426; gun+turret x=26..380.
  // Uniformly calibrate the isolated layer, since generation changed its scale.
  const calibration = (354 / 287) * hull.bounds.width / turret.bounds.width;
  const width = Math.round(turret.info.width * calibration);
  const height = Math.round(turret.info.height * calibration);
  await sharp(file('turret-generated.png')).resize(width, height, { fit: 'inside' })
    .png().toFile(file('turret-selected.png'));
  const factor = width / turret.info.width;
  const point = (x, y) => [Math.round(x * factor), Math.round(y * factor)];
  const manifest = {
    schemaVersion: 1, kind: 'tigerking',
    notes: 'User top-view blueprint; clean gray redraw; uniform turret registration to blueprint proportions; shared final scale and hull-aligned wreck.',
    inputs: {
      hull: { path: 'source_art/tanks/tigerking/reference-redraw-200/hull-selected.png', background: 'alpha' },
      turret: { path: 'source_art/tanks/tigerking/reference-redraw-200/turret-selected.png', background: 'alpha' },
      destroyed: { path: 'source_art/tanks/tigerking/reference-redraw-200/destroyed-selected.png', background: 'alpha' }
    },
    processing: {
      alphaThreshold: 32, commonScale: 198 / hull.bounds.width, outlinePixels: 0,
      hullPadding: [1, 1, 1, 1], turretPadding: [1, 1, 1, 1]
    },
    sourceGeometry: {
      hullPivot: [1100, 444], turretPivot: point(1203, 471),
      muzzle: point(36, 470), commanderHatch: point(1203, 552)
    }
  };
  fs.writeFileSync('data/tank_art/tigerking.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log({ hullBounds: hull.bounds, turretCalibration: factor, commonScale: manifest.processing.commonScale });
})().catch(error => { console.error(error); process.exitCode = 1; });
