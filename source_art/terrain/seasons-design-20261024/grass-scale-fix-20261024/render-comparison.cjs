// Reference compositor, fixed camera and identical unit-size references in each panel.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const ROOT=path.resolve(__dirname,'../../../..');
const {loadRaster}=require(path.join(ROOT,'tools/buildEuropeanSeasons.cjs'));
const {TerrainGroundRaster}=loadRaster(),W=480,H=260,tiles=[];
for(let r=-3;r<=3;r++)for(let q=-4;q<=4;q++)tiles.push({pos:{q,r},terrain:'field'});
const looks=['spring','autumn','winter_bare'],names=['春季','秋季','冬季 · 无积雪'];
async function panel(pack) {
  const a=new TerrainGroundRaster(pack).renderChunk(tiles,false,-96,-52,192,104,2);
  const ground=await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:384,height:208}).resize(W,H).png().toBuffer();
  const units=[{input:await sharp(path.join(ROOT,'assets/resources/textures/units/sherman_top.png')).trim().resize(116,72,{fit:'contain',background:'#00000000'}).png().toBuffer(),left:62,top:99}];
  for(let i=0;i<3;i++)units.push({input:await sharp(path.join(ROOT,`assets/resources/textures/units/AmericanInfantry0${i+1}.png`)).trim().resize(22,30,{fit:'contain',background:'#00000000'}).png().toBuffer(),left:290+i*34,top:112+[0,-24,17][i]});
  return sharp(ground).composite(units).png().toBuffer();
}
async function main() {
  const layers=[],text=[];
  text.push('<text x="24" y="39" font-size="27">田野草纹尺度修正 · 相同镜头 / 相同单位比例参照</text>');
  text.push('<text x="94" y="81" font-size="21">调整前：草簇过大</text><text x="600" y="81" font-size="21">调整后：细密低矮草纹</text>');
  for(let i=0;i<looks.length;i++) {
    const id=looks[i],top=120+i*312,pack=JSON.parse(fs.readFileSync(path.join(ROOT,`assets/resources/textures/terrain/seasons/${id}/materials.json`)));
    const before=await sharp(path.join(__dirname,`${id}-before-grass.png`)).removeAlpha().raw().toBuffer();
    const old={...pack,materials:{...pack.materials,grass:{width:384,height:384,rgb:before.toString('base64')}}};
    text.push(`<text x="24" y="${top-12}" font-size="20">${names[i]}</text>`);
    layers.push({input:await panel(old),left:24,top},{input:await panel(pack),left:528,top});
  }
  const labels=Buffer.from(`<svg width="1032" height="1040"><g font-family="Microsoft YaHei,sans-serif" fill="#e5dfc7">${text.join('')}</g></svg>`);
  layers.push({input:labels,left:0,top:0});
  await sharp({create:{width:1032,height:1040,channels:4,background:'#253025'}}).composite(layers).png().toFile(path.join(__dirname,'comparison.png'));
  console.log('Saved grass-scale-fix-20261024/comparison.png');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
