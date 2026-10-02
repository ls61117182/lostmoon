const fs = require('fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const body = source.match(/private drawStukaShotDown\(pass: StukaFlyover, x: number\) \{([\s\S]*?)\n  private drawStukaCannonBurst/)[1].replace(/\n  \}\s*$/, '');
let sounds = 0;
let bursts = 0;
const draw = new Function('pass', 'x', 'playMgFire', 'machineGunBurstStartPoint', body);
const scene = {
  mapNode: { position: { x: 20, y: 30 } },
  hexSize: 40,
  project: () => ({ x: 10, y: 15 }),
  spawnMachineGunBurst: () => { bursts++; return { t: 0, dur: 0.62 }; },
};
const pass = { defender: { pos: { q: 0, r: 0 } }, y: 100 };
const sound = () => sounds++;
const muzzle = (p, ux, uy) => ({ x: p.x + ux * 10, y: p.y + uy * 10 });
draw.call(scene, pass, 200, sound, muzzle);
assert.equal(pass.aaBurst.targetX, 180);
assert.equal(pass.aaBurst.targetY, 70);
const firstDirection = pass.aaBurst.ux;
scene.mapNode.position.x = 40;
draw.call(scene, pass, -100, sound, muzzle);
assert.equal(pass.aaBurst.targetX, -140);
assert.ok(firstDirection > 0 && pass.aaBurst.ux < 0);
assert.equal(sounds, 1, 'tracking updates must not replay sound each frame');
pass.aaBurst.t = 0.62;
draw.call(scene, pass, -120, sound, muzzle);
assert.equal(sounds, 1, 'finished AA attack must not replay its sound');
assert.equal(bursts, 1, 'finished AA attack must not spawn another animation');
for (let i = 0; i < 120; i++) draw.call(scene, pass, -120 - i, sound, muzzle);
assert.equal(sounds, 1);
assert.equal(bursts, 1);
assert.match(source, /!pass.shotDown && !pass.cannonSoundStarted/);
assert.match(source, /!pass.shotDown && pass.cannonT < 0/);
assert.match(source, /prepared.bodyKey === 'turnEnd.stuka.shotDown'/);
assert.match(source, /drawFireSmoke\(g, \{ x, y: pass.y \}, 3, pass.cannonSeed, 1\)/);
console.log('Stuka shot-down presentation tests passed');
