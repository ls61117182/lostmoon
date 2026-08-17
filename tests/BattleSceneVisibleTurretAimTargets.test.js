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
  source,
  /private visibleTurretAimDirection\(pos: Axial\): FireDirection \| null[\s\S]*?!this\.isHexVisible\(pos\)[\s\S]*?this\.canTurretReachDirection\(sherman, direction\)/,
  'visible turret targets must be visible, direction-valid, and within the configured traverse speed',
);

assert.doesNotMatch(
  methodBody('fogTurretAimDirection'),
  /isCommanderHatchOpen/,
  'open-hatch state must still permit turret direction selection',
);
assert.doesNotMatch(
  methodBody('redrawTurretAimOverlay'),
  /showTurretAimMarkers[\s\S]*?isCommanderHatchOpen/,
  'open-hatch state must still display clickable turret markers',
);
assert.doesNotMatch(
  methodBody('onTouchMap'),
  /hasTurretReconGunSelection\(\)\s*&&\s*!this\.isCommanderHatchOpen/,
  'open-hatch state must accept marked turret rotation clicks',
);
assert.match(
  methodBody('gunActionUnavailable'),
  /const canUseUnloadedForTurretRecon = GameSession\.gameMode === 'hardcore';/,
  'hardcore turret rotation must remain selectable while unloaded regardless of hatch state',
);
assert.doesNotMatch(
  methodBody('gunActionUnavailable'),
  /canUseUnloadedForTurretRecon[^\n]*hatchOpen/,
  'unloaded turret rotation availability must not depend on the hatch',
);
assert.match(
  methodBody('gunActionUnavailable'),
  /const crewReason[\s\S]*?if \(crewReason\) return crewReason;[\s\S]*?if \(s\.turretDamaged\) return null;/,
  'a damaged turret must still allow the main-gun button to enter the blocked-range preview state',
);
assert.doesNotMatch(
  methodBody('hasTurretReconGunSelection'),
  /turretDamaged/,
  'turret damage must not discard an active main-gun or machine-gun preview selection',
);
assert.doesNotMatch(
  methodBody('hasTurretReconGunSelection'),
  /selectedGunHitThresholdModifier\s*>=\s*0/,
  'precision fire must enter the same turret range preview lifecycle as ordinary main-gun fire',
);
assert.match(
  methodBody('mgActionUnavailable'),
  /if \(this\.mission\.sherman\.turretDamaged\) return null;/,
  'a damaged turret must still allow the machine-gun button to enter the blocked-range preview state',
);
assert.match(
  methodBody('precisionGunActionUnavailable'),
  /crewActionUnavailable\('gunner'\)[\s\S]*?!this\.mission\.sherman\.loaded[\s\S]*?return t\('hud\.unloaded'\)/,
  'precision fire must report unloaded instead of inheriting ordinary main-gun rotation availability',
);
assert.match(
  methodBody('showDiePopover'),
  /action\.precisionFire[\s\S]*?selectPrecisionGunDie\(idx\), this\.precisionGunActionUnavailable\(\)/,
  'the precision-fire button must use its strict loaded-state availability check',
);
assert.match(
  methodBody('selectPrecisionGunDie'),
  /if \(!this\.mission\.sherman\.loaded\) \{[\s\S]*?clearGunSelection\(\)[\s\S]*?t\('hud\.unloaded'\)[\s\S]*?redraw\(\)[\s\S]*?return;[\s\S]*?selectedGunHitThresholdModifier = -2/,
  'an unloaded precision-fire selection must clear any target state and return before enabling the range preview',
);
assert.match(
  source,
  /const direction = this\.isHexVisible\(tile\.pos\)[\s\S]*?this\.visibleTurretAimDirection\(tile\.pos\)[\s\S]*?: this\.fogTurretAimDirection\(tile\.pos\)[\s\S]*?this\.drawTurretAimHex/,
  'a hex mask must be drawn for legal visible and fog turret targets',
);
assert.match(
  methodBody('drawTurretAimHex'),
  /TURRET_AIM_HEX_FILL[\s\S]*?traceHexPathOn[\s\S]*?g\.fill\(\)/,
  'turret target masks must use a static translucent blue hex fill',
);
assert.match(
  methodBody('drawTurretTraverseAngleRing'),
  /TURRET_TRAVERSE_BLOCKED_ARC_COLOR[\s\S]*?g\.circle[\s\S]*?TURRET_TRAVERSE_REACHABLE_ARC_COLOR[\s\S]*?halfSpan = speed \* Math\.PI \/ 6[\s\S]*?strokeTurretTraverseArc/,
  'the player origin must show reachable angles in green and unreachable angles in dark gray',
);
assert.doesNotMatch(
  source,
  /TURRET_AIM_ORIGIN_HEX_FILL|drawTurretAimOriginHex/,
  'the player origin must no longer use a green hex mask',
);
assert.doesNotMatch(
  source,
  /drawFogTurretAimEye|FOG_TURRET_AIM_HINT|TURRET_AIM_HEX_PULSE|Math\.sin\(this\.unitEffectTime[^\n]*TURRET_AIM/,
  'turret target presentation must not draw eye icons or animate the mask opacity',
);
assert.match(
  methodBody('redrawTurretAimOverlay'),
  /boundaryInteriorKeys[\s\S]*?neighbor\(tile\.pos, axialDir as Direction\)[\s\S]*?!neighborTile \|\| boundaryInteriorKeys\.has[\s\S]*?drawTurretAimBoundaryEdge/,
  'only shared edges between reachable and unreachable map hexes should receive the emphasized boundary',
);
assert.match(
  methodBody('redrawTurretAimOverlay'),
  /originKey = HexMap\.keyOf\(this\.mission\.sherman\.pos\)[\s\S]*?drawTurretTraverseAngleRing[\s\S]*?boundaryInteriorKeys\.add\(originKey\)[\s\S]*?boundaryInteriorKeys\.has\(HexMap\.keyOf\(neighborTile\.pos\)\)/,
  'the player angle-ring origin must suppress shared boundary edges without becoming a blue target hex',
);
assert.match(
  methodBody('redrawTurretAimOverlay'),
  /const turretDamaged = this\.mission\.sherman\.turretDamaged === true;[\s\S]*?if \(!turretDamaged\) \{[\s\S]*?drawTurretAimHex[\s\S]*?turretDamaged \? 0 : this\.mission\.sherman\.stats\.turretTraverseSpeed/,
  'a damaged turret must render no blue target hexes and pass zero speed to the all-gray angle ring',
);
assert.match(
  methodBody('redrawTurretAimOverlay'),
  /precisionGunSelection = this\.selectedGunDieIdx >= 0[\s\S]*?selectedGunHitThresholdModifier < 0[\s\S]*?if \(precisionGunSelection && !legalWeaponTargetKeys\.has\(tileKey\)\) continue;[\s\S]*?if \(precisionGunSelection\) \{[\s\S]*?drawPrecisionTargetReticle[\s\S]*?continue;[\s\S]*?reachableKeys\.add/,
  'precision fire must draw red reticles instead of adding its legal targets to the blue-mask set',
);
assert.match(
  methodBody('drawPrecisionTargetReticle'),
  /radius = this\.hexSize \* 0\.74[\s\S]*?PRECISION_TARGET_RETICLE_COLOR[\s\S]*?g\.circle\(cx, cy, radius\)[\s\S]*?for \(let i = 0; i < 4; i\+\+\)[\s\S]*?g\.lineTo[\s\S]*?g\.circle\(cx, cy, Math\.max/,
  'the precision target marker must be a large red scope ring with four crosshair ticks and a center point',
);
assert.match(
  methodBody('drawTurretAimBoundaryEdge'),
  /HEDGE_DRAW_EDGE_BY_AXIAL[\s\S]*?TURRET_AIM_BOUNDARY_COLOR[\s\S]*?lineWidth = 5[\s\S]*?g\.stroke\(\)/,
  'the reachable-area boundary must use the dedicated strong color and stroke',
);
assert.match(
  source,
  /enemiesOnTile\.length === 0 \|\| unloadedGunRotation[\s\S]*?this\.tryAimShermanTurretAtFogTile\(direction, target\.pos, mgSel\)/,
  'clicking a marked visible empty hex must rotate the selected turret weapon instead of opening inspection',
);
assert.match(
  methodBody('onTouchMap'),
  /const unloadedGunRotation = gunSel && !this\.mission\.sherman\.loaded;[\s\S]*?enemiesOnTile\.length === 0 \|\| unloadedGunRotation[\s\S]*?tryAimShermanTurretAtFogTile/,
  'an unloaded main gun must rotate instead of trying to fire when a visible enemy hex is clicked',
);
assert.match(
  methodBody('redrawTurretAimOverlay'),
  /legalWeaponTargetKeys = this\.playerWeaponTargetHexKeys\(\)[\s\S]*?unloadedGunRotation[\s\S]*?machineGunRotationSelection[\s\S]*?visibleEnemyKeys\.has\(tileKey\)[\s\S]*?!machineGunRotationSelection[\s\S]*?!legalWeaponTargetKeys\.has\(tileKey\)[\s\S]*?drawTurretAimHex/,
  'legal firing targets, unloaded-gun targets, and MG rotation-only enemy hexes must share the green mask',
);
assert.match(
  methodBody('onTouchMap'),
  /const legalMGTarget = mgSel \? enemiesOnTile\.find\(e => canMGAttack[\s\S]*?const machineGunRotationOnly = mgSel && enemiesOnTile\.length > 0 && !legalMGTarget;[\s\S]*?unloadedGunRotation \|\| machineGunRotationOnly[\s\S]*?tryAimShermanTurretAtFogTile/,
  'clicking an enemy outside MG attack legality must consume the MG action as turret rotation',
);
assert.match(
  methodBody('onTouchMap'),
  /if \(mgSel && legalMGTarget\)[\s\S]*?tryMGAttack\(legalMGTarget\)/,
  'only an MG target with a displayed hit preview may trigger machine-gun fire',
);
assert.match(
  methodBody('onTouchMap'),
  /hasTurretReconGunSelection\(\)[\s\S]*?if \(this\.mission\.sherman\.turretDamaged\) \{[\s\S]*?showGunAimWarning\('attack\.reason\.turretDamaged'\)[\s\S]*?return;/,
  'map clicks during a damaged-turret preview must not rotate, fire, or consume the selected die',
);
assert.match(
  methodBody('onTouchMap'),
  /precisionGunSelection = gunSel && this\.selectedGunHitThresholdModifier < 0[\s\S]*?if \(precisionGunSelection\)[\s\S]*?!targetVisible \|\| !mainGunTarget[\s\S]*?openTileInspectModal\(target\)[\s\S]*?\} else \{[\s\S]*?tryAimShermanTurretAtFogTile/,
  'precision fire must keep the range preview without permitting empty or fog hexes to consume its paired dice as rotation-only actions',
);
assert.match(
  methodBody('tryAttack'),
  /canTurretReachDirection\(sherman, this\.turretTargetDirection\(sherman, target\)\)[\s\S]*?showGunAimWarning\('attack\.reason\.turretTraverseSpeed'\)[\s\S]*?return;/,
  'precision and ordinary main-gun attacks must both enforce the configured traverse speed before firing',
);
assert.match(
  source,
  /new Node\('TurretAimOverlay'\)[\s\S]*?gNode\.addChild\(turretAimOverlayNode\);[\s\S]*?new Node\('MapOcclusion'\)[\s\S]*?gNode\.addChild\(occlusionNode\);[\s\S]*?new Node\('VisibleUnitMask'\)/,
  'the green mask layer must render above terrain but below buildings, foliage, and units',
);
assert.match(
  methodBody('redrawFogOverlay'),
  /this\.redrawTurretAimOverlay\(\)/,
  'fog refreshes must also refresh the independent turret target layer',
);
assert.match(
  methodBody('playerWeaponTargetHexKeys'),
  /selectedMGDieIdx[\s\S]*?canMGAttack[\s\S]*?keys\.add[\s\S]*?selectedGunDieIdx[\s\S]*?sherman\.loaded[\s\S]*?canAttack[\s\S]*?keys\.add/,
  'green enemy masks must follow machine-gun and loaded main-gun legality',
);
assert.doesNotMatch(
  methodBody('drawAttackableHighlights'),
  /drawHexOutline|ATTACKABLE_COLOR/,
  'main-gun target previews must not draw red hex outlines',
);
assert.doesNotMatch(
  methodBody('drawMGTargetHighlights'),
  /drawHexOutline|ATTACKABLE_COLOR/,
  'machine-gun target previews must not draw red hex outlines',
);
assert.match(
  methodBody('drawAttackableHighlights'),
  /spawnSuppressionPreviewLabel|spawnPreviewLabel/,
  'main-gun hit or suppression previews must remain visible',
);
assert.match(
  source,
  /this\.selectedGunDieIdx >= 0\s*&& this\.mission\.sherman\.loaded === true\s*&& this\.outcome === 'ongoing'\) \{\s*this\.drawAttackableHighlights\(\)/,
  'main-gun hit and suppression previews must only render while the gun is loaded',
);
assert.match(
  methodBody('drawMGTargetHighlights'),
  /spawnPreviewLabel/,
  'machine-gun hit previews must remain visible',
);
assert.match(
  methodBody('hasTurretReconGunSelection'),
  /gunDie\.used[\s\S]*?gunPartner\.used[\s\S]*?mgDie\.used[\s\S]*?gunSelectionActive \|\| mgSelectionActive/,
  'turret range display must require every selected weapon die to still exist and remain unused',
);
assert.match(
  methodBody('usePhaseDice'),
  /indices\.includes\(this\.selectedGunDieIdx\)[\s\S]*?indices\.includes\(this\.selectedGunDoublesIdx\)[\s\S]*?indices\.includes\(this\.selectedMGDieIdx\)[\s\S]*?clearGunSelection\(\)[\s\S]*?redrawFogOverlay\(\)/,
  'consuming a selected gun, gun partner, or machine-gun die must immediately clear its range overlay',
);
assert.match(
  methodBody('onClickDie'),
  /selectedWeaponDieIdx = this\.selectedGunDieIdx >= 0[\s\S]*?: this\.selectedMGDieIdx[\s\S]*?selectedWeaponDieIdx !== idx[\s\S]*?clearGunSelection\(\)[\s\S]*?this\.redraw\(\)/,
  'clicking any other die must cancel either weapon selection and redraw the map',
);
assert.match(
  methodBody('redrawTurretAimOverlay'),
  /!this\.turretTargetOverlaySuppressed/,
  'a committed legal action must suppress the green target layer',
);
assert.match(
  methodBody('hideTurretTargetOverlayForCommittedAction'),
  /turretTargetOverlaySuppressed = true[\s\S]*?redrawTurretAimOverlay\(\)/,
  'committing a target must clear the green layer immediately without waiting for action resolution',
);
assert.match(
  methodBody('tryAimShermanTurretAtFogTile'),
  /hideTurretTargetOverlayForCommittedAction\(\)[\s\S]*?startShermanTurretAimDirection/,
  'pure turret rotation must hide its range before starting the animation',
);
assert.match(
  methodBody('tryMGAttack'),
  /if \(!turretAlreadyAimed\) this\.hideTurretTargetOverlayForCommittedAction\(\);[\s\S]*?startShermanTurretAim/,
  'machine-gun fire must hide its range as soon as a legal target is committed',
);
assert.match(
  methodBody('tryAttack'),
  /if \(!check\.ok\)[\s\S]*?return;[\s\S]*?hideTurretTargetOverlayForCommittedAction\(\)[\s\S]*?startShermanTurretAim/,
  'main-gun fire must keep the range on invalid clicks and hide it before legal attack animation',
);
assert.match(
  methodBody('clearGunSelection'),
  /turretTargetOverlaySuppressed = false/,
  'clearing weapon selection must reset immediate-hide state for the next selection',
);

console.log('BattleScene visible turret aim target tests passed');
