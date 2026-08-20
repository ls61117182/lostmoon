#!/usr/bin/env node
'use strict';

/**
 * Deterministically prepare one split tank from a manifest.
 *
 * Usage:
 *   pnpm run tank:prepare -- --kind panzer4
 *   pnpm run tank:prepare -- --manifest data/tank_art/panzer4.json --dry-run
 */

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'tank_visuals.csv');
const GENERATED_DB = path.join(ROOT, 'assets', 'scripts', 'core', 'TankVisualDB.ts');
const UNITS_DIR = path.join(ROOT, 'assets', 'resources', 'textures', 'units');
const MAX_HULL_CONTENT_EDGE = 150;

function fail(message) {
  throw new Error(message);
}

function usage() {
  console.log([
    'Prepare one split-tank art set from a manifest.',
    '',
    'Usage:',
    '  pnpm run tank:prepare -- --kind <kind> [--dry-run]',
    '  pnpm run tank:prepare -- --manifest <file> [--dry-run]',
    '',
    'Default manifest: data/tank_art/<kind>.json',
    'Example manifest: data/tank_art/tank.example.json',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = { dryRun: false, kind: '', manifest: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--kind') args.kind = argv[++i] ?? '';
    else if (arg === '--manifest') args.manifest = argv[++i] ?? '';
    else if (arg === '--help' || arg === '-h') args.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (args.help) return args;
  if (args.kind && args.manifest) fail('use either --kind or --manifest, not both');
  if (!args.kind && !args.manifest) fail('missing --kind or --manifest');
  if (args.kind && !/^[a-z][a-z0-9_]*$/.test(args.kind)) fail(`invalid kind: ${args.kind}`);
  return args;
}

function resolveInsideRoot(relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) fail(`${label} must be a non-empty path`);
  const absolute = path.resolve(ROOT, relativePath);
  const relation = path.relative(ROOT, absolute);
  if (relation.startsWith('..') || path.isAbsolute(relation)) fail(`${label} must stay inside the repository: ${relativePath}`);
  return absolute;
}

function readManifest(args) {
  const manifestPath = args.manifest
    ? resolveInsideRoot(args.manifest, '--manifest')
    : path.join(ROOT, 'data', 'tank_art', `${args.kind}.json`);
  if (!fs.existsSync(manifestPath)) fail(`manifest not found: ${path.relative(ROOT, manifestPath)}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`invalid manifest JSON: ${error.message}`);
  }
  validateManifest(manifest);
  if (args.kind && manifest.kind !== args.kind) fail(`manifest kind ${manifest.kind} does not match --kind ${args.kind}`);
  return { manifest, manifestPath };
}

function requirePoint(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    fail(`${label} must be [x, y] with finite numbers`);
  }
}

function requirePadding(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 4
      || !value.every((v) => Number.isInteger(v) && v >= 0)) {
    fail(`${label} must be [left, top, right, bottom] with non-negative integers`);
  }
}

function requireKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value ?? {})) {
    if (!allowed.includes(key)) fail(`${label} contains unknown field ${key}`);
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest must be an object');
  requireKnownKeys(manifest, ['$schema', 'schemaVersion', 'kind', 'notes', 'inputs', 'processing', 'sourceGeometry'], 'manifest');
  if (manifest.schemaVersion !== 1) fail(`unsupported schemaVersion: ${manifest.schemaVersion}`);
  if (!/^[a-z][a-z0-9_]*$/.test(manifest.kind ?? '')) fail(`invalid manifest kind: ${manifest.kind}`);
  requireKnownKeys(manifest.inputs, ['hull', 'turret', 'destroyed', 'paintReference'], 'inputs');
  for (const role of ['hull', 'turret', 'destroyed']) {
    const input = manifest.inputs?.[role];
    if (!input || typeof input.path !== 'string') fail(`inputs.${role}.path is required`);
    requireKnownKeys(input, ['path', 'background'], `inputs.${role}`);
    if (!['alpha', 'chroma'].includes(input.background)) fail(`inputs.${role}.background must be alpha or chroma`);
  }
  const processing = manifest.processing ?? {};
  requireKnownKeys(processing, ['alphaThreshold', 'commonScale', 'outlinePixels', 'hullPadding', 'turretPadding'], 'processing');
  if (!Number.isInteger(processing.alphaThreshold)
      || processing.alphaThreshold < 1 || processing.alphaThreshold > 255) {
    fail('processing.alphaThreshold must be an integer from 1 to 255');
  }
  if (!Number.isFinite(processing.commonScale)
      || processing.commonScale <= 0 || processing.commonScale > 4) {
    fail('processing.commonScale must be greater than 0 and at most 4');
  }
  if (!Number.isInteger(processing.outlinePixels)
      || processing.outlinePixels < 0 || processing.outlinePixels > 8) {
    fail('processing.outlinePixels must be an integer from 0 to 8');
  }
  requirePadding(processing.hullPadding, 'processing.hullPadding');
  requirePadding(processing.turretPadding, 'processing.turretPadding');
  requireKnownKeys(manifest.sourceGeometry, ['hullPivot', 'turretPivot', 'muzzle', 'commanderHatch'], 'sourceGeometry');
  for (const key of ['hullPivot', 'turretPivot', 'muzzle', 'commanderHatch']) {
    requirePoint(manifest.sourceGeometry?.[key], `sourceGeometry.${key}`);
  }
}

function csvData() {
  const decoded = decodeTable(CSV_PATH);
  const parsed = chooseParsedRows(decoded.text, ['kind', 'hullSpritePath', 'turretSpritePath']);
  const rows = parsed.rows;
  const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  return { headers, rows };
}

function tankRow(kind) {
  const { headers, rows } = csvData();
  const kindIndex = headers.indexOf('kind');
  const rowIndex = rows.findIndex((row, i) => i > 0 && String(row[kindIndex] ?? '').trim() === kind);
  if (rowIndex < 0) fail(`tank_visuals.csv has no row for kind ${kind}`);
  const record = {};
  headers.forEach((header, index) => { record[header] = String(rows[rowIndex][index] ?? '').trim(); });
  if (!record.hullSpritePath || !record.turretSpritePath) fail(`${kind} is not configured as a split tank`);
  return { headers, rows, rowIndex, record };
}

function pngFromResource(resourcePath, label) {
  const match = /^textures\/units\/(.+?)\/spriteFrame$/.exec(resourcePath);
  if (!match) fail(`${label} is not a tank sprite resource path: ${resourcePath}`);
  const absolute = path.join(UNITS_DIR, `${match[1]}.png`);
  const relation = path.relative(UNITS_DIR, absolute);
  if (relation.startsWith('..') || path.isAbsolute(relation)) fail(`${label} leaves the units directory`);
  return absolute;
}

function outputPaths(record) {
  const outputs = {
    hull: pngFromResource(record.hullSpritePath, 'hullSpritePath'),
    turret: pngFromResource(record.turretSpritePath, 'turretSpritePath'),
    top: pngFromResource(record.topSpritePath, 'topSpritePath'),
    destroyed: pngFromResource(record.destroyedSpritePath, 'destroyedSpritePath'),
  };
  const unique = new Set(Object.values(outputs).map((value) => value.toLowerCase()));
  if (unique.size !== Object.keys(outputs).length) {
    fail('hull, turret, top and destroyed must use distinct formal PNG paths before tank:prepare can run');
  }
  return outputs;
}

function inputPaths(manifest, outputs) {
  const paths = {};
  for (const role of ['hull', 'turret', 'destroyed']) {
    paths[role] = resolveInsideRoot(manifest.inputs[role].path, `inputs.${role}.path`);
    if (!fs.existsSync(paths[role])) fail(`missing ${role} input: ${path.relative(ROOT, paths[role])}`);
    if (Object.values(outputs).some((output) => path.resolve(output).toLowerCase() === paths[role].toLowerCase())) {
      fail(`${role} input must be a selected source file, not a formal output asset`);
    }
  }
  if (manifest.inputs.paintReference) {
    paths.paintReference = resolveInsideRoot(manifest.inputs.paintReference, 'inputs.paintReference');
    if (!fs.existsSync(paths.paintReference)) fail(`missing paint reference: ${path.relative(ROOT, paths.paintReference)}`);
  }
  return paths;
}

async function loadRgba(filePath, background) {
  const result = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = Buffer.from(result.data);
  const info = { width: result.info.width, height: result.info.height, channels: result.info.channels };
  if (info.channels !== 4) fail(`${path.relative(ROOT, filePath)} did not decode as RGBA`);
  if (background === 'chroma') {
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (g >= 235 && r <= 35 && b <= 35) {
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        data[o + 3] = 0;
      }
    }
  }
  return { data, info };
}

function alphaBounds(image, threshold) {
  const { data, info } = image;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) fail('input contains no visible pixels after background removal');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function neutralMedian(data) {
  const colors = [];
  for (let o = 0; o < data.length; o += 4) {
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    const light = (r + g + b) / 3;
    if (a > 220 && light > 55 && light < 240 && Math.max(r, g, b) - Math.min(r, g, b) < 60) {
      colors.push([r, g, b]);
    }
  }
  if (!colors.length) return null;
  colors.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  return colors[Math.floor(colors.length / 2)];
}

function matchPaint(data, target) {
  if (!target) return;
  const source = neutralMedian(data);
  if (!source) return;
  const shift = target.map((value, index) => value - source[index]);
  for (let o = 0; o < data.length; o += 4) {
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    if (!a || (r + g + b) / 3 <= 55 || Math.max(r, g, b) - Math.min(r, g, b) >= 60) continue;
    data[o] = Math.max(0, Math.min(255, r + shift[0]));
    data[o + 1] = Math.max(0, Math.min(255, g + shift[1]));
    data[o + 2] = Math.max(0, Math.min(255, b + shift[2]));
  }
}

function applyInwardOutline(data, width, height, radius) {
  if (!radius) return;
  const source = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (source[o + 3] < 64) continue;
      let edge = false;
      for (let yy = y - radius; yy <= y + radius && !edge; yy++) {
        for (let xx = x - radius; xx <= x + radius; xx++) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height
              || source[(yy * width + xx) * 4 + 3] < 64) {
            edge = true;
            break;
          }
        }
      }
      if (edge) {
        data[o] = 28;
        data[o + 1] = 31;
        data[o + 2] = 27;
      }
    }
  }
}

function clearLowAlpha(data) {
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] >= 8) continue;
    data[o] = 0;
    data[o + 1] = 0;
    data[o + 2] = 0;
    data[o + 3] = 0;
  }
}

async function preparedLayer(image, bounds, scale, padding, outlinePixels, targetPaint) {
  const [padLeft, padTop, padRight, padBottom] = padding;
  const contentWidth = Math.max(1, Math.round(bounds.width * scale));
  const contentHeight = Math.max(1, Math.round(bounds.height * scale));
  const extracted = await sharp(image.data, { raw: image.info })
    .extract(bounds)
    .resize(contentWidth, contentHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = contentWidth + padLeft + padRight;
  const height = contentHeight + padTop + padBottom;
  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: extracted.data,
    raw: { width: contentWidth, height: contentHeight, channels: 4 },
    left: padLeft,
    top: padTop,
  }]).raw().toBuffer();
  matchPaint(canvas, targetPaint);
  applyInwardOutline(canvas, width, height, outlinePixels);
  clearLowAlpha(canvas);
  return {
    data: canvas,
    info: { width, height, channels: 4 },
    transform: {
      cropLeft: bounds.left,
      cropTop: bounds.top,
      scaleX: contentWidth / bounds.width,
      scaleY: contentHeight / bounds.height,
      padLeft,
      padTop,
    },
    content: { width: contentWidth, height: contentHeight },
  };
}

function transformPoint(point, transform) {
  return [
    Math.round((point[0] - transform.cropLeft) * transform.scaleX + transform.padLeft),
    Math.round((point[1] - transform.cropTop) * transform.scaleY + transform.padTop),
  ];
}

function requireInside(point, width, height, label) {
  if (point[0] < 0 || point[1] < 0 || point[0] >= width || point[1] >= height) {
    fail(`${label} (${point.join(',')}) falls outside prepared ${width}x${height}`);
  }
}

async function savePng(image, filePath) {
  await sharp(image.data, { raw: image.info }).png().toFile(filePath);
}

async function composeTop(hull, turret, hullPivot, turretPivot, filePath) {
  const turretLeft = hullPivot[0] - turretPivot[0];
  const turretTop = hullPivot[1] - turretPivot[1];
  const marginX = Math.max(0, -turretLeft, turretLeft + turret.info.width - hull.info.width);
  const marginY = Math.max(0, -turretTop, turretTop + turret.info.height - hull.info.height);
  const width = hull.info.width + marginX * 2;
  const height = hull.info.height + marginY * 2;
  const hullOffsetX = marginX;
  const hullOffsetY = marginY;
  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: hull.data, raw: hull.info, left: hullOffsetX, top: hullOffsetY },
    { input: turret.data, raw: turret.info, left: turretLeft + hullOffsetX, top: turretTop + hullOffsetY },
  ]).png().toFile(filePath);
  return { width, height, hullOffsetX, hullOffsetY };
}

function syncSpriteMeta(pngPath) {
  const metaPath = `${pngPath}.meta`;
  if (!fs.existsSync(metaPath)) fail(`missing Cocos meta: ${path.relative(ROOT, metaPath)}`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const frame = Object.values(meta.subMetas ?? {}).find((entry) => entry.importer === 'sprite-frame');
  if (!frame?.userData) fail(`missing sprite-frame metadata: ${path.relative(ROOT, metaPath)}`);
  return sharp(pngPath).metadata().then((image) => {
    const w = image.width;
    const h = image.height;
    frame.userData.width = w;
    frame.userData.height = h;
    frame.userData.rawWidth = w;
    frame.userData.rawHeight = h;
    frame.userData.trimX = 0;
    frame.userData.trimY = 0;
    frame.userData.trimType = 'none';
    const hw = w / 2;
    const hh = h / 2;
    frame.userData.vertices = {
      rawPosition: [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
      indexes: [0, 1, 2, 2, 1, 3],
      uv: [0, h, w, h, 0, 0, w, 0],
      nuv: [0, 0, 1, 0, 0, 1, 1, 1],
      minPos: [-hw, -hh, 0],
      maxPos: [hw, hh, 0],
    };
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  });
}

function setCsvValue(headers, row, field, value) {
  const index = headers.indexOf(field);
  if (index < 0) fail(`tank_visuals.csv is missing field ${field}`);
  while (row.length <= index) row.push('');
  row[index] = String(value);
}

function updateCsv(csv, geometry) {
  const row = csv.rows[csv.rowIndex];
  const values = {
    topTrimX: 0,
    topTrimY: 0,
    topTrimW: geometry.hullWidth,
    topTrimH: geometry.hullHeight,
    turretTrimX: 0,
    turretTrimY: 0,
    turretTrimW: geometry.turretWidth,
    turretTrimH: geometry.turretHeight,
    turretPivotX: geometry.hullPivot[0],
    turretPivotY: geometry.hullPivot[1],
    turretSpritePivotX: geometry.turretPivot[0],
    turretSpritePivotY: geometry.turretPivot[1],
    muzzleSpriteX: geometry.muzzle[0],
    muzzleSpriteY: geometry.muzzle[1],
    commanderHatchSpriteX: geometry.commanderHatch[0],
    commanderHatchSpriteY: geometry.commanderHatch[1],
    destroyedFitScale: 1,
  };
  for (const [field, value] of Object.entries(values)) setCsvValue(csv.headers, row, field, value);
  const output = Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from(rowsToCsv(csv.rows), 'utf8'),
  ]);
  fs.writeFileSync(CSV_PATH, output);
}

function backupFiles(kind, files, manifestPath) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '_');
  const backupDir = path.join(ROOT, 'asset_backups', 'latest', kind, `${stamp}_before_tank_prepare`);
  if (fs.existsSync(backupDir)) fail(`backup already exists: ${path.relative(ROOT, backupDir)}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const copied = [];
  for (const file of files) {
    if (!fs.existsSync(file)) fail(`cannot back up missing file: ${path.relative(ROOT, file)}`);
    const name = file === CSV_PATH ? 'tank_visuals.csv'
      : file === GENERATED_DB ? 'TankVisualDB.ts.bak'
        : path.basename(file);
    const destination = path.join(backupDir, name);
    fs.copyFileSync(file, destination);
    copied.push({ source: file, backup: destination });
  }
  fs.copyFileSync(manifestPath, path.join(backupDir, 'tank-art-manifest.json'));
  return { backupDir, copied };
}

function restoreBackup(backup) {
  for (const entry of backup.copied) fs.copyFileSync(entry.backup, entry.source);
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${result.status}`);
}

async function createPlan(manifest, manifestPath) {
  const csv = tankRow(manifest.kind);
  const outputs = outputPaths(csv.record);
  const inputs = inputPaths(manifest, outputs);
  for (const output of Object.values(outputs)) {
    if (!fs.existsSync(output) || !fs.existsSync(`${output}.meta`)) {
      fail(`formal output and meta must already exist: ${path.relative(ROOT, output)}`);
    }
  }

  const hullSource = await loadRgba(inputs.hull, manifest.inputs.hull.background);
  const turretSource = await loadRgba(inputs.turret, manifest.inputs.turret.background);
  const destroyedSource = await loadRgba(inputs.destroyed, manifest.inputs.destroyed.background);
  if (destroyedSource.info.width !== hullSource.info.width
      || destroyedSource.info.height !== hullSource.info.height) {
    fail(`destroyed source must share the hull source canvas; hull=${hullSource.info.width}x${hullSource.info.height}, destroyed=${destroyedSource.info.width}x${destroyedSource.info.height}`);
  }

  const threshold = manifest.processing.alphaThreshold;
  const hullBounds = alphaBounds(hullSource, threshold);
  const turretBounds = alphaBounds(turretSource, threshold);
  alphaBounds(destroyedSource, threshold);
  const paddingHull = manifest.processing.hullPadding ?? [0, 0, 0, 0];
  const paddingTurret = manifest.processing.turretPadding ?? [0, 0, 0, 0];
  let targetPaint = null;
  if (inputs.paintReference) {
    const paint = await loadRgba(inputs.paintReference, 'alpha');
    targetPaint = neutralMedian(paint.data);
  }
  const hull = await preparedLayer(
    hullSource,
    hullBounds,
    manifest.processing.commonScale,
    paddingHull,
    manifest.processing.outlinePixels,
    targetPaint,
  );
  if (Math.max(hull.content.width, hull.content.height) > MAX_HULL_CONTENT_EDGE) {
    fail(`prepared hull content ${hull.content.width}x${hull.content.height} exceeds ${MAX_HULL_CONTENT_EDGE}px`);
  }
  const turret = await preparedLayer(
    turretSource,
    turretBounds,
    manifest.processing.commonScale,
    paddingTurret,
    manifest.processing.outlinePixels,
    targetPaint,
  );
  const destroyed = await preparedLayer(
    destroyedSource,
    hullBounds,
    manifest.processing.commonScale,
    paddingHull,
    manifest.processing.outlinePixels,
    targetPaint,
  );
  if (destroyed.info.width !== hull.info.width || destroyed.info.height !== hull.info.height) {
    fail('internal error: destroyed output did not preserve the hull canvas');
  }

  const hullPivot = transformPoint(manifest.sourceGeometry.hullPivot, hull.transform);
  const turretPivot = transformPoint(manifest.sourceGeometry.turretPivot, turret.transform);
  const muzzle = transformPoint(manifest.sourceGeometry.muzzle, turret.transform);
  const commanderHatch = transformPoint(manifest.sourceGeometry.commanderHatch, turret.transform);
  requireInside(hullPivot, hull.info.width, hull.info.height, 'hull pivot');
  requireInside(turretPivot, turret.info.width, turret.info.height, 'turret pivot');
  requireInside(muzzle, turret.info.width, turret.info.height, 'muzzle');
  requireInside(commanderHatch, turret.info.width, turret.info.height, 'commander hatch');

  return {
    csv,
    destroyed,
    hull,
    inputs,
    manifest,
    manifestPath,
    outputs,
    turret,
    geometry: { hullPivot, turretPivot, muzzle, commanderHatch },
    source: { hullBounds, turretBounds },
  };
}

function printPlan(plan) {
  const { manifest, source, hull, turret, destroyed, geometry, outputs } = plan;
  console.log(`[tank:prepare] kind=${manifest.kind} scale=${manifest.processing.commonScale}`);
  console.log(`[tank:prepare] hull source bbox=${source.hullBounds.width}x${source.hullBounds.height}+${source.hullBounds.left},${source.hullBounds.top} -> ${hull.info.width}x${hull.info.height}`);
  console.log(`[tank:prepare] turret source bbox=${source.turretBounds.width}x${source.turretBounds.height}+${source.turretBounds.left},${source.turretBounds.top} -> ${turret.info.width}x${turret.info.height}`);
  console.log(`[tank:prepare] destroyed -> ${destroyed.info.width}x${destroyed.info.height} using the hull transform`);
  console.log(`[tank:prepare] pivots hull=${geometry.hullPivot.join(',')} turret=${geometry.turretPivot.join(',')} muzzle=${geometry.muzzle.join(',')} hatch=${geometry.commanderHatch.join(',')}`);
  for (const [role, output] of Object.entries(outputs)) console.log(`[tank:prepare] ${role} output=${path.relative(ROOT, output)}`);
}

async function applyPlan(plan) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sherman-tank-prepare-'));
  const staged = {
    hull: path.join(staging, 'hull.png'),
    turret: path.join(staging, 'turret.png'),
    top: path.join(staging, 'top.png'),
    destroyed: path.join(staging, 'destroyed.png'),
  };
  let backup = null;
  try {
    await savePng(plan.hull, staged.hull);
    await savePng(plan.turret, staged.turret);
    await savePng(plan.destroyed, staged.destroyed);
    const top = await composeTop(
      plan.hull,
      plan.turret,
      plan.geometry.hullPivot,
      plan.geometry.turretPivot,
      staged.top,
    );
    plan.geometry.top = top;
    plan.geometry.hullWidth = plan.hull.info.width;
    plan.geometry.hullHeight = plan.hull.info.height;
    plan.geometry.turretWidth = plan.turret.info.width;
    plan.geometry.turretHeight = plan.turret.info.height;

    const protectedFiles = [CSV_PATH, GENERATED_DB];
    for (const output of Object.values(plan.outputs)) protectedFiles.push(output, `${output}.meta`);
    backup = backupFiles(plan.manifest.kind, protectedFiles, plan.manifestPath);
    for (const role of ['hull', 'turret', 'top', 'destroyed']) {
      fs.copyFileSync(staged[role], plan.outputs[role]);
      await syncSpriteMeta(plan.outputs[role]);
    }
    updateCsv(plan.csv, plan.geometry);
    run(process.execPath, ['tools/buildTankVisualDB.js']);
    run(process.execPath, ['tools/auditTankAssets.cjs', '--kind', plan.manifest.kind]);
    run(process.execPath, ['--test', 'tests/topDownTankFacing.test.js']);
    console.log(`[tank:prepare] PASS backup=${path.relative(ROOT, backup.backupDir)}`);
  } catch (error) {
    if (backup) {
      restoreBackup(backup);
      console.error(`[tank:prepare] restored formal files from ${path.relative(ROOT, backup.backupDir)}`);
    }
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const { manifest, manifestPath } = readManifest(args);
  const plan = await createPlan(manifest, manifestPath);
  printPlan(plan);
  if (args.dryRun) {
    console.log('[tank:prepare] DRY RUN: no files changed');
    return;
  }
  await applyPlan(plan);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[tank:prepare] FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  alphaBounds,
  composeTop,
  parseArgs,
  transformPoint,
  validateManifest,
};
