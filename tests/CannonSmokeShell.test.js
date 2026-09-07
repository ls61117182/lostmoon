const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { loadCampaignShell } = require('../assets/scripts/core/CampaignUpgrade.ts');
const { resolvedLoadedShell } = require('../assets/scripts/core/types.ts');
const tank = { loaded: false, loadedShell: null };
for (let i = 0; i < 7; i++) {
  assert.equal(loadCampaignShell(tank, 'smoke'), true);
  assert.equal(tank.smokeAmmoRemaining, 6 - i);
  tank.loaded = false; tank.loadedShell = null;
}
assert.equal(loadCampaignShell(tank, 'smoke'), false);
const swap = { loaded: false, hvapAmmoRemaining: 2 };
loadCampaignShell(swap, 'smoke');
loadCampaignShell(swap, 'smoke');
assert.equal(swap.smokeAmmoRemaining, 6);
loadCampaignShell(swap, 'hvap');
assert.equal(swap.smokeAmmoRemaining, 7);
loadCampaignShell(swap, 'smoke');
assert.equal(swap.hvapAmmoRemaining, 2);
loadCampaignShell(swap, 'he');
assert.equal(swap.smokeAmmoRemaining, 7);
const scene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');
const method = scene.match(/  private tryFireSmokeAt\(tile: Tile\): void \{[\s\S]*?\n  \}/)[0];
const code = ts.transpileModule('class Harness { '+method+' }', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const Harness = new Function('resolvedLoadedShell', 'markAmbushAction', 't', 'Color', code+'; return Harness;')(resolvedLoadedShell, ()=>{}, x=>x, class {});
for (const partner of [-1, 1]) {
  const h = new Harness();
  const unit = { loaded: true, loadedShell: 'smoke', stats: {}, hp: 10 };
  const tile = { pos: { q: 3, r: 0 } };
  Object.assign(h, { mission: { sherman: unit }, selectedGunDieIdx: 0, selectedGunDoublesIdx: partner, phaseDice: [{used:false},{used:false}], projectileTraces: [], canFireSmokeAt: ()=>true, startShermanTurretAim: (_, done)=>done(), playAttackFireCue: ()=>{}, spawnProjectileTrace: (_,__,___, options)=>{ h.projectileTraces.push({}); h.impact = options.onPenetrationImpact; }, deploySmokeAt: pos=>h.smoke=pos, usePhaseDice: dice=>h.used=dice, clearGunSelection: ()=>{}, spawnFloater: ()=>{}, battleLogI18n: ()=>{}, refreshPhaseUI: ()=>{}, updateHUD: ()=>{}, redraw: ()=>{}, completePhaseDiceAction: ()=>h.done=true });
  h.tryFireSmokeAt(tile);
  assert.equal(h.smoke, undefined);
  assert.equal(h.smokeShellInFlight, true);
  h.impact();
  assert.deepEqual(h.smoke, tile.pos);
  assert.equal(unit.hp, 10);
  assert.equal(unit.loadedShell, null);
  assert.deepEqual(h.used, partner < 0 ? [0] : [0,1]);
  assert.equal(h.done, true);
  assert.equal(h.smokeShellInFlight, false);
}
console.log('Cannon smoke shell tests passed');

// Smoke cannot enter precision selection, even through a direct/stale callback.
const precisionMethod = scene.match(/  private selectPrecisionGunDie\(dieIdx: number\) \{[\s\S]*?\n  \}/)[0];
const precisionCode = ts.transpileModule('class PrecisionHarness { '+precisionMethod+' }', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const PrecisionHarness = new Function('resolvedLoadedShell', 'getGameModeConfig', 'GameSession', precisionCode+'; return PrecisionHarness;')(resolvedLoadedShell, ()=>({precisionFire:true}), {gameMode:'hardcore'});
const blocked = new PrecisionHarness();
blocked.mission = {sherman:{loadedShell:'smoke'}};
blocked.selectPrecisionGunDie(0);
assert.equal(blocked.selectedGunHitThresholdModifier, undefined);
assert.match(scene, /precisionFire\s*&& resolvedLoadedShell\(this\.mission!\.sherman\) !== 'smoke'/);

// Fog targets keep their icon even when outside the blue reconnaissance range.
const overlayMethod = scene.match(/  private redrawTurretAimOverlay\(\) \{[\s\S]*?\n  \}/)[0];
const overlayCode = ts.transpileModule('class OverlayHarness { '+overlayMethod+' }', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const hex = { keyOf: p=>p.q+','+p.r };
const OverlayHarness = new Function('resolvedLoadedShell','GameSession','HexMap','isMainGunLoaded','neighbor',overlayCode+'; return OverlayHarness;')(resolvedLoadedShell,{gameMode:'hardcore'},hex,()=>true,()=>({q:99,r:99}));
const h = new OverlayHarness();
const tiles = [{pos:{q:1,r:0}},{pos:{q:2,r:0}}];
const icons = {clear:()=>{}};
let iconCount=0, blueCount=0, topIndex=-1;
Object.assign(h, {
  turretAimOverlayGraphics:{clear:()=>{}},turretAimOverlayNode:{},smokeTargetIconGraphics:icons,
  smokeTargetIconNode:{setSiblingIndex:i=>topIndex=i},mapNode:{children:[{}, {}, {}, {}]},
  mission:{sherman:{pos:{q:0,r:0},loadedShell:'smoke',stats:{turretTraverseSpeed:2}},map:{all:()=>tiles,get:()=>null}},
  selectedGunDieIdx:0,selectedGunHitThresholdModifier:0,
  playerTurretCanRotate:()=>true,hasTurretReconGunSelection:()=>true,
  playerWeaponTargetHexKeys:()=>new Set(['1,0','2,0']),isDeepShadowTile:()=>false,
  isHexVisible:()=>false,fogTurretAimDirection:p=>p.q===1?0:null,
  project:(x,y)=>({x,y}),drawSmokeShellTargetIcon:g=>{assert.equal(g,icons);iconCount++;},
  drawTurretAimHex:()=>blueCount++,currentTurretFacingFor:()=>0,directionScreenAngle:()=>0,
  drawTurretTraverseAngleRing:()=>{},drawTurretAimBoundaryEdge:()=>{}
});
h.redrawTurretAimOverlay();
assert.equal(iconCount,2,'both unseen legal hexes receive icons');
assert.equal(blueCount,1,'the blue turret range remains visible');
assert.equal(topIndex,3,'icons are placed above existing map children');
assert.equal(h.smokeTargetIconNode.active,true);
assert(scene.indexOf('this.tryFireSmokeAt(target);') < scene.indexOf('const targetVisible = this.isHexVisible(target.pos);'), 'smoke clicks route before visibility filtering');
