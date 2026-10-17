const path = require('path');
const sharp = require('sharp');
async function main() {
  const [base, edit] = await Promise.all([
    sharp(path.join(__dirname, 'destroyed-generated-v2.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true}),
    sharp(path.join(__dirname, 'destroyed-wheel-flat-v3-generated.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  ]);
  if(base.info.width !== edit.info.width || base.info.height !== edit.info.height) throw new Error('Canvas dimensions changed');
  const region = {left:275,top:805,width:350,height:250};
  // Uniform scaling keeps the generated round wheel round and inside the existing canvas footprint.
  const wheel = await sharp(path.join(__dirname, 'destroyed-wheel-flat-v3-generated.png'))
    .extract({left:300,top:810,width:280,height:280}).resize(238,238).png().toBuffer();
  const patch = await sharp({create:{width:region.width,height:region.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite([{input:wheel,left:46,top:10}]).ensureAlpha().raw().toBuffer();
  const original = Buffer.from(base.data);
  for(let y=region.top;y<region.top+region.height;y++) {
    const from=(y*base.info.width+region.left)*4;
    const patchFrom=(y-region.top)*region.width*4;
    patch.copy(base.data,from,patchFrom,patchFrom+region.width*4);
  }
  let changedInside=0, changedOutside=0;
  for(let y=0;y<base.info.height;y++) for(let x=0;x<base.info.width;x++) {
    const offset=(y*base.info.width+x)*4;
    if(!base.data.subarray(offset,offset+4).equals(original.subarray(offset,offset+4))) {
      if(x>=region.left&&x<region.left+region.width&&y>=region.top&&y<region.top+region.height)changedInside++;
      else changedOutside++;
    }
  }
  if(changedOutside) throw new Error('Pixels outside wheel region changed');
  await sharp(base.data,{raw:{width:base.info.width,height:base.info.height,channels:4}}).png().toFile(path.join(__dirname,'destroyed-generated-v3.png'));
  require('fs').writeFileSync(path.join(__dirname,'wheel-edit-audit-v3.json'),JSON.stringify({region,changedInside,changedOutside},null,2)+'\n');
  console.log({region,changedInside,changedOutside});
}
main().catch(e=>{console.error(e);process.exitCode=1;});
