const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {trenchInfantryOffsets}=require('../assets/scripts/core/Fortification.ts');
const {infantrySquadOffsets}=require('../assets/scripts/view/InfantryVisualFacing.ts');
const types=require('../assets/scripts/core/types.ts');
const {HexMap}=require('../assets/scripts/core/HexGrid.ts');
const GameSession={gameMode:'hardcore'};
class UITransform {setContentSize(w,h){this.w=w;this.h=h}setAnchorPoint(){}}
class Graphics {}
class Node {
  constructor(name){this.name=name;this.children=[];this.components=new Map();this.active=true;this.angle=0}
  addComponent(C){const c=new C();this.components.set(C,c);return c}
  getComponent(C){return this.components.get(C)}
  addChild(n){if(n.parent){n.parent.children.splice(n.parent.children.indexOf(n),1)}this.children.push(n);n.parent=this}
  insertChild(n,i){this.addChild(n);this.setChildIndex(n,i)}
  setChildIndex(n,i){this.children.splice(this.children.indexOf(n),1);this.children.splice(i,0,n)}
  getSiblingIndex(){return this.parent.children.indexOf(this)}
  setSiblingIndex(i){this.parent.setChildIndex(this,i)}
  setPosition(x,y){this.x=x;this.y=y}setScale(){}
}
const Scene=require('./helpers/BattleSceneMethods.cjs')(
  ['drawInfantry','infantryFormationOffsets','captureSilhouetteSources','spawnInfantryBulletVolley','shouldDisplayUnitOutline','tankTrenchInfantryOccluders','recordVectorSilhouette','syncUnitOcclusion'],
  {...types,Node,UITransform,Graphics,trenchInfantryOffsets,infantrySquadOffsets,BattleScene:{INFANTRY_SPRITES_PER_UNIT:3},GameSession},
);
const plain=value=>JSON.parse(JSON.stringify(value));
function assertOffsets(actual,expected,message) {
  assert.equal(actual.length,expected.length,message);
  for(let i=0;i<actual.length;i++)for(const key of ['ox','oy'])assert.ok(Math.abs(actual[i][key]-expected[i][key])<1e-9,message);
}
function setup() {
  const scene=new Scene(),map=new HexMap(5,5),unit={id:'squad',kind:'infantry',pos:{q:0,r:0},facing:0,faction:'german'};
  map.set({pos:unit.pos,terrain:'field',fortification:{kind:'trench',connections:'111100'}});
  const root=new Node('Map'),urban=new Node('Urban');root.addChild(urban);
  Object.assign(scene,{node:{layer:0},mission:{map,data:{},sherman:unit,allies:[],enemies:[]},hexSize:128,g:{},sceneryPoolParents:new Map()});
  // Execute the actual onLoad layer construction rather than duplicate its order.
  const source=fs.readFileSync('assets/scripts/view/BattleScene.ts','utf8');
  const start=source.indexOf("    const unitMaskNode = new Node('VisibleUnitMask');");
  const end=source.indexOf('    // Bottom to top: wreck tracks',start);
  const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('Node','UITransform','Graphics','gNode','urbanBuildingLayerNode',code).call(scene,Node,UITransform,Graphics,root,urban);
  scene.mapNode=root;
  const slots=Array.from({length:3},()=>{const node=new Node('Soldier');node.addComponent(UITransform);node.active=false;return {node,sprite:{node}}});
  Object.assign(scene,{infantryTopSpritePool:slots,infantryTopPoolNext:0,enemyTopSpritePool:[],commanderHatchSpritePool:[],officerTopSpritePool:[],
    infantryVisualAngle:()=>32,infantrySharesHexWithOtherUnit:()=>false,enemyTankSharingInfantryHex:()=>null,
    infantryVisualsFor:()=>({frames:[{width:40,height:60},{width:40,height:60},{width:40,height:60}],dims:Array(3).fill({dw:40,dh:60}),scales:[1,1,1]}),
    unitSilhouetteColor:()=>({}),silhouetteClaimed:new Set(),silhouetteSources:new Map(),infantryOcclusionSprites:new Map(),
    vectorSilhouettes:[],infantryVectorSilhouettes:[],hasBunkerAt:()=>false,
    isUnitVisible:()=>true,project:(q,r)=>({x:q*100,y:-r*100}),interpolatedPos:u=>({x:u.pos.q*100,y:-u.pos.r*100}),infantryBulletVolleys:[],drawInfantryBulletVolley:()=>{},placeProjectileTraceNode:()=>{},
  });
  return {scene,unit,slots,root,map};
}

test('actual infantry rendering enters a trench automatically and never scatters around a tank',()=>{
  const {scene,unit,slots,map}=setup();
  const draw=()=>{scene.infantryTopPoolNext=0;scene.drawInfantry(unit,100,200);return slots.map(({node})=>({ox:node.x-100,oy:node.y-200}))};
  const expected=trenchInfantryOffsets(map.get(unit.pos),128);
  assertOffsets(draw(),expected);assert.deepEqual(expected[0],{ox:0,oy:0});
  scene.infantrySharesHexWithOtherUnit=()=>true;scene.enemyTankSharingInfantryHex=()=>({kind:'sherman'});
  assertOffsets(draw(),expected,'tank entry must not move entrenched soldiers');
  assert.ok(slots.every(({node})=>node.angle===32),'do not turn entrenched soldiers inward around a tank');
  map.get(unit.pos).fortification.kind='gun_pit';scene.infantrySharesHexWithOtherUnit=()=>false;scene.enemyTankSharingInfantryHex=()=>null;
  assertOffsets(draw(),infantrySquadOffsets(128,false),'empty gun pits retain the original triangle');
  delete map.get(unit.pos).fortification;
  assertOffsets(draw(),infantrySquadOffsets(128,false),'leaving a trench restores the old formation');
});

test('actual layer construction and pooled sprite ownership keep tanks above trench infantry and rims',()=>{
  const {scene,unit,slots,root}=setup();
  scene.drawInfantry(unit,0,0);scene.captureSilhouetteSources(unit);
  for(const slot of slots)assert.equal(slot.node.parent,scene.infantryContentNode);
  const tank=new Node('TankSprite');tank.active=true;const sprite={node:tank};scene.enemyTopSpritePool=[{node:tank,sprite}];
  scene.captureSilhouetteSources({id:'tank',kind:'sherman',pos:unit.pos});
  assert.equal(tank.parent,scene.tankContentNode);
  const infantryMask=scene.infantryContentNode.parent,tankMask=scene.tankContentNode.parent;
  assert.ok(infantryMask.getSiblingIndex()<tankMask.getSiblingIndex());
  assert.ok(infantryMask.children.find(n=>n.name==='FortificationRimsAboveInfantry').getSiblingIndex()>scene.infantryContentNode.getSiblingIndex());
  assert.ok(root.children.find(n=>n.name==='FortificationGround').getSiblingIndex()<infantryMask.getSiblingIndex());
});

test('actual infantry volleys start and end at the independent attacker and target trench slots',()=>{
  const {scene,unit,map}=setup(),target={...unit,id:'target',pos:{q:2,r:0}};
  map.set({pos:target.pos,terrain:'field',fortification:{kind:'trench',connections:'001001'}});
  scene.spawnInfantryBulletVolley(unit,target);
  const volley=scene.infantryBulletVolleys[0],from=trenchInfantryOffsets(map.get(unit.pos),128),to=trenchInfantryOffsets(map.get(target.pos),128);
  assert.equal(volley.lanes.length,3);
  for(let i=0;i<3;i++) {
    assert.equal(volley.lanes[i].startX,from[i].ox+12.8);assert.equal(volley.lanes[i].startY,from[i].oy);
    assert.equal(volley.lanes[i].targetX,200+to[i].ox-20.48);assert.equal(volley.lanes[i].targetY,to[i].oy);
  }
});

function addTankOccluders(scene) {
  const tank={id:'tank',kind:'sherman',faction:'usa',pos:{q:1,r:0}};
  const slots=['Hull','Turret'].map(name=>{
    const node=new Node(name);node.addComponent(UITransform);
    return {node,sprite:{node,spriteFrame:{width:80,height:100}}};
  });
  scene.enemyTopSpritePool=slots;
  scene.captureSilhouetteSources(tank);
  return slots;
}

test('tank hull and turret masks select only entrenched infantry, including while arriving from another hex',()=>{
  for(const mode of ['classic','hardcore','test'])for(const kind of ['trench','gun_pit']) {
    GameSession.gameMode=mode;
    const {scene,unit,slots,map}=setup();map.get(unit.pos).fortification.kind=kind;
    scene.drawInfantry(unit,0,0);scene.captureSilhouetteSources(unit);
    const tanks=addTankOccluders(scene),passes=scene.tankTrenchInfantryOccluders();
    assert.equal(passes.length,2,'both hull and turret can obscure soldiers');
    assert.equal(passes[0].sources,passes[1].sources,'share one source selection across tank parts');
    for(const pass of passes) {
      assert.equal(pass.sources.size,3);
      assert.ok(tanks.some(slot=>slot.sprite===pass.blocker));
      for(const slot of slots)assert.equal(pass.sources.get(slot.sprite),scene.silhouetteSources.get(slot.sprite));
      for(const tank of tanks)assert.equal(pass.sources.has(tank.sprite),false,'tank must never outline itself');
    }
    delete map.get(unit.pos).fortification;
    assert.equal(scene.tankTrenchInfantryOccluders().length,0,'ordinary open ground is excluded');
  }
  GameSession.gameMode='hardcore';
});

test('hidden tanks and hidden or destroyed squads do not generate trench outlines',()=>{
  const {scene,unit,slots}=setup();scene.drawInfantry(unit,0,0);scene.captureSilhouetteSources(unit);
  const tanks=addTankOccluders(scene);
  scene.unitFogRenderer={policyOf:node=>node===tanks[1].node?'hidden':'known'};
  let passes=scene.tankTrenchInfantryOccluders();assert.equal(passes.length,1);assert.equal(passes[0].blocker,tanks[0].sprite);
  scene.unitFogRenderer.policyOf=()=> 'hidden';assert.equal(scene.tankTrenchInfantryOccluders().length,0);
  scene.unitFogRenderer=null;unit.destroyed=true;assert.equal(scene.tankTrenchInfantryOccluders().length,0);
  unit.destroyed=false;
  for(const slot of slots)scene.silhouetteClaimed.delete(slot.sprite);
  scene.silhouetteSources.clear();scene.isUnitVisible=()=>false;scene.captureSilhouetteSources(unit);
  assert.equal(scene.tankTrenchInfantryOccluders().length,0);
});

test('classic vector fallback infantry also receive tank-clipped outlines',()=>{
  GameSession.gameMode='classic';
  const {scene,unit}=setup();scene.g=scene.unitGraphics;
  scene.recordVectorSilhouette(unit,0,0,4);
  addTankOccluders(scene);
  const passes=scene.tankTrenchInfantryOccluders();
  assert.equal(passes.length,2);assert.equal(passes[0].sources.size,0);
  assert.equal(passes[0].vectors.length,1);
  assert.equal(passes[0].vectors[0],scene.vectorSilhouettes[0]);
  GameSession.gameMode='hardcore';
});

test('the live occlusion sync retains building passes and adds tank-trench passes together',()=>{
  const {scene,unit}=setup();scene.drawInfantry(unit,0,0);scene.captureSilhouetteSources(unit);addTankOccluders(scene);
  const bunkerPass={blocker:{},sources:new Map()};let delivered;
  Object.assign(scene,{urbanBuildingSpritePool:[],foliageSpritePool:[],occlusionShapes:[],
    bunkerInfantryOccluders:()=>[bunkerPass],unitOcclusion:{sync:(...args)=>{delivered=args}}});
  scene.syncUnitOcclusion();assert.equal(delivered[4].length,3);assert.equal(delivered[4][0],bunkerPass);
});

test('bridge infantry receive hull and turret outlines in all game modes',()=>{
  for(const mode of ['classic','hardcore','test']) {
    GameSession.gameMode=mode;
    const {scene,unit,slots,map}=setup();
    const tile=map.get(unit.pos);delete tile.fortification;tile.terrain='water';tile.bridgeEnds=[1,4];
    // Placement is exercised separately by the bridge geometry tests; exercise
    // the real sprite ownership, source selection and occluder wiring here.
    scene.infantryFormationOffsets=()=>[{ox:-30,oy:0},{ox:0,oy:0},{ox:30,oy:0}];
    scene.drawInfantry(unit,0,0);scene.captureSilhouetteSources(unit);
    const tanks=addTankOccluders(scene),passes=scene.tankTrenchInfantryOccluders();
    assert.equal(scene.shouldDisplayUnitOutline(unit),true);
    assert.equal(passes.length,2);
    for(const pass of passes)for(const slot of slots)assert.equal(pass.sources.get(slot.sprite),scene.silhouetteSources.get(slot.sprite));
    scene.unitFogRenderer={policyOf:()=> 'hidden'};
    assert.equal(scene.tankTrenchInfantryOccluders().length,0,'hidden tanks must not expose bridge outlines');
    scene.unitFogRenderer=null;unit.destroyed=true;
    assert.equal(scene.tankTrenchInfantryOccluders().length,0,'dead infantry must not leave an outline');
    assert.ok(tanks.length===2);
  }
  GameSession.gameMode='hardcore';
});

test('classic fallback bridge infantry also receive tank-clipped outlines',()=>{
  GameSession.gameMode='classic';
  const {scene,unit,map}=setup(),tile=map.get(unit.pos);
  delete tile.fortification;tile.terrain='water';tile.bridgeEnds=[0,3];scene.g=scene.unitGraphics;
  scene.recordVectorSilhouette(unit,0,0,4);addTankOccluders(scene);
  const passes=scene.tankTrenchInfantryOccluders();
  assert.equal(passes.length,2);assert.equal(passes[0].vectors.length,1);
  GameSession.gameMode='hardcore';
});
