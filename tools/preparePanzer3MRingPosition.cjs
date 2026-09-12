// Local integration of image-tool deck repairs; translate the original ring
// pixels without rotation or rescaling. All pixels outside the edit masks stay original.
const fs=require('fs'), sharp=require('sharp'), assert=require('assert');
const dir='source_art/tanks/panzer3_m', out=`${dir}/ring-position`;
// Keep the approved longitudinal x; y=450 is the midpoint of the hull's side rails.
const oldCenter=[1002,442], newCenter=[910,450];
const shift=[newCenter[0]-oldCenter[0],newCenter[1]-oldCenter[1]];
const clamp=x=>Math.max(0,Math.min(1,x));
async function prepare(role){
 const src=await sharp(`${dir}/grey/${role}-selected.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const repair=await sharp(`${out}/${role}-generated.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(src.info.width,repair.info.width);assert.equal(src.info.height,repair.info.height);
 const {width:w,height:h}=src.info,result=Buffer.from(src.data);
 const radius=role==='hull'?198:245,fade=role==='hull'?6:14;
 let changed=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const oldWeight=clamp((radius-Math.hypot(x-oldCenter[0],y-oldCenter[1]))/fade);
  const newWeight=clamp((radius-Math.hypot(x-newCenter[0],y-newCenter[1]))/fade);
  if(oldWeight===0&&newWeight===0)continue;
  // Image tool repaired the vacated deck. Sample only its plain deck, avoiding
  // its incorrectly positioned ring and all mechanical details.
  const rx=Math.round(1050+(x-oldCenter[0])*0.25);
  const ri=(y*w+rx)*4;
  const referenceIndex=(y*w+(role==='hull'?1215:650))*4;
  const repairReference=(y*w+1100)*4;
  for(let c=0;c<3;c++){
   const deck=Math.max(0,Math.min(255,src.data[referenceIndex+c]+(repair.data[ri+c]-repair.data[repairReference+c])*0.2));
   result[i+c]=Math.round(src.data[i+c]*(1-oldWeight)+deck*oldWeight);
  }
  if(newWeight>0){
   const sx=x-shift[0],sy=y-shift[1],si=(sy*w+sx)*4;
   for(let c=0;c<3;c++)result[i+c]=Math.round(result[i+c]*(1-newWeight)+src.data[si+c]*newWeight);
  }
  if(result[i]!==src.data[i]||result[i+1]!==src.data[i+1]||result[i+2]!==src.data[i+2])changed++;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;assert.equal(result[i+3],src.data[i+3]);
  if(Math.hypot(x-oldCenter[0],y-oldCenter[1])>=radius&&Math.hypot(x-newCenter[0],y-newCenter[1])>=radius)
   for(let c=0;c<4;c++)assert.equal(result[i+c],src.data[i+c]);
 }
 await sharp(result,{raw:src.info}).png().toFile(`${out}/${role}-selected.png`);
 console.log(`${role}: moved original ring ${shift}; ${changed} local pixels changed; outside masks and alpha identical`);
}
(async()=>{
 await prepare('hull');await prepare('destroyed');
 const manifest=JSON.parse(fs.readFileSync(`${out}/before-manifest.json`,'utf8'));
 // Preserve user-tuned runtime coordinates from the pre-edit CSV (60,44 and 110,33).
 manifest.sourceGeometry.hullPivot=[854,441];
 manifest.sourceGeometry.commanderHatch=[1117,469];
 for(const role of ['hull','destroyed'])manifest.inputs[role].path=`${out}/${role}-selected.png`;
 manifest.notes+=' Ring artwork at source (910,450): approved longitudinal position and laterally centered between side rails; turret and runtime geometry unchanged.';
 fs.writeFileSync('data/tank_art/panzer3_m.json',JSON.stringify(manifest,null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
