const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {tileHeight,elevationEdges,editorElevationTiles,editorCliffState,setEditorCliff}=require('../assets/scripts/core/Elevation.ts');
const {HexMap,neighbor}=require('../assets/scripts/core/HexGrid.ts');
const {getUnitStats}=require('../assets/scripts/core/UnitDB.ts');
const {ElevationContourRaster,elevationContour,elevationFingerprint}=require('../assets/scripts/view/ElevationContour.ts');
const {hitBreakdown,mgHitBreakdown}=require('../assets/scripts/core/Combat.ts');
const material=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/elevation/continuous-material.json'));
function actor(kind,pos){return {id:kind,kind,pos,faction:getUnitStats(kind).faction,facing:0,stats:getUnitStats(kind)};}
test('legacy rocky cells default to height 1; six exterior edges block both ways for every ground unit',()=>{
  assert.equal(tileHeight({terrain:'rocky'}),1);assert.equal(tileHeight({t:'H'}),1);
  assert.equal(tileHeight({terrain:'rocky',height:0}),0);assert.equal(tileHeight({t:'H',height:-1}),-1);
  const map=new HexMap(7,7),a={pos:{q:0,r:0},terrain:'rocky'};map.set(a);
  for(let d=0;d<6;d++){
    const b={pos:neighbor(a.pos,d),terrain:'clear'};map.set(b);
    for(const kind of ['sherman','truck','at_gun','japanese_infantry','american_infantry']){
      assert.equal(map.canUnitCrossEdge(a.pos,b.pos,actor(kind,a.pos),{ignoreBreakwater:true}),false);
      assert.equal(map.canUnitCrossEdge(b.pos,a.pos,actor(kind,b.pos),{ignoreBreakwater:true}),false);
    }
  }
  assert.equal(elevationEdges(map.all()).length,6);assert.ok(elevationEdges(map.all()).every(e=>e.blocked&&e.difference===1));
  map.get(neighbor(a.pos,0)).terrain='rocky';
  assert.equal(elevationEdges(map.all()).some(e=>e.high===a&&e.direction===0),false);
  assert.equal(map.canUnitCrossEdge(a.pos,neighbor(a.pos,0),actor('japanese_infantry',a.pos)),true);
});
test('rocky height participates in uphill fire and editor agrees with runtime',()=>{
  const map=new HexMap(3,3),a={pos:{q:0,r:0},terrain:'clear'},b={pos:{q:1,r:0},terrain:'rocky'};map.set(a);map.set(b);
  const ctx={attacker:actor('sherman',a.pos),target:actor('japanese_infantry',b.pos),map,hardcoreTankMachineGuns:true};
  assert.equal(hitBreakdown(ctx).elevation,2);assert.equal(mgHitBreakdown(ctx).elevation,1);
  const grid=[[{t:'H'},{t:'c'}]];const tiles=editorElevationTiles(grid);
  assert.equal(tiles[0].terrain,'rocky');assert.equal(tileHeight(tiles[0]),1);
  assert.equal(elevationEdges(tiles)[0].blocked,true);assert.equal(editorCliffState(grid,0,1,3),true);
  assert.equal(setEditorCliff(grid,0,1,3,false),false);
});
test('continuous reef surface covers shared interiors, caches material changes and matches across chunks',()=>{
  const tiles=[{pos:{q:0,r:0},terrain:'rocky'},{pos:{q:1,r:0},terrain:'rocky'},{pos:{q:0,r:1},terrain:'clear'}];
  const raster=new ElevationContourRaster(material),segments=elevationContour(tiles),a=raster.render(tiles,segments,-48,-48,128),b=raster.render(tiles,segments,80,-48,128);
  for(let y=0;y<130;y++)for(let c=0;c<4;c++)assert.equal(a.pixels[(y*130+129)*4+c],b.pixels[(y*130+1)*4+c]);
  const interior=raster.render(tiles,segments,40,-1,2);
  assert.equal(interior.pixels[(1*4+1)*4+3],255,'shared same-height interior remains solid rock');
  const sig=elevationFingerprint(tiles,0);tiles[0].terrain='clear';tiles[0].height=1;
  assert.notEqual(elevationFingerprint(tiles,0),sig,'same elevation with a different surface must rebake');
  assert.equal(material.reefTop.width,384);
});
