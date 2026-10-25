const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,deps={}){const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m,m.exports,name=>{if(name in deps)return deps[name];throw Error(name);});return m.exports;}
const urban=load('assets/scripts/core/UrbanTerrain.ts');
const {TerrainGroundRaster}=load('assets/scripts/view/TerrainGroundRaster.ts',{'../core/UrbanTerrain':urban});
const flat=rgb=>({width:1,height:1,rgb:Buffer.from(rgb).toString('base64')});
const materials=Object.fromEntries(['grass','soil','mud','sand','water','deep_water','paving','snow','winter_water','timber'].map(id=>[id,flat(id.includes('water')?[40,120,180]:id==='mud'?[90,75,50]:id==='sand'?[240,220,170]:[150,160,100])]));
const engine=new TerrainGroundRaster({version:3,materials}),tiles=[];
for(let r=-3;r<=3;r++)for(let q=-3;q<=3;q++)tiles.push({pos:{q,r},terrain:q>0?'water':'field'});
const image=engine.renderChunk(tiles,false,0,0,100,4,2);
function sample(x){const i=(image.textureWidth+Math.round(x*2)+1)*4;return {rgb:Array.from(image.pixels.slice(i,i+3)),motion:image.waterMask[i]};}
assert.deepEqual(sample(10).rgb,[150,160,100],'distant grass retains its source colour');
assert.deepEqual(sample(90).rgb,[40,120,180],'open water retains its source colour');
let wet=0,shallows=0,maxJump=0;
for(let x=25;x<85;x+=.5){
  const a=sample(x),b=sample(x+.5);
  if(a.motion===0&&a.rgb[0]<145&&a.rgb[2]<110)wet++;
  if(a.motion>0&&a.motion<255)shallows++;
  maxJump=Math.max(maxJump,...a.rgb.map((v,k)=>Math.abs(v-b.rgb[k])));
  if(x<Math.sqrt(3)*24)assert.equal(a.motion,0,'the land-side hedge boundary stays stationary');
}
assert(wet>=4,'wet earth occupies a visible band before the water');
assert(shallows>=14,'shallow-water motion fades over at least seven map pixels');
assert(maxJump<30,'wet earth, contact line and shallow water blend without a hard colour step');
// At every orientation, the shoreline keeps water on the water side and the
// interior of an isolated water hex alive; no polygon clamp is needed.
for(let direction=0;direction<6;direction++){
  const dirs=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]],land=dirs[direction];
  const map=[{pos:{q:0,r:0},terrain:'water'},...dirs.map(([q,r])=>({pos:{q,r},terrain:'field'}))];
  const a=engine.renderChunk(map,false,-50,-50,100,100,2),value=(x,y)=>a.waterMask[((Math.floor((y+50)*2)+1)*a.textureWidth+Math.floor((x+50)*2)+1)*4];
  assert.equal(value(0,0),255,'single-hex lake keeps an animated core');
  const x=Math.sqrt(3)*48*(land[0]+land[1]/2)*.51,y=72*land[1]*.51;
  assert.equal(value(x,y),0,'all six bank orientations remain dry on land');
}
console.log(JSON.stringify({status:'passed',wetSamples:wet,shallowSamples:shallows,maxColourJump:maxJump}));
