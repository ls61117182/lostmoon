'use strict';
const path = require('path');
const sharp = require('sharp');
const source = path.resolve(__dirname,'../source_art/tanks/panzer4_f');
async function main() {
  const {data,info} = await sharp(path.join(source,'user-turret-base.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height}=info;
  const outside=new Uint8Array(width*height);
  const queue=[];
  const visit=(x,y)=>{
    const n=y*width+x;
    if(outside[n] || data[n*4]<220 || data[n*4+1]<220 || data[n*4+2]<220) return;
    outside[n]=1;queue.push(n);
  };
  for(let x=0;x<width;x++){visit(x,0);visit(x,height-1);}
  for(let y=0;y<height;y++){visit(0,y);visit(width-1,y);}
  for(let i=0;i<queue.length;i++) {
    const n=queue[i],x=n%width,y=Math.floor(n/width);
    if(x>0) visit(x-1,y);if(x+1<width) visit(x+1,y);
    if(y>0) visit(x,y-1);if(y+1<height) visit(x,y+1);
  }
  // Original detail locations and silhouette remain at original pixel positions.
  // Only exterior white is removed and interior luminance mapped to hull grey.
  const paint=[125,135,143];
  for(let n=0;n<outside.length;n++) {
    const i=n*4;
    if(outside[n]){data.fill(0,i,i+4);continue;}
    const luminance=(data[i]*0.2126+data[i+1]*0.7152+data[i+2]*0.0722)/255;
    for(let c=0;c<3;c++) data[i+c]=Math.round(17+(paint[c]-17)*luminance);
  }
  await sharp(data,{raw:info}).png().toFile(path.join(source,'user-turret-colored.png'));
  // Use ImageGen only for the added gun. None of its replacement turret
  // pixels are used; the user's recolored raster above is the actual body.
  const generated=path.join(source,'gun-position-generated.png');
  // Four measured envelopes from the user's position/thickness sketch.
  // Fit the generated surface detail to each envelope, never fit the whole
  // assembly to a guessed bounding box or move it relative to the turret.
  const sections=[
    {crop:{left:39,top:347,width:361,height:158},left:37,top:217,width:43,height:25},
    {crop:{left:400,top:329,width:700,height:190},left:80,top:212,width:78,height:35},
    {crop:{left:1100,top:156,width:460,height:538},left:158,top:184,width:57,height:94},
    {crop:{left:1560,top:39,width:250,height:770},left:215,top:163,width:35,height:129},
  ];
  const gunLayers=[];
  for(const section of sections) {
    const layer=await sharp(generated).extract(section.crop).resize(section.width,section.height,{fit:'fill'}).modulate({brightness:0.9}).png().toBuffer();
    gunLayers.push({input:layer,left:section.left,top:section.top});
  }
  const body=await sharp(data,{raw:info}).resize(597,447).png().toBuffer();
  await sharp({create:{width:765,height:454,channels:4,background:'#00000000'}})
    .composite([{input:body,left:165,top:2},...gunLayers])
    .png().toFile(path.join(source,'turret-user-composited.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
