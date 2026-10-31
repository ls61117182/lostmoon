// Visual QA of the production contour compositor, plus a legacy sprite atlas for comparison.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..'),SOURCE=path.join(ROOT,'source_art/terrain/elevation-v1');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {elevationEdges,slopePlacement,slopeSpritePath,SLOPE_DIRECTIONS,SLOPE_ART}=require('../assets/scripts/core/Elevation.ts');
const {offsetToAxial,axialToOffset}=require('../assets/scripts/core/HexGrid.ts');
const {TerrainGroundRaster}=require('../assets/scripts/view/TerrainGroundRaster.ts');
const {ElevationContourRaster,elevationContour}=require('../assets/scripts/view/ElevationContour.ts');
const uri=file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
const project=(pos,size=48)=>({x:Math.sqrt(3)*size*(pos.q+pos.r/2),y:1.5*size*pos.r});
function edgeSvg(edge,size,camera=0) {
  const p=project(edge.high.pos,size),s=slopePlacement(edge,size);
  const file=path.join(ROOT,'assets/resources',slopeSpritePath(edge.direction,edge.blocked,camera).replace('/spriteFrame','.png'));
  return `<image href="${uri(file)}" x="${-s.width/2}" y="${-s.height*(1-SLOPE_ART.anchorY)}" width="${s.width}" height="${s.height}" transform="translate(${p.x+s.x} ${p.y-s.y}) rotate(${-s.angle})"/>`;
}
function gridSvg(tiles,size=48) {
  return tiles.map(tile=>{const p=project(tile.pos,size);const points=Array.from({length:6},(_,i)=>{const a=(-30+i*60)*Math.PI/180;return `${p.x+Math.cos(a)*size},${p.y+Math.sin(a)*size}`;}).join(' ');return `<polygon points="${points}" fill="none" stroke="#e5e4c0" stroke-opacity=".4" stroke-width=".8"/>`;}).join('');
}
async function main(){
  const data=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/redesign_v3/materials.json'),'utf8'));
  const raster=new TerrainGroundRaster(data.europeanSummer??data);
  const tiles=[];
  for(let row=0;row<7;row++)for(let col=0;col<9;col++) {
    const high=row>=2&&row<=4&&col>=2&&col<=5;
    tiles.push({pos:offsetToAxial({row,col}),terrain:'field',height:high?1:0});
  }
  for(const edge of elevationEdges(tiles)) {
    const a=project(edge.high.pos),b=project(edge.low.pos);
    if((a.x+b.x)/2>310){edge.high.cliffs??=Array(6).fill(false);edge.high.cliffs[edge.direction]=true;}
  }
  const mission={id:'elevation_demo_v1',name:'高地与边坡测试',description:'连续高地：左侧缓坡可通行，右侧陡坡禁止跨越。',theater:'europe',cols:9,rows:7,
    tiles:Array.from({length:7},()=>Array(9).fill(null)),sherman:{kind:'sherman',at:{row:3,col:3},facing:0},
    enemies:[{kind:'panzer4',at:{row:5,col:7},facing:3}],objective:{type:'destroy_all_enemies'}};
  for(const tile of tiles){const at=axialToOffset(tile.pos);mission.tiles[at.row][at.col]={t:'f',...(tile.height?{height:tile.height}:{}),...(tile.cliffs?{cliff:tile.cliffs.map(Boolean).map(Number).join('')}:{} )};}
  require('../assets/scripts/core/MissionLoader.ts').loadMission(mission);
  fs.writeFileSync(path.join(SOURCE,'demo-package.json'),JSON.stringify({schemaVersion:2,editorVersion:'elevation-v1',savedAt:Date.UTC(2026,9,30),source:'developer',mission,turnEndEvents:[]},null,2)+'\n');
  // A regular development-only resource mission enables actual Cocos visual checks through the menu.
  const qaMission={...mission,id:'elevation_visual_test',name:'高地边坡视觉检查',weather:'rain'};
  const qaFile=path.join(ROOT,'assets/resources/missions/elevation_visual_test.json');
  fs.writeFileSync(qaFile,JSON.stringify(qaMission,null,2)+'\n');
  if(!fs.existsSync(qaFile+'.meta'))fs.writeFileSync(qaFile+'.meta',JSON.stringify({ver:'2.0.1',importer:'json',imported:true,uuid:'37aba4d1-411e-481b-abaa-cb19a3b380f2',files:['.json'],subMetas:{},userData:{}},null,2)+'\n');
  const chunk=raster.renderChunk(tiles,false,-70,-60,850,570);
  const ground=await sharp(Buffer.from(chunk.pixels),{raw:{width:chunk.textureWidth,height:chunk.textureHeight,channels:4}}).extract({left:1,top:1,width:850,height:570}).png().toBuffer();
  const contours=new ElevationContourRaster(JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/elevation/continuous-material.json'),'utf8')));
  const overlay=contours.render(tiles,elevationContour(tiles),-70,-60,850);
  const overlayPng=await sharp(Buffer.from(overlay.pixels),{raw:{width:852,height:852,channels:4}}).extract({left:1,top:1,width:850,height:570}).png().toBuffer();
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="730"><rect width="1020" height="730" fill="#222c24"/><g font-family="Microsoft YaHei,sans-serif" fill="#eee9d6"><text x="36" y="40" font-size="24">连续边坡 · 实际地面与运行时轮廓</text><text x="36" y="69" font-size="15">左侧缓坡可通行 / 右侧岩石陡坡不可通行 / 固定屏幕左上光照</text></g><g transform="translate(112 151)">';
  svg+=`<image x="-70" y="-60" width="850" height="570" href="data:image/png;base64,${ground.toString('base64')}"/>`;
  svg+=`<image x="-70" y="-60" width="850" height="570" href="data:image/png;base64,${overlayPng.toString('base64')}"/>`+gridSvg(tiles);
  for(const [row,col]of[[3,3],[5,2]]){const p=project(offsetToAxial({row,col}));svg+=`<image href="${uri(path.join(ROOT,'assets/resources/textures/units/sherman_top.png'))}" x="${p.x-22}" y="${p.y-22}" width="44" height="44"/>`;}
  svg+='</g></svg>';
  fs.writeFileSync(path.join(SOURCE,'runtime-preview.svg'),svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(SOURCE,'runtime-preview.png'));
  let atlas='<svg xmlns="http://www.w3.org/2000/svg" width="1560" height="680"><rect width="1560" height="680" fill="#39452f"/>';
  for(const blocked of[false,true])for(let dir=0;dir<6;dir++){
    const x=dir*260+130,y=blocked?480:160;
    const edge={high:{pos:{q:0,r:0}},direction:dir,difference:1,blocked};
    atlas+=`<g transform="translate(${x} ${y})">${edgeSvg(edge,85)}<polygon points="${Array.from({length:6},(_,i)=>{const a=(30+i*60)*Math.PI/180;return `${Math.cos(a)*85},${Math.sin(a)*85}`;}).join(' ')}" fill="none" stroke="#d4d2a1" stroke-opacity=".3"/><text x="0" y="148" font-family="sans-serif" font-size="18" fill="#eeeed5" text-anchor="middle">${blocked?'CLIFF':'SLOPE'} ${SLOPE_DIRECTIONS[dir]}</text></g>`;
  }
  atlas+='</svg>';
  await sharp(Buffer.from(atlas)).png().toFile(path.join(SOURCE,'direction-sheet.png'));
  console.log('Saved runtime-preview.png and direction-sheet.png');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={edgeSvg};
