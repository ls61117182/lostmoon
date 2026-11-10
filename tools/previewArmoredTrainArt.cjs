const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {ROOT,SOURCE,OUT,SIZE,modules,filename}=require('./prepareArmoredTrainArt.cjs');
const railArt=require('./prepareRailwayArt.cjs');
const {railwayArtTransform}=require('../assets/scripts/core/Railway.ts');
const {TerrainGroundRaster}=require('../assets/scripts/view/TerrainGroundRaster.ts');
const bundle=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/redesign_v3/materials.json'),'utf8'));
const raster=new TerrainGroundRaster(bundle.europeanSummer??bundle);
const normal=id=>path.join(SOURCE,'assembled',id+'_normal.png');
const wreck=id=>path.join(OUT,filename(id,'destroyed'));
const text=(s,x,y,size=18)=>`<text x="${x}" y="${y}" fill="#e8e3cf" font-family="Microsoft YaHei,sans-serif" font-size="${size}">${s}</text>`;
const svg=(w,h,s)=>Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`);
const canvas=(w,h)=>sharp({create:{width:w,height:h,channels:4,background:'#283129'}});
async function sheet(){
  const width=1536,height=850,layers=[];
  let labels=text('BP 44 风格装甲列车 · 六种单格模块',25,40,29)+text('正常状态 / 击毁状态 · 车体与武器分层 · 图中为正式 PNG 的合成效果',25,72,17);
  for(const [i,m]of modules.entries()){
    const x=i*256;
    labels+=text(m.label,x+20,113,18);
    for(const [j,file]of[normal(m.id),wreck(m.id)].entries())layers.push({input:await sharp(file).resize(330,330).png().toBuffer(),left:Math.round(x-37),top:137+j*345});
  }
  labels+=text('上排：正常',25,128,13)+text('下排：击毁',25,474,13)+text('一节占 1 格；正常与残骸使用相同的车体轴线与车钩基准。',25,837,17);
  await canvas(width,height).composite([{input:svg(width,height,labels),left:0,top:0},...layers]).png().toFile(path.join(SOURCE,'previews/bp44-modules-preview.png'));
}
async function ground(tiles,x,y,width,height){
  const a=raster.renderChunk(tiles,false,x,y,width,height,1);
  return sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width,height}).png().toBuffer();
}
async function centered(layers,file,x,y,side,angle=0){
  const input=await sharp(file).resize(Math.round(side),Math.round(side)).rotate(angle,{background:'#00000000'}).png().toBuffer(),m=await sharp(input).metadata();
  layers.push({input,left:Math.round(x-m.width/2),top:Math.round(y-m.height/2)});
}
async function railFile(connections){const art=railwayArtTransform(connections);return{...art,file:path.join(ROOT,'assets/resources',art.surface.replace('/spriteFrame','.png'))};}
async function small(){
  const width=1320,height=550,layers=[];
  let labels=text('实际显示尺寸检查 · 一节一格',24,39,26)+text('48px 六角半径：车钩间距约 83px；右下方另附半尺寸对照。',24,72,17);
  for(const [i,m]of modules.entries()){
    const x=20+i*218,tiles=[];
    for(let r=-2;r<=2;r++)for(let q=-2;q<=2;q++)tiles.push({pos:{q,r},terrain:'field'});
    const base=await ground(tiles,-100,-100,200,200),s=[];
    const rail=await railFile('100100');
    await centered(s,rail.file,100,100,96);
    await centered(s,normal(m.id),100,100,96,90);
    const image=await sharp(base).composite(s).png().toBuffer();
    layers.push({input:image,left:x,top:122});
    const ds=[];await centered(ds,rail.file,100,100,96);await centered(ds,wreck(m.id),100,100,96,90);
    layers.push({input:await sharp(base).composite(ds).png().toBuffer(),left:x,top:337});
    labels+=text(m.label,x+8,108,17);
    const tiny=await sharp(image).resize(100,100).png().toBuffer();
    layers.push({input:tiny,left:x+100,top:230});
  }
  await canvas(width,height).composite([{input:svg(width,height,labels),left:0,top:0},...layers]).png().toFile(path.join(SOURCE,'previews/bp44-small-scale-preview.png'));
}
async function placement(){
  const width=720,height=450,X=-95,Y=-95,R=48,S=2,layers=[],tiles=[];
  for(let r=-1;r<=4;r++)for(let q=-2;q<=7;q++)tiles.push({pos:{q,r},terrain:q===4?'road':'field',...(q===4?{roads:[false,true,false,false,true,false]}:{})});
  const p=(q,r)=>({x:(Math.sqrt(3)*R*(q+r/2)-X)*S,y:(R*1.5*r-Y)*S});
  layers.push({input:await sharp(await ground(tiles,X,Y,width,height)).resize(width*S,height*S).png().toBuffer(),left:0,top:0});
  const couplers=[];
  // Upper row: exactly one module between each pair of adjacent hex centers.
  for(let q=-1;q<=6;q++){const a=p(q,0),rail=await railFile('100100');await centered(layers,rail.file,a.x,a.y,R*2*S);}
  for(const [i,m]of modules.entries()){
    const a=p(i,0);await centered(layers,normal(m.id),a.x,a.y,R*2*S,90);
    couplers.push({id:m.id,position:{q:i,r:0},center:a,angle:90});
  }
  // Lower S bend: artwork registration demonstration, not train movement logic.
  const route=[{q:0,r:3,id:'command',a:3,b:0},{q:1,r:3,id:'howitzer',a:3,b:5},{q:2,r:2,id:'artillery_flak',a:2,b:0},{q:3,r:2,id:'panzerjaeger',a:3,b:0}];
  const connectors=[];
  for(const t of route){
    const flags=railArt.flags((1<<t.a)|(1<<t.b)),art=await railFile(flags),c=p(t.q,t.r);
    await centered(layers,art.file,c.x,c.y,R*2*S,-art.rotationDegrees);
  }
  for(const t of route){
    const c=p(t.q,t.r),line=railArt.centerline(t.a,t.b),mid=line.points[80],before=line.points[79],after=line.points[81];
    const angle=Math.atan2(after[1]-before[1],after[0]-before[0])*180/Math.PI+90;
    const x=c.x+mid[0]/128*R*S,y=c.y+mid[1]/128*R*S;
    await centered(layers,normal(t.id),x,y,R*2*S,angle);
    const a=angle*Math.PI/180,half=Math.sqrt(3)*R*S/2;
    connectors.push({front:{x:x+Math.sin(a)*half,y:y-Math.cos(a)*half},rear:{x:x-Math.sin(a)*half,y:y+Math.cos(a)*half}});
  }
  // Flexible coupling rods connect the registered ends; their geometry will be
  // handled by future train animation, independent of the art canvases.
  let rods='';for(let i=1;i<connectors.length;i++){const a=connectors[i-1].front,b=connectors[i].rear;rods+=`<path d="M${a.x},${a.y} L${b.x},${b.y}" stroke="#252b29" stroke-width="4" stroke-linecap="round"/>`;}
  layers.push({input:svg(width*S,height*S,rods),left:0,top:0});
  const image=await canvas(width*S,height*S).composite(layers).png().toBuffer();
  const header=svg(width*S,114,text('BP 44 · 单格铁路适配预览',22,36,28)+text('上：六种模块直轨拼接；下：弯轨上的车体与车钩静态示意。',22,69,17)+text('使用正式地形与单位素材合成；火车移动、转弯和战斗规则尚待后续接入。',22,99,16));
  await canvas(width*S,height*S+114).composite([{input:header,left:0,top:0},{input:image,left:0,top:114}]).png().toFile(path.join(SOURCE,'previews/bp44-railway-preview.png'));
  fs.writeFileSync(path.join(SOURCE,'previews/placement.json'),JSON.stringify({straight:couplers,curved:route},null,2)+'\n');
}
async function main(){await sheet();await small();await placement();console.log('BP44 contact sheet, game-scale inspection and railway placement previews saved.');}
main().catch(e=>{console.error(e);process.exitCode=1;});
