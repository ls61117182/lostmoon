// Offline design review using the same ground and elevation compositors as BattleScene.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {offsetToAxial}=require('../assets/scripts/core/HexGrid.ts');
const {TerrainGroundRaster}=require('../assets/scripts/view/TerrainGroundRaster.ts');
const {ElevationContourRaster,elevationContour}=require('../assets/scripts/view/ElevationContour.ts');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'source_art/terrain/pacific-highland-elevation-20261117');
const uri=b=>'data:image/png;base64,'+b.toString('base64');
const ground=new TerrainGroundRaster(JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/redesign_v3/materials.json'))));
const relief=new ElevationContourRaster(JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/elevation/continuous-material.json'))));
function scene(rows,cols,high){return Array.from({length:rows},(_,row)=>Array.from({length:cols},(_,col)=>({pos:offsetToAxial({row,col}),terrain:high(row,col)?'rocky':'clear'}))).flat();}
async function render(tiles,x,y,width,height,camera=0){
  const g=ground.renderChunk(tiles,false,x,y,width,height);
  const size=Math.max(width,height),e=relief.render(tiles,elevationContour(tiles),x,y,size,camera);
  const base=await sharp(Buffer.from(g.pixels),{raw:{width:g.textureWidth,height:g.textureHeight,channels:4}}).extract({left:1,top:1,width,height}).png().toBuffer();
  const overlay=await sharp(Buffer.from(e.pixels),{raw:{width:size+2,height:size+2,channels:4}}).extract({left:1,top:1,width,height}).png().toBuffer();
  return sharp(base).composite([{input:overlay}]).png().toBuffer();
}
async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const isolated=scene(3,3,(r,c)=>r===1&&c===1),joined=scene(4,5,(r,c)=>(r===1||r===2)&&(c===1||c===2));
  const single=await render(isolated,55,20,210,175),cluster=await render(joined,45,10,365,270);
  const map=scene(7,11,(r,c)=>(r>=2&&r<=4&&c>=3&&c<=5)||(r===1&&c===8)||(r===4&&c===8));
  const full=await render(map,-48,-48,1000,550);
  const iconTiles=[{pos:{q:0,r:0},terrain:'rocky'},...[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]].map(([q,r])=>({pos:{q,r},terrain:'clear'}))];
  const icon=relief.render(iconTiles,elevationContour(iconTiles),-60,-65,130);
  const iconFile=path.join(ROOT,'assets/resources/textures/terrain/pacific_highland_elevation.png');
  await sharp(Buffer.from(icon.pixels),{raw:{width:132,height:132,channels:4}}).extract({left:1,top:1,width:120,height:130})
    .resize(222,256,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(iconFile);
  if(!fs.existsSync(iconFile+'.meta')){
    const meta=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/rocky_highland_01.png.meta')));
    const previous=meta.uuid,next=require('node:crypto').randomUUID();
    fs.writeFileSync(iconFile+'.meta',JSON.stringify(JSON.parse(JSON.stringify(meta).replaceAll(previous,next).replaceAll('rocky_highland_01','pacific_highland_elevation')),null,2)+'\n');
  }
  await sharp(full).toFile(path.join(OUT,'runtime-compositor-map.png'));
  const old=fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/rocky_highland_01.png'));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1040"><rect width="1200" height="1040" fill="#242a25"/>
  <g font-family="Microsoft YaHei,sans-serif" fill="#eee8d6"><text x="40" y="48" font-size="27">太平洋 · 连续礁岩高地</text>
  <text x="40" y="80" font-size="16" fill="#c6c7b6">高度 +1 / 六向高差均为不可通行陡坡 / 90° 垂直俯视</text>
  <text x="70" y="123" font-size="17">原有独立岩块</text><text x="370" y="123" font-size="17">新单格：封闭岩壁</text><text x="775" y="123" font-size="17">连片：仅外沿有陡坡</text>
  <image href="${uri(old)}" x="88" y="154" width="155" height="179"/>
  <image href="${uri(single)}" x="315" y="140" width="294" height="245"/>
  <image href="${uri(cluster)}" x="685" y="134" width="401" height="297"/>
  <text x="46" y="450" font-size="17">连续台面 · 浅色风化礁岩 / 自然受光岩壁 / 坡脚零散碎石 / 固定左上方来光</text>
  <image href="${uri(full)}" x="60" y="474" width="1080" height="594"/>
  <rect x="36" y="992" width="1128" height="34" fill="#242a25"/><text x="45" y="1015" font-size="13" fill="#b7bfae">生产合成器离线预览；并非 Cocos 实机截图。同高相邻格不产生内部坡面，格心及单位站位不偏移。</text></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT,'design-review.png'));
  await sharp(single).resize(105,88).png().toFile(path.join(OUT,'small-scale.png'));
  await sharp(await render(isolated,55,20,210,175,90)).png().toFile(path.join(OUT,'camera90-lighting.png'));
  // Reviewable map definitions; no replacement of campaign missions is required.
  const mission={id:'pacific_highland_review',name:'太平洋岩石高地检查',description:'高度1，外沿陡坡，连片内部无坡面。',theater:'pacific',cols:11,rows:7,
    tiles:Array.from({length:7},(_,r)=>Array.from({length:11},(_,c)=>({t:map[r*11+c].terrain==='rocky'?'H':'c'}))),
    sherman:{kind:'sherman',at:{row:5,col:1},facing:0},enemies:[{kind:'japanese_infantry',at:{row:3,col:4},facing:3}],objective:{type:'destroy_all_enemies'}};
  require('../assets/scripts/core/MissionLoader.ts').loadMission(mission);
  fs.writeFileSync(path.join(OUT,'review-map.json'),JSON.stringify({schemaVersion:2,editorVersion:'pacific-highland-v1',savedAt:Date.UTC(2026,10,17),source:'developer',mission,turnEndEvents:[]},null,2)+'\n');
  console.log('Saved Pacific highland design review, map and scale/light checks.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
