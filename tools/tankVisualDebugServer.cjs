#!/usr/bin/env node
'use strict';

// Local development bridge for the browser preview; never part of the game server.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');
const { build } = require('./buildTankVisualDB');
const { loadExistingMission, saveExistingMission } = require('./missionEditorFiles.cjs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3219;
const EDITABLE_FIELDS = new Set([
  'fitScale', 'offsetForward', 'offsetRight', 'destroyedOffsetForward',
  'destroyedOffsetRight', 'destroyedFitScale', 'aspectRatioMul', 'hullFitScale',
  'turretScale', 'hullOffsetForward', 'hullOffsetRight', 'turretOffsetForward',
  'turretOffsetRight', 'turretPivotX', 'turretPivotY', 'muzzleSpriteX', 'muzzleSpriteY',
  'commanderHatchSpriteX', 'commanderHatchSpriteY', 'commanderHatchScale',
  'exhaustPort1Forward', 'exhaustPort1Right', 'exhaustPort2Forward', 'exhaustPort2Right',
]);

function replaceFile(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function saveTankVisualPatch(root, payload, generate = build) {
  const { kind, values } = payload ?? {};
  if (typeof kind !== 'string' || !values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('配置格式不正确');
  }
  const entries = Object.entries(values);
  if (!entries.length) throw new Error('没有需要保存的参数');
  for (const [key, value] of entries) {
    if (!EDITABLE_FIELDS.has(key) || typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`参数无效：${key}`);
    }
  }
  const csvPath = path.join(root, 'data/tank_visuals.csv');
  const outPath = path.join(root, 'assets/scripts/core/TankVisualDB.ts');
  const originalCsv = fs.readFileSync(csvPath);
  const originalCode = fs.readFileSync(outPath);
  const { rows } = chooseParsedRows(decodeTable(csvPath).text, ['kind']);
  const headers = rows[0];
  const kindColumn = headers.indexOf('kind');
  const matches = rows.slice(1).filter(row => row[kindColumn] === kind);
  if (matches.length !== 1 || !/^[a-z][a-z0-9_]*$/.test(kind)) throw new Error('找不到唯一的坦克配置');
  for (const [key, value] of entries) {
    const column = headers.indexOf(key);
    if (column < 0) throw new Error(`配置表缺少字段：${key}`);
    matches[0][column] = String(value);
  }

  // Generate and validate in isolation before touching either project file.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sherman-tank-debug-'));
  try {
    const stagedCsv = path.join(staging, 'tank_visuals.csv');
    const stagedCode = path.join(staging, 'TankVisualDB.ts');
    fs.writeFileSync(stagedCsv, '\ufeff' + rowsToCsv(rows), 'utf8');
    generate({ csvPath: stagedCsv, outPath: stagedCode });
    const nextCsv = fs.readFileSync(stagedCsv);
    const nextCode = fs.readFileSync(stagedCode);
    if (!fs.readFileSync(csvPath).equals(originalCsv) || !fs.readFileSync(outPath).equals(originalCode)) {
      throw new Error('配置文件在保存期间发生变化，请重试');
    }
    let csvWritten = false;
    try {
      replaceFile(csvPath, nextCsv);
      csvWritten = true;
      replaceFile(outPath, nextCode);
    } catch (error) {
      if (csvWritten) replaceFile(csvPath, originalCsv);
      throw error;
    }
    return { ok: true, kind, fields: entries.map(([key]) => key) };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function localOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function createDebugServer(root = ROOT) {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    // Reject DNS rebinding and requests from remote websites.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host ?? '').replace(/:\d+$/, ''))
      || (origin && !localOrigin(origin))) return reply(403, { ok: false, message: '仅允许本机预览访问' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Tank-Debug');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204);
      return res.end();
    }
    const missionRequest = req.url === '/missions/load' || req.url === '/missions/save';
    if (req.method !== 'POST' || (req.url !== '/tank-visuals' && !missionRequest)) return reply(404, { ok: false });
    if (req.headers['x-tank-debug'] !== '1' || req.headers['content-type'] !== 'application/json') {
      return reply(400, { ok: false, message: '请求格式不正确' });
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (missionRequest ? 2 * 1024 * 1024 : 16384)) return reply(413, { ok: false, message: '配置内容过大' });
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = req.url === '/missions/load' ? loadExistingMission(root, payload.missionPath)
        : req.url === '/missions/save' ? saveExistingMission(root, payload)
          : saveTankVisualPatch(root, payload);
      reply(200, result);
    } catch (error) {
      reply(400, { ok: false, message: error.message });
    }
  });
}

module.exports = { createDebugServer, saveTankVisualPatch, EDITABLE_FIELDS };
if (require.main === module) {
  const server = createDebugServer();
  server.on('error', error => {
    console.error(`[tank-debug] ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[tank-debug] http://127.0.0.1:${PORT} — ${ROOT}`);
    console.log('[local-editor] 支持坦克配置保存、现有关卡读取与保存；Ctrl+C 停止服务。');
  });
}
