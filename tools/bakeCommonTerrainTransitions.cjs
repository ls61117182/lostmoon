const fs=require('fs'),path=require('path'),crypto=require('crypto'),sharp=require('sharp'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'source_art/terrain/prefab-transitions-v1'),R=48,SQ=Math.sqrt(3),AXES=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
const PAIRS=[
 ['europe','field','mud'],['europe','field','forest'],['europe','field','water'],
 ['winter','field','mud'],['winter','field','forest'],['winter','field','water'],
 ['pacific','clear','beach'],['pacific','clear','water'],['pacific','water','deep_water'],
];
function load(file,deps={}){const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m,m.exports,n=>deps[n]);return m.exports;}
const api=load('assets/scripts/view/TerrainGroundRaster.ts',{'../core/UrbanTerrain':load('assets/scripts/core/UrbanTerrain.ts')});
const clamp=v=>Math.max(0,Math.min(1,v)),smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);},isWater=t=>['water','deep_water','beach'].includes(t);
/** Translation-periodic detail has the same phase on every hex boundary. */
function edgeGrain(x,y){const r=y/72,q=x/(SQ*R)-r/2;return (Math.cos(q*Math.PI*22)+Math.cos(r*Math.PI*26)+Math.cos((q+r)*Math.PI*18))*2;}
/** All touching tiles agree on the face average, or three-way vertex average.
 * Water/land interfaces use land at the boundary so banks retreat into water. */
function borderSample(x,y,center,neighbors,palette){
 const distances=AXES.map((_,i)=>x*Math.cos(i*Math.PI/3)+y*Math.sin(i*Math.PI/3)-SQ*R/2),edge=Math.max(...distances);
 const weighted=[[center,1]];for(let i=0;i<6;i++){const w=smooth(-10,0,distances[i]);if(w>0)weighted.push([neighbors[i],w]);}
 const land=weighted.filter(([t])=>!isWater(t)),selected=land.length&&weighted.some(([t])=>isWater(t))?land:weighted;
 const sum=selected.reduce((n,[,w])=>n+w,0),rgb=[0,0,0];for(const [t,w]of selected)for(let k=0;k<3;k++)rgb[k]+=palette[t][k]*w/sum;
 const grain=edgeGrain(x,y);for(let k=0;k<3;k++)rgb[k]+=grain;
 const total=weighted.reduce((n,[,w])=>n+w,0);
 const share=t=>weighted.filter(([id])=>id===t).reduce((n,[,w])=>n+w,0)/total;
 return {rgb,blend:smooth(-10,0,edge),edge,land:land.length>0,deep:share('deep_water'),shallow:share('beach')};
}
function context(center,other,mask){
 const tiles=[{pos:{q:0,r:0},terrain:center}],neighbors=AXES.map((_,i)=>mask&(1<<i)?other:center);
 for(let i=0;i<6;i++)tiles.push({pos:{q:AXES[i][0],r:AXES[i][1]},terrain:neighbors[i]});
 // A second ring completes the filter support; nearest first-ring hex extends
 // the known topology. Runtime matching must exclude special terrain nearby.
 const seeds=tiles.slice();for(let q=-2;q<=2;q++)for(let r=-2;r<=2;r++)if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))===2){let nearest=seeds[0],best=Infinity;for(const t of seeds){const d=(q-t.pos.q)**2+(r-t.pos.r)**2+(q-t.pos.q)*(r-t.pos.r);if(d<best){best=d;nearest=t;}}tiles.push({pos:{q,r},terrain:nearest.terrain});}
 return {tiles,neighbors};
}
async function build(){
 fs.mkdirSync(OUT,{recursive:true});const bytes=fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/redesign_v3/materials.json')),bundle=JSON.parse(bytes),manifest={version:1,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),radius:R,resolution:2,width:170,height:194,bounds:{x:-42.5,y:-48.5,width:85,height:97},directions:AXES,bitMeaning:'bit i = neighbor in direction i uses other terrain; unset = center terrain',matching:{twoMaterialsOnly:true,exclude:['roads','bridgeEnds','airstrip','ruralYard','urbanKind','mapBoundary'],neighborRing:2},entries:[]};
 for(const [style,a,b]of PAIRS){
  const engine=new api.TerrainGroundRaster(style==='europe'?bundle.europeanSummer:style==='winter'?bundle.europeanWinter:bundle),winter=style==='winter',palette={};
  for(const terrain of [a,b]){const sample=engine.renderChunk([{pos:{q:0,r:0},terrain}],winter,-20,-20,40,40);const mean=[0,0,0];for(let i=0;i<sample.pixels.length;i+=4)for(let k=0;k<3;k++)mean[k]+=sample.pixels[i+k]/(sample.pixels.length/4);palette[terrain]=mean;}
  const dir=path.join(OUT,style,`${a}-${b}`);fs.mkdirSync(dir,{recursive:true});let sheet=[];
  for(const [center,other]of [[a,b],[b,a]])for(let mask=0;mask<64;mask++){
   const {tiles,neighbors}=context(center,other,mask),chunk=engine.renderChunk(tiles,winter,-42,-48,84,96,2),color=Buffer.from(chunk.pixels),motion=Buffer.from(chunk.waterMask);
   for(let y=0;y<194;y++)for(let x=0;x<170;x++){
    const gx=-42+(x-1+.5)/2,gy=-48+(y-1+.5)/2,i=(y*170+x)*4,s=borderSample(gx,gy,center,neighbors,palette);
    // One half-pixel of coverage outside the hex supplies overlap at fractional
    // screen positions. Extra rectangle corners are fully transparent.
    color[i+3]=Math.round(255*(1-smooth(0,.5,s.edge)));
    if(!color[i+3]){motion.fill(0,i,i+4);continue;}
    for(let k=0;k<3;k++)color[i+k]=Math.round(color[i+k]+(s.rgb[k]-color[i+k])*s.blend);
    if(s.land)motion[i]=Math.round(motion[i]*(1-s.blend));
    else {const target=[255,(winter?.50:.72+s.shallow*.18-s.deep*.12)*255,(winter?.65:.5+s.deep*.35)*255,winter?128:255];for(let k=0;k<4;k++)motion[i+k]=Math.round(motion[i+k]+(target[k]-motion[i+k])*s.blend);}
   }
   const flags=Array.from({length:6},(_,i)=>mask>>i&1).join(''),stem=`${center}_${flags}`,relative=`${style}/${a}-${b}/${stem}`,file=path.join(dir,stem+'.png');
   await sharp(color,{raw:{width:170,height:194,channels:4}}).png().toFile(file);
   const animated=isWater(a)||isWater(b);if(animated)await sharp(motion,{raw:{width:170,height:194,channels:4}}).png().toFile(path.join(dir,stem+'_water-mask.png'));
   manifest.entries.push({style,center,other,neighborMask:mask,flags,outerRing:tiles.slice(7).map(t=>[t.pos.q,t.pos.r,t.terrain===other?1:0]),color:relative+'.png',waterMask:animated?relative+'_water-mask.png':null});
   if([0,1,3,7,9,21,31,63].includes(mask))sheet.push({input:await sharp(file).resize(136,155).png().toBuffer(),left:(sheet.length%8)*136,top:30+Math.floor(sheet.length/8)*185});
  }
  const label=Buffer.from(`<svg width="1088" height="30"><text x="12" y="22" fill="#eeeeee" font-size="18">${style}: ${a} / ${b} — masks 0, 1, 3, 7, 9, 21, 31, 63</text></svg>`);
  const second=Buffer.from(`<svg width="1088" height="30"><text x="12" y="22" fill="#eeeeee" font-size="18">center: ${b} — opposite side of the same transition</text></svg>`);
  await sharp({create:{width:1088,height:370,channels:4,background:'#263127'}}).composite([{input:label,left:0,top:0},{input:second,left:0,top:185},...sheet]).png().toFile(path.join(OUT,`${style}-${a}-${b}-preview.png`));
  console.log(`${style} ${a}/${b}: 128 directional color tiles${isWater(a)||isWater(b)?' + 128 water masks':''}`);
 }
 fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(OUT,'README.md'),'# Common terrain transition prefabs\n\nGenerated offline from the current native terrain compositor. Run `node tools/bakeCommonTerrainTransitions.cjs` to rebuild.\n\n1152 RGBA full-hex tiles across 9 terrain pairs; water pairs also include 640 RGBA animation masks. Images are 170×194 at 2 pixels per canonical world unit, including overlap padding. Six directional mask bits follow the manifest directions; no runtime rotation is required. Border colour and detail are standardized in an inward 10-unit strip, with a shared average at corners. Water interfaces retain land at the grid boundary.\n\nMatch only two-material neighborhoods without roads, bridges, runways, village yards, cities or map edges. A second ring must agree with the extended topology used by the baker; arbitrary three-material vertices need the existing fallback. Run `node tools/installCommonTerrainTransitions.cjs` to install feathered runtime assets and paired animation masks. The game overlays matching prefabs on continuous ground; see RUNTIME.md for matching and fallback behavior. The source material SHA identifies stale bakes.\n');
 console.log(`Saved ${manifest.entries.length} full tiles to ${OUT}`);
}
if(require.main===module)build().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={borderSample,context,PAIRS,edgeGrain};
