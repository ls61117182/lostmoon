const fs=require('fs'),sharp=require('sharp');
const dir='source_art/tanks/jagdtiger';
(async()=>{
 for(const name of ['top-grey-generated.png','top-grey-destroyed-generated.png']){
  const backup=`${dir}/${name.replace('.png','-before-barrel-clean.png')}`;
  if(!fs.existsSync(backup))fs.copyFileSync(`${dir}/${name}`,backup);
  const {data,info}=await sharp(backup).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<info.height;y++)for(let x=0;x<760;x++){
   const p=(y*info.width+x)*4;
   const exposed=x<540||(x<565&&y>=340&&y<=445);
   if(exposed&&(x<25||y<371||y>414)){data.fill(0,p,p+4);continue;}
   if(y<371||y>414)continue;
   // Preserve the original barrel shading across its full length. No generated
   // replacement segment: only neutralize fringe colors and darken the outline.
   let gray=Math.round((data[p]+data[p+1]+data[p+2])/3);
   if(y<=375||y>=410)gray=Math.min(gray,20);
   data[p]=gray;data[p+1]=gray;data[p+2]=gray;
   if(data[p+3]<=4)data.fill(0,p,p+4);
  }
  await sharp(data,{raw:info}).png().toFile(`${dir}/${name}`);
 }
 for(const [name,suffix]of [['top-grey-generated.png','top'],['top-grey-destroyed-generated.png','top_destroyed']]){
  const {data,info}=await sharp(`${dir}/${name}`).resize(220,80).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // Resampling can amplify RGB in nearly transparent pixels. Neutralize the
  // entire exposed barrel including its filter footprint after downsampling.
  for(let y=0;y<80;y++)for(let x=0;x<81;x++){
   if(x<62&&y>=45&&y<=47){data.fill(0,(y*220+x)*4,(y*220+x)*4+4);continue;}
   if(x>=57&&(y<38||y>45))continue;
   const p=(y*220+x)*4;
   if(data[p+3]<=4){data.fill(0,p,p+4);continue;}
   const gray=Math.round((data[p]+data[p+1]+data[p+2])/3);
   data[p]=gray;data[p+1]=gray;data[p+2]=gray;
  }
  await sharp(data,{raw:info}).png().toFile(`assets/resources/textures/units/jagdtiger_${suffix}.png`);
 }
 const inputs=await Promise.all(['top','top_destroyed'].map(s=>sharp(`assets/resources/textures/units/jagdtiger_${s}.png`).toBuffer()));
 await sharp({create:{width:460,height:100,channels:4,background:'#303940'}}).composite(inputs.map((input,i)=>({input,left:5+i*230,top:10}))).png().toFile(`${dir}/game-size-preview.png`);
 await sharp(`${dir}/game-size-preview.png`).resize(1380,300,{kernel:'nearest'}).toFile(`${dir}/game-size-preview-3x.png`);
})();
