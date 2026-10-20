const fs = require('fs');
const path = require('path');
const assert = require('assert');

const battle = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

const liveGuard = battle.match(/function isEnemyTopKind[\s\S]*?\n\}/)?.[0] ?? '';
const destroyedGuard = battle.match(/function isDestroyedTopKind[\s\S]*?\n\}/)?.[0] ?? '';

assert.match(liveGuard, /TANK_VISUAL_KINDS/, 'live tank rendering must use the generated visual-kind registry');
assert.match(destroyedGuard, /TANK_VISUAL_KINDS/, 'destroyed tank rendering must use the generated visual-kind registry');
assert.doesNotMatch(liveGuard, /k === 'maus'/, 'live rendering must not maintain a second hand-written Maus whitelist');
assert.doesNotMatch(destroyedGuard, /k === 'maus'/, 'destroyed rendering must not maintain a second hand-written Maus whitelist');

console.log('MausBattleRendering.test.js passed');

const test = require('node:test');
const sharp = require('sharp');

for (const scheme of ['', 'late_war']) {
  test(`Maus ${scheme || 'grey'} wreck has the exact intact chassis silhouette`, async () => {
    const folder = path.join(__dirname, '..', 'assets', 'resources', 'textures', 'units', scheme);
    const [hull, wreck] = await Promise.all([
      sharp(path.join(folder, 'maus_top_hull.png')).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true }),
      sharp(path.join(folder, 'maus_top_destroyed.png')).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true }),
    ]);
    assert.strictEqual(wreck.info.width, hull.info.width, 'wreck canvas width must match the intact hull');
    assert.strictEqual(wreck.info.height, hull.info.height, 'wreck canvas height must match the intact hull');
    assert.deepStrictEqual(wreck.data, hull.data, 'matching canvas dimensions alone must not hide a wider painted wreck');
  });

  test(`Maus ${scheme || 'grey'} wreck preserves every intact detail outside local damage`, async () => {
    const folder = path.join(__dirname, '..', 'assets', 'resources', 'textures', 'units', scheme);
    const [hull, wreck, mask] = await Promise.all([
      sharp(path.join(folder, 'maus_top_hull.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(path.join(folder, 'maus_top_destroyed.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(path.join(__dirname, '..', 'data', 'tank_art', 'maus_damage_mask.png')).greyscale().raw().toBuffer({ resolveWithObject: true }),
    ]);
    assert.strictEqual(mask.info.width, hull.info.width);
    assert.strictEqual(mask.info.height, hull.info.height);
    let allowed = 0;
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i]) {
        allowed++;
        continue;
      }
      const offset = i * 4;
      assert.deepStrictEqual(wreck.data.subarray(offset, offset + 4), hull.data.subarray(offset, offset + 4),
        `unbroken detail at ${i % hull.info.width},${Math.floor(i / hull.info.width)} changed`);
    }
    // Stronger ring, grille, access-lid and skirt damage still leaves over two
    // thirds of the accepted base image pixel-identical to the intact hull.
    assert.ok(allowed > 100 && allowed < mask.data.length * 0.32, 'damage must remain local and preserve most intact details');
  });
}

test('Maus turret uses the same neutral-gray paint baseline as its hull', async () => {
  const folder = path.join(__dirname, '..', 'assets', 'resources', 'textures', 'units');
  async function paintMedian(name) {
    const { data } = await sharp(path.join(folder, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = [[], [], []];
    for (let i = 0; i < data.length; i += 4) {
      const rgb = [data[i], data[i + 1], data[i + 2]];
      const light = (rgb[0] + rgb[1] + rgb[2]) / 3;
      if (data[i + 3] <= 220 || light <= 75 || light >= 210 || Math.max(...rgb) - Math.min(...rgb) >= 50) continue;
      rgb.forEach((value, c) => channels[c].push(value));
    }
    return channels.map(values => {
      values.sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    });
  }
  const [hull, turret] = await Promise.all([paintMedian('maus_top_hull.png'), paintMedian('maus_top_turret.png')]);
  hull.forEach((value, c) => assert.ok(Math.abs(value - turret[c]) <= 1, `paint channel ${c}: hull=${value}, turret=${turret[c]}`));
});
