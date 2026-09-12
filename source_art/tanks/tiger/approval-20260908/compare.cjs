const sharp=require('sharp');
const fs=require('fs');
const path=require('path');
async function main(){
 const dir=__dirname,W=820,H=340;
 const ref=await sharp('C:/Temp/codex-clipboard-546dc694-e0e8-4bc3-b485-b3ffc1748efa.png').extract({left:0,top:370,width:W,height:H}).ensureAlpha().raw().toBuffer();
 // Two corresponding longitudinal deck edges: reference x300,744; art x550,1530.
 // Gun axis: reference y534, art y470. Uniform scale only; no warping.
 const scale=444/980,dx=300-550*scale,dy=534-470*scale-370;
 const artRes=await sharp(path.join(dir,'tiger-normal-preview-v4-corners-exhaust.png')).resize({width:Math.round(1689*scale)}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const art=Buffer.alloc(W*H*4,255),red=Buffer.alloc(W*H*4),over=Buffer.alloc(W*H*4);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const o=(y*W+x)*4,sx=x-Math.round(dx),sy=y-Math.round(dy);
  if(sx>=0&&sy>=0&&sx<artRes.info.width&&sy<artRes.info.height)artRes.data.copy(art,o,(sy*artRes.info.width+sx)*4,(sy*artRes.info.width+sx)*4+4);
  const lum=(ref[o]+ref[o+1]+ref[o+2])/3,a=Math.max(0,Math.min(1,(240-lum)/205));
  red[o]=225;red[o+1]=30;red[o+2]=65;red[o+3]=Math.round(a*230);
  for(let c=0;c<3;c++){const base=art[o+c]*0.58+255*.42;over[o+c]=Math.round(base*(1-a*.85)+red[o+c]*a*.85)}over[o+3]=255;
 }
 const enc=b=>sharp(b,{raw:{width:W,height:H,channels:4}}).png().toBuffer();
 const [r,a,o,refP]=await Promise.all([enc(red),enc(art),enc(over),enc(ref)]);
 fs.writeFileSync(path.join(dir,'comparison-overlay.png'),o);
 fs.writeFileSync(path.join(dir,'comparison-reference.png'),refP);
 fs.writeFileSync(path.join(dir,'comparison-aligned-art.png'),a);
 let html=fs.readFileSync(path.join(dir,'comparison-template.html'),'utf8');
 html=html.replace('REF_DATA',r.toString('base64')).replace('ART_DATA',a.toString('base64'));
 fs.writeFileSync('C:/Users/Administrator/.codex/visualizations/2026/09/08/01a080f0-6d5a-7042-ae40-b77e02f90513/tiger-overlay.html',html);
 fs.writeFileSync(path.join(dir,'comparison-alignment.json'),JSON.stringify({scale,dx,dy,cropTop:370,referenceAnchors:[[300,534],[744,534]],artAnchors:[[550,470],[1530,470]],method:'Manual corresponding deck-edge anchors; uniform scaling and translation only; estimates, not CAD measurements'},null,2));
 console.log({scale,dx,dy,htmlBytes:Buffer.byteLength(html)});
}
main().catch(e=>{console.error(e);process.exit(1)});
