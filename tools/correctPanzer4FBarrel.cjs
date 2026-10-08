'use strict';
const path = require('path');
const sharp = require('sharp');
const source = path.resolve(__dirname,'../source_art/tanks/panzer4_f');
async function main() {
  const {data,info} = await sharp(path.join(source,'turret-before-barrel-correction.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // Preserve every original pixel at and behind the mantlet. The ImageGen
  // correction supplies only the barrel; fit its tip to the reference length.
  for(let y=0;y<info.height;y++) for(let x=0;x<540;x++) data.fill(0,(y*info.width+x)*4,(y*info.width+x)*4+4);
  const barrel = await sharp(path.join(source,'barrel-correction-generated.png')).extract({left:218,top:0,width:322,height:890}).resize(240,890,{fit:'fill'}).ensureAlpha().raw().toBuffer();
  for(let y=0;y<info.height;y++) barrel.copy(data,(y*info.width+300)*4,y*240*4,(y+1)*240*4);
  await sharp(data,{raw:info}).png().toFile(path.join(source,'turret-generated.png'));
  const before=await sharp(path.join(source,'turret-before-barrel-correction.png')).extract({left:540,top:0,width:1227,height:890}).raw().toBuffer();
  const after=await sharp(path.join(source,'turret-generated.png')).extract({left:540,top:0,width:1227,height:890}).raw().toBuffer();
  if(!before.equals(after)) throw Error('Turret body pixels changed');
  console.log('Turret body preserved exactly; barrel span 300..540 (was 107..540).');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
