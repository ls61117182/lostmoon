const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

test('unit rank marker follows the full localized unit-name width', () => {
  const method = source.match(
    /private\s+drawUnitRankMarker[\s\S]*?\n  }\n\n  private\s+hasLiveUnitOnSameTile/,
  );

  assert.ok(method, 'unit rank marker renderer should be present');
  assert.match(
    method[0],
    /-estimatedTextWidth\s*\*\s*0\.5\s*-\s*10\s*\*\s*UNIT_NAME_SCALE/,
    'rank marker should be placed from the complete estimated text width',
  );
  assert.doesNotMatch(
    method[0],
    /Math\.min\([^\n]*estimatedTextWidth/,
    'long English names must not clamp the marker back inside the label text',
  );
});
