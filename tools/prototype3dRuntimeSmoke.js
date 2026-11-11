/** Opt-in in-engine smoke checks, loaded only by prototype3dQaServer.cjs. */
window.runPrototypeSmoke = async (cc, scene) => {
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const saveFrame = name => new Promise(resolve => cc.director.once(cc.Director.EVENT_AFTER_DRAW, () => {
    fetch(`/__qa/frame?name=${name}`, { method: 'POST', body: cc.game.canvas.toDataURL('image/png') }).then(resolve);
  }));
  const waitIdle = instance => new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const poll = setInterval(() => {
      if (!instance.busy) { clearInterval(poll); resolve(); }
      else if (Date.now() > deadline) { clearInterval(poll); reject(new Error('Animation did not finish')); }
    }, 50);
  });
  const report = data => fetch('/__qa/smoke', { method: 'POST', body: JSON.stringify({ checks, ...data }) });
  try {
    const instance = scene.getComponentsInChildren('Prototype3DScene')[0];
    assert(!!instance.status && instance.meshes.length > 30, 'Scene, HUD and procedural meshes initialize');
    await saveFrame('initial');
    const cameraBefore = instance.camera.node.position.clone();
    instance.onKey({ keyCode: cc.KeyCode.KEY_E });
    assert(!cameraBefore.equals(instance.camera.node.position), 'Orbit keyboard control moves the perspective camera');
    instance.onKey({ keyCode: cc.KeyCode.KEY_Q });
    const x = 1.55 * Math.sqrt(3) * (-1 + 1 / 2), z = 1.55 * 1.5;
    const screen = instance.camera.worldToScreen(new cc.Vec3(x, 0, z));
    instance.pick(new cc.Vec2(screen.x, screen.y));
    await waitIdle(instance);
    assert(instance.battle.player.q === -1 && instance.battle.player.r === 1 && instance.battle.moves === 2,
      'Screen picking, path movement and movement budget agree');
    assert(Math.abs(instance.player.root.position.x - x) < .001, 'Tank animation arrives on its selected hex');
    await instance.shoot(false);
    assert(instance.battle.enemyHP === 1 && instance.battle.fired, 'Projectile animation applies one outgoing hit');
    await instance.shoot(false);
    assert(instance.battle.enemyHP === 1, 'Second shell in the same turn is rejected');
    await instance.endTurn();
    assert(instance.battle.playerHP === 2 && instance.battle.turn === 2 && !instance.battle.fired,
      'Enemy response, next turn and gun reload complete');
    await instance.shoot(false);
    assert(instance.battle.outcome === 'won' && instance.targetLabel.string === 'PANZER IV  ',
      'Final hit produces the completed exercise and wreck');
    await saveFrame('victory');
    await report({ passed: true, final: { turn: instance.battle.turn, playerHP: instance.battle.playerHP, enemyHP: instance.battle.enemyHP } });
    const launched = new Promise(resolve => cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, resolve));
    instance.restart();
    await launched;
    const restarted = cc.director.getScene().getComponentsInChildren('Prototype3DScene')[0];
    assert(restarted.battle.turn === 1 && restarted.battle.enemyHP === 2 && restarted.battle.playerHP === 3,
      'Restart reloads an intact independent exercise');
    await saveFrame('restarted');
    await report({ passed: true, restarted: true });
  } catch (error) { await report({ passed: false, error: String(error.stack || error) }); }
};
