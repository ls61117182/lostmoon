'use strict';
const path=require('path');
const sharp=require('sharp');
const source=path.resolve(__dirname,'../source_art/tanks/panzer4_f');
// Trace in the user's markup coordinate system first. Preserve the small
// stepped connector at x174..223 instead of replacing it with a diagonal.
const marked=[[0,240],[112,240],[174,240],[174,238],[184,237],[223,233],[223,228],[248,204],[277,194],[281,186],[295,182],[299,161],[325,148],[326,100],[340,73],[340,-34],[973,-34],[973,535],[345,535],[345,462],[328,420],[326,370],[307,361],[311,358],[300,334],[248,321],[223,295],[223,292],[184,292],[174,288],[112,288],[0,288]];
const factor=0.5973*(1628/765);
const vertices=marked.map(([x,y])=>[(x-9.2)/factor,(y+34)/factor]);
function inside(x,y){let result=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++) {const a=vertices[i],b=vertices[j];if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) result=!result;}return result;}
async function main(){
  const {data,info}=await sharp(path.join(source,'turret-before-front-trim.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    if(!inside(x+.5,y+.5)) data.fill(0,(y*info.width+x)*4,(y*info.width+x)*4+4);
  }
  await sharp(data,{raw:info}).png().toFile(path.join(source,'turret-user-composited.png'));
  // Review the trace at the same scale as the marked reference.
  const upper=marked.slice(1,15).map(([x,y])=>`${x},${y}`).join(' ');
  const lower=marked.slice(20,32).map(([x,y])=>`${x},${y}`).join(' ');
  const overlay=Buffer.from(`<svg width="973" height="535"><polyline points="${upper}" fill="none" stroke="#00caff" stroke-width="1"/><polyline points="${lower}" fill="none" stroke="#00caff" stroke-width="1"/></svg>`);
  const reference=path.join(source,'reference-front-trim.png');
  await sharp(reference).composite([{input:overlay}]).png().toFile(path.join(source,'redline-trace-verification.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
