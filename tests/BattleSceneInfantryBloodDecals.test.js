const assert = require('assert');
const fs = require('fs');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert.match(
  battleScene,
  /import\s+\{\s*[^}]*infantrySquadOffsets[^}]*\}\s+from\s+'\.\/InfantryVisualFacing'/,
  'BattleScene should reuse the infantry squad offset helper for blood decal placement',
);
assert.match(
  battleScene,
  /private\s+infantryBloodSpriteFrames:\s*Array<SpriteFrame\s*\|\s*null>\s*=\s*\[null,\s*null,\s*null,\s*null\]/,
  'BattleScene should cache multiple infantry blood sprite frames',
);
[
  'infantry_blood_stain',
  'infantry_blood_stain_02',
  'infantry_blood_stain_03',
  'infantry_blood_stain_04',
].forEach(name => {
  assert(
    battleScene.includes(`'${name}'`),
    `BattleScene should include ${name} in the blood decal asset list`,
  );
});
assert.match(
  battleScene,
  /resources\.load\(`textures\/effects\/\$\{name\}\/spriteFrame`,\s*SpriteFrame/,
  'BattleScene should load each infantry blood decal sprite asset from the list',
);
assert.match(
  battleScene,
  /private\s+spawnInfantryBloodDecals\s*\(u:\s*Unit\)[\s\S]*?infantrySquadOffsets\(this\.hexSize,\s*coLocateVehicle\)/,
  'blood decal placement should use the same three-person squad offsets as live infantry sprites',
);
assert.match(
  battleScene,
  /for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*offsets\.length;[\s\S]*?new Node\('InfantryBloodDecal'\)/,
  'each infantry squad offset should create its own blood decal node',
);
assert.match(
  battleScene,
  /const\s+decalSize\s*=\s*50/,
  'blood decals should render at 50% of the 100x100 source image size',
);
assert.match(
  battleScene,
  /const\s+sf\s*=\s*this\.infantryBloodSpriteFrameFor\(u\.id,\s*i\)/,
  'each soldier blood decal should pick a stable variant from the unit id and soldier index',
);
const bloodDecalCreate = battleScene.match(/const\s+node\s*=\s*new Node\('InfantryBloodDecal'\)[\s\S]*?this\.infantryBloodDecalNodes\.push\(node\);/);
assert(bloodDecalCreate, 'blood decal node creation block should be found');
assert(
  bloodDecalCreate[0].indexOf('sprite.sizeMode = Sprite.SizeMode.CUSTOM') >= 0
    && bloodDecalCreate[0].indexOf('sprite.sizeMode = Sprite.SizeMode.CUSTOM') < bloodDecalCreate[0].indexOf('sprite.spriteFrame = sf'),
  'blood decal Sprite should enter CUSTOM mode before spriteFrame assignment so Cocos does not reset the node to source-image size',
);
assert(
  /setContentSize\(decalSize,\s*decalSize\)[\s\S]*?sprite\.sizeMode = Sprite\.SizeMode\.CUSTOM[\s\S]*?sprite\.spriteFrame = sf[\s\S]*?setContentSize\(decalSize,\s*decalSize\)/.test(bloodDecalCreate[0]),
  'blood decal should reapply decalSize after spriteFrame assignment to preserve the tiny runtime display size',
);
assert.match(
  battleScene,
  /private\s+registerDestroyWreckVisual\s*\(u:\s*Unit\):\s*void\s*\{[\s\S]*?if\s*\(isFootUnit\(u\)\)\s*\{[\s\S]*?this\.spawnInfantryBloodDecals\(u\);[\s\S]*?return;/,
  'destroy registration should route foot units to blood decals instead of tank wreck visuals',
);
assert.match(
  battleScene,
  /private\s+loadAndDraw\s*\([^)]*\)[\s\S]*?this\.clearInfantryBloodDecals\(\)/,
  'loading a new mission should clear persistent infantry blood decals',
);
assert.match(
  battleScene,
  /private\s+mapOcclusionGraphics:\s*Graphics\s*\|\s*null\s*=\s*null/,
  'BattleScene should have a separate occlusion graphics layer for buildings/tree fallback above blood decals',
);
const layerSetup = battleScene.match(
  /const\s+gNode\s*=\s*new Node\('MapGraphics'\);[\s\S]*?this\.node\.addChild\(gNode\);[\s\S]*?const\s+bloodDecalNode\s*=\s*new Node\('InfantryBloodDecals'\);[\s\S]*?gNode\.addChild\(bloodDecalNode\);[\s\S]*?const\s+occlusionNode\s*=\s*new Node\('MapOcclusion'\);[\s\S]*?this\.mapOcclusionGraphics\s*=\s*occlusionNode\.addComponent\(Graphics\);[\s\S]*?gNode\.addChild\(occlusionNode\);/,
);
assert(
  layerSetup,
  'blood decal layer should be inside MapGraphics after the surface graphics but before the building/tree occlusion layer',
);
assert(
  !/this\.node\.addChild\(bloodDecalNode\)/.test(battleScene),
  'blood decal layer should not be a scene-root layer because that puts it below roads, bridges, and airstrips',
);
assert.match(
  battleScene,
  /private\s+applyMapViewPosition\s*\([^)]*\)[\s\S]*?this\.terrainLayerNode\?\.setPosition\(clampedX,\s*clampedY,\s*0\);[\s\S]*?this\.mapNode\?\.setPosition\(clampedX,\s*clampedY,\s*0\);/,
  'blood decal layer should follow camera/pan through MapGraphics rather than as a separate root layer',
);
assert(
  !/applyMapViewPosition[\s\S]*?infantryBloodDecalLayerNode\?\.setPosition/.test(battleScene),
  'blood decal layer should not be independently panned when it is a MapGraphics child',
);
assert.match(
  battleScene,
  /const\s+surfaceGraphics\s*=\s*this\.g;[\s\S]*?const\s+occlusionGraphics\s*=\s*this\.mapOcclusionGraphics;[\s\S]*?surfaceGraphics\.clear\(\);[\s\S]*?occlusionGraphics\.clear\(\);/,
  'redraw should clear both the surface graphics and the building/tree occlusion graphics',
);
assert.match(
  battleScene,
  /this\.drawRoadOverlay\(c\.x,\s*c\.y,\s*this\.hexSize,\s*t\.roads,\s*t\);[\s\S]*?this\.g\s*=\s*occlusionGraphics;[\s\S]*?this\.drawBuildingOverlay\(c\.x,\s*c\.y,\s*this\.hexSize,\s*t\);[\s\S]*?this\.g\s*=\s*surfaceGraphics;/,
  'roads, bridges, and airstrips should stay on the surface graphics while buildings render on the later occlusion graphics above blood decals',
);

console.log('BattleScene infantry blood decal integration test passed');
