// Compile the production join fragment in WebGL 1/2 and verify draw-order independent intersections.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
require('./renderElevationPreview.cjs'); // Project's existing TypeScript loader.
const {elevationEdges,elevationJoins,slopeSpritePath,SLOPE_ART}=require('../assets/scripts/core/Elevation.ts');
const {offsetToAxial}=require('../assets/scripts/core/HexGrid.ts');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'tmp/elevation-gpu');
async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const source=fs.readFileSync(path.join(ROOT,'assets/resources/effects/elevation-join.effect'),'utf8');
  let body=source.slice(source.indexOf('CCProgram elevation-fs %{')+'CCProgram elevation-fs %{'.length,source.lastIndexOf('}%'));
  body=body.replace(/^\s*#include.*$/gm,'').replace(/^\s*#pragma.*$/gm,'').replace(/layout\([^)]*\)\s*/g,'')
    .replace(/uniform ElevationJoinParams \{([^}]+)\};/,(_,fields)=>fields.split(';').filter(s=>s.trim()).map(s=>'uniform '+s.trim()+';').join('\n'))
    .replace(/CCSampleWithAlphaSeparated\(/g,'texture(').replace(/ALPHA_TEST\(o\);/g,'if(o.a<.001)discard;');
  const scenes=[];
  for(const camera of[0,90])for(const shape of['mixed','concave','three-heights','all-slopes']){
    let tiles=[];
    for(let row=0;row<7;row++)for(let col=0;col<9;col++){
      let height=row>=2&&row<=4&&col>=2&&col<=5?1:0;
      if(shape==='concave'&&row===3&&col>=4)height=0;
      if(shape==='three-heights'&&row===3&&col===4)height=2;
      const tile={pos:offsetToAxial({row,col}),terrain:'field',height};tiles.push(tile);
    }
    if(shape!=='all-slopes')for(const edge of elevationEdges(tiles)){
      const x=p=>Math.sqrt(3)*48*(p.q+p.r/2);
      if((x(edge.high.pos)+x(edge.low.pos))/2>310){edge.high.cliffs??=Array(6).fill(false);edge.high.cliffs[edge.direction]=true;}
    }
    scenes.push({name:`${shape}-c${camera}`,camera,joins:elevationJoins(elevationEdges(tiles))});
  }
  const paths=[...new Set(scenes.flatMap(s=>s.joins.flatMap(j=>[j.edge,...j.neighbors.map(n=>n.edge)].map(e=>slopeSpritePath(e.direction,e.blocked,s.camera)))))];
  const images=Object.fromEntries(paths.map(p=>[p,'data:image/png;base64,'+fs.readFileSync(path.join(ROOT,'assets/resources',p.replace('/spriteFrame','.png'))).toString('base64')]));
  const input={body,scenes,images,art:SLOPE_ART};
  const script=fs.readFileSync(path.join(ROOT,'tests/fixtures/elevation-gpu-webgl.js'),'utf8');
  fs.writeFileSync(path.join(OUT,'check.html'),'<!doctype html><meta charset="utf-8"><pre id="result">running</pre><canvas id="preview"></canvas><script>const input='+JSON.stringify(input)+';\n'+script+'</script>');
  const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const result=spawnSync(chrome,['--headless','--no-first-run','--disable-background-networking','--disable-component-update','--use-angle=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files','--user-data-dir='+path.join(OUT,'chrome-profile'),'--virtual-time-budget=10000','--dump-dom',new URL('file:///'+path.join(OUT,'check.html').replace(/\\/g,'/')).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:24*1024*1024});
  fs.writeFileSync(path.join(OUT,'chrome.log'),result.stderr||'');
  if(result.error)throw result.error;
  const encoded=result.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
  if(!encoded)throw Error('No elevation GPU result');
  const report=JSON.parse(encoded.replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&'));
  for(const preview of report.previews??[])fs.writeFileSync(path.join(OUT,preview.name+'.png'),Buffer.from(preview.png.split(',')[1],'base64'));
  delete report.previews;fs.writeFileSync(path.join(OUT,'pixel-result.json'),JSON.stringify(report,null,2));
  if(!report.passed)throw Error(report.error);
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
