const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { readCsvRowsSmart } = require('../../../tools/csvSmart');
const root = path.resolve(__dirname, '../../..');
const units = path.join(root, 'assets/resources/textures/units');

function edit(file, transform) {
  const target=path.join(root,file);
  const before=fs.readFileSync(target,'utf8');
  const after=transform(before);
  if(before!==after) fs.writeFileSync(target,after,'utf8');
}
function tableRow(file, id, fields) {
  edit(file,text=>{
    const headers=text.replace(/^\uFEFF/,'').split(/\r?\n/)[0].split(',');
    return text.replace(new RegExp(`^${id},[^\\r\\n]*`,'m'),line=>{
      const cells=line.split(',');
      for(const [key,value]of Object.entries(fields)) {
        const index=headers.indexOf(key);
        if(index<0)throw new Error(`Missing column ${key}`);
        if(String(value).includes(','))throw new Error('Use comma-free values');
        cells[index]=String(value);
      }
      return cells.join(',');
    });
  });
}
async function main() {
  const snapshot=path.join(__dirname,'before-install');
  fs.mkdirSync(snapshot,{recursive:true});
  for(const name of ['at_gun_top.png','at_gun_top_destroyed.png']) {
    for(const ext of ['', '.meta']) {
      const backup=path.join(snapshot,name+ext);
      if(!fs.existsSync(backup)) fs.copyFileSync(path.join(units,name+ext),backup);
    }
  }
  const unitRows=readCsvRowsSmart(path.join(root,'data/units.csv'));
  const headers=unitRows[0];
  const row=unitRows.find(r=>r[0]==='at_gun');
  const configSnapshot=path.join(snapshot,'unit-profile.json');
  if(!fs.existsSync(configSnapshot)) fs.writeFileSync(configSnapshot,JSON.stringify(Object.fromEntries(headers.map((h,i)=>[h,row[i]??''])),null,2)+'\n');
  for(const [src,dst]of [['type92_top.png','at_gun_top.png'],['type92_top_destroyed-v3.png','at_gun_top_destroyed.png']]) {
    fs.copyFileSync(path.join(__dirname,src),path.join(units,dst));
    const {width:w,height:h,hasAlpha}=await sharp(path.join(units,dst)).metadata();
    if(!hasAlpha)throw new Error('Missing alpha');
    const metaPath=path.join(units,dst+'.meta');
    const meta=JSON.parse(fs.readFileSync(metaPath,'utf8'));
    const frame=Object.values(meta.subMetas).find(x=>x.importer==='sprite-frame').userData;
    Object.assign(frame,{width:w,height:h,rawWidth:w,rawHeight:h,trimX:0,trimY:0,trimType:'none',offsetX:0,offsetY:0});
    frame.vertices={rawPosition:[-w/2,-h/2,0,w/2,-h/2,0,-w/2,h/2,0,w/2,h/2,0],indexes:[0,1,2,2,1,3],uv:[0,h,w,h,0,0,w,0],nuv:[0,0,1,0,0,1,1,1],minPos:[-w/2,-h/2,0],maxPos:[w/2,h/2,0]};
    fs.writeFileSync(metaPath,JSON.stringify(meta,null,2)+'\n');
  }
  tableRow('data/units.csv','at_gun',{displayName:'九二式步兵炮',notes:'九二式步兵炮美术与名称；保留原有游戏平衡数值；基础火力表示人机协同；HE本体与炮组独立判定；炮班协同基准2、装填1'});
  tableRow('data/tank_visuals.csv','at_gun',{displayName:'九二式步兵炮',muzzleSpriteX:1,muzzleSpriteY:55,notes:'Type 92 infantry gun; approved top-down art 150x113; aligned destroyed v3 with flat fallen wheel and broken trail'});
  edit('data/lang.csv',text=>text
    .replace(/^unit\.name\.at_gun,[^\r\n]*/m,'unit.name.at_gun,九二式步兵炮,Type 92 Infantry Gun')
    .replace(/^dice\.aiCol\.at_gun,[^\r\n]*/m,'dice.aiCol.at_gun,九二式步兵炮,Type 92 Infantry Gun'));
  edit('data/enemy_ai_dice.csv',text=>text.replace(/^at_gun,2,[^\r\n]*/m,'at_gun,2,九二式步兵炮 掷 2 骰'));
  edit('assets/scripts/view/MainMenuScene.ts',text=>text.replace("at_gun: 'AT Gun'", "at_gun: t('unit.name.at_gun')").replace("case 'at_gun': return 'AT Gun';", "case 'at_gun': return t('unit.name.at_gun');"));
  function missions(dir) {
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const target=path.join(dir,entry.name);
      if(entry.isDirectory())missions(target);
      else if(entry.name.endsWith('.json')) {
        const before=fs.readFileSync(target,'utf8');
        const after=before.replace(/\bAT Guns\b/g,'Type 92 Infantry Guns').replace(/\bAT Gun\b/g,'Type 92 Infantry Gun');
        if(after!==before)fs.writeFileSync(target,after,'utf8');
      }
    }
  }
  missions(path.join(root,'assets/resources/missions'));
  const installedRows=readCsvRowsSmart(path.join(root,'data/units.csv'));
  const after=Object.fromEntries(installedRows[0].map((h,i)=>[h,installedRows.find(r=>r[0]==='at_gun')[i]??'']));
  const before=JSON.parse(fs.readFileSync(configSnapshot,'utf8'));
  for(const field of headers)if(!['displayName','notes'].includes(field)&&before[field]!==after[field])throw new Error(`Combat field changed: ${field}`);
  console.log('Installed approved normal and destroyed v3; synchronized metadata and names; combat profile unchanged.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
