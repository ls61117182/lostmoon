'use strict';
const path = require('path');
const sharp = require('sharp');
const source = path.resolve(__dirname,'../source_art/tanks/panzer4_f');
async function main() {
  const corrected = await sharp(path.join(source,'contour-correction-generated.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const previous = await sharp(path.join(source,'turret-before-contour-correction.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(corrected.info.width!==1768 || corrected.info.height!==890) throw Error('Unexpected contour edit canvas');
  // New mantlet sits at x450, y480. Translate the approved barrel by (-90,+10),
  // preserving its dimensions rather than accepting the regenerated long gun.
  for(let y=0;y<corrected.info.height;y++) corrected.data.fill(0,y*corrected.info.width*4,(y*corrected.info.width+450)*4);
  for(let y=0;y<previous.info.height-10;y++) previous.data.copy(corrected.data,((y+10)*corrected.info.width+210)*4,(y*previous.info.width+300)*4,(y*previous.info.width+540)*4);
  await sharp(corrected.data,{raw:corrected.info}).png().toFile(path.join(source,'turret-generated.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
