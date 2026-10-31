const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const core=require('../assets/scripts/core/Elevation.ts'),contour=require('../assets/scripts/view/ElevationContour.ts');
class Node {
  constructor(name){Object.assign(this,{name,children:[],layer:1,isValid:true,active:true,components:new Map(),listeners:{}});}
  addChild(n){n.parent=this;this.children.push(n);}
  addComponent(Type){const c=new Type();c.node=this;this.components.set(Type,c);return c;}
  getComponent(Type){return this.components.get(Type);}
  setPosition(x,y,z){this.position={x,y,z};}
  setSiblingIndex(index){const siblings=this.parent.children;siblings.splice(siblings.indexOf(this),1);siblings.splice(index,0,this);}
  once(event,callback){this.listeners[event]=callback;}
  destroy(){if(!this.isValid)return;this.isValid=false;this.listeners['node-destroyed']?.();for(const c of [...this.children])c.destroy();if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
}
class UITransform{setContentSize(width,height){this.width=width;this.height=height;}}
class Graphics{clear(){}moveTo(){}lineTo(){}close(){}fill(){}}
class Mask{constructor(){this.subComp=new Graphics();}} Mask.Type={GRAPHICS_STENCIL:1};
class Sprite{} Sprite.SizeMode={CUSTOM:1};
class SpriteFrame{destroy(){this.destroyed=true;}}
class Texture2D{static Filter={LINEAR:1};static WrapMode={CLAMP_TO_EDGE:1};reset(size){this.size=size;}setFilters(){}setWrapMode(){}uploadData(pixels){this.pixels=pixels;}destroy(){this.destroyed=true;}}
class Rect{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}
class Size{constructor(width,height){Object.assign(this,{width,height});}}
class JsonAsset{}
const material=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/elevation/continuous-material.json'));
const cc={Node,UITransform,Graphics,Mask,Sprite,SpriteFrame,Texture2D,Rect,Size,JsonAsset,resources:{load(_path,_type,done){done(null,{json:material});}}};
const code=ts.transpileModule(fs.readFileSync('assets/scripts/view/ElevationRenderer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exported={};vm.runInNewContext(code,{exports:exported,console,require:id=>id==='cc'?cc:id.includes('ElevationContour')?contour:core});
const {ElevationRenderer,addElevationPreview}=exported;
const project=(q,r)=>({x:48*Math.sqrt(3)*(q+r/2),y:-48*1.5*r});
const pair=()=>[{pos:{q:0,r:0},terrain:'field',height:1},{pos:{q:1,r:0},terrain:'field'}];

test('the actual map renderer reuses baked textures across redraw, zoom and pan, and releases them on height changes',()=>{
  const parent=new Node('Terrain'),renderer=new ElevationRenderer(parent),tiles=pair();
  renderer.draw(tiles,{},48,project);
  const layer=parent.children[0],nodes=[...layer.children],frames=nodes.map(n=>n.getComponent(Sprite).spriteFrame);
  assert.ok(nodes.length>0);assert.ok(frames.some(f=>f.texture.pixels.some((v,i)=>i%4===3&&v>0)));
  for(const frame of frames){assert.equal(frame.rect.x,1);assert.equal(frame.rect.width,256);assert.equal(frame.packable,false);}
  const first=nodes[0],before=first.position;
  renderer.draw([...tiles].reverse(),{},96,(q,r)=>{const p=project(q,r);return{x:p.x*2+10,y:p.y*2-20};});
  assert.equal(layer.children[0],first);assert.equal(first.getComponent(Sprite).spriteFrame,frames[0]);
  assert.equal(first.position.x,before.x*2+10);assert.equal(first.position.y,before.y*2-20);
  renderer.draw(tiles,{},27,(q,r)=>{const p=project(q,r);return{x:p.x*1.1+20,y:p.y*1.2+30};});
  assert.equal(first.position.x,before.x*1.1+20);assert.equal(first.position.y,before.y*1.2+30);
  assert.equal(first.getComponent(UITransform).width,256*1.1);assert.equal(first.getComponent(UITransform).height,256*1.2);
  tiles[0].height=0;renderer.draw(tiles,{},48,project);
  assert.equal(layer.children.length,0);assert.ok(frames.every(f=>f.destroyed&&f.texture.destroyed));
  renderer.destroy();assert.equal(parent.children.length,0);
});

test('camera light and impassable-edge changes invalidate the cached field',()=>{
  const parent=new Node('Terrain'),renderer=new ElevationRenderer(parent),tiles=pair();
  renderer.draw(tiles,{},48,project,0);
  const old=parent.children[0].children.map(n=>n.getComponent(Sprite).spriteFrame);
  renderer.draw(tiles,{},48,project,90);
  const rotated=parent.children[0].children.map(n=>n.getComponent(Sprite).spriteFrame);
  assert.ok(old.every(f=>f.destroyed));assert.notDeepEqual(Buffer.concat(old.map(f=>Buffer.from(f.texture.pixels))),Buffer.concat(rotated.map(f=>Buffer.from(f.texture.pixels))));
  tiles[0].cliffs=[true,false,false,false,false,false];renderer.draw(tiles,{},48,project,90);
  assert.ok(rotated.every(f=>f.destroyed));renderer.destroy();
});

test('inspector crops the same continuous overlay on the low side and frees its owned textures',()=>{
  const parent=new Node('Preview'),tiles=pair();addElevationPreview(parent,tiles,tiles[1],{},20,30,48,90);
  const root=parent.children[0],frames=root.children.map(n=>n.getComponent(Sprite).spriteFrame);
  assert.equal(root.getComponent(Mask).type,Mask.Type.GRAPHICS_STENCIL);assert.equal(root.position.x,20);assert.equal(root.position.y,30);
  assert.ok(frames.length);assert.ok(frames.some(f=>f.texture.pixels.some((v,i)=>i%4===3&&v>0)));
  root.destroy();assert.ok(frames.every(f=>f.destroyed&&f.texture.destroyed));
});
