const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),sharp=require('sharp');
const {test}=require('node:test');
const ROOT=path.resolve(__dirname,'..'),SOURCE=path.join(ROOT,'source_art/trains/bp44-v1-20261106');
function load(file,deps={}){const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m,m.exports,n=>{if(n in deps)return deps[n];throw Error('Unexpected dependency '+n)});return m.exports;}
const geometry=load('assets/scripts/core/ArmoredTrainArt.ts');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/units/trains/bp44/bp44_art_manifest.json'),'utf8'));
class UITransform{setAnchorPoint(x,y){this.anchor={x,y}}setContentSize(w,h){this.size={width:w,height:h}}}
class Sprite{static SizeMode={CUSTOM:1};}
class SpriteFrame{}
class JsonAsset{}
class Node{
  constructor(name='parent'){this.name=name;this.children=[];this.components=new Map();this.layer=9;this.active=true;this.angle=0;this.isValid=true;}
  addComponent(Kind){const c=new Kind();this.components.set(Kind,c);return c}
  getComponent(Kind){return this.components.get(Kind)}
  addChild(node){node.parent=this;this.children.push(node)}
  setPosition(x,y,z){this.position={x,y,z}}
  destroy(){this.isValid=false;for(const node of this.children)node.destroy()}
}
const resources={load(){throw Error('Unexpected resource load')}};
const view=load('assets/scripts/view/ArmoredTrainVisual.ts',{'cc':{Node,Sprite,SpriteFrame,UITransform,JsonAsset,resources},'../core/ArmoredTrainArt':geometry});
const frames={};for(const path of manifest.modules.flatMap(m=>[m.body,m.destroyed]).concat(manifest.weapons.map(w=>w.sprite)))frames[path]={path};
function fixture(moduleId='artillery_flak',pose={x:12,y:24,angleDegrees:0}){const parent=new Node();return{parent,visual:new view.ArmoredTrainVisual(parent,{manifest,frames},moduleId,48,pose)}}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('all three gun types are separate resources in uniquely named independent weapon slots',()=>{
  assert.doesNotThrow(()=>geometry.validateArmoredTrainArt(manifest));assert.equal(manifest.schemaVersion,2);
  const expected={howitzer:['main_gun'],artillery_flak:['main_gun','anti_aircraft'],panzerjaeger:['anti_tank']};
  for(const [id,slots]of Object.entries(expected)){
    const module=geometry.trainModuleArt(manifest,id);
    assert.deepEqual(module.weapons.map(s=>s.slotId),slots);
    for(const s of module.weapons){assert.equal(s.rotationMode,'independent');assert.notEqual(geometry.trainWeaponArt(manifest,s.id).sprite,module.body);}
  }
  const invalid=structuredClone(manifest);invalid.modules[4].weapons[1].slotId='main_gun';assert.throws(()=>geometry.validateArmoredTrainArt(invalid),/slot/);
});

test('Cocos weapon nodes are siblings of the carriage and can rotate without moving the carriage or the other weapon',()=>{
  const {parent,visual}=fixture(),main=visual.getWeaponNode('main_gun'),aa=visual.getWeaponNode('anti_aircraft');
  assert.equal(main.parent,visual.node);assert.equal(aa.parent,visual.node);assert.equal(visual.bodyNode.parent,visual.node);
  assert.notEqual(main,aa);assert.equal(main.layer,parent.layer);
  const mainPosition={...main.position},aaPosition={...aa.position};
  visual.setWeaponAngle('main_gun',90);
  assert.equal(main.angle,90);assert.equal(aa.angle,-180);assert.equal(visual.bodyNode.angle,0);
  assert.deepEqual(main.position,mainPosition);assert.deepEqual(aa.position,aaPosition);
  visual.setWeaponAngle('anti_aircraft',45);
  assert.equal(main.angle,90);assert.equal(aa.angle,45);assert.equal(visual.bodyNode.angle,0);
  const paths=manifest.modules.find(m=>m.id==='artillery_flak');
  assert.equal(visual.bodyNode.getComponent(Sprite).spriteFrame,frames[paths.body]);
});

test('turning the carriage moves the mounts but preserves both independent aiming angles',()=>{
  const {visual}=fixture();visual.setWeaponAngle('main_gun',35);visual.setWeaponAngle('anti_aircraft',-70);
  const main=visual.getWeaponNode('main_gun'),aa=visual.getWeaponNode('anti_aircraft'),before={...main.position};
  visual.setPose({x:99,y:77,angleDegrees:90});
  assert.equal(visual.bodyNode.angle,90);assert.equal(visual.node.angle,0);assert.equal(main.angle,35);assert.equal(aa.angle,-70);
  assert.notDeepEqual(main.position,before);close(main.position.x,-18.75);close(main.position.y,0);close(aa.position.x,19.5);close(aa.position.y,0);
  assert.deepEqual(visual.node.position,{x:99,y:77,z:0});
});

test('howitzer and anti-tank turret rotation use the same API and retain source-image pivot/scale',()=>{
  for(const [id,slot]of[['howitzer','main_gun'],['panzerjaeger','anti_tank']]){
    const {visual}=fixture(id),weapon=visual.getWeaponNode(slot);visual.setWeaponAngle(slot,123);
    assert.equal(weapon.angle,123);assert.equal(visual.bodyNode.angle,0);
    assert.deepEqual(weapon.getComponent(UITransform).anchor,{x:.5,y:.5});
    assert.deepEqual(weapon.getComponent(UITransform).size,{width:96,height:96});
    visual.setHexRadius(24);assert.deepEqual(weapon.getComponent(UITransform).size,{width:48,height:48});assert.equal(weapon.angle,123);
  }
});

test('all six carriage headings and arbitrary weapon angles keep pivots fixed and rotate actual muzzle points',()=>{
  const module=geometry.trainModuleArt(manifest,'artillery_flak');
  for(const radius of[24,48,96])for(let bodyAngle=0;bodyAngle<360;bodyAngle+=60)for(const slot of module.weapons)for(const aim of[-135,-45,0,37,90,180]){
    const p=geometry.trainWeaponPose(manifest,module,slot,{x:31,y:-12,angleDegrees:bodyAngle},aim,radius);
    const weapon=geometry.trainWeaponArt(manifest,slot.id),scale=radius*2/512;
    close(Math.hypot(p.position.x-31,p.position.y+12),Math.hypot(slot.pivot.x-256,slot.pivot.y-256)*scale);
    for(let i=0;i<p.muzzles.length;i++)close(Math.hypot(p.muzzles[i].x-p.position.x,p.muzzles[i].y-p.position.y),Math.hypot(weapon.muzzles[i].x-weapon.pivot.x,weapon.muzzles[i].y-weapon.pivot.y)*scale);
  }
});

test('weapon rotation handles off-center source pivots and cannot borrow the carriage center',()=>{
  const m=structuredClone(manifest),module=geometry.trainModuleArt(m,'howitzer'),weapon=geometry.trainWeaponArt(m,'howitzer');
  weapon.pivot={x:200,y:300};weapon.muzzles=[{x:200,y:200}];
  const p=geometry.trainWeaponPose(m,module,module.weapons[0],{x:0,y:0,angleDegrees:0},90,256);
  close(p.muzzles[0].x,p.position.x-100);close(p.muzzles[0].y,p.position.y);
});

test('wreck swaps hide independent weapon nodes and suppress muzzles without losing retained aim',()=>{
  const {visual}=fixture();visual.setWeaponAngle('main_gun',77);visual.setDestroyed(true);
  assert.equal(visual.getWeaponNode('main_gun').active,false);assert.equal(visual.getWeaponNode('anti_aircraft').active,false);assert.deepEqual(visual.getWeaponMuzzles('main_gun'),[]);
  assert.equal(visual.bodyNode.getComponent(Sprite).spriteFrame,frames[manifest.modules[4].destroyed]);
  visual.setPose({x:0,y:0,angleDegrees:60});visual.setDestroyed(false);
  assert.equal(visual.getWeaponNode('main_gun').active,true);assert.equal(visual.getWeaponNode('main_gun').angle,77);assert.equal(visual.getWeaponMuzzles('anti_aircraft').length,4);
  assert.throws(()=>visual.setWeaponAngle('missing',0),/slot/);assert.throws(()=>visual.setWeaponAngle('main_gun',NaN),/finite/);
});

test('loading caches fifteen shared sprites and destroying a carriage only destroys its own nodes',async()=>{
  const calls=[];resources.load=(path,Kind,callback)=>{calls.push(path);callback(null,Kind===JsonAsset?{json:manifest}:{path})};
  const loaded=await view.loadArmoredTrainArt();assert.equal(Object.keys(loaded.frames).length,15);assert.equal(calls.length,16);
  const a=new view.ArmoredTrainVisual(new Node(),loaded,'howitzer'),b=new view.ArmoredTrainVisual(new Node(),loaded,'howitzer');
  a.destroy();assert.equal(a.node.isValid,false);assert.equal(b.node.isValid,true);assert.equal(Object.keys(loaded.frames).length,15);
});

test('rotation preview default assembly exactly matches existing art and moving one weapon leaves the other pixels unchanged',async()=>{
  const {compose}=require('../tools/previewArmoredTrainRotation.cjs');
  const raw=async buffer=>sharp(buffer).ensureAlpha().raw().toBuffer();
  for(const id of['howitzer','artillery_flak','panzerjaeger'])assert.ok((await raw(await compose(id,0))).equals(await raw(path.join(SOURCE,'assembled',id+'_normal.png'))));
  const a=await raw(await compose('artillery_flak',0)),b=await raw(await compose('artillery_flak',0,{main_gun:90})),c=await raw(await compose('artillery_flak',0,{main_gun:90,anti_aircraft:45}));
  const region=(data,x,y,w,h)=>sharp(data,{raw:{width:512,height:512,channels:4}}).extract({left:x,top:y,width:w,height:h}).raw().toBuffer();
  assert.ok((await region(a,190,320,140,125)).equals(await region(b,190,320,140,125)));
  assert.ok((await region(b,190,90,140,120)).equals(await region(c,190,90,140,120)));
  assert.equal(a.equals(b),false);assert.equal(b.equals(c),false);
});

test('offline preview sliders independently change each weapon and body rotation preserves aiming controls',()=>{
  class Element{constructor(){this.children=[];this.style={};this.value='0';this.className=''}appendChild(c){c.parent=this;this.children.push(c)}set innerHTML(v){this.children=[]}querySelectorAll(){return this.children.filter(n=>n.className.split(' ').includes('mark'))}remove(){this.parent.children=this.parent.children.filter(n=>n!==this)}}
  const elements={};for(const id of['stage','module','body','controls','bodyValue','reset'])elements[id]=new Element();
  const document={querySelector:selector=>elements[selector.slice(1)],createElement:()=>new Element()};
  const html=fs.readFileSync(path.join(SOURCE,'previews/bp44-independent-rotation.html'),'utf8'),context=vm.createContext({document});
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  const get=expression=>vm.runInContext(expression,context);
  const aa=get('nodes.anti_aircraft.style.transform'),body=get('nodes.body.style.transform');
  get('inputs.main_gun.input.value="90"; inputs.main_gun.input.oninput()');
  assert.equal(get('nodes.anti_aircraft.style.transform'),aa);assert.equal(get('nodes.body.style.transform'),body);
  const main=get('nodes.main_gun.style.transform');
  get('inputs.anti_aircraft.input.value="45"; inputs.anti_aircraft.input.oninput()');
  assert.equal(get('nodes.main_gun.style.transform'),main);
  elements.body.value='60';elements.body.oninput();
  assert.equal(get('nodes.main_gun.style.transform'),main);assert.equal(get('nodes.anti_aircraft.style.transform'),'rotate(-45deg)');
});
