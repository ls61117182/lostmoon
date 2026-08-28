const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'),
  'utf8',
);

function methodBody(name) {
  const start = source.indexOf(`private ${name}(`);
  assert.notStrictEqual(start, -1, `missing method ${name}`);
  const next = source.indexOf('\n  private ', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

assert.match(
  methodBody('spawnDestroyedTurretVisual'),
  /groundScale:\s*1(?:\.0)?[,\n]/,
  'a landed turret should return to exactly its mounted size',
);

assert.match(
  methodBody('advanceDestroyedTurretVisuals'),
  /const baseScale = 1 \+ \(visual\.groundScale - 1\) \* flightT;[\s\S]*?const scale = baseScale \+ \(visual\.maxScale - baseScale\) \* height;/,
  'the flight scale should smoothly settle at the configured ground scale',
);
