const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {ROOT,readPack}=require('./switchEuropeanTerrainArt.cjs');
const {loadRaster}=require('./buildEuropeanTerrainV6.cjs');
const STEEL=process.argv.includes('--steel'),VERSION=STEEL?'detailed-steel-bridge':'detailed-bridge';
const OUT=path.join(ROOT,STEEL?'source_art/terrain/steel-bridge-20261015':'source_art/terrain/bridge-v7-20261015');
const {TerrainGroundRaster}=loadRaster();
function makeTiles(axis){
 const angle=axis*Math.PI/3,tiles=[];
 for(let r=-3;r<=3;r++)for(let q=-3;q<=3;q++){
  const x=Math.sqrt(3)*48*(q+r/2),y=72*r,u=x*Math.cos(angle)+y*Math.sin(angle),v=-x*Math.sin(angle)+y*Math.cos(angle);
  const water=Math.abs(u)<45,roads=Array.from({length:6},(_,i)=>i===axis||i===axis+3);
  tiles.push({pos:{q,r},terrain:water?'water':Math.abs(v)<20?'road':'field',...(q===0&&r===0?{bridgeEnds:[axis,axis+3]}:!water&&Math.abs(v)<20?{roads}:{})});
 }return tiles;
}
async function render(version,axis,resolution,world=240,pixels=600){
 const b=readPack(version).summer,a=new TerrainGroundRaster(b).renderChunk(makeTiles(axis),false,-world/2,-world/2,world,world,resolution);
 return sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:world*resolution,height:world*resolution}).resize(pixels,pixels).png().toBuffer();
}
function label(width,height,title,subtitle){return Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#eee8d9"/><g font-family="Microsoft YaHei,sans-serif" fill="#303c2f"><text x="22" y="34" font-size="25">${title}</text><text x="22" y="62" font-size="16">${subtitle}</text></g></svg>`);}
async function main(){
 const old=await render('detailed',1,1),next=await render(VERSION,1,2);
 await sharp(next).toFile(path.join(OUT,'bridge-in-map.png'));
 await sharp({create:{width:1240,height:710,channels:4,background:'#eee8d9'}}).composite([
  {input:label(1240,92,STEEL?'坦克战场钢桥 · 原木桥 / 新钢桥':'木桥重绘 V7 · 原版 / 新版',STEEL?'左：原有木桥　　右：钢板桥面、纵向钢梁、横向加劲与铆钉；含桥区块 2×烘焙。项目合成器预览。':'左：V6 材质合成桥面，1×烘焙　　右：独立桥面原画，含桥区块 2×烘焙。项目合成器预览。'),left:0,top:0},
  {input:old,left:10,top:95},{input:next,left:630,top:95}
 ]).png().toFile(path.join(OUT,'comparison.png'));
 const axes=[];for(let axis=0;axis<3;axis++)axes.push({input:await render(VERSION,axis,2,160,400),left:10+axis*410,top:95});
 await sharp({create:{width:1240,height:510,channels:4,background:'#eee8d9'}}).composite([{input:label(1240,90,STEEL?'重型钢桥 · 三个轴向':'新版木桥 · 三个轴向','同一张桥面原画旋转使用，桥面尺寸、通行宽度与原版一致。'),left:0,top:0},...axes]).png().toFile(path.join(OUT,'three-axes.png'));
 console.log('Saved bridge comparison, map crop and three-axis preview.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
