const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../assets/scripts/view/BattleScene.ts'), 'utf8');
const afterMove = source.indexOf("if (anim.kind === 'move' && !anim.evacExit");
const resumeEnemy = source.indexOf('this.runNextEnemyStep();', afterMove);
const resumePlayer = source.indexOf('this.completePhaseDiceAction();', afterMove);
assert.ok(afterMove >= 0 && resumeEnemy > afterMove && resumePlayer > afterMove,
  'reaction must resolve after a move before subsequent action dice');
const start = source.indexOf('private tryResolveAmbushAfterMove(');
const end = source.indexOf('private tryEnterAmbush(', start);
const body = source.slice(start, end);
assert.ok(body.includes('isInAmbushSight(mover.pos, sight, HexMap.keyOf)'),
  'movement ending in the aimed sight range must trigger');
assert.ok(body.includes('orderedAmbushers(this.allUnits(), mover)'),
  'multiple ambushers must resolve in activation order');
assert.ok(body.includes('if (!mover.destroyed && this.tryResolveAmbushAfterMove(mover, resume)) return;'),
  'destroyed movers cannot be targeted by later ambushers');
assert.ok(body.includes('rollAttack({') && body.includes('rollHighExplosiveAttack({'),
  'AP and HE reactions use ordinary gun reports');
assert.ok(body.includes('markAmbushAction(watcher)'), 'triggered stance ends');

console.log('BattleScene ambush timing tests passed');
