const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp'),crypto=require('node:crypto');
const {ROOT,SOURCE,OUT,SIZE,COUPLER,modules,weapons,filename,alphaBounds}=require('./prepareArmoredTrainArt.cjs');
const manifest=JSON.parse(fs.readFileSync(path.join(OUT,'bp44_art_manifest.json'),'utf8'));
const resource=p=>path.join(ROOT,'assets/resources',p.replace('/spriteFrame','.png'));
async function raw(file){return sharp(file).ensureAlpha().raw().toBuffer();}
function nearAlpha(data,x,y,r=5){for(let yy=Math.max(0,Math.round(y-r));yy<=Math.min(SIZE-1,Math.round(y+r));yy++)for(let xx=Math.max(0,Math.round(x-r));xx<=Math.min(SIZE-1,Math.round(x+r));xx++)if(data[(yy*SIZE+xx)*4+3]>100)return true;return false;}
async function main(){
  assert.equal(manifest.modules.length,6);assert.equal(manifest.weapons.length,3);assert.equal(manifest.footprintLength,1);assert.equal(manifest.scope,'art-only');
  assert.equal(manifest.schemaVersion,2);
  assert.equal(manifest.pixelDensity,2);assert.equal(manifest.railGaugePixels,44);
  const listed=manifest.modules.flatMap(m=>[m.body,m.destroyed]).concat(manifest.weapons.map(w=>w.sprite));
  const pngs=fs.readdirSync(OUT).filter(n=>n.endsWith('.png'));assert.equal(pngs.length,15);assert.equal(new Set(listed).size,15);
  const ids=new Set(),report={status:'passed',corePngCount:15,modules:[],weapons:[],files:[]};
  for(const p of listed){
    const file=resource(p),info=await sharp(file).metadata(),data=await raw(file),meta=JSON.parse(fs.readFileSync(file+'.meta','utf8'));
    assert.equal(info.width,SIZE);assert.equal(info.height,SIZE);assert.equal(info.hasAlpha,true);
    for(const [x,y]of[[0,0],[SIZE-1,0],[0,SIZE-1],[SIZE-1,SIZE-1]])assert.equal(data[(y*SIZE+x)*4+3],0);
    assert.ok(data.some((v,i)=>i%4===3&&v===255));
    assert.equal(ids.has(meta.uuid),false);ids.add(meta.uuid);
    const f=meta.subMetas.f9941.userData;
    assert.equal(f.width,SIZE);assert.equal(f.height,SIZE);assert.equal(f.rawWidth,SIZE);assert.equal(f.rawHeight,SIZE);
    assert.equal(f.trimType,'none');assert.equal(f.packable,false);assert.equal(f.pivotX,.5);assert.equal(f.pivotY,.5);
    assert.deepEqual(f.vertices.minPos,[-256,-256,0]);assert.deepEqual(f.vertices.maxPos,[256,256,0]);assert.deepEqual(f.vertices.uv,[0,512,512,512,0,0,512,0]);
    report.files.push({path:path.relative(ROOT,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  }
  const registration=JSON.parse(fs.readFileSync(path.join(SOURCE,'registration.json'),'utf8'));
  for(const m of manifest.modules){
    const normal=await raw(resource(m.body)),destroyed=await raw(resource(m.destroyed));
    const a=await alphaBounds(resource(m.body)),b=await alphaBounds(resource(m.destroyed));
    assert.ok(Math.abs(a.height-COUPLER*4)<3);assert.ok(a.width<190);
    assert.ok(Math.abs(a.height-b.height)<12,`${m.id}: wreck height drift`);
    assert.ok(Math.abs((a.top+a.height/2)-(b.top+b.height/2))<7,`${m.id}: wreck position drift`);
    for(const anchor of[m.frontCoupler,m.rearCoupler]){assert.ok(nearAlpha(normal,anchor.x,anchor.y),`${m.id}: normal coupler misaligned`);assert.ok(nearAlpha(destroyed,anchor.x,anchor.y,7),`${m.id}: wreck coupler misaligned`);}
    assert.ok(registration.destroyed[m.id].silhouetteIoU>.9);
    const layers=[];
    const slots=new Set();
    for(const slot of m.weapons){assert.equal(slot.rotationMode,'independent');assert.ok(slot.slotId&&!slots.has(slot.slotId));slots.add(slot.slotId);const w=manifest.weapons.find(w=>w.id===slot.id);assert.ok(w);assert.ok(nearAlpha(normal,slot.pivot.x,slot.pivot.y));const input=await sharp(resource(w.sprite)).rotate(slot.initialAngleDegrees,{background:'#00000000'}).png().toBuffer();layers.push({input,left:Math.round(slot.pivot.x-SIZE/2),top:Math.round(slot.pivot.y-SIZE/2)});}
    const actual=await sharp(resource(m.body)).composite(layers).ensureAlpha().raw().toBuffer();
    assert.ok(actual.equals(await raw(path.join(SOURCE,'assembled',m.id+'_normal.png'))),`${m.id}: layered assembly differs from preview`);
    let diff=0;for(let i=0;i<actual.length;i+=4)if(actual[i+3]>220&&destroyed[i+3]>220)diff+=Math.abs(actual[i]-destroyed[i])+Math.abs(actual[i+1]-destroyed[i+1])+Math.abs(actual[i+2]-destroyed[i+2]);
    assert.ok(diff>100000,`${m.id}: wreck needs visible structural damage`);
    report.modules.push({id:m.id,weaponCount:m.weapons.length,independentSlots:m.weapons.map(s=>s.slotId),normalBounds:a,destroyedBounds:b,wreckSilhouetteIoU:registration.destroyed[m.id].silhouetteIoU});
  }
  assert.deepEqual(manifest.modules.map(m=>m.weapons.length),[0,0,0,1,2,1]);
  for(const w of manifest.weapons){const data=await raw(resource(w.sprite));assert.ok(nearAlpha(data,w.pivot.x,w.pivot.y));assert.equal(w.muzzles.length,w.id==='flakvierling'?4:1);for(const p of w.muzzles)assert.ok(nearAlpha(data,p.x,p.y,2));assert.ok(registration.weapons[w.id].silhouetteIoU>.75);report.weapons.push({id:w.id,muzzles:w.muzzles,pivot:w.pivot,silhouetteIoU:registration.weapons[w.id].silhouetteIoU});}
  fs.writeFileSync(path.join(SOURCE,'validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,corePngCount:report.corePngCount,moduleCount:report.modules.length,weaponCount:report.weapons.length,checks:'alpha, canvas, Cocos metadata, UUIDs, couplers, independent weapon slots, layers, muzzle tips, wreck registration and damage'}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
