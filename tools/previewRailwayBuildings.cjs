// Compare authored hedge/roof conflicts using production terrain, PNGs and layout functions.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
require('./prepareRailwayArt.cjs');
const {railwayArtTransform,railwayHasCrossing,railwaySurfaceClearance}=require('../assets/scripts/core/Railway.ts');
const {railwaySafeTiles}=require('../assets/scripts/core/RailwayHedges.ts');
const {ruralBuildingLayout}=require('../assets/scripts/core/RuralBuildings.ts');
const {europeanRoadVariantIndex}=require('../assets/scripts/core/UrbanTerrain.ts');
const {TerrainGroundRaster,europeanCountryRoadDistance}=require('../assets/scripts/view/TerrainGroundRaster.ts');
const ROOT=path.resolve(__dirname,'..'),DIR=path.join(ROOT,'assets/resources/textures/terrain');
const OUT=path.join(ROOT,'source_art/terrain/railway-v1-20261105/railway-building-clearance-preview.png');
const bundle=JSON.parse(fs.readFileSync(path.join(DIR,'redesign_v3/materials.json'),'utf8'));
const engine=new TerrainGroundRaster(bundle.europeanSummer??bundle);
const W=400,H=300,S=2,X=-220,Y=-140;
const flags=mask=>Array.from({length:6},(_,d)=>(mask>>d)&1).join('');
async function picture(after) {
  let defs=Array.from({length:5},()=>Array.from({length:7},()=>({t:'f'})));
  // Coordinates of the conflict are axial (0,0); row parity is 0.
  const defsAt=(q,r)=>defs[r+2][q+Math.floor(r/2)+3];
  for(let q=-2;q<0;q++)defsAt(q,0).rl='100100';
  Object.assign(defsAt(0,0),{t:'r',rd:'010010',rl:'010100',bd:1,h:'000100'});
  defsAt(-1,0).h='100000';
  for(let r=-2;r<=2;r++)if(r!==0)Object.assign(defsAt(0,r),{t:'r',rd:'010010',...(r>0?{rl:'010010'}:{})});
  if(after)defs=railwaySafeTiles(defs);
  const tiles=[];
  for(let row=0;row<defs.length;row++)for(let col=0;col<defs[row].length;col++){
    const t=defs[row][col],r=row-2,q=col-Math.floor(r/2)-3;
    tiles.push({pos:{q,r},terrain:t.t==='r'?'road':'field',railway:t.rl,hedges:t.h,
      hasBuilding:t.bd===1,...(t.rd?{roads:[...t.rd].map(v=>v==='1')}:{})});
  }
  const a=engine.renderChunk(tiles,false,X,Y,W,H,1);
  const ground=await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}})
    .extract({left:1,top:1,width:W,height:H}).resize(W*S,H*S).png().toBuffer();
  const layers=[{input:ground,left:0,top:0}];
  const pos=t=>({x:(Math.sqrt(3)*48*(t.pos.q+t.pos.r/2)-X)*S,y:(72*t.pos.r-Y)*S});
  const place=async(input,x,y)=>{const m=await sharp(input).metadata();layers.push({input,left:Math.round(x-m.width/2),top:Math.round(y-m.height/2)});};
  for(const t of tiles)if(t.railway){
    const art=railwayArtTransform(t.railway,railwayHasCrossing(t)),p=pos(t);
    const file=path.join(ROOT,'assets/resources',art.surface.replace('/spriteFrame','.png'));
    const rotated=await sharp(file).rotate(-art.rotationDegrees,{background:'#00000000'}).png().toBuffer(),m=await sharp(rotated).metadata();
    const image=await sharp(rotated).extract({left:Math.floor((m.width-256)/2),top:Math.floor((m.height-256)/2),width:256,height:256}).resize(192,192).png().toBuffer();
    await place(image,p.x,p.y);
  }
  const center=tiles.find(t=>t.pos.q===0&&t.pos.r===0),p=pos(center),variant=europeanRoadVariantIndex(0,0);
  const road=(x,y)=>europeanCountryRoadDistance(center.roads,x,y,variant)-.19;
  const rail=railwaySurfaceClearance(center.railway,railwayHasCrossing(center));
  const roofs=ruralBuildingLayout(0,0,after?(x,y)=>Math.min(road(x,y),rail(x,y)):road,after?4:2);
  for(const b of roofs){
    const image=await sharp(path.join(DIR,`redesign_v3/rural_roof_0${b.variant+1}.png`))
      .resize(Math.round(b.width*48*S),Math.round(b.height*48*S)).rotate(-b.angle*180/Math.PI,{background:'#00000000'}).png().toBuffer();
    await place(image,p.x+b.x*48*S,p.y-b.y*48*S);
  }
  const tree=await sharp(path.join(DIR,'redesign_v3/europe_tree_01.png')).resize(32,32).png().toBuffer();
  if(center.hedges?.[3]==='1')for(let i=0;i<7;i++)await place(tree,p.x-Math.sqrt(3)*24*S,p.y+(-24+i*8)*S);
  const result=await sharp({create:{width:W*S,height:H*S,channels:4,background:'#293125'}}).composite(layers).png().toBuffer();
  return {image:result,count:roofs.length};
}
async function main(){
  const before=await picture(false),after=await picture(true),width=1640,height=730;
  const header=Buffer.from(`<svg width="1640" height="120"><g font-family="Microsoft YaHei,sans-serif" fill="#e6dfc6"><text x="22" y="38" font-size="27">铁路 · 树篱与建筑避让修正</text><text x="22" y="74" font-size="18">修正前：树篱横断铁路，建筑仅避让道路（${before.count} 栋）</text><text x="842" y="74" font-size="18">修正后：清除冲突树篱，建筑同时避让铁路与道路（${after.count} 栋）</text><text x="22" y="103" font-size="15">使用正式地形与屋顶 PNG 合成；不是运行中的 Cocos 截图。</text></g></svg>`);
  await sharp({create:{width,height,channels:4,background:'#293125'}}).composite([{input:header,left:0,top:0},{input:before.image,left:10,top:120},{input:after.image,left:830,top:120}]).png().toFile(OUT);
  console.log(JSON.stringify({preview:OUT,beforeRoofs:before.count,afterRoofs:after.count}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
