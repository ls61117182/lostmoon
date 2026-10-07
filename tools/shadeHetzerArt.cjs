const fs=require('fs'),path=require('path'),sharp=require('sharp');
const dir='source_art/tanks/jagdpanther';const backup=dir+'/before-volume-20261005';fs.mkdirSync(backup,{recursive:true});
const gen='C:/Users/Administrator/.codex/generated_images/01a0fb4c-6391-7de0-a69e-636c83b3f538/';
const files=['exec-14c9c049-eb51-4aa4-a507-d1f833dc9032.png','exec-155e57b7-507b-4777-b484-74503c8a34ca.png'];
(async()=>{
for(let j=0;j<2;j++){
const suffix=j?'top_destroyed':'top',src=dir+'/'+suffix+'-aligned.png',dst='assets/resources/textures/units/jagdpanther_'+suffix+'.png';
for(const p of [src,dst]){const b=backup+'/'+path.basename(p);if(!fs.existsSync(b))fs.copyFileSync(p,b);}
fs.copyFileSync(gen+files[j],dir+'/'+suffix+'-shaded-generated.png');
const orig=await sharp(backup+'/'+path.basename(src)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const shaded=await sharp(gen+files[j]).resize(orig.info.width,orig.info.height,{fit:'fill'}).ensureAlpha().raw().toBuffer();
const output=Buffer.from(shaded);
for(let i=0;i<output.length;i+=4){output[i+3]=orig.data[i+3];if(Math.max(orig.data[i],orig.data[i+1],orig.data[i+2])<45){for(let c=0;c<3;c++)output[i+c]=orig.data[i+c];}}
await sharp(output,{raw:orig.info}).png().toFile(src);
const crop=JSON.parse(fs.readFileSync(dir+'/geometry.json')).crop;
const old=await sharp(backup+'/'+path.basename(dst)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const fresh=await sharp(src).extract(crop).resize(old.info.width,old.info.height).ensureAlpha().raw().toBuffer();
for(let i=0;i<fresh.length;i+=4){fresh[i+3]=old.data[i+3];if(Math.max(old.data[i],old.data[i+1],old.data[i+2])<40)for(let c=0;c<3;c++)fresh[i+c]=old.data[i+c];}
await sharp(fresh,{raw:old.info}).png().toFile(dst);
console.log(suffix+': retained original alpha and dark outlines; '+old.info.width+'x'+old.info.height);
}
const inputs=await Promise.all(['top','top_destroyed'].map(s=>sharp('assets/resources/textures/units/jagdpanther_'+s+'.png').toBuffer()));
await sharp({create:{width:430,height:102,channels:4,background:'#4b5156'}}).composite(inputs.map((input,i)=>({input,left:5+i*220,top:10}))).png().toFile(dir+'/game-size-preview.png');
await sharp(dir+'/game-size-preview.png').resize(1290,306,{kernel:'nearest'}).toFile(dir+'/game-size-preview-3x.png');
fs.writeFileSync(dir+'/volume-edit-notes.txt','Built-in image_gen color-only edit: upper-left lighting, armor plane values, curved mantlet/barrel highlights, hatch/tool contact shadows, recessed grilles. Original alpha and dark outlines preserved deterministically; existing configuration and metadata unchanged. Photo reference: https://www.moddb.com/groups/tanks/images/hetzer-bovington-hdhq\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
