const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createDebugServer, saveTankVisualPatch } = require('../tools/tankVisualDebugServer.cjs');
const { chooseParsedRows } = require('../tools/csvSmart');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-debug-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['data/tank_visuals.csv', 'assets/scripts/core/TankVisualDB.ts']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(root, name));
  }
  return root;
}
const readRows = root => chooseParsedRows(fs.readFileSync(path.join(root, 'data/tank_visuals.csv'), 'utf8'), ['kind']).rows;

test('saving patches only selected fields, retains descriptions/other tanks, and regenerates runtime data', t => {
  const root = fixture(t), before = readRows(root);
  saveTankVisualPatch(root, { kind: 'maus', values: { turretPivotX: 156, hullOffsetRight: 0.0123, destroyedFitScale: 1.2,
    coaxialMuzzleSpriteX: 58.25, coaxialMuzzleSpriteY: 33.5, hullMuzzleSpriteX: 40.125, hullMuzzleSpriteY: 62.75 } });
  const after = readRows(root), expected = structuredClone(before);
  const maus = expected.find(row => row[0] === 'maus');
  maus[expected[0].indexOf('turretPivotX')] = '156';
  maus[expected[0].indexOf('hullOffsetRight')] = '0.0123';
  maus[expected[0].indexOf('destroyedFitScale')] = '1.2';
  for (const [key, value] of Object.entries({ coaxialMuzzleSpriteX: 58.25, coaxialMuzzleSpriteY: 33.5,
    hullMuzzleSpriteX: 40.125, hullMuzzleSpriteY: 62.75 })) maus[expected[0].indexOf(key)] = String(value);
  assert.deepEqual(after, expected);
  assert.equal(fs.readFileSync(path.join(root, 'data/tank_visuals.csv')).subarray(0, 3).toString('hex'), 'efbbbf');
  const code = fs.readFileSync(path.join(root, 'assets/scripts/core/TankVisualDB.ts'), 'utf8');
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const ctx = vm.createContext({ exports: {} });
  vm.runInContext(compiled, ctx);
  assert.equal(ctx.exports.splitTankGeometryConfigOf('maus').pivot.bodyX, 156);
  assert.equal(ctx.exports.splitTankVisualConfigOf('maus').hullOffsetRight, 0.0123);
  assert.equal(ctx.exports.tankVisualConfigOf('maus').destroyedFitScale, 1.2);
  assert.equal(ctx.exports.tankVisualConfigOf('maus').coaxialMuzzleSpriteX, 58.25);
  assert.equal(ctx.exports.tankVisualConfigOf('maus').coaxialMuzzleSpriteY, 33.5);
  assert.equal(ctx.exports.tankVisualConfigOf('maus').hullMuzzleSpriteX, 40.125);
  assert.equal(ctx.exports.tankVisualConfigOf('maus').hullMuzzleSpriteY, 62.75);
  // Fixed-gun tanks use the full-sprite fields and the same save path.
  saveTankVisualPatch(root, { kind: 'jagdtiger', values: { muzzleSpriteY: 42, offsetForward: 0.18 } });
  assert.equal(readRows(root).find(row => row[0] === 'jagdtiger')[before[0].indexOf('muzzleSpriteY')], '42');
});

test('invalid requests and generator failures leave both files byte-identical', t => {
  const root = fixture(t);
  const files = ['data/tank_visuals.csv', 'assets/scripts/core/TankVisualDB.ts'];
  const before = files.map(file => fs.readFileSync(path.join(root, file)));
  for (const payload of [null, { kind: 'maus', values: {} },
    { kind: '../maus', values: { fitScale: 1 } },
    { kind: 'maus', values: { topSpritePath: 1 } },
    { kind: 'maus', values: { fitScale: '1' } },
    { kind: 'maus', values: { fitScale: Infinity } }]) {
    assert.throws(() => saveTankVisualPatch(root, payload));
  }
  assert.throws(() => saveTankVisualPatch(root, { kind: 'maus', values: { fitScale: 1 } }, () => {
    throw new Error('generation failed');
  }), /generation failed/);
  files.forEach((file, i) => assert.deepEqual(fs.readFileSync(path.join(root, file)), before[i]));
});

test('local HTTP endpoint handles preflight and save, rejecting remote origins and malformed requests', async t => {
  const root = fixture(t), server = createDebugServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/tank-visuals`;
  const headers = { Origin: 'http://localhost:7456', 'Content-Type': 'application/json', 'X-Tank-Debug': '1' };
  let response = await fetch(url, { method: 'OPTIONS', headers });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.equal(response.headers.get('access-control-allow-private-network'), 'true');
  response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ kind: 'maus', values: { turretPivotY: 51 } }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).kind, 'maus');
  response = await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://remote.example' }, body: '{}' });
  assert.equal(response.status, 403);
  response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 400);
  response = await fetch(url, { method: 'POST', headers, body: '{' });
  assert.equal(response.status, 400);
});

// Execute the actual UI save handler without needing the Cocos renderer.
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/view/MainMenuScene.ts'), 'utf8');
const ast = ts.createSourceFile('MainMenuScene.ts', source, ts.ScriptTarget.Latest, true);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'saveCurrentConfig') handler = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function ui(fetchImpl) {
  const ctx = vm.createContext({
    selectedKind: 'maus', drafts: { maus: { fitScale: 0.812345 } }, savedDrafts: { maus: { fitScale: 0.812345 } },
    debugInputs: new Map([['fitScale', { string: '0.8123' }]]), savingConfig: false,
    saveHint: { node: { isValid: true }, string: '' }, saveConfigBtn: { node: { isValid: true }, label: {} },
    tankVisualAssetName: k => k, formatTankDebugNumber: n => String(Math.round(n * 10000) / 10000),
    AbortController, setTimeout, clearTimeout, fetch: fetchImpl,
  });
  const save = vm.runInContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2019 } }).outputText, ctx);
  return { ctx, save };
}
test('UI reads focused input, saves only changes, prevents duplicate requests, and tracks the captured tank', async () => {
  let release, request;
  const { ctx, save } = ui((url, options) => {
    request = JSON.parse(options.body);
    return new Promise(resolve => { release = resolve; });
  });
  await save();
  assert.equal(request, undefined, 'untouched rounded display is not a change');
  ctx.debugInputs.get('fitScale').string = '0.92';
  const pending = save();
  assert.deepEqual(request, { kind: 'maus', values: { fitScale: 0.92 } });
  await save();
  ctx.selectedKind = 'tiger';
  ctx.drafts.maus.fitScale = 0.95;
  release({ ok: true, json: async () => ({ ok: true, kind: 'maus' }) });
  await pending;
  assert.equal(ctx.savedDrafts.maus.fitScale, 0.92);
  assert.equal(ctx.drafts.maus.fitScale, 0.95, 'edits during a request remain unsaved');
  assert.match(ctx.saveHint.string, /已保存 maus/);
  assert.equal(ctx.savingConfig, false);
});
test('UI blocks invalid input and retains drafts for retry after connection failure', async () => {
  let calls = 0;
  const { ctx, save } = ui(async () => { calls++; throw new Error('offline'); });
  ctx.debugInputs.get('fitScale').string = '';
  await save();
  assert.equal(calls, 0);
  ctx.debugInputs.get('fitScale').string = '0.9';
  await save();
  assert.equal(ctx.drafts.maus.fitScale, 0.9);
  assert.equal(ctx.savedDrafts.maus.fitScale, 0.812345);
  assert.match(ctx.saveHint.string, /npm run tank:debug-server/);
  await save();
  assert.equal(calls, 2);
});
