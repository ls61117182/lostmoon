const fs=require('fs'),path=require('path'),crypto=require('crypto'),sharp=require('sharp');
const source='source_art/terrain/prefab-transitions-v1',target='source_art/terrain/retired-runtime-transitions/textures';
const digest=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function feather(raw){for(let y=0;y<194;y++)for(let x=0;x<170;x++){
 const gx=-42+(x-.5)/2,gy=-48+(y-.5)/2;let edge=-Infinity;
 for(let i=0;i<6;i++)edge=Math.max(edge,gx*Math.cos(i*Math.PI/3)+gy*Math.sin(i*Math.PI/3)-Math.sqrt(3)*24);
 const t=Math.max(0,Math.min(1,-edge/10));raw[(y*170+x)*4+3]=Math.round(raw[(y*170+x)*4+3]*t*t*(3-2*t));
}return raw;}
function animated(raw){for(let i=0;i<raw.length;i+=4)if(raw[i])return true;return false;}
async function main(){
 const original=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
 if(digest(fs.readFileSync('assets/resources/textures/terrain/redesign_v3/materials.json'))!==original.sourceSha256)throw Error('Transition artwork is stale; rebuild before installing.');
 fs.mkdirSync(target,{recursive:true});
 const manifest={...original,version:2,resources:{},entries:[]},seen=new Map(),keep=new Set();
 let oldBytes=0,oldCount=0;function inventory(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())inventory(f);else if(f.endsWith('.png')){oldBytes+=fs.statSync(f).size;oldCount++;}}}inventory(target);
 const template=JSON.parse(fs.readFileSync('assets/resources/textures/terrain/terrain_field.png.meta'));
 async function install(relative,kind){
  if(!relative)return null;
  const raw=await sharp(path.join(source,relative)).ensureAlpha().raw().toBuffer();
  if(kind==='mask'&&!animated(raw))return null;
  if(kind==='color')feather(raw);
  const hash=digest(raw),key=kind+':'+hash;
  if(seen.has(key))return seen.get(key);
  seen.set(key,relative);keep.add(relative);manifest.resources[relative]={kind,width:170,height:194,pixelSha256:hash};
  const dest=path.join(target,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});
  // Preserve identical files and their UUIDs, avoiding needless editor reimports.
  let equal=false;if(fs.existsSync(dest))equal=(await sharp(dest).ensureAlpha().raw().toBuffer()).equals(raw);
  if(!equal)await sharp(raw,{raw:{width:170,height:194,channels:4}}).png().toFile(dest);
  if(!fs.existsSync(dest+'.meta')){
   const meta=JSON.parse(JSON.stringify(template)),uuid=crypto.randomUUID();meta.uuid=uuid;
   for(const [id,sub]of Object.entries(meta.subMetas)){sub.uuid=uuid+'@'+id;sub.displayName=path.basename(relative,'.png');if(id==='6c48a')sub.userData.imageUuidOrDatabaseUri=uuid;else{
    Object.assign(sub.userData,{trimX:0,trimY:0,width:170,height:194,rawWidth:170,rawHeight:194,offsetX:0,offsetY:0,packable:false,imageUuidOrDatabaseUri:uuid+'@6c48a'});delete sub.userData.vertices;
   }}meta.userData.redirect=uuid+'@6c48a';fs.writeFileSync(dest+'.meta',JSON.stringify(meta,null,2)+'\n');
  }
  return relative;
 }
 for(const entry of original.entries)manifest.entries.push({...entry,color:await install(entry.color,'color'),waterMask:await install(entry.waterMask,'mask')});
 fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest)+'\n');
 // Remove only obsolete generated PNGs and their import metadata within target.
 const absoluteTarget=path.resolve(target);
 function prune(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.resolve(dir,e.name);if(!f.startsWith(absoluteTarget+path.sep))throw Error('Cleanup escaped target');if(e.isDirectory())prune(f);else if(f.endsWith('.png')&&!keep.has(path.relative(absoluteTarget,f).split(path.sep).join('/'))){fs.unlinkSync(f);if(fs.existsSync(f+'.meta'))fs.unlinkSync(f+'.meta');}}}
 prune(target);
 let newBytes=0;for(const relative of keep)newBytes+=fs.statSync(path.join(target,relative)).size;
 console.log(JSON.stringify({combinations:manifest.entries.length,beforeImages:oldCount,afterImages:keep.size,colorImages:Object.values(manifest.resources).filter(r=>r.kind==='color').length,maskImages:Object.values(manifest.resources).filter(r=>r.kind==='mask').length,omittedMaskReferences:original.entries.filter((e,i)=>e.waterMask&&!manifest.entries[i].waterMask).length,beforeBytes:oldBytes,afterBytes:newBytes},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={feather,animated,digest};
