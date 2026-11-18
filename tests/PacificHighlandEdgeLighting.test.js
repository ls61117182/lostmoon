const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {ElevationContourRaster,elevationContour}=require('../assets/scripts/view/ElevationContour.ts');
const {neighbors}=require('../assets/scripts/core/HexGrid.ts');
const material=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/elevation/continuous-material.json'));
const neutral={...material,stones:[],reefTop:{width:1,height:1,rgb:Buffer.from([180,175,163]).toString('base64')}};
const tiles=[{pos:{q:0,r:0},terrain:'rocky'},...neighbors({q:0,r:0}).map(pos=>({pos,terrain:'clear'}))];
const pixel=(chunk,x,y)=>{const at=((Math.round(y)-chunk.y+1)*(chunk.size+2)+Math.round(x)-chunk.x+1)*4;return [...chunk.pixels.subarray(at,at+4)];};
function sideSamples(chunk,distance){return Array.from({length:6},(_,dir)=>{
  const a=dir*Math.PI/3,nx=Math.cos(a),ny=Math.sin(a);
  return Array.from({length:9},(_,j)=>pixel(chunk,nx*distance-ny*(j-4)*2,ny*distance+nx*(j-4)*2));
});}
const mean=(a,fn)=>a.reduce((sum,v)=>sum+fn(v),0)/a.length;
const lum=v=>v[0]*.2126+v[1]*.7152+v[2]*.0722;
test('reef walls remain stone-coloured on every side, with directional relief instead of a dark ring',()=>{
  const raster=new ElevationContourRaster(neutral),chunk=raster.render(tiles,elevationContour(tiles),-100,-100,200);
  const levels=sideSamples(chunk,48*Math.sqrt(3)/2).map(samples=>mean(samples,lum));
  assert.ok(Math.min(...levels)>125,`no black wall: ${levels}`);
  assert.ok(Math.max(...levels)>175&&Math.max(...levels)-Math.min(...levels)>25,`sunlit wall remains readable: ${levels}`);
  const fog=levels.map(v=>v*.7+70*.3);
  assert.ok(Math.min(...fog)>105,'fog does not turn a neutral rock wall into a black outline');
});
test('lowland shadow stays narrow and belongs mainly to the backlit side in both cameras',()=>{
  const raster=new ElevationContourRaster(neutral);
  for(const camera of [0,90]){
    const chunk=raster.render(tiles,elevationContour(tiles),-100,-100,200,camera);
    const near=sideSamples(chunk,48*Math.sqrt(3)/2+11),far=sideSamples(chunk,48*Math.sqrt(3)/2+17);
    const theta=camera*Math.PI/180,lx=(-Math.cos(theta)+Math.sin(theta))/Math.SQRT2,ly=-(Math.sin(theta)+Math.cos(theta))/Math.SQRT2;
    for(let dir=0;dir<6;dir++){
      const facing=lx*Math.cos(dir*Math.PI/3)+ly*Math.sin(dir*Math.PI/3);
      const alpha=mean(near[dir],v=>v[3]);
      if(facing>.6) assert.ok(alpha<8,`no sun-facing halo ${camera}/${dir}: ${alpha}`);
      if(facing<-.6) assert.ok(alpha>3&&alpha<60,`restrained backlit cast ${camera}/${dir}: ${alpha}`);
      assert.ok(mean(far[dir],v=>v[3])<3,`no broad outer halo ${camera}/${dir}`);
    }
  }
});
test('new reef facets and talus remain identical across chunk borders and map enumeration',()=>{
  const cells=[...tiles,{pos:{q:1,r:-1},terrain:'rocky'}].filter((t,i,a)=>a.findLastIndex(v=>v.pos.q===t.pos.q&&v.pos.r===t.pos.r)===i);
  const raster=new ElevationContourRaster(material),segments=elevationContour(cells);
  for(const camera of [0,90]){
    const left=raster.render(cells,segments,-50,-60,92,camera),right=raster.render(cells,segments,42,-60,92,camera);
    for(let y=0;y<94;y++)for(let x=0;x<2;x++)for(let c=0;c<4;c++)assert.equal(left.pixels[(y*94+92+x)*4+c],right.pixels[(y*94+x)*4+c]);
    const reversed=[...cells].reverse();
    assert.deepEqual(raster.render(reversed,elevationContour(reversed),-50,-60,92,camera).pixels,left.pixels);
  }
});
test('European slopes and cliffs keep pixel-identical rendering to the previous compositor',()=>{
  const archived=fs.readFileSync('source_art/terrain/pacific-highland-edge-v2-20261118/before/ElevationContour.ts.bak','utf8');
  const code=ts.transpileModule(archived,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const exports={};new Function('require','exports',code)(require('node:module').createRequire(path.resolve('assets/scripts/view/ElevationContour.ts')),exports);
  const before=new exports.ElevationContourRaster(material),after=new ElevationContourRaster(material);
  for(const camera of [0,90])for(const blocked of [false,true]){
    const cells=tiles.map(t=>({...t,terrain:'field',height:t.terrain==='rocky'?1:0,cliffs:Array(6).fill(blocked)}));
    assert.deepEqual(after.render(cells,elevationContour(cells),-70,-70,140,camera).pixels,
      before.render(cells,exports.elevationContour(cells),-70,-70,140,camera).pixels);
  }
});
