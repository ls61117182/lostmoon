'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { chooseParsedRows, decodeTable, rowsToCsv } = require('./csvSmart');
const { build } = require('./buildTurnEndEventDB');

function missionFile(root, missionPath) {
  if (typeof missionPath !== 'string' || !/^missions\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(missionPath)) {
    throw new Error('关卡路径无效');
  }
  const directory = fs.realpathSync(path.join(root, 'assets/resources/missions'));
  const file = fs.realpathSync(path.join(root, 'assets/resources', `${missionPath}.json`));
  const relative = path.relative(directory, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(file).isFile()) {
    throw new Error('只能编辑项目内已有的关卡文件');
  }
  return file;
}

function readState(root, missionPath) {
  const file = missionFile(root, missionPath);
  const original = fs.readFileSync(file);
  const mission = JSON.parse(original.toString('utf8').replace(/^\uFEFF/, ''));
  const eventFile = path.join(root, 'data/turn_end_events.csv');
  const eventBytes = fs.readFileSync(eventFile);
  const rows = chooseParsedRows(decodeTable(eventFile).text, ['mission_id']).rows;
  const headers = rows[0];
  const tableId = mission.eventTableId ?? mission.id;
  const eventRows = rows.slice(1).filter(row => row[headers.indexOf('mission_id')] === tableId);
  const events = eventRows.map(row => ({
    missionId: tableId,
    sumMin: Number(row[headers.indexOf('sum_min')]),
    sumMax: Number(row[headers.indexOf('sum_max')]),
    diceCount: Number(row[headers.indexOf('dice_count')]),
    effectType: row[headers.indexOf('effect_type')],
    ...(row[headers.indexOf('reinforcement_side')] ? { reinforcementSide: row[headers.indexOf('reinforcement_side')] } : {}),
  }));
  const revision = createHash('sha256').update(original).update(eventBytes).digest('hex');
  return { file, original, mission, eventFile, eventBytes, rows, headers, events, eventRows, tableId, revision };
}

function loadExistingMission(root, missionPath) {
  const state = readState(root, missionPath);
  return { ok: true, missionPath, mission: state.mission, turnEndEvents: state.events, revision: state.revision };
}

function replaceFile(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function eventValues(events) {
  return events.map(event => [event.sumMin, event.sumMax, event.diceCount, event.effectType, event.reinforcementSide || '']);
}

function saveExistingMission(root, payload, generate = build) {
  const { missionPath, mission, turnEndEvents, revision } = payload ?? {};
  const current = readState(root, missionPath);
  if (typeof revision !== 'string' || revision !== current.revision) {
    throw new Error('本地关卡或事件表已发生变化，请重新选择关卡后再保存');
  }
  if (!mission || mission.id !== current.mission.id || typeof mission.name !== 'string'
    || !Number.isInteger(mission.rows) || mission.rows < 1 || mission.rows > 100
    || !Number.isInteger(mission.cols) || mission.cols < 1 || mission.cols > 100
    || !Array.isArray(mission.tiles) || mission.tiles.length !== mission.rows
    || mission.tiles.some(row => !Array.isArray(row) || row.length > mission.cols)
    || !Array.isArray(mission.enemies) || !mission.objective || !Array.isArray(turnEndEvents)) {
    throw new Error('关卡配置无效，不能更改原关卡 ID');
  }
  const nextMission = { ...mission };
  const writes = [];
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sherman-mission-editor-'));
  try {
    if (JSON.stringify(eventValues(turnEndEvents)) !== JSON.stringify(eventValues(current.events))) {
      // Shared source event tables stay intact; edits get this mission's own table.
      const tableId = mission.id;
      if (!/^[a-zA-Z0-9_-]+$/.test(tableId)) throw new Error('关卡 ID 无效');
      nextMission.eventTableId = tableId;
      const { headers } = current;
      const replacements = turnEndEvents.map((event, index) => {
        const row = current.eventRows[index]?.slice() ?? headers.map(() => '');
        const values = { mission_id: tableId, sum_min: event.sumMin, sum_max: event.sumMax,
          dice_count: event.diceCount, effect_type: event.effectType, reinforcement_side: event.reinforcementSide || '' };
        for (const [key, value] of Object.entries(values)) row[headers.indexOf(key)] = String(value);
        return row;
      });
      const remaining = current.rows.slice(1).filter(row => row[headers.indexOf('mission_id')] !== tableId);
      const nextCsv = Buffer.from('\ufeff' + rowsToCsv([headers, ...remaining, ...replacements]), 'utf8');
      const stagedCsv = path.join(staging, 'turn_end_events.csv');
      const stagedCode = path.join(staging, 'TurnEndEventDB.ts');
      fs.writeFileSync(stagedCsv, nextCsv);
      generate({ csvPath: stagedCsv, outPath: stagedCode });
      writes.push({ file: current.eventFile, before: current.eventBytes, after: nextCsv });
      const runtimeFile = path.join(root, 'assets/scripts/core/TurnEndEventDB.ts');
      writes.push({ file: runtimeFile, before: fs.readFileSync(runtimeFile), after: fs.readFileSync(stagedCode) });
    }
    writes.push({ file: current.file, before: current.original, after: Buffer.from(JSON.stringify(nextMission, null, 2) + '\n') });
    // Preserve pre-existing local work before replacing project files.
    const backup = path.join(root, '.codex-tmp/mission-editor-backups', `${Date.now()}-${randomUUID()}`);
    for (const write of writes) {
      const copy = path.join(backup, path.relative(root, write.file));
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.writeFileSync(copy, write.before);
    }
    for (const write of writes) {
      if (!fs.readFileSync(write.file).equals(write.before)) throw new Error('文件在保存期间发生变化，请重试');
    }
    const completed = [];
    try {
      for (const write of writes) { replaceFile(write.file, write.after); completed.push(write); }
    } catch (error) {
      for (const write of completed.reverse()) replaceFile(write.file, write.before);
      throw error;
    }
    return { ...loadExistingMission(root, missionPath), file: `assets/resources/${missionPath}.json` };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { loadExistingMission, saveExistingMission };
