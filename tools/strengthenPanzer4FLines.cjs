'use strict';
const path=require('path');
const sharp=require('sharp');
const source=path.resolve(__dirname,'../source_art/tanks/panzer4_f');
async function main(){
  // Use the generated line treatment as style guidance, while retaining the
  // approved user's exact geometry and all alpha pixels in the final sprite.
  const {data,info}=await sharp(path.join(source,'turret-user-composited.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const before=Buffer.from(data);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const i=(y*info.width+x)*4;
    if(!before[i+3])continue;
    const lum=before[i]*.2126+before[i+1]*.7152+before[i+2]*.0722;
    const amount=42*Math.max(0,Math.min(1,(125-lum)/25));
    for(let c=0;c<3;c++)data[i+c]=Math.max(18,Math.round(before[i+c]-amount));
    let edge=false;
    for(let dy=-4;dy<=4&&!edge;dy++)for(let dx=-4;dx<=4;dx++){
      if(dx*dx+dy*dy>16)continue;
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=info.width||ny>=info.height||before[(ny*info.width+nx)*4+3]<32){edge=true;break;}
    }
    if(edge){data[i]=Math.min(data[i],30);data[i+1]=Math.min(data[i+1],35);data[i+2]=Math.min(data[i+2],40);}
  }
  for(let i=3;i<data.length;i+=4)if(data[i]!==before[i])throw Error('Alpha changed');
  await sharp(data,{raw:info}).png().toFile(path.join(source,'turret-line-matched.png'));
  console.log('Lines darkened; source dimensions, alpha and pale armor fill retained.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
