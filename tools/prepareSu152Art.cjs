const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'source_art/tanks/su152');
const out = path.join(root, 'assets/resources/textures/units');
async function main() {
  // Generated bold-line art replaces the original direct extraction.
  // Remove only neutral bright background / green-screen pixels before resizing.
  for (const [input, output, green] of [
    ['top-simplified-generated.png', 'su152_top.png', false],
    ['destroyed-broken-barrel-generated.png', 'su152_top_destroyed.png', true],
  ]) {
    const {data, info} = await sharp(path.join(src,input)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let i=0;i<data.length;i+=4) {
      const r=data[i],g=data[i+1],b=data[i+2];
      if(green ? g>r*1.45 && g>b*1.45 && g>85 : Math.min(r,g,b)>190) data[i+3]=0;
    }
    // Keep the wreck's original canvas: trimming the missing barrel would enlarge
    // and shift the surviving hull relative to the live vehicle.
    const layer = sharp(data,{raw:info});
    await (green ? layer : layer.trim({threshold:10})).resize(356,140,{fit:'fill'})
      .png().toFile(path.join(out,output));
  }
  for(const name of ['su152_top','su152_top_destroyed']) {
    const metaPath=path.join(out,name+'.png.meta');
    let meta=JSON.parse(fs.readFileSync(fs.existsSync(metaPath)?metaPath:path.join(out,'stug3_top.png.meta'),'utf8'));
    if(!fs.existsSync(metaPath)) meta=JSON.parse(JSON.stringify(meta).replaceAll(meta.uuid,randomUUID()).replaceAll('stug3_top',name));
    const d=meta.subMetas.f9941.userData,w=356,h=140,hw=w/2,hh=h/2;
    Object.assign(d,{width:w,height:h,rawWidth:w,rawHeight:h,trimX:0,trimY:0,offsetX:0,offsetY:0,trimType:'none'});
    d.vertices={rawPosition:[-hw,-hh,0,hw,-hh,0,-hw,hh,0,hw,hh,0],indexes:[0,1,2,2,1,3],uv:[0,h,w,h,0,0,w,0],nuv:[0,0,1,0,0,1,1,1],minPos:[-hw,-hh,0],maxPos:[hw,hh,0]};
    fs.writeFileSync(metaPath,JSON.stringify(meta,null,2)+'\n');
  }
  await sharp({create:{width:752,height:380,channels:4,background:'#343b34'}}).composite([
    {input:await sharp(path.join(out,'su152_top.png')).resize(712,280,{kernel:'nearest'}).toBuffer(),left:20,top:10},
    {input:await sharp(path.join(out,'su152_top.png')).resize(178,70).toBuffer(),left:20,top:300},
    {input:await sharp(path.join(out,'su152_top_destroyed.png')).resize(178,70).toBuffer(),left:218,top:300},
  ]).png().toFile(path.join(src,'preview.png'));
  console.log('SU-152: prepared live/wreck 356x140 sprites and Cocos metadata.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
