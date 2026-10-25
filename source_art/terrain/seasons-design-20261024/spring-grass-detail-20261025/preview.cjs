// Fixed camera and actual unit sprites for checking the short grass at game scale.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const ROOT=path.resolve(__dirname,'../../../..');
const {loadRaster}=require(path.join(ROOT,'tools/buildEuropeanSeasons.cjs'));
const {TerrainGroundRaster}=loadRaster(),W=480,H=300,tiles=[];
for(let r=-4;r<=4;r++)for(let q=-4;q<=4;q++)tiles.push({pos:{q,r},terrain:'field'});
async function panel(pack) {
  const a=new TerrainGroundRaster(pack).renderChunk(tiles,false,-192,-120,384,240,1.25);
  const ground=await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:W,height:H}).png().toBuffer();
  const units=[{input:await sharp(path.join(ROOT,'assets/resources/textures/units/sherman_top.png')).trim().resize(110,70,{fit:'contain',background:'#00000000'}).png().toBuffer(),left:62,top:115}];
  for(let i=0;i<3;i++)units.push({input:await sharp(path.join(ROOT,`assets/resources/textures/units/AmericanInfantry0${i+1}.png`)).trim().resize(22,30,{fit:'contain',background:'#00000000'}).png().toBuffer(),left:280+i*38,top:128+[0,-24,17][i]});
  return sharp(ground).composite(units).png().toBuffer();
}
async function main() {
  const pack=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/resources/textures/terrain/seasons/spring/materials.json')));
  const pixels=await sharp(path.join(__dirname,'grass-material-before.png')).removeAlpha().raw().toBuffer();
  const old={...pack,materials:{...pack.materials,grass:{width:384,height:384,rgb:pixels.toString('base64')}}};
  const labels=Buffer.from('<svg width="1032" height="420"><g font-family="Microsoft YaHei,sans-serif" fill="#e5dfc7"><text x="24" y="37" font-size="25">春季田野 · 相同镜头 / 相同单位比例参照</text><text x="24" y="84" font-size="21">调整前</text><text x="528" y="84" font-size="21">调整后：短草叶 / 碎草 / 疏密变化</text></g></svg>');
  await sharp({create:{width:1032,height:420,channels:4,background:'#253025'}}).composite([{input:await panel(old),left:24,top:100},{input:await panel(pack),left:528,top:100},{input:labels,left:0,top:0}]).png().toFile(path.join(__dirname,'comparison.png'));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
