#!/usr/bin/env node
'use strict';

// Idempotent registration; preserves existing units and their edits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { decodeTable, chooseParsedRows, rowsToCsv } = require('../../../tools/csvSmart');

const root = path.resolve(__dirname, '../../..');
function addRow(filename, sourceKind, make) {
  const file = path.join(root, 'data', filename);
  const rows = chooseParsedRows(decodeTable(file).text, []).rows;
  const headers = rows[0].map((cell) => cell.replace(/^\uFEFF/, ''));
  if (rows.some((row) => row[0] === 'is2')) return;
  const index = rows.findIndex((row) => row[0] === sourceKind);
  if (index < 0) throw new Error(`${filename}: missing ${sourceKind}`);
  const row = [...rows[index]];
  const set = (key, value) => { row[headers.indexOf(key)] = String(value); };
  make(set);
  rows.splice(index + 1, 0, row);
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(rowsToCsv(rows), 'utf8'),
  ]));
}

async function main() {
  addRow('tank_visuals.csv', 'kv1', (set) => {
    set('kind', 'is2');
    set('displayName', 'IS-2');
    for (const role of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
      const key = role === 'top' ? 'topSpritePath'
        : role === 'top_hull' ? 'hullSpritePath'
          : role === 'top_turret' ? 'turretSpritePath' : 'destroyedSpritePath';
      set(key, `textures/units/is2_${role}/spriteFrame`);
    }
    set('fitScale', 0.82);
    set('hullFitScale', 0.76);
    set('turretScale', 1);
    set('turretOffsetForward', 0);
    set('turretOffsetRight', 0);
    set('commanderHatchScale', 22);
    set('notes', 'IS-2 model 1944; user three-view; shared-scale 122 mm gun and hull-aligned wreck');
  });
  addRow('units.csv', 'kv1', (set) => {
    set('unitKind', 'is2');
    set('displayName', 'IS-2 重型坦克');
    set('size', 4);
    set('mobility', 2);
    set('armorFront', 16);
    set('armorFrontSide', 13);
    set('armorRearSide', 11);
    set('armorRear', 10);
    set('firepower', 3);
    set('penetration', 5);
    set('highExplosivePower', 6);
    set('effectiveRange', 3);
    set('turretTraverseSpeed', 2);
    set('notes', 'IS-2 重型坦克；五人车组；122 毫米 D-25T 炮');
  });
  const langPath = path.join(root, 'data/lang.csv');
  let lang = fs.readFileSync(langPath, 'utf8');
  if (!lang.includes('unit.name.is2,')) {
    lang = lang.replace(/(unit\.name\.kv1,[^\r\n]*\r?\n)/,
      '$1unit.name.is2,IS-2 重型坦克,IS-2 Heavy Tank\n');
    fs.writeFileSync(langPath, lang, 'utf8');
  }

  const dir = path.join(root, 'assets/resources/textures/units');
  const template = JSON.parse(fs.readFileSync(path.join(dir, 'kv1_top_hull.png.meta'), 'utf8'));
  for (const role of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
    const stem = `is2_${role}`;
    const png = path.join(dir, `${stem}.png`);
    if (!fs.existsSync(png)) await sharp({ create: {
      width: 1, height: 1, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    } }).png().toFile(png);
    if (!fs.existsSync(`${png}.meta`)) {
      const meta = JSON.parse(JSON.stringify(template));
      const uuid = crypto.randomUUID();
      meta.uuid = uuid;
      for (const sub of Object.values(meta.subMetas)) {
        sub.uuid = `${uuid}@${sub.id}`;
        sub.displayName = stem;
        if (sub.importer === 'texture') sub.userData.imageUuidOrDatabaseUri = uuid;
      }
      fs.writeFileSync(`${png}.meta`, `${JSON.stringify(meta, null, 2)}\n`);
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
