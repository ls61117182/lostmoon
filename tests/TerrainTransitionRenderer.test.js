const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const entries=[{color:'shared.png',waterMask:null},{color:'shared.png',waterMask:'water-a.png'},{color:'shared.png',waterMask:'water-b.png'},{color:'other.png',waterMask:'water-a.png'}];
class Asset{refs=0;addRef(){this.refs++;}decRef(){this.refs--;}}
class SpriteFrame extends Asset{}
class Texture2D extends Asset{}
class JsonAsset{}
class EffectAsset{}
class Vec4{constructor(x=0,y=0,z=0,w=0){Object.assign(this,{x,y,z,w});}}
class Material{initialize(){}setProperty(k,v){this[k]=v;}destroy(){}}
class UITransform{setContentSize(w,h){this.width=w;this.height=h;}}
class Sprite{static SizeMode={CUSTOM:1};getRenderMaterial(){return this.customMaterial;}}
class Node{children=[];components=new Map();active=true;layer=1;addComponent(c){const instance=new c();this.components.set(c,instance);return instance;}getComponent(c){return this.components.get(c);}addChild(node){this.children.push(node);}setPosition(x,y){this.x=x;this.y=y;}destroy(){this.destroyed=true;}}
const callbacks=new Map(),counts=new Map(),assets=[];
const resources={load(path,type,callback){counts.set(path,(counts.get(path)||0)+1);if(type===JsonAsset)callback(null,{json:{entries}});else callbacks.set(path,{type,callback});}};
const moduleData={exports:{}};
new Function('module','exports','require',ts.transpileModule(fs.readFileSync('source_art/terrain/retired-runtime-transitions/TerrainTransitionRenderer.ts.txt','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(moduleData,moduleData.exports,name=>name==='cc'?{EffectAsset,JsonAsset,Material,Node,resources,Sprite,SpriteFrame,Texture2D,UITransform,Vec4}:{matchTerrainTransitions:tiles=>tiles.map((tile,i)=>({tile,entry:entries[i]}))});
const {TerrainTransitionRenderer}=moduleData.exports;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function complete(path){const {type,callback}=callbacks.get(path);callbacks.delete(path);const asset=new type();assets.push(asset);callback(null,asset);return asset;}
(async()=>{
 const parent=new Node(),renderer=new TerrainTransitionRenderer(parent),tiles=entries.map((_,q)=>({pos:{q,r:0},terrain:'field'}));
 renderer.draw(tiles,'europe','map',48,0,0);
 const root='textures/terrain/transitions/';
 assert.equal(counts.get(root+'shared/spriteFrame'),1,'colors load once across different mask combinations');
 assert.equal(counts.get(root+'water-a/texture'),1,'masks load once across different colors');
 complete(root+'shared/spriteFrame');complete(root+'other/spriteFrame');complete(root+'water-a/texture');complete(root+'water-b/texture');await flush();
 let nodes=parent.children.filter(n=>!n.destroyed);assert.equal(nodes.length,1,'static ground must appear without waiting for water effect');assert(!nodes[0].getComponent(Sprite).customMaterial);
 complete('effects/water-surface');await flush();nodes=parent.children.filter(n=>!n.destroyed);assert.equal(nodes.length,4);
 const materials=nodes.map(n=>n.getComponent(Sprite).customMaterial);assert.notEqual(materials[1].waterMask,materials[2].waterMask,'shared color must retain distinct animation masks');assert.equal(materials[1].waterMask,materials[3].waterMask,'different colors must share same mask texture');
 renderer.update(.05);assert.equal(materials[1].waterClock.x,.05);
 const before=counts.size;renderer.draw(tiles,'europe','map',60,12,34);assert.equal(counts.size,before,'ordinary redraw must reuse loaded resources');
 renderer.hide();assert(nodes.every(n=>!n.active));renderer.destroy();assert(assets.filter(a=>a instanceof Asset).every(a=>a.refs===0),'each owned resource must be released exactly once');
 const late=new TerrainTransitionRenderer(new Node());late.draw(tiles,'europe','map',48,0,0);late.destroy();for(const path of [...callbacks.keys()])complete(path);await flush();assert(assets.filter(a=>a instanceof Asset).every(a=>a.refs===0),'late load callbacks must not retain resources after destruction');
 console.log('Transition renderer: shared colors/masks, static tiles without effect, paired animation, redraw cache and destruction passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
