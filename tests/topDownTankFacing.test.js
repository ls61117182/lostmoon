const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

function methodBody(name) {
  const marker = `private ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing method ${name}`);
  const open = source.indexOf('\n  ) {', start) + '\n  ) '.length;
  if (open < '\n  ) '.length) throw new Error(`Missing method body for ${name}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed method ${name}`);
}

function testSingleTopDownTankSpritesUseStableFacingDuringMovement() {
  const body = methodBody('applyTopDownTankSprite');

  assert(
    body.includes('this.topDownForwardVec(u, c, facingLerp)'),
    'applyTopDownTankSprite should use the shared stable facing helper',
  );
  assert(
    !body.includes('const np = this.project(neighbor(u.pos, u.facing).q, neighbor(u.pos, u.facing).r)'),
    'applyTopDownTankSprite should not derive facing from the animated sprite center',
  );
}

testSingleTopDownTankSpritesUseStableFacingDuringMovement();
console.log('topDownTankFacing.test.js passed');
