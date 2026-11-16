// Installs the approved v17 art. Only lossless 270-degree rotation is applied.
// Cocos uses front-left sprites; source-space pivots use continuous pixel edges.
const fs=require('fs'),path=require('path'),sharp=require('sharp'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../../..'),R=__dirname;
const {chooseParsedRows,decodeTable}=require(path.join(ROOT,'tools/csvSmart'));
const L=JSON.parse(fs.readFileSync(path.join(R,'layout.json')));
const points={
 sherman:{muzzle:[33,39.5],hatch:[45.5,120.5],coax:[40,85],hullMG:[54.5,14]},
 sherman76:{muzzle:[33,4],hatch:[45,126],coax:[46,86],hullMG:[54,14]},
 sherman_jumbo:{muzzle:[33,47],hatch:[45.5,122],coax:[43,84],hullMG:[55,11.5]}
};
const rel=f=>path.relative(ROOT,f).replaceAll('\\','/');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const turn=([x,y],width)=>[y,width-x];
async function syncMeta(png){
 const file=png+'.meta',meta=JSON.parse(fs.readFileSync(file,'utf8')),m=await sharp(png).metadata(),w=m.width,h=m.height;
 const d=Object.values(meta.subMetas).find(s=>s.importer==='sprite-frame').userData;
 Object.assign(d,{width:w,height:h,rawWidth:w,rawHeight:h,trimX:0,trimY:0,offsetX:0,offsetY:0,rotated:false,trimType:'none'});
 d.vertices={rawPosition:[-w/2,-h/2,0,w/2,-h/2,0,-w/2,h/2,0,w/2,h/2,0],indexes:[0,1,2,2,1,3],uv:[0,h,w,h,0,0,w,0],nuv:[0,0,1,0,0,1,1,1],minPos:[-w/2,-h/2,0],maxPos:[w/2,h/2,0]};
 fs.writeFileSync(file,JSON.stringify(meta,null,2)+'\n');
}
function csvLine(row){return row.map(v=>/[",\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v).join(',');}
async function main(){
 const csv=path.join(ROOT,'data/tank_visuals.csv'),db=path.join(ROOT,'assets/scripts/core/TankVisualDB.ts'),old=decodeTable(csv),rows=chooseParsedRows(old.text,['kind']).rows,headers=rows[0].map(s=>s.replace(/^\uFEFF/,''));
 const stamp=new Date().toISOString().replaceAll(/[-:.]/g,'');const backup=path.join(R,'integration-backups',stamp);fs.mkdirSync(backup,{recursive:true});
 const report={approvedByUser:true,rotationDegrees:270,pixelPointConvention:'continuous pixel edge coordinates: (x,y) -> (y,width-x)',backup:rel(backup),files:[],variants:[]};
 // Complete backup of the affected presentation files before any mutation.
 const paths=[csv,db];for(const v of L.variants)for(const suffix of ['top','top_hull','top_turret','top_destroyed']){
  const f=path.join(ROOT,'assets/resources/textures/units',v.kind+'_'+suffix+'.png');paths.push(f,f+'.meta');
 }
 for(const f of paths){const to=path.join(backup,rel(f)+(f.endsWith('.ts')?'.bak':''));fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(f,to);}
 for(const v of L.variants){
  const config=points[v.kind],hp=turn(L.hullPivot,84),tp=turn(L.turretPivot,66),mu=turn(config.muzzle,66),ha=turn(config.hatch,66),co=turn(config.coax,66),hm=turn(config.hullMG,84);
  for(const [role,source]of Object.entries({...v.files,destroyed:'destroyed/'+v.kind+'_top_destroyed.png'})){
   const from=path.join(R,source),to=path.join(ROOT,'assets/resources/textures/units',path.basename(source)),originalMeta=JSON.parse(fs.readFileSync(to+'.meta','utf8'));
   await sharp(from).rotate(270).png().toFile(to);await syncMeta(to);
   const mm=JSON.parse(fs.readFileSync(to+'.meta','utf8'));if(mm.uuid!==originalMeta.uuid)throw Error('UUID changed '+to);
   report.files.push({role,source,asset:rel(to),sha256:sha(to),uuid:mm.uuid});
  }
  const n=rows.findIndex(row=>row[0]===v.kind),row=rows[n];if(n<0)throw Error('Missing kind '+v.kind);
  const values={fitScale:Number((.7*199/158).toFixed(8)),offsetForward:Number((20.5*1.8*.7/(158*Math.sqrt(3))).toFixed(8)),offsetRight:0,aspectRatioMul:1,hullFitScale:.7,turretScale:1,hullOffsetForward:0,hullOffsetRight:0,turretOffsetForward:0,turretOffsetRight:0,topTrimX:0,topTrimY:0,topTrimW:158,topTrimH:84,turretTrimX:0,turretTrimY:0,turretTrimW:160,turretTrimH:66,turretPivotX:hp[0],turretPivotY:hp[1],turretSpritePivotX:tp[0],turretSpritePivotY:tp[1],muzzleSpriteX:mu[0],muzzleSpriteY:mu[1],commanderHatchSpriteX:ha[0],commanderHatchSpriteY:ha[1],commanderHatchScale:14,coaxialMuzzleSpriteX:co[0],coaxialMuzzleSpriteY:co[1],hullMuzzleSpriteX:hm[0],hullMuzzleSpriteY:hm[1],destroyedOffsetForward:0,destroyedOffsetRight:0,destroyedFitScale:1,trackBodyLengthScale:1,trackBodyWidthScale:1,notes:v.label+' approved v17; <=200px; shared black ring; uniform layer scale; hull-only large-damage wreck; front-left runtime rotation'};
  for(const [key,value]of Object.entries(values)){const j=headers.indexOf(key);if(j<0)throw Error('Missing CSV field '+key);row[j]=String(value);}
  report.variants.push({kind:v.kind,hullPivot:hp,turretPivot:tp,muzzle:mu,commanderHatch:ha,coax:co,hullMG:hm,values});
 }
 // Preserve unrelated rows byte-for-byte, including the Chinese description row.
 let contents=fs.readFileSync(csv,'utf8');for(const v of L.variants){const row=rows.find(row=>row[0]===v.kind);const re=new RegExp('^'+v.kind+',[^\\r\\n]*','m');if(!re.test(contents))throw Error('Missing CSV line '+v.kind);contents=contents.replace(re,csvLine(row));}fs.writeFileSync(csv,contents,'utf8');
 fs.writeFileSync(path.join(R,'integration-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({installed:report.files.length,backup:report.backup,variants:report.variants.map(v=>({kind:v.kind,hullPivot:v.hullPivot,turretPivot:v.turretPivot,muzzle:v.muzzle}))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
