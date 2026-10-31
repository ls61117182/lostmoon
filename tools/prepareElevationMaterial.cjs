// Neutral rock detail and independent rubble cutouts for the continuous contour compositor.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
async function rubble(root){
  const source=path.join(root,'source_art/terrain/elevation-v1/rubble-atlas-generated-v5.png');
  const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const stones=[],previews=[],size=48;
  for(let row=0;row<4;row++)for(let col=0;col<4;col++){
    const left=Math.floor(col*info.width/4),top=Math.floor(row*info.height/4),right=Math.floor((col+1)*info.width/4),bottom=Math.floor((row+1)*info.height/4);
    const width=right-left,height=bottom-top,cell=Buffer.alloc(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const at=((top+y)*info.width+left+x)*4,i=(y*width+x)*4;data.copy(cell,i,at,at+4);
      // The generated cutout has a few saturated edge pixels. These are padding artifacts,
      // not stone colour; remove them before resampling alpha so they cannot make halos.
      const r=cell[i],g=cell[i+1],b=cell[i+2];
      if(Math.max(r,g,b)-Math.min(r,g,b)>65||(r>g*1.3&&r>b*1.5)||(r>170&&g>150&&b<90))cell[i+3]=0;
    }
    let minX=width,minY=height,maxX=0,maxY=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(cell[(y*width+x)*4+3]>128){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    const png=await sharp(cell,{raw:{width,height,channels:4}}).extract({left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1})
      .resize(size-4,size-4,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).extend({left:2,right:2,top:2,bottom:2,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    const rgba=await sharp(png).raw().toBuffer(),blur=await sharp(png).removeAlpha().blur(5).raw().toBuffer();
    const support=Array(8).fill(0),normals=Buffer.alloc(size*size*2),heights=Buffer.alloc(size*size),directions=support.map((_,i)=>[Math.cos(i*Math.PI/4),Math.sin(i*Math.PI/4)]);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(rgba[(y*size+x)*4+3]>128)for(let d=0;d<8;d++)support[d]=Math.max(support[d],(x-(size-1)/2)*directions[d][0]+(y-(size-1)/2)*directions[d][1]);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const at=y*size+x;let h=1;
      for(let d=0;d<8;d++)h=Math.min(h,Math.max(0,(1-((x-(size-1)/2)*directions[d][0]+(y-(size-1)/2)*directions[d][1])/Math.max(1,support[d]))*2.5));
      heights[at]=Math.round(h*255);
      // Suppress a large baked brightness gradient while keeping authored cracks and grain.
      for(let c=0;c<3;c++)rgba[at*4+c]=Math.min(255,Math.round(rgba[at*4+c]*(.65+.35*140/Math.max(50,blur[at*3+c]))));
    }
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const sample=(px,py)=>heights[Math.max(0,Math.min(size-1,py))*size+Math.max(0,Math.min(size-1,px))]/255;
      const dx=(sample(x+1,y)-sample(x-1,y))*size*.09,dy=(sample(x,y+1)-sample(x,y-1))*size*.09,len=Math.hypot(dx,dy,1),at=(y*size+x)*2;
      normals[at]=Math.round(128-dx/len*127);normals[at+1]=Math.round(128-dy/len*127);
    }
    stones.push({size,rgba:rgba.toString('base64'),normals:normals.toString('base64')});
    previews.push({input:await sharp(rgba,{raw:{width:size,height:size,channels:4}}).resize(144,144).png().toBuffer(),left:col*160+8,top:row*160+8});
  }
  await sharp({create:{width:640,height:640,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(previews).png().toFile(path.join(root,'source_art/terrain/elevation-v1/rubble-atlas-prepared-v5.png'));
  return stones;
}
async function main(){
  const root=path.resolve(__dirname,'..'),file=path.join(root,'assets/resources/textures/terrain/elevation/continuous-material.json');
  const size=256,pixels=await sharp(path.join(root,'source_art/terrain/elevation-v1/cliff-generated.png')).resize(size,size).removeAlpha().raw().toBuffer();
  const blurred=await sharp(pixels,{raw:{width:size,height:size,channels:3}}).blur(10).raw().toBuffer();
  // Reduce large baked lighting variations; the curved terrain normal supplies directional light.
  for(let i=0;i<pixels.length;i++)pixels[i]=Math.round(Math.min(255,pixels[i]*.8+blurred[i]*.2));
  const stones=await rubble(root);
  fs.writeFileSync(file,JSON.stringify({version:5,rock:{width:size,height:size,rgb:pixels.toString('base64')},stones})+'\n');
  if(!fs.existsSync(file+'.meta'))fs.writeFileSync(file+'.meta',JSON.stringify({ver:'2.0.1',importer:'json',imported:true,uuid:'5bb28daf-97a6-40a5-9b08-c05c17b33057',files:['.json'],subMetas:{},userData:{}},null,2)+'\n');
  console.log('Prepared continuous elevation material.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
