// Actual WebGL 1 compilation + WebGL 2 pixel checks using an isolated headless
// Chrome profile. The production shader and source art are the test inputs.
const fs=require('fs'),path=require('path'),ts=require('typescript'),sharp=require('sharp'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/terrain-gpu');
function load(file,deps={}) {const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m,m.exports,n=>{if(n in deps)return deps[n];throw Error(n);});return m.exports;}
async function main() {
  fs.mkdirSync(out,{recursive:true});
  const urban=load('assets/scripts/core/UrbanTerrain.ts'),raster=load('assets/scripts/view/TerrainGroundRaster.ts',{'../core/UrbanTerrain':urban});
  const {TerrainGroundGpuData}=load('assets/scripts/view/TerrainGroundGpuData.ts',{'../core/UrbanTerrain':urban,'./TerrainGroundRaster':raster});
  const bundle=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/textures/terrain/redesign_v3/materials.json'))),cases=[];
  for(const [name,b,w]of [['summer',bundle.europeanSummer,false],['winter',bundle.europeanWinter,true],['pacific',bundle,false]]) {
    const data=new TerrainGroundGpuData(b),tiles=[];
    for(let r=-3;r<=5;r++)for(let q=-4;q<=8;q++)tiles.push({pos:{q,r},terrain:q===0?'water':q===1?'beach':q===2?'mud':q===3?'forest':q===4?'urban_ground':'field',...(r===2&&q!==0?{roads:[true,false,false,true,false,false]}:{}),...(r===2&&q===0?{bridgeEnds:[0,3]}:{})});
    const atlas=data.atlas(),encoded=data.tileData(tiles,w);
    cases.push({name,w,b:{curvedRoads:!!b.curvedRoads,winterArtwork:!!b.winterArtwork,roadSurface:!!b.materials.road_surface,winterYard:!!b.materials.winter_yard},encoded:{...encoded,ground:Array.from(encoded.ground),roads:Array.from(encoded.roads)}});
    await sharp(atlas.pixels,{raw:{width:atlas.width,height:atlas.height,channels:4}}).png().toFile(path.join(out,'atlas-'+name+'.png'));
  }
  const source=fs.readFileSync(path.join(root,'assets/resources/effects/terrain-bake.effect'),'utf8');
  const body=source.slice(source.indexOf('CCProgram terrain-fs %{')+'CCProgram terrain-fs %{'.length,source.lastIndexOf('}%'));
  const uniforms=body.replace(/uniform TerrainParams \{([^}]+)\};/,(_,fields)=>fields.split(';').filter(s=>s.trim()).map(s=>'uniform '+s.trim()+';').join('\n'));
  const input={cases,glsl3:uniforms+'\nlayout(location=0) out vec4 terrainColor;void main(){terrainColor=frag();}',glsl1:uniforms.replace('in vec2 mapUV;','varying vec2 mapUV;').replace(/\btexture\(/g,'texture2D(')+'\nvoid main(){gl_FragColor=frag();}'};
  const script=fs.readFileSync(path.join(root,'tests/fixtures/terrain-gpu-webgl.js'),'utf8');
  fs.writeFileSync(path.join(out,'check.html'),'<!doctype html><meta charset="utf-8"><style>body{background:#202329;color:#ddd;font-family:monospace}canvas{display:block;max-width:100%}</style><pre id="result">running</pre><canvas id="preview"></canvas><script>const input='+JSON.stringify(input)+';\n'+script+'</script>');
  const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if(!fs.existsSync(chrome))throw Error('Set CHROME_PATH to a Chrome/Chromium executable for the GPU pixel test.');
  const result=spawnSync(chrome,['--headless','--no-first-run','--disable-background-networking','--disable-component-update','--use-angle=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files','--user-data-dir='+path.join(out,'chrome-profile'),'--virtual-time-budget=10000','--dump-dom','--screenshot='+path.join(out,'preview.png'),'--window-size=900,650',new URL('file:///'+path.join(out,'check.html').replace(/\\/g,'/')).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(out,'chrome.log'),result.stderr||'');
  if(result.error)throw result.error;
  const encodedResult=result.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
  if(!encodedResult)throw Error('No GPU pixel result; see tmp/terrain-gpu/chrome.log');
  const report=JSON.parse(encodedResult.replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&'));
  fs.writeFileSync(path.join(out,'pixel-result.json'),JSON.stringify(report,null,2));
  if(!report.passed)throw Error(report.error);
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
