// Register generated Jumbo paint to the existing shared hull/turret geometry.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chooseParsedRows, decodeTable } = require('./csvSmart');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'source_art/tanks/sherman_jumbo/simplified');
function bounds(data, width, height) {
  let l=width,t=height,r=-1,b=-1;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) if(data[(y*width+x)*4+3]>=32) {
    l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);
  }
  if(r<l) throw Error('Empty foreground');
  return {left:l,top:t,width:r-l+1,height:b-t+1};
}
async function register(role) {
  const old=await sharp(path.join(dir,role==='turret'?'before-top_turret.png':'before-top_hull.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const target=bounds(old.data,old.info.width,old.info.height);
  const gen=await sharp(path.join(dir,`${role}-generated.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<gen.data.length;i+=4) if(gen.data[i+1]>gen.data[i]+35 && gen.data[i+1]>gen.data[i+2]+35) gen.data.fill(0,i,i+4);
  const box=bounds(gen.data,gen.info.width,gen.info.height);
  const paint=await sharp(gen.data,{raw:gen.info}).extract(box).resize(target.width,target.height,{fit:'fill'}).raw().toBuffer();
  // Extend foreground colors across antialiased boundary gaps before applying
  // the approved alpha silhouette. No old photographic texture is retained.
  const queue=[],seen=new Uint8Array(target.width*target.height);
  for(let i=0;i<seen.length;i++) if(paint[i*4+3]>100){seen[i]=1;queue.push(i);}
  for(let q=0;q<queue.length;q++) {
    const p=queue[q],x=p%target.width,y=Math.floor(p/target.width);
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const xx=x+dx,yy=y+dy,n=yy*target.width+xx;
      if(xx<0||yy<0||xx>=target.width||yy>=target.height||seen[n]) continue;
      paint.copy(paint,n*4,p*4,p*4+3);seen[n]=1;queue.push(n);
    }
  }
  const out=Buffer.alloc(old.data.length);
  for(let y=0;y<old.info.height;y++) for(let x=0;x<old.info.width;x++) {
    const o=(y*old.info.width+x)*4;out[o+3]=old.data[o+3];if(!out[o+3])continue;
    const xx=Math.max(0,Math.min(target.width-1,x-target.left)),yy=Math.max(0,Math.min(target.height-1,y-target.top));
    paint.copy(out,o,(yy*target.width+xx)*4,(yy*target.width+xx)*4+3);
  }
  await sharp(out,{raw:old.info}).png().toFile(path.join(dir,`${role}-source.png`));
  return {box:target,width:old.info.width,height:old.info.height};
}
(async()=>{
  const hull=await register('hull'),turret=await register('turret');await register('destroyed');
  const rows=chooseParsedRows(decodeTable(path.join(dir,'before-tank_visuals.csv')).text,[]).rows;
  const row=rows.find(r=>r[0]==='sherman_jumbo'),n=k=>Number(row[rows[0].indexOf(k)]);
  const padding=v=>[v.box.left,v.box.top,v.width-v.box.left-v.box.width,v.height-v.box.top-v.box.height];
  const manifest={ $schema:'./tank-art-manifest.schema.json',schemaVersion:1,kind:'sherman_jumbo',
    notes:'Jumbo simplified olive drab redraw; existing common geometry and silhouette retained; localized coarse wreck damage. See source_art/tanks/sherman_jumbo/simplified/README.md.',
    inputs:Object.fromEntries(['hull','turret','destroyed'].map(role=>[role,{path:`source_art/tanks/sherman_jumbo/simplified/${role}-source.png`,background:'alpha'}])),
    processing:{alphaThreshold:32,commonScale:1,outlinePixels:0,hullPadding:padding(hull),turretPadding:padding(turret)},
    sourceGeometry:{hullPivot:[n('turretPivotX'),n('turretPivotY')],turretPivot:[n('turretSpritePivotX'),n('turretSpritePivotY')],muzzle:[n('muzzleSpriteX'),n('muzzleSpriteY')],commanderHatch:[n('commanderHatchSpriteX'),n('commanderHatchSpriteY')]}};
  fs.writeFileSync(path.join(root,'data/tank_art/sherman_jumbo.json'),JSON.stringify(manifest,null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
