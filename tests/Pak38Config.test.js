const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const sharp = require('sharp');

function recordsFor(file, requiredHeaders) {
  const text = fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === delimiter) { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += c;
  }
  const headers = rows[0].map(cell => cell.trim().replace(/^\uFEFF/, ''));
  for (const required of requiredHeaders) assert(headers.includes(required), `missing CSV header ${required}`);
  return rows.slice(1).map(row => Object.fromEntries(
    headers.map((header, index) => [header, (row[index] ?? '').trim()]),
  ));
}

const unitRecords = recordsFor('data/units.csv', ['unitKind', 'displayName', 'faction']);
const visualRecords = recordsFor('data/tank_visuals.csv', ['kind', 'topSpritePath', 'destroyedSpritePath']);
const langRecords = recordsFor('data/lang.csv', ['key', 'zh', 'en']);

test('Pak 38 is an independent German unit with the Japanese AT-gun combat profile', () => {
  const japaneseGun = unitRecords.find(unit => unit.unitKind === 'at_gun');
  const pak38 = unitRecords.find(unit => unit.unitKind === 'pak38');
  assert(japaneseGun && pak38);
  assert.strictEqual(pak38.faction, 'german');
  assert.strictEqual(pak38.displayName, 'pak38');
  assert.notStrictEqual(pak38.unitKind, japaneseGun.unitKind);
  assert.notStrictEqual(pak38.displayName, japaneseGun.displayName);

  const pak38Name = langRecords.find(entry => entry.key === 'unit.name.pak38');
  assert(pak38Name);
  assert.strictEqual(pak38Name.zh, 'pak38');
  assert.strictEqual(pak38Name.en, 'pak38');

  const identityFields = new Set(['unitKind', 'displayName', 'faction', 'notes']);
  for (const field of Object.keys(japaneseGun)) {
    if (!identityFields.has(field)) {
      assert.strictEqual(pak38[field], japaneseGun[field], `Pak 38 should copy AT-gun combat field ${field}`);
    }
  }

  const types = fs.readFileSync('assets/scripts/core/types.ts', 'utf8');
  assert.match(types, /const ANTI_TANK_GUN_KINDS[\s\S]*?'at_gun',[\s\S]*?'pak38'/);
  assert.match(types, /isControlledATGun[\s\S]*?isAntiTankGunKind\(u\.kind\)/);
});

test('Pak 38 owns independent visual paths and visibly structural destroyed art', async () => {
  const japaneseGun = visualRecords.find(unit => unit.kind === 'at_gun');
  const pak38 = visualRecords.find(unit => unit.kind === 'pak38');
  assert(japaneseGun && pak38);
  assert.notStrictEqual(pak38.topSpritePath, japaneseGun.topSpritePath);
  assert.notStrictEqual(pak38.destroyedSpritePath, japaneseGun.destroyedSpritePath);

  const alivePath = 'assets/resources/textures/units/pak38_top.png';
  const deadPath = 'assets/resources/textures/units/pak38_top_destroyed.png';
  const alive = await sharp(alivePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const dead = await sharp(deadPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepStrictEqual(
    { width: alive.info.width, height: alive.info.height },
    { width: 150, height: 110 },
  );
  assert.deepStrictEqual(
    { width: dead.info.width, height: dead.info.height },
    { width: 150, height: 110 },
  );
  let alphaDifferences = 0;
  for (let i = 3; i < alive.data.length; i += 4) {
    if (dead.data[i] !== alive.data[i]) alphaDifferences++;
  }
  assert(alphaDifferences > 300,
    'destroyed art must change the silhouette instead of only recoloring the intact gun');

  const visited = new Uint8Array(dead.info.width * dead.info.height);
  const componentSizes = [];
  for (let y = 0; y < dead.info.height; y++) {
    for (let x = 0; x < dead.info.width; x++) {
      const start = y * dead.info.width + x;
      if (visited[start] || dead.data[start * 4 + 3] < 32) continue;
      const queue = [start];
      visited[start] = 1;
      let size = 0;
      while (queue.length) {
        const index = queue.pop();
        size++;
        const px = index % dead.info.width;
        const py = Math.floor(index / dead.info.width);
        for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
          if (nx < 0 || nx >= dead.info.width || ny < 0 || ny >= dead.info.height) continue;
          const next = ny * dead.info.width + nx;
          if (!visited[next] && dead.data[next * 4 + 3] >= 32) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
      componentSizes.push(size);
    }
  }
  componentSizes.sort((a, b) => b - a);
  assert(componentSizes.length >= 2 && componentSizes[1] >= 50,
    'destroyed Pak 38 should retain a clearly detached barrel/debris component after downscaling');

  for (const file of [`${alivePath}.meta`, `${deadPath}.meta`]) {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    const frame = meta.subMetas.f9941.userData;
    assert.strictEqual(frame.width, 150);
    assert.strictEqual(frame.height, 110);
    assert.strictEqual(frame.rawWidth, 150);
    assert.strictEqual(frame.rawHeight, 110);
  }
});
