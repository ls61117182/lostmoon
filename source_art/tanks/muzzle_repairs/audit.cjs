#!/usr/bin/env node
'use strict';

const path = require('path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../../..');
const here = __dirname;
const pairs = [
  ['panzer4 source', 'before-turret-selected.png', 'source_art/tanks/panzer4g/turret-selected.png'],
  ['stug3 source', 'before-top-selected.png', 'source_art/tanks/stug3g/top-selected.png'],
  ['panzer4 turret', 'before-panzer4_top_turret.png', 'assets/resources/textures/units/panzer4_top_turret.png'],
  ['panzer4 top', 'before-panzer4_top.png', 'assets/resources/textures/units/panzer4_top.png'],
  ['panther turret', 'before-panther_top_turret.png', 'assets/resources/textures/units/panther_top_turret.png'],
  ['panther top', 'before-panther_top.png', 'assets/resources/textures/units/panther_top.png'],
  ['stug3 top', 'before-stug3_top.png', 'assets/resources/textures/units/stug3_top.png'],
];

async function read(p) {
  return sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function main() {
  for (const [label, before, after] of pairs) {
    const a = await read(path.join(here, before));
    const b = await read(path.join(root, after));
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
      throw new Error(`${label}: dimensions changed`);
    }
    let count = 0; let alpha = 0; let minX = Infinity; let minY = Infinity; let maxX = -1; let maxY = -1;
    for (let y = 0; y < a.info.height; y++) for (let x = 0; x < a.info.width; x++) {
      const i = (y * a.info.width + x) * 4;
      if (a.data[i] === b.data[i] && a.data[i+1] === b.data[i+1]
          && a.data[i+2] === b.data[i+2] && a.data[i+3] === b.data[i+3]) continue;
      count++;
      if (a.data[i+3] !== b.data[i+3]) alpha++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    console.log(`${label}: ${a.info.width}x${a.info.height}, changed=${count}, alpha=${alpha}, bbox=${count ? `${minX},${minY}..${maxX},${maxY}` : 'none'}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
