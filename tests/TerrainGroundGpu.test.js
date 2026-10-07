const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function load(file,deps={}){const module={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(module,module.exports,name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);});return module.exports;}
const urban=load('assets/scripts/core/UrbanTerrain.ts');
const raster=load('assets/scripts/view/TerrainGroundRaster.ts',{'../core/UrbanTerrain':urban});
raster.TerrainGroundRaster.prototype.renderChunkSteps=function*(){throw Error('Runtime used CPU rasterizer');};
const data=load('assets/scripts/view/TerrainGroundGpuData.ts',{'../core/UrbanTerrain':urban,'./TerrainGroundRaster':raster});
const bundle=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/redesign_v3/materials.json'));
const tile=(q,r,terrain='field',more={})=>({pos:{q,r},terrain,...more});
const gp=new data.TerrainGroundGpuData({...bundle.europeanSummer,fieldBasedLand:true});
const cells=[tile(-4,-3,'mud'),tile(-3,-3,'mud'),tile(-2,-3,'water',{bridgeEnds:[0,3]}),tile(-1,-3,'airstrip',{roads:[true,false,false,true,false,false]}),tile(0,-3,'field',{hasBuilding:true})];
const encoded=gp.tileData(cells,false),at=t=>((t.pos.r-encoded.r)*encoded.width+t.pos.q-encoded.q)*4;
assert(encoded.hasWater);assert(encoded.width<10&&encoded.height<5,'tile uploads are compact, not pixel-sized');
assert.equal(encoded.ground[at(cells[0])+3],2);assert.equal(encoded.roads[at(cells[0])+3],1,'mud neighbours use shared region edges');
assert.equal(encoded.ground[at(cells[2])+2],1);assert.equal(encoded.ground[at(cells[3])+3],1);assert.equal(encoded.ground[at(cells[4])+3],4);
const villageRoad=tile(0,0,'road',{hasBuilding:true,roads:[true,false,false,true,false,false]});
const villageData=gp.tileData([villageRoad],false),villageIndex=((0-villageData.r)*villageData.width-villageData.q)*4;
assert.equal(villageData.ground[villageIndex+3],4,'road buildings retain the village floor flag');
assert.equal(villageData.ground[villageIndex+1],9,'village floor keeps road connections');
assert.deepEqual(gp.plans(cells,false).map(p=>({x:p.x,y:p.y})),new raster.TerrainGroundRaster(bundle.europeanSummer).chunkOrigins(cells));
const atlas=gp.atlas();assert.equal(atlas.pixels.length,atlas.width*atlas.height*4);
for(let id=0;id<data.GPU_MATERIALS.length;id++){const x=id%4*386,y=Math.floor(id/4)*386;assert.deepEqual(atlas.pixels.slice((y*atlas.width+x)*4,(y*atlas.width+x)*4+4),atlas.pixels.slice(((y+1)*atlas.width+x+1)*4,((y+1)*atlas.width+x+1)*4+4),'atlas cells have duplicated borders');}
class Vec4{constructor(x=0,y=0,z=0,w=0){Object.assign(this,{x,y,z,w});}}
class Node{constructor(name){this.name=name;this.active=true;this.isValid=true;this.components=new Map();this.children=[];this.layer=1;}get scene(){return scene;}addChild(n){this.children.push(n);n.parent=this;}addComponent(Type){const c=new Type();this.components.set(Type,c);c.node=this;return c;}getComponent(Type){return this.components.get(Type);}setPosition(x,y,z){this.position={x,y,z};}setScale(x,y,z){this.scale={x,y,z};}setSiblingIndex(){}destroy(){this.isValid=false;for(const c of this.children)c.destroy();}}
const scene=new Node('scene');
class UITransform{setContentSize(w,h){this.width=w;this.height=h;}}
class Sprite{static SizeMode={CUSTOM:1};getRenderMaterial(){return this.renderMaterial??this.customMaterial;}}
class SpriteFrame{destroy(){this.destroyed=true;}}
class Rect{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}
class Size{constructor(width,height){Object.assign(this,{width,height});}}
const textures=[],materials=[],cameras=[];let uploads=0,bakes=0;
class Texture2D{static Filter={LINEAR:1,NEAREST:0};static WrapMode={CLAMP_TO_EDGE:1};constructor(){textures.push(this);}reset(o){Object.assign(this,o);}setWrapMode(s,t){this.wrap=[s,t];}setFilters(a,b){this.filters=[a,b];}uploadData(p){assert.equal(p.length,this.width*this.height*4);this.bytes=p.length;uploads++;}destroy(){assert(!this.destroyed,'texture double-release');this.destroyed=true;}}
class RenderTexture extends Texture2D{reset(o){super.reset(o);bakes++;}}
class Material{constructor(){materials.push(this);}initialize(o){this.effect=o.effectAsset;}setProperty(k,v){this[k]=v instanceof Vec4?new Vec4(v.x,v.y,v.z,v.w):v;}destroy(){this.destroyed=true;}}
class MeshRenderer{setSharedMaterial(m){this.material=m;}}
class Camera{static ProjectionType={ORTHO:1};static ClearFlag={SOLID_COLOR:1};constructor(){cameras.push(this);this.enabled=true;}}
class Canvas{}
class Color{constructor(r,g,b,a){Object.assign(this,{r,g,b,a});}}
const events=new Map(),director={root:{device:{capabilities:{screenSpaceSignY:1}}},once(k,fn){events.set(k,fn);},off(k,fn){if(events.get(k)===fn)events.delete(k);}},Director={EVENT_AFTER_DRAW:'draw'};
const callbacks=new Map(),requests=[];
const cc={Node,UITransform,Sprite,SpriteFrame,Rect,Size,Texture2D,RenderTexture,Material,MeshRenderer,Camera,Canvas,Color,Vec4,director,Director,EffectAsset:class{},utils:{createMesh(){return {destroy(){this.destroyed=true;}};}},resources:{load(path,type,callback){requests.push(path);callbacks.set(path,callback);}}};
const baker=load('assets/scripts/view/TerrainGroundGpuBaker.ts',{'cc':cc,'./TerrainGroundRaster':raster,'./TerrainGroundGpuData':data});
const {TerrainGroundRenderer}=load('assets/scripts/view/TerrainGroundRenderer.ts',{'cc':cc,'./TerrainGroundRaster':raster,'./TerrainGroundGpuData':data,'./TerrainGroundGpuBaker':baker});
function frame(){const fn=events.get('draw');if(fn){events.delete('draw');fn();}}
function effects(){callbacks.get('effects/terrain-bake')(null,{});callbacks.get('effects/water-surface')(null,{});}
function ready(r,...args){r.draw(...args);let count=0;while(r.loading){r.advanceGeneration();frame();assert(++count<200);}r.advanceGeneration();r.draw(...args);}
const parent=new Node('ground'),renderer=new TerrainGroundRenderer(parent,bundle);
renderer.draw(cells,false,60,0,0,true);assert(renderer.loading);assert.equal(uploads,0,'no pixel work in draw');
renderer.advanceGeneration();assert.equal(bakes,0,'wait for shader before submitting a job');effects();renderer.advanceGeneration();
const submitted=bakes;renderer.advanceGeneration();assert.equal(bakes,submitted,'one outstanding job until AFTER_DRAW');
assert(cameras.some(c=>c.enabled));renderer.hide();frame();assert(parent.children.every(n=>!n.active));
ready(renderer,cells,false,60,0,0,true);
assert(cameras.every(c=>!c.enabled&&c.targetTexture===null),'bake cameras stop immediately after cached output');
assert(parent.children.filter(n=>n.isValid).every(n=>n.active));
const cachedBakes=bakes,cachedUploads=uploads;
ready(renderer,cells,false,72,123,456,true);assert.equal(bakes,cachedBakes);assert.equal(uploads,cachedUploads);
assert(requests.every(p=>!p.includes('transitions')),'no prefab resources requested');
const sprites=parent.children.filter(n=>n.isValid).map(n=>n.getComponent(Sprite));assert(sprites.every(s=>!s.spriteFrame.flipUVY),'builtin RT material owns UV correction; frames must not flip twice');
const water=sprites.find(s=>s.customMaterial);assert(water);assert.equal(water.customMaterial.waterUv.x,1,'map coordinates undo GL render-target sampling flip');water.renderMaterial=new Material();renderer.update(.03);
assert.equal(water.customMaterial.waterClock.x,.03);assert.equal(water.renderMaterial.waterClock.x,.03);renderer.update(NaN);assert.equal(water.customMaterial.waterClock.x,.03);assert.equal(uploads,cachedUploads);
ready(renderer,cells,true,60,0,0,true);assert(bakes>cachedBakes,'season switch rebakes');
renderer.destroy();assert(textures.every(t=>t.destroyed),'all colour targets, masks, data textures and atlases released');assert(!events.size);
// Local edit preserves distant cached blocks, and reorder does not change pixels.
const distant=[tile(0,0),tile(30,0),tile(31,0)];const p2=new Node(),r2=new TerrainGroundRenderer(p2,bundle);effects();ready(r2,distant,false,60,0,0);
const far=p2.children.filter(n=>n.isValid&&n.position.x>1000),before=bakes;
ready(r2,[tile(0,0,'mud'),...distant.slice(1)],false,60,0,0);
assert(far.every(n=>n.isValid),'far caches survive local terrain edits');assert(bakes-before<far.length+4,'only nearby chunks rebake');
const stable=bakes;ready(r2,[...distant.slice(1),tile(0,0,'mud')],false,60,0,0);assert.equal(bakes,stable,'cell order does not invalidate caches');
r2.draw([tile(2,2,'water')],false,60,0,0);r2.advanceGeneration();assert(events.size);r2.destroy();frame();assert(!events.size);assert(textures.every(t=>t.destroyed),'cancellation releases pending output and removes callbacks');
// A delayed water effect attaches to already baked blocks without rebaking.
const lateParent=new Node(),late=new TerrainGroundRenderer(lateParent,bundle);
callbacks.get('effects/terrain-bake')(null,{});ready(late,[tile(0,0,'water')],false,60,0,0);
const lateSprites=lateParent.children.filter(n=>n.isValid).map(n=>n.getComponent(Sprite));
assert(lateSprites.every(s=>!s.customMaterial));const lateBakes=bakes,lateUploads=uploads;
const lateWaterCallback=callbacks.get('effects/water-surface');lateWaterCallback(null,{});
assert(lateSprites.every(s=>s.customMaterial?.waterMask));late.update(.03);
assert(lateSprites.every(s=>s.customMaterial.waterClock.x===.03));assert.equal(bakes,lateBakes);assert.equal(uploads,lateUploads);
late.destroy();lateWaterCallback(null,{});assert(textures.every(t=>t.destroyed),'late callbacks cannot resurrect a destroyed renderer');
// Failed shader uses BattleScene's existing fallback instead of infinite loading.
const broken=new TerrainGroundRenderer(new Node(),bundle);broken.draw([tile(0,0)],false,60,0,0);callbacks.get('effects/terrain-bake')(new Error('compile'),null);assert.throws(()=>broken.advanceGeneration(),/GPU terrain effect/);broken.destroy();
assert(!fs.existsSync('assets/resources/textures/terrain/transitions'),'retired images are outside the resource bundle');
console.log('GPU terrain: compact map data, atlas padding, offscreen lifecycle, redraw cache, local invalidation, cancellation, water clocks and shader failure passed.');
