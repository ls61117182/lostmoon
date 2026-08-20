const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

const {
  alphaBounds,
  composeTop,
  parseArgs,
  transformPoint,
  validateManifest,
} = require('../tools/prepareTankArt.cjs');

function manifest() {
  return {
    schemaVersion: 1,
    kind: 'panzer4',
    inputs: {
      hull: { path: 'source/hull.png', background: 'alpha' },
      turret: { path: 'source/turret.png', background: 'chroma' },
      destroyed: { path: 'source/destroyed.png', background: 'alpha' },
    },
    processing: {
      alphaThreshold: 32,
      commonScale: 0.1,
      outlinePixels: 1,
      hullPadding: [1, 1, 1, 1],
      turretPadding: [0, 0, 0, 0],
    },
    sourceGeometry: {
      hullPivot: [500, 250],
      turretPivot: [360, 190],
      muzzle: [0, 190],
      commanderHatch: [460, 190],
    },
  };
}

test('accepts pnpm separator and parses a dry-run manifest invocation', () => {
  assert.deepEqual(
    parseArgs(['--', '--manifest', 'data/tank_art/panzer4.json', '--dry-run']),
    { dryRun: true, kind: '', manifest: 'data/tank_art/panzer4.json' },
  );
});

test('validates the single-tank manifest contract', () => {
  assert.doesNotThrow(() => validateManifest(manifest()));
  const invalid = manifest();
  invalid.processing.commonScale = 0;
  assert.throws(() => validateManifest(invalid), /commonScale/);
  const typo = manifest();
  typo.processing.commonSclae = 0.1;
  assert.throws(() => validateManifest(typo), /unknown field commonSclae/);
});

test('measures alpha content bounds at the configured threshold', () => {
  const data = Buffer.alloc(4 * 4 * 4);
  data[(1 * 4 + 1) * 4 + 3] = 32;
  data[(2 * 4 + 3) * 4 + 3] = 255;
  assert.deepEqual(
    alphaBounds({ data, info: { width: 4, height: 4, channels: 4 } }, 32),
    { left: 1, top: 1, width: 3, height: 2 },
  );
});

test('transforms source-space points through crop, scale and padding', () => {
  assert.deepEqual(
    transformPoint([125, 75], {
      cropLeft: 25,
      cropTop: 25,
      scaleX: 0.5,
      scaleY: 0.5,
      padLeft: 2,
      padTop: 3,
    }),
    [52, 28],
  );
});

test('expands a complete top canvas symmetrically around the hull', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-top-compose-test-'));
  const output = path.join(temp, 'top.png');
  try {
    const hull = {
      data: Buffer.alloc(10 * 6 * 4, 255),
      info: { width: 10, height: 6, channels: 4 },
    };
    const turret = {
      data: Buffer.alloc(8 * 2 * 4, 255),
      info: { width: 8, height: 2, channels: 4 },
    };
    const result = await composeTop(hull, turret, [5, 3], [7, 1], output);
    const metadata = await sharp(output).metadata();
    assert.deepEqual(result, {
      width: 14,
      height: 6,
      hullOffsetX: 2,
      hullOffsetY: 0,
    });
    assert.equal(metadata.width, 14);
    assert.equal(metadata.height, 6);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
