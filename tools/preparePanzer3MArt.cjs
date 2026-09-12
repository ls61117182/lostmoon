// Remove chroma and undo extraction zoom using the common assembled source.
// This processes generated art; it does not draw replacement tank geometry.
const fs = require('fs');
const sharp = require('sharp');
const dir = 'source_art/tanks/panzer3_m';
async function clean(file) {
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4) {
    const r=data[i],g=data[i+1],b=data[i+2];
    if(g>r+55 && g>b+65) data.fill(0,i,i+4);
    else if(g>r+20 && g>b+30) data[i+1]=Math.max(r,b);
  }
  return sharp(data,{raw:info}).png().toBuffer();
}
(async()=>{
  const hull=await clean(`${dir}/hull-faithful-generated.png`);
  await sharp(hull).toFile(`${dir}/hull-selected.png`);
  // Extraction enlarged the turret. A single uniform transform restores its
  // original muzzle and surrounding armor bounds; never fit layers separately.
  const turret=await sharp(await clean(`${dir}/turret-faithful-generated.png`))
    .resize({width:1615}).png().toBuffer();
  await sharp({create:{width:1746,height:901,channels:4,background:'#00000000'}})
    .composite([{input:turret,left:2,top:48}]).png().toFile(`${dir}/turret-selected.png`);
  if(fs.existsSync(`${dir}/destroyed-faithful-generated.png`)) {
    await sharp(await clean(`${dir}/destroyed-faithful-generated.png`))
      .resize(1746,901,{fit:'fill'}).png().toFile(`${dir}/destroyed-selected.png`);
  }
  const manifest={
    $schema:'./tank-art-manifest.schema.json',schemaVersion:1,kind:'panzer3_m',
    notes:'Independent Ausf M. User overhead view is geometry authority. Common assembled source; extraction zoom corrected uniformly; no old Panzer III art reused.',
    inputs:Object.fromEntries(['hull','turret','destroyed'].map(role=>[role,{path:`${dir}/${role}-selected.png`,background:'alpha'}])),
    processing:{alphaThreshold:32,commonScale:0.1,outlinePixels:0,hullPadding:[1,1,1,1],turretPadding:[1,1,1,1]},
    sourceGeometry:{hullPivot:[944,469],turretPivot:[944,469],muzzle:[27,469],commanderHatch:[1049,469]}
  };
  fs.writeFileSync('data/tank_art/panzer3_m.json',JSON.stringify(manifest,null,2)+'\n');
  await sharp(hull).composite([{input:`${dir}/turret-selected.png`}]).png().toFile(`${dir}/assembled-source.png`);
})().catch(e=>{console.error(e);process.exitCode=1;});
