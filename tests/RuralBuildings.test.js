const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,deps={}){const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m,m.exports,n=>deps[n]);return m.exports;}
const urban=load('assets/scripts/core/UrbanTerrain.ts'),raster=load('assets/scripts/view/TerrainGroundRaster.ts',{'../core/UrbanTerrain':urban});
const {ruralBuildingLayout,ruralBuildingsOverlap,ruralVillageProps}=load('assets/scripts/core/RuralBuildings.ts');
for(let mask=0;mask<64;mask++)for(let variant=0;variant<3;variant++){
  const roads=Array.from({length:6},(_,i)=>!!(mask&(1<<i))),clearance=mask?(x,y)=>raster.europeanCountryRoadDistance(roads,x,y,variant)-.19:undefined;
  const buildings=ruralBuildingLayout(7,-4,clearance);
  assert(buildings.length >= (mask?3:5) && buildings.length <= (mask?4:6),'settlement meets its road-dependent count limits');
  assert(new Set(buildings.map(b=>b.variant)).size>=3,'settlement uses diverse roofs');
  const base=buildings[0].width/buildings[0].scale;
  for(const b of buildings){
    assert(b.scale>=.9&&b.scale<=1.1);
    assert(Math.abs(b.width/b.scale-base)<1e-8,'all buildings share the adjusted baseline');
    const c=Math.cos(b.angle),s=Math.sin(b.angle);
    for(const u of [-.5,0,.5])for(const v of [-.5,0,.5]){
      const x=b.x+u*b.width*c-v*b.height*s,y=b.y+u*b.width*s+v*b.height*c;
      if(clearance)assert(clearance(x,y)>=.025,'roof footprint stays off the road');
      for(let i=0;i<6;i++)assert(x*Math.cos(i*Math.PI/3)+y*Math.sin(i*Math.PI/3)<=.866-.025,'roof stays inside its tile');
    }
  }
  for(let i=0;i<buildings.length;i++)for(let j=i+1;j<buildings.length;j++)assert(!ruralBuildingsOverlap(buildings[i],buildings[j]),'roof rectangles do not overlap');
  const props=ruralVillageProps(7,-4,buildings,clearance);
  assert(props.filter(p=>p.name==='rural_well').length<=1);
  const hay=props.filter(p=>p.name==='rural_hay');assert(hay.length>=2&&hay.length<=4,'every settlement fits two to four haystacks');
  for(const p of props)if(clearance)assert(clearance(p.x,p.y)>p.size*.71+.025,'props avoid the road');
}
assert.equal(ruralBuildingLayout(2,3)[0].width/ruralBuildingLayout(2,3)[0].scale,.38*1.1,'unconstrained baseline grows by ten percent');
assert(ruralBuildingLayout(2,3).length>=5,'open village retains at least five roofs');
const radii=ruralBuildingLayout(2,3).map(b=>Math.hypot(b.x,b.y));assert(Math.max(...radii)-Math.min(...radii)>.10,'village buildings do not follow a fixed-radius circle');
assert.deepEqual(ruralBuildingLayout(2,3),ruralBuildingLayout(2,3),'layout is stable across redraws');
assert.notDeepEqual(ruralBuildingLayout(2,3),ruralBuildingLayout(3,3),'neighbouring settlements vary');
console.log('All 64 road masks × 3 variants: 3–4 roadside / 5–6 village roofs, scale, bounds, road clearance and spacing passed.');
