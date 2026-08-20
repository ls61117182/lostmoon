#!/usr/bin/env node
'use strict';

/**
 * Audit tank PNGs, Cocos sprite-frame metadata and source-space geometry.
 * Usage: node tools/auditTankAssets.cjs [--kind maus]
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { readCsvRowsSmart } = require('./csvSmart');

const ROOT = path.resolve(__dirname, '..');
const CSV = path.join(ROOT, 'data', 'tank_visuals.csv');
const UNITS = path.join(ROOT, 'assets', 'resources', 'textures', 'units');
const requestedKind = process.argv.includes('--kind')
  ? process.argv[process.argv.indexOf('--kind') + 1]
  : '';

function records(rows) {
  const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  return rows.slice(1).map((row, index) => {
    const out = { __row: index + 2 };
    headers.forEach((header, i) => { out[header] = String(row[i] ?? '').trim(); });
    return out;
  });
}

function sourcePng(resourcePath) {
  const match = /^textures\/units\/(.+?)\/spriteFrame$/.exec(resourcePath);
  return match ? path.join(UNITS, `${match[1]}.png`) : null;
}

function num(row, field) {
  const value = Number(row[field]);
  if (!Number.isFinite(value)) throw new Error(`${row.kind}: invalid ${field}=${row[field]}`);
  return value;
}

function spriteFrameMeta(pngPath) {
  const metaPath = `${pngPath}.meta`;
  if (!fs.existsSync(metaPath)) throw new Error(`${path.relative(ROOT, pngPath)}: missing .meta`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const frame = Object.values(meta.subMetas ?? {}).find((entry) => entry.importer === 'sprite-frame');
  if (!frame?.userData) throw new Error(`${path.relative(ROOT, metaPath)}: missing sprite-frame metadata`);
  return frame.userData;
}

async function inspectPng(pngPath) {
  if (!fs.existsSync(pngPath)) throw new Error(`${path.relative(ROOT, pngPath)}: missing PNG`);
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  let chroma = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * info.channels;
    const [r, g, b, a] = [data[o], data[o + 1], data[o + 2], data[o + 3]];
    if (a > 16) visible++;
    if (a > 16 && g > 230 && r < 30 && b < 30) chroma++;
  }
  if (!visible) throw new Error(`${path.relative(ROOT, pngPath)}: image is fully transparent`);
  if (chroma) throw new Error(`${path.relative(ROOT, pngPath)}: ${chroma} chroma-key pixels remain`);

  const frame = spriteFrameMeta(pngPath);
  if (frame.rawWidth !== info.width || frame.rawHeight !== info.height) {
    throw new Error(`${path.relative(ROOT, pngPath)}: PNG ${info.width}x${info.height} != meta raw ${frame.rawWidth}x${frame.rawHeight}`);
  }
  const trimX = Number(frame.trimX ?? 0);
  const trimY = Number(frame.trimY ?? 0);
  if (frame.width <= 0 || frame.height <= 0
      || trimX < 0 || trimY < 0
      || trimX + frame.width > frame.rawWidth
      || trimY + frame.height > frame.rawHeight) {
    throw new Error(`${path.relative(ROOT, pngPath)}: invalid trimmed frame ${frame.width}x${frame.height}+${trimX},${trimY} inside ${frame.rawWidth}x${frame.rawHeight}`);
  }
  return { width: info.width, height: info.height, visible };
}

function inside(label, x, y, width, height) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error(`${label} (${x},${y}) is outside ${width}x${height}`);
  }
}

async function audit(row) {
  const paths = {
    top: sourcePng(row.topSpritePath),
    hull: sourcePng(row.hullSpritePath),
    turret: sourcePng(row.turretSpritePath),
    destroyed: sourcePng(row.destroyedSpritePath),
  };
  const images = {};
  for (const [role, pngPath] of Object.entries(paths)) {
    if (!pngPath) {
      if (role === 'hull' || role === 'turret') continue;
      throw new Error(`${row.kind}: invalid ${role} resource path`);
    }
    images[role] = await inspectPng(pngPath);
  }

  if (images.hull || images.turret) {
    if (!images.hull || !images.turret) throw new Error(`${row.kind}: split tank requires both hull and turret`);
    const splitPaths = [paths.top, paths.hull, paths.turret, paths.destroyed].map((value) => path.resolve(value).toLowerCase());
    if (new Set(splitPaths).size !== splitPaths.length) {
      throw new Error(`${row.kind}: split tank requires distinct top, hull, turret and destroyed PNG paths`);
    }
    const topW = num(row, 'topTrimW');
    const topH = num(row, 'topTrimH');
    const turretW = num(row, 'turretTrimW');
    const turretH = num(row, 'turretTrimH');
    if (topW > images.hull.width || topH > images.hull.height) {
      throw new Error(`${row.kind}: top trim ${topW}x${topH} exceeds hull ${images.hull.width}x${images.hull.height}`);
    }
    if (turretW > images.turret.width || turretH > images.turret.height) {
      throw new Error(`${row.kind}: turret trim ${turretW}x${turretH} exceeds turret ${images.turret.width}x${images.turret.height}`);
    }
    inside(`${row.kind} hull pivot`, num(row, 'turretPivotX'), num(row, 'turretPivotY'), topW, topH);
    inside(`${row.kind} turret pivot`, num(row, 'turretSpritePivotX'), num(row, 'turretSpritePivotY'), turretW, turretH);
    inside(`${row.kind} commander hatch`, num(row, 'commanderHatchSpriteX'), num(row, 'commanderHatchSpriteY'), turretW, turretH);
    inside(`${row.kind} muzzle`, num(row, 'muzzleSpriteX'), num(row, 'muzzleSpriteY'), turretW, turretH);
  }

  console.log(`[tank:audit] ${row.kind.padEnd(24)} OK  top=${images.top.width}x${images.top.height} destroyed=${images.destroyed.width}x${images.destroyed.height}`);
}

async function main() {
  const rows = records(readCsvRowsSmart(CSV, {
    toolName: 'auditTankAssets',
    requiredHeaders: ['kind', 'topSpritePath', 'destroyedSpritePath'],
  })).filter((row) => row.kind && /^[a-z][a-z0-9_]*$/.test(row.kind));
  const selected = requestedKind ? rows.filter((row) => row.kind === requestedKind) : rows;
  if (!selected.length) throw new Error(`unknown tank kind: ${requestedKind}`);
  for (const row of selected) await audit(row);
  console.log(`[tank:audit] PASS ${selected.length} tank(s)`);
}

main().catch((error) => {
  console.error(`[tank:audit] FAIL ${error.message}`);
  process.exit(1);
});
