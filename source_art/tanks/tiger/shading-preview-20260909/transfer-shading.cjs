const sharp=require('sharp'),path=require('path'),fs=require('fs');
const dir=__dirname;
function map(v,a,b){let k=0;while(k<a.length-2&&v>a[k+1])k++;return b[k]+(v-a[k])/(a[k+1]-a[k])*(b[k+1]-b[k]);}
(async()=>{
 const original=path.join(dir,'../final-20260909/assembled-source.png');
 const src=await sharp(original).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const shade=await sharp(path.join(dir,'shading-study-generated.png')).removeAlpha().blur(8).raw().toBuffer({resolveWithObject:true});
 const base=await sharp(original).flatten({background:'#81929e'}).blur(8).raw().toBuffer({resolveWithObject:true});
 const {width:w,height:h}=src.info,out=Buffer.from(src.data);
 const ax=[67,525,678,940,1270,1415,1778,1877],bx=[30,491,646,915,1250,1393,1768,1869];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const o=(y*w+x)*4;if(!out[o+3])continue;
  const xx=Math.max(0,Math.min(shade.info.width-1,Math.round(map(x,ax,bx))));
  const yy=Math.max(0,Math.min(shade.info.height-1,Math.round(map(y,[15,386,774],[14,392,784]))));
  const q=(yy*shade.info.width+xx)*3,j=(y*w+x)*3;
  const lum=(shade.data[q]+shade.data[q+1]+shade.data[q+2])/3;
  const old=(base.data[j]+base.data[j+1]+base.data[j+2])/3;
  let gain=Math.max(.38,Math.min(1.48,lum/Math.max(35,old)));
  const gray=(src.data[o]+src.data[o+1]+src.data[o+2])/3;
  // Keep original line pixels exactly; apply only a smooth illumination field to armor RGB.
  const ink=Math.max(0,Math.min(1,(gray-35)/40));
  for(let c=0;c<3;c++){
   const paint=(src.data[o+c]*.65+gray*.35)*gain;
   out[o+c]=Math.round(Math.max(0,Math.min(255,src.data[o+c]*(1-ink)+paint*ink)));
  }
 }
 let alphaChanges=0,inkChanges=0;
 for(let o=0;o<out.length;o+=4){if(out[o+3]!==src.data[o+3])alphaChanges++;if((src.data[o]+src.data[o+1]+src.data[o+2])/3<=35&&out.subarray(o,o+3).compare(src.data.subarray(o,o+3)))inkChanges++;}
 if(alphaChanges||inkChanges)throw Error('Geometry/ink changed');
 await sharp(out,{raw:src.info}).png().toFile(path.join(dir,'tiger-shading-preview.png'));
 for(const [name,data] of [['before',src.data],['after',out]])await sharp(data,{raw:src.info}).resize({width:214}).png().toFile(path.join(dir,name+'-small.png'));
 const imgs=await Promise.all(['before','after'].map(name=>sharp(path.join(dir,name+'-small.png')).resize({width:856,kernel:'nearest'}).flatten({background:'#eeeeee'}).png().toBuffer()));
 await sharp({create:{width:856,height:376,channels:3,background:'#eeeeee'}}).composite(imgs.map((input,i)=>({input,left:0,top:i*188}))).png().toFile(path.join(dir,'small-comparison.png'));
 fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify({alphaChanges,inkChanges,sourceCanvas:[w,h],method:'Registered low-frequency lighting field transferred to original RGB. Original alpha and dark line pixels unchanged. Preview only.'},null,2));
 console.log({alphaChanges,inkChanges});
})().catch(e=>{console.error(e);process.exit(1)});
