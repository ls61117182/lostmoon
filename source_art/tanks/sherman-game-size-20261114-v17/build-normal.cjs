const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const R=__dirname,P=path.join(R,'..');
const variants=[['m4a1','sherman','M4A1','sherman-width-tail-20261113-v10'],['m4a1_76_hvss','sherman76','M4A1(76)W HVSS','sherman-width-tail-20261113-v10'],['m4a3e2','sherman_jumbo','M4A3E2 Jumbo','sherman-jumbo-curved-shoulders-20261114-v14']];
const frames={hull:{left:34,top:62,width:84,height:158},turret:{left:43,top:20,width:66,height:160},top:{left:34,top:21,width:84,height:199}};
async function clean(b){const {data,info}=await sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(let i=0;i<data.length;i+=4)if(data[i+3]<=4)data.fill(0,i,i+4);return sharp(data,{raw:info}).png().toBuffer();}
async function main(){
 for(const d of ['normal','destroyed','references','generated','prompts','previews'])fs.mkdirSync(path.join(R,d),{recursive:true});
 const audit={status:'production-size review; not installed',sourceScale:.19,sourceCanvas:[800,1400],scaledCanvas:[152,266],maxTextureSide:200,frames,hullPivot:[42,74.8],turretPivot:[33,116.8],hullLength:152,ringDiameter:44.84,variants:[]};
 for(const [key,kind,label,version]of variants){
  const full={},record={key,kind,label,sourceVersion:version,files:{},sourceHashes:{}};
  for(const part of ['hull','turret']){
   const f=path.join(P,version,'candidates',key+'_'+part+'.png');record.sourceHashes[part]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
   full[part]=await clean(await sharp(f).resize(152,266,{kernel:'lanczos3'}).toBuffer());
   const out=kind+'_top_'+part+'.png';await sharp(await clean(await sharp(full[part]).extract(frames[part]).toBuffer())).toFile(path.join(R,'normal',out));record.files[part]='normal/'+out;
  }
  const assembled=await clean(await sharp(full.hull).composite([{input:full.turret,left:0,top:0}]).toBuffer());
  record.files.top='normal/'+kind+'_top.png';await sharp(assembled).extract(frames.top).toFile(path.join(R,record.files.top));
  fs.copyFileSync(path.join(R,record.files.hull),path.join(R,'references',key+'_final-hull-edit-target.png'));
  audit.variants.push(record);
 }
 fs.writeFileSync(path.join(R,'layout.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
