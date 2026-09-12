// Register image-tool color edits onto the original source alpha and geometry.
const fs = require('fs');
const sharp = require('sharp');
const dir = 'source_art/tanks/panzer3_m';
async function register(role) {
  const original = await sharp(`${dir}/${role}-selected.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const edited = await sharp(`${dir}/grey/${role}-generated.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height} = original.info;
  if(edited.info.width!==width || edited.info.height!==height) throw Error(`${role}: edit changed canvas`);
  const pixels=width*height, seen=new Uint8Array(pixels), queue=new Int32Array(pixels);
  let head=0,tail=0;
  for(let p=0;p<pixels;p++) {
    const i=p*4,r=edited.data[i],g=edited.data[i+1],b=edited.data[i+2];
    if(edited.data[i+3]>200 && !(g>r+35 && g>b+35)) {seen[p]=1;queue[tail++]=p;}
  }
  // Extend foreground colors into chroma fringe before restoring the locked alpha.
  while(head<tail) {
    const p=queue[head++],x=p%width,y=Math.floor(p/width);
    for(const n of [x>0?p-1:-1,x+1<width?p+1:-1,y>0?p-width:-1,y+1<height?p+width:-1]) {
      if(n<0 || seen[n]) continue;
      seen[n]=1;queue[tail++]=n;edited.data.copy(edited.data,n*4,p*4,p*4+3);
    }
  }
  const result=Buffer.from(edited.data);
  for(let i=0;i<result.length;i+=4) {
    result[i+3]=original.data[i+3];
    if(!result[i+3]) {result.fill(0,i,i+4);continue;}
    // Preserve original near-black mechanical outlines and cavity detail.
    if(Math.max(original.data[i],original.data[i+1],original.data[i+2])<38)
      original.data.copy(result,i,i,i+3);
  }
  await sharp(result,{raw:original.info}).png().toFile(`${dir}/grey/${role}-selected.png`);
}
(async()=>{
  for(const role of ['hull','turret','destroyed']) await register(role);
  const manifest=JSON.parse(fs.readFileSync(`${dir}/grey/before-manifest.json`,'utf8'));
  for(const role of ['hull','turret','destroyed']) manifest.inputs[role].path=`${dir}/grey/${role}-selected.png`;
  manifest.notes+=' Color-only German grey repaint; camouflage removed; original source alpha and geometry retained.';
  fs.writeFileSync('data/tank_art/panzer3_m.json',JSON.stringify(manifest,null,2)+'\n');
  await sharp(`${dir}/grey/hull-selected.png`).composite([{input:`${dir}/grey/turret-selected.png`}])
    .png().toFile(`${dir}/grey/assembled-source.png`);
})().catch(e=>{console.error(e);process.exitCode=1;});
