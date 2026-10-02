const fs=require('fs'),crypto=require('crypto'),sharp=require('sharp');
const {chooseParsedRows,decodeTable,rowsToCsv}=require('./csvSmart');
const source='source_art/tanks/jagdtiger';
function add(file,base,key,edits){const rows=chooseParsedRows(decodeTable(file).text,[]).rows;let row=rows.find(r=>r[0]===key);if(!row){row=[...rows.find(r=>r[0]===base)];rows.push(row);}for(const [k,v]of Object.entries(edits)){const i=rows[0].indexOf(k);if(i<0)throw Error('Missing column '+k);row[i]=String(v);}fs.writeFileSync(file,'\ufeff'+rowsToCsv(rows));}
(async()=>{
 const width=220,height=80;
 for(const [input,suffix]of [['top-grey-generated.png','top'],['top-grey-destroyed-generated.png','top_destroyed']]){
  const dest=`assets/resources/textures/units/jagdtiger_${suffix}.png`;
  const m=await sharp(`${source}/${input}`).metadata();if(m.width!==2079||m.height!==756)throw Error('Source must share 2079x756 canvas');
  await sharp(`${source}/${input}`).resize(width,height).png().toFile(dest);
  const original=fs.readFileSync('assets/resources/textures/units/stug3_top.png.meta','utf8'),old=JSON.parse(original).uuid;
  const uuid=fs.existsSync(dest+'.meta')?JSON.parse(fs.readFileSync(dest+'.meta','utf8')).uuid:crypto.randomUUID();
  const meta=JSON.parse(original.replaceAll(old,uuid).replaceAll('stug3_top',`jagdtiger_${suffix}`));const u=meta.subMetas.f9941.userData;
  Object.assign(u,{width,height,rawWidth:width,rawHeight:height,trimX:0,trimY:0,offsetX:0,offsetY:0});
  u.vertices={rawPosition:[-110,-40,0,110,-40,0,-110,40,0,110,40,0],indexes:[0,1,2,2,1,3],uv:[0,80,220,80,0,0,220,0],nuv:[0,0,1,0,0,1,1,1],minPos:[-110,-40,0],maxPos:[110,40,0]};fs.writeFileSync(dest+'.meta',JSON.stringify(meta,null,2)+'\n');
 }
 add('data/tank_visuals.csv','stug3','jagdtiger',{kind:'jagdtiger',displayName:'Jagdtiger',topSpritePath:'textures/units/jagdtiger_top/spriteFrame',destroyedSpritePath:'textures/units/jagdtiger_top_destroyed/spriteFrame',fitScale:1.12,offsetForward:0.16,topTrimW:220,topTrimH:80,muzzleSpriteX:3,muzzleSpriteY:41,commanderHatchSpriteX:131,commanderHatchSpriteY:35,commanderHatchScale:20,destroyedOffsetForward:0,destroyedOffsetRight:0,destroyedFitScale:1,trackBodyLengthScale:0.70,exhaustPort1Forward:-0.37,exhaustPort1Right:0.08,exhaustPort2Forward:-0.37,exhaustPort2Right:-0.08,notes:'German gray Jagdtiger; fixed 128mm gun; identical normal/wreck source canvas and scale; hull roof breach and damaged engine deck'});
 add('data/units.csv','tigerking','jagdtiger',{unitKind:'jagdtiger',displayName:'猎虎坦克歼击车',visionType:'fixed',turretTraverseSpeed:0,penetration:9,highExplosivePower:5,firepower:2,mobility:1,crewMembers:'1|2|3|4|5|6',crewRoleAssignments:'loader=3|6',notes:'猎虎固定128毫米炮；虎王装甲基础与128毫米火力暂定，待单独平衡'});
 for(const file of ['tools/buildUnitDB.js','tools/buildTankVisualDB.js']){let s=fs.readFileSync(file,'utf8');if(!s.includes("'jagdtiger'"))s=s.replaceAll("'sturmtiger',","'sturmtiger', 'jagdtiger',");fs.writeFileSync(file,s);}
 const types='assets/scripts/core/types.ts';let s=fs.readFileSync(types,'utf8');if(!s.includes("| 'jagdtiger'"))s=s.replace("  | 'sturmtiger'","  | 'sturmtiger'\n  | 'jagdtiger'");if(!s.includes("kind === 'jagdtiger'"))s=s.replace("|| kind === 'sturmtiger'","|| kind === 'sturmtiger'\n    || kind === 'jagdtiger'");fs.writeFileSync(types,s);
 const menu='assets/scripts/view/MainMenuScene.ts';s=fs.readFileSync(menu,'utf8');if(!s.includes("jagdtiger: '猎虎'"))s=s.replace("sturmtiger: '突击虎',","sturmtiger: '突击虎',\n      jagdtiger: '猎虎',");fs.writeFileSync(menu,s);
 if(!fs.readFileSync('data/lang.csv','utf8').includes('unit.name.jagdtiger,'))fs.appendFileSync('data/lang.csv','\nunit.name.jagdtiger,猎虎坦克歼击车,Jagdtiger\n');
 const imgs=await Promise.all(['top','top_destroyed'].map(s=>sharp(`assets/resources/textures/units/jagdtiger_${s}.png`).toBuffer()));await sharp({create:{width:460,height:100,channels:4,background:'#303940'}}).composite(imgs.map((input,i)=>({input,left:5+i*230,top:10}))).png().toFile(`${source}/game-size-preview.png`);
 await sharp(`${source}/game-size-preview.png`).resize(1380,300,{kernel:'nearest'}).toFile(`${source}/game-size-preview-3x.png`);
})().catch(e=>{console.error(e);process.exitCode=1;});
