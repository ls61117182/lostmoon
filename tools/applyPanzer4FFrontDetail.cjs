'use strict';
const path=require('path');
const sharp=require('sharp');
const source=path.resolve(__dirname,'../source_art/tanks/panzer4_f');
async function main(){
  const original=await sharp(path.join(source,'turret-before-detail.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const edit=await sharp(path.join(source,'front-detail-generated.png')).resize(765,454).modulate({brightness:0.92}).ensureAlpha().raw().toBuffer();
  // Only the approved gun and forward socket are replaced. Preserve the
  // user's original turret raster elsewhere, including all roof fittings.
  for(let y=135;y<330;y++) for(let x=0;x<285;x++){
    const i=(y*765+x)*4;
    // Blend the seam inside the flat roof, away from the gun silhouette.
    const weight=x<=270?1:(285-x)/15;
    for(let c=0;c<4;c++) original.data[i+c]=Math.round(edit[i+c]*weight+original.data[i+c]*(1-weight));
  }
  await sharp(original.data,{raw:original.info}).png().toFile(path.join(source,'turret-user-composited.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
