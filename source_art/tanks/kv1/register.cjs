#!/usr/bin/env node
'use strict';

// One-time, idempotent registration of the new artwork and gameplay unit.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { decodeTable, chooseParsedRows, rowsToCsv } = require('../../../tools/csvSmart');

const root = path.resolve(__dirname, '../../..');
const csvPath = (name) => path.join(root, 'data', name);
const saveCsv = (filename, sourceKind, make) => {
  const filenameFull = csvPath(filename);
  const rows = chooseParsedRows(decodeTable(filenameFull).text, []).rows;
  const headers = rows[0].map((cell) => cell.replace(/^\uFEFF/, ''));
  if (rows.some((row) => row[0] === 'kv1')) return;
  const from = rows.findIndex((row) => row[0] === sourceKind);
  if (from < 0) throw new Error(`${filename}: missing ${sourceKind}`);
  const row = [...rows[from]];
  const set = (key, value) => { row[headers.indexOf(key)] = String(value); };
  make(set);
  rows.splice(from + 1, 0, row);
  fs.writeFileSync(filenameFull, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(rowsToCsv(rows), 'utf8'),
  ]));
};

async function main() {
  saveCsv('tank_visuals.csv', 't34_85', (set) => {
    set('kind', 'kv1');
    set('displayName', 'KV-1');
    for (const role of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
      const key = role === 'top' ? 'topSpritePath'
        : role === 'top_hull' ? 'hullSpritePath'
          : role === 'top_turret' ? 'turretSpritePath' : 'destroyedSpritePath';
      set(key, `textures/units/kv1_${role}/spriteFrame`);
    }
    set('fitScale', 0.82);
    set('hullFitScale', 0.76);
    set('turretScale', 1);
    set('turretOffsetForward', 0);
    set('turretOffsetRight', 0);
    set('commanderHatchScale', 22);
    set('notes', 'KV-1 three-view olive-green split sprite; 76 mm gun; hull-aligned wreck');
  });
  saveCsv('units.csv', 't34_85', (set) => {
    set('unitKind', 'kv1');
    set('displayName', 'KV-1 重型坦克');
    set('size', 3);
    set('mobility', 2);
    set('armorFront', 13);
    set('armorFrontSide', 12);
    set('armorRearSide', 11);
    set('armorRear', 10);
    set('gunMantletArmor', 1);
    set('firepower', 4);
    set('penetration', 2);
    set('highExplosivePower', 2);
    set('effectiveRange', 2);
    set('turretTraverseSpeed', 2);
    set('notes', 'KV-1 重型坦克；五人车组；76 毫米炮');
  });
  const langPath = csvPath('lang.csv');
  let lang = fs.readFileSync(langPath, 'utf8');
  if (!lang.includes('unit.name.kv1,')) {
    lang = lang.replace(/(unit\.name\.t34_85,[^\r\n]*\r?\n)/,
      '$1unit.name.kv1,KV-1 重型坦克,KV-1 Heavy Tank\n');
    fs.writeFileSync(langPath, lang, 'utf8');
  }

  const dir = path.join(root, 'assets/resources/textures/units');
  const template = JSON.parse(fs.readFileSync(path.join(dir, 't34_85_top_hull.png.meta'), 'utf8'));
  for (const role of ['top', 'top_hull', 'top_turret', 'top_destroyed']) {
    const stem = `kv1_${role}`;
    const png = path.join(dir, `${stem}.png`);
    const metaPath = `${png}.meta`;
    if (!fs.existsSync(png)) await sharp({ create: {
      width: 1, height: 1, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    } }).png().toFile(png);
    if (!fs.existsSync(metaPath)) {
      const meta = JSON.parse(JSON.stringify(template));
      const uuid = crypto.randomUUID();
      meta.uuid = uuid;
      for (const sub of Object.values(meta.subMetas)) {
        sub.uuid = `${uuid}@${sub.id}`;
        sub.displayName = stem;
        if (sub.importer === 'texture') sub.userData.imageUuidOrDatabaseUri = uuid;
      }
      fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
