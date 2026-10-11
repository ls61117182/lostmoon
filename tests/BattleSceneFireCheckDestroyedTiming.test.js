const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.createSourceFile('BattleScene.ts', fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const sceneClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'BattleScene');
const names = ['startFireCheckFlow', 'advanceFireCheckEventUI', 'onFireCheckConfirmClick', 'applyFireCheckEffect'];
const methods = names.map(name => sceneClass.members.find(member => member.name?.getText(source) === name).getText(source));
const code = ts.transpileModule(`class Scene { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const Scene = new Function('Color', 't', 'isAbandonedTank', 'playDiceRoll', 'DICE_ROLL_DUR', `${code}; return Scene;`)(
  class {}, key => key, () => false, () => {}, 1,
);

function setup(effect) {
  const scene = new Scene();
  const tank = { pos: { q: 0, r: 0 }, fireLevel: 1, destroyed: false };
  scene.mission = { sherman: tank, playerTank: tank };
  const calls = { explosion: 0, complete: 0, log: 0, redraw: 0 };
  scene.battleLog = scene.spawnFloater = scene.refreshStatusPanel = scene.setDieLabelFace = () => {};
  scene.redraw = () => calls.redraw++;
  scene.registerAmmoExplosionWreckVisual = unit => {
    assert.equal(unit.destroyed, true);
    calls.explosion++;
  };
  scene.prepareFireCheckSteps = () => ({ steps: [{ die: 1, effect }], allDice: [1], pendingFire: 0 });
  scene.formatFireCheckBodyText = () => effect;
  scene.fireCheckFinalResultDescriptor = () => ({ key: effect });
  scene.localizedFireCheckResult = key => key;
  scene.destroyFireCheckEventUI = () => { scene.fireCheckEventUI = null; };
  scene.destroyUsCasualtyEventUI = () => {};
  scene.buildFireCheckEventPanel = () => ({
    root: {}, dieLabels: [{}], sumLabel: {}, bodyLabel: {}, confirmButton: { active: false },
  });
  scene.battleLogI18n = () => calls.log++;
  scene.finishCombatLogReplay = () => calls.complete++;
  scene.startFireCheckFlow(() => calls.complete++);
  return { scene, tank, calls };
}

{
  const { scene, tank, calls } = setup('destroyed');
  scene.advanceFireCheckEventUI(0.5);
  scene.onFireCheckConfirmClick();
  assert.equal(tank.destroyed, false, 'rolling must not reveal destruction early');
  assert.equal(calls.complete, 0);
  scene.advanceFireCheckEventUI(0.5);
  assert.equal(tank.destroyed, true, 'destruction must apply when dice reveal the result');
  assert.equal(calls.explosion, 1, 'explosion must play before confirmation');
  assert.equal(calls.redraw, 1);
  assert.equal(calls.complete, 0, 'next phase must still wait for confirmation');
  scene.advanceFireCheckEventUI(1);
  scene.onFireCheckConfirmClick();
  scene.onFireCheckConfirmClick();
  assert.equal(calls.explosion, 1, 'confirmation must not repeat the explosion');
  assert.equal(calls.redraw, 1);
  assert.equal(calls.complete, 1);
  assert.equal(calls.log, 1);
}

{
  const { scene, tank, calls } = setup('fire');
  scene.advanceFireCheckEventUI(1);
  assert.equal(tank.fireLevel, 1, 'other results retain confirmation timing');
  scene.onFireCheckConfirmClick();
  assert.equal(tank.fireLevel, 2);
  assert.equal(calls.explosion, 0);
}

{
  const { scene, tank, calls } = setup('destroyed');
  scene.fireCheckEventUI.historyReplay = true;
  scene.advanceFireCheckEventUI(1);
  scene.onFireCheckConfirmClick();
  assert.equal(tank.destroyed, false, 'history replay must not mutate the tank');
  assert.equal(calls.explosion, 0);
  assert.equal(calls.log, 0);
}

console.log('BattleScene fire-check destruction timing tests passed');
