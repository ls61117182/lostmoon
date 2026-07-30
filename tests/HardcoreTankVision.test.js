const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fogSource = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/core/FogOfWar.ts'),
  'utf8',
);
const typeSource = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/core/types.ts'),
  'utf8',
);
const docSource = fs.readFileSync(
  path.resolve(__dirname, '../docs/GameDesignDocument.md'),
  'utf8',
);

assert.match(typeSource, /gunnerVisionRange\??:\s*number/, 'gunner sight must have its own data field');
assert.match(typeSource, /interiorVisionRange\??:\s*number/, 'interior sight must have its own data field');
assert.match(fogSource, /export function currentGunnerVisionRange/, 'gunner range needs an independent resolver');
assert.match(fogSource, /export function currentInteriorVisionRange/, 'interior range needs an independent resolver');
assert.match(
  fogSource,
  /const tank = isTankUnit\(unit\);[\s\S]*?if \(tank && !openHatch\)[\s\S]*?currentInteriorVisionRange\(unit\)/,
  'only closed tanks should add the independent interior ring',
);
assert.match(
  fogSource,
  /const gunnerVisionRange = tank \? currentGunnerVisionRange\(unit\) : commanderVisionRange/,
  'tank gunner rays must not reuse commander range',
);
assert.match(docSource, /开舱时 = 车长视野 ∪ 炮手视野；关舱或车长阵亡时 = 车内视野 ∪ 炮手视野/, 'GDD must define union semantics');

console.log('Hardcore tank vision tests passed');
