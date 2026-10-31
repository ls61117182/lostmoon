const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {test}=require('node:test');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {elevationContour,ElevationContourRaster,ELEVATION_RADIUS:R}=require('../assets/scripts/view/ElevationContour.ts');
const {neighbors,offsetToAxial}=require('../assets/scripts/core/HexGrid.ts');
const material=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/elevation/continuous-material.json'));
const raster=new ElevationContourRaster(material);
const make=(shape='mixed')=>{
  const tiles=[];for(let row=0;row<7;row++)for(let col=0;col<9;col++){
    let height=row>=2&&row<=4&&col>=2&&col<=5?1:0;
    if(shape==='concave'&&row===3&&col>=4)height=0;
    if(shape==='negative')height=-height;
    if(shape==='three'&&row===3&&col===4)height=2;
    tiles.push({pos:offsetToAxial({row,col}),terrain:'field',height});
  }
  if(shape!=='grass')for(const tile of tiles)if(tile.height)tile.cliffs=[true,true,true,false,false,false];
  return tiles;
};
const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-7;
const lum=(chunk,gx,gy,ground=140)=>{const width=chunk.size+2,i=((gy-chunk.y+1)*width+gx-chunk.x+1)*4,a=chunk.pixels[i+3]/255;return (chunk.pixels[i]*.2126+chunk.pixels[i+1]*.7152+chunk.pixels[i+2]*.0722)*a+ground*(1-a);};

test('every corner of an isolated high hex has shared positions and continuous normals, including grass/rock transitions',()=>{
  const high={pos:{q:0,r:0},terrain:'field',height:1,cliffs:[true,true,true,false,false,false]};
  const segments=elevationContour([high,...neighbors(high.pos).map(pos=>({pos,terrain:'field'}))]);
  assert.ok(segments.length>6);
  for(const segment of segments){
    const after=segments.filter(s=>near(s.a,segment.b));assert.equal(after.length,1,'each contour segment has one successor');
    assert.ok(near(segment.nb,after[0].na),'the lighting normal cannot jump at a connection');
    assert.ok(Math.abs(segment.rockB-after[0].rockA)<1e-7,'material cannot jump at a connection');
  }
  assert.ok(segments.some(s=>s.rockA>0&&s.rockA<1));
});

test('convex and concave connected contours retain their high side and have no open joins',()=>{
  for(const shape of ['mixed','concave','negative']){
    const segments=elevationContour(make(shape));
    for(const s of segments){assert.equal(segments.filter(t=>near(t.a,s.b)).length,1);assert.ok(s.high>s.low);}
  }
});

test('canonical world samples agree exactly across chunk borders and reversed map enumeration',()=>{
  const tiles=make('mixed'),segments=elevationContour(tiles),left=raster.render(tiles,segments,0,0),right=raster.render(tiles,segments,256,0);
  const width=258;
  for(let y=0;y<258;y++)for(let x=0;x<2;x++)for(let c=0;c<4;c++)assert.equal(left.pixels[(y*width+256+x)*4+c],right.pixels[(y*width+x)*4+c]);
  const reverse=[...tiles].reverse();assert.deepEqual(raster.render(reverse,elevationContour(reverse),0,0).pixels,left.pixels);
});

test('a straight slope straddles the shared edge and retains a crest/foot value step after rain',()=>{
  // Vertical shared border at X=0; both cells are present for all sampled points.
  const tiles=[{pos:{q:-1,r:0},terrain:'field',height:1},{pos:{q:0,r:0},terrain:'field'}];
  const segment=elevationContour(tiles)[0],border=(segment.a.x+segment.b.x)*R/2;
  const chunk=raster.render(tiles,[segment],-100,-100,200);
  const crest=lum(chunk,Math.round(border-12),0),foot=lum(chunk,Math.round(border+12),0);
  assert.ok((crest-foot)*.76>15,`rain crest ${crest} / foot ${foot}`);
  const sample=x=>chunk.pixels[(101*202+x+101)*4+3];
  assert.ok(sample(Math.round(border-5))>34,'shade exists inside the high cell');
  assert.ok(sample(Math.round(border+5))>0,'shade exists inside the low cell');
});

test('screen-space light changes with map rotation, while texture and contour positions do not',()=>{
  const tiles=make('grass'),segments=elevationContour(tiles),a=raster.render(tiles,segments,0,0),b=raster.render(tiles,segments,0,0,256,90);
  assert.notDeepEqual(a.pixels,b.pixels);assert.equal(a.x,b.x);assert.equal(a.size,b.size);
  assert.deepEqual(elevationContour(tiles),segments);
});

test('empty maps allocate no chunks, negative heights and three-height junctions remain bounded, and holes stay transparent',()=>{
  assert.deepEqual(raster.plans([{pos:{q:0,r:0},terrain:'field'}]),[]);
  for(const shape of ['negative','three']){
    const tiles=make(shape),segments=elevationContour(tiles),chunk=raster.render(tiles,segments,0,0);
    assert.ok(chunk.pixels.some((v,i)=>i%4===3&&v>0));
    assert.ok(segments.every(s=>[s.a.x,s.a.y,s.b.x,s.b.y,s.na.x,s.nb.y].every(Number.isFinite)));
  }
  const tiles=[{pos:{q:0,r:0},terrain:'field',height:1}],chunk=raster.render(tiles,[],0,0);
  assert.equal(chunk.pixels.at(-1),0,'no overlay outside existing hexes');
});

test('production rubble has 16 transparent silhouettes with distinct facets and neutral stone colours',()=>{
  assert.equal(material.version,5);assert.equal(material.stones.length,16);
  const hashes=new Set();
  for(const art of material.stones){
    const rgba=Buffer.from(art.rgba,'base64'),normals=Buffer.from(art.normals,'base64');
    assert.equal(rgba.length,art.size*art.size*4);assert.equal(normals.length,art.size*art.size*2);
    assert.equal(rgba[3],0);assert.ok(rgba.some((v,i)=>i%4===3&&v>240));
    assert.ok(normals.some(v=>Math.abs(v-128)>24),'each silhouette retains relightable stone facets');
    for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>128)assert.ok(Math.max(rgba[i],rgba[i+1],rgba[i+2])-Math.min(rgba[i],rgba[i+1],rgba[i+2])<75,'no saturated extraction halo');
    hashes.add(require('node:crypto').createHash('sha256').update(rgba).digest('hex'));
  }
  assert.equal(hashes.size,16);
});

test('a rubble-covered cliff is identical when a boulder and its shadow straddle two chunks',()=>{
  const tiles=[{pos:{q:0,r:0},terrain:'field',height:1,cliffs:[true,false,false,false,false,false]},
    {pos:{q:1,r:0},terrain:'field'}],segments=elevationContour(tiles);
  const left=raster.render(tiles,segments,-50,-40,92),right=raster.render(tiles,segments,42,-40,92),whole=raster.render(tiles,segments,-50,-40,184);
  let solid=0;
  for(let py=0;py<94;py++)for(let px=0;px<94;px++)for(let c=0;c<4;c++){
    assert.equal(left.pixels[(py*94+px)*4+c],whole.pixels[(py*186+px)*4+c]);
    assert.equal(right.pixels[(py*94+px)*4+c],whole.pixels[(py*186+px+92)*4+c]);
    if(c===3&&right.pixels[(py*94+px)*4+c]===255)solid++;
  }
  assert.ok(solid>20,'the checked boundary crosses actual opaque rock fragments');
});

test('rubble reaches beyond the solid face in scattered patches and keeps geometry while sunlight rotates',()=>{
  const tiles=make('mixed'),segments=elevationContour(tiles),fragmented=raster.render(tiles,segments,256,256),rotated=raster.render(tiles,segments,256,256,256,90);
  const plain=new ElevationContourRaster({...material,stones:[]}).render(tiles,segments,256,256);
  let scattered=0,opaque=0,shared=0;
  for(let i=3;i<plain.pixels.length;i+=4){
    if(plain.pixels[i]<64&&fragmented.pixels[i]>120)scattered++;
    // Small changes in the semi-transparent shadow beneath an antialiased edge can
    // change its rounded alpha. Rock cores should remain covered in either light.
    if(fragmented.pixels[i]===255){opaque++;if(rotated.pixels[i]>=240)shared++;}
  }
  assert.ok(scattered>5,'some independent stones lie outside the old continuous ribbon');
  assert.ok(opaque>100&&shared/opaque>.97,'sunlight changes shading, not the rock positions');
  assert.notDeepEqual(fragmented.pixels,rotated.pixels);
});
