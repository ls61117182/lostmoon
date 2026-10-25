// Same geometry, production materials/sprites, and CPU reference compositor in five looks.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {LIVE,OUT,loadRaster}=require('./buildEuropeanSeasons.cjs');
const {TerrainGroundRaster}=loadRaster();
const base=JSON.parse(fs.readFileSync(path.join(LIVE,'redesign_v3/materials.json')));
const looks=['spring','summer','autumn','winter_bare','winter_snow'];
const names={spring:'春季',summer:'夏季',autumn:'秋季',winter_bare:'冬季 · 无积雪',winter_snow:'冬季 · 积雪'};
const layout=[[0,.64,.78],[-.47,.35,.84],[.47,.35,.80],[-.58,-.16,.85],[0,.12,.90],[.58,-.16,.82],[-.32,-.54,.85],[.32,-.54,.82],[0,-.10,.79]];
const tiles=[];
for(let r=0;r<7;r++)for(let c=0;c<9;c++) {
  const water=r===3||(r===2&&c<2)||(r===4&&c>6),forest=!water&&((r<2&&c>5)||(r>4&&c<2)||(r===1&&c===3)||(r===5&&c===5)),road=c===4;
  tiles.push({pos:{q:c-Math.floor(r/2),r},terrain:water?'water':forest?'forest':(c===1&&r===1)||(c===6&&r===5)?'mud':road?'road':'field',
    ...(road&&!water?{roads:[false,true,false,false,true,false]}:{}),...(road&&water?{bridgeEnds:[1,4]}:{}),hasBuilding:road&&[1,5].includes(r),hedge:!water&&((c===2&&r>=4)||(c===7&&r<2))});
}
const W=800,H=550;
const pos=t=>({x:Math.sqrt(3)*48*(t.pos.q+t.pos.r/2)+48,y:72*t.pos.r+52});
function treeFile(look,index) {return path.join(LIVE,look==='summer'?`redesign_v3/europe_tree_0${index+1}.png`:look==='winter_snow'?`tree_0${index+1}_snow.png`:`seasons/${look}/tree_0${index+1}.png`);}
async function map(look) {
  const pack=look==='summer'?base.europeanSummer:look==='winter_snow'?base.europeanWinter:JSON.parse(fs.readFileSync(path.join(LIVE,`seasons/${look}/materials.json`)));
  const a=new TerrainGroundRaster(pack).renderChunk(tiles,look==='winter_snow',-48,-52,W,H,1),layers=[];
  const ground=await sharp(a.pixels,{raw:{width:a.textureWidth,height:a.textureHeight,channels:4}}).extract({left:1,top:1,width:W,height:H}).png().toBuffer();
  async function tree(t,dx,dy,size,index) {
    const input=await sharp(treeFile(look,index%4)).resize(size,size).png().toBuffer(),p=pos(t),left=Math.round(p.x+dx-size/2),top=Math.round(p.y+dy-size/2);
    if(left>=0&&top>=0&&left+size<=W&&top+size<=H)layers.push({input,left,top});
  }
  for(const t of tiles) {
    if(t.terrain==='forest')for(let i=0;i<layout.length;i++) {
      const [dx,dy,s]=layout[i];await tree(t,dx*48,-dy*48,Math.round(48*s*.82),Math.abs(t.pos.q*92811+t.pos.r*6899)+i);
    }
    if(t.hedge)for(let i=0;i<6;i++)await tree(t,-33+i*13,-21,21+i%3,i+t.pos.r);
    if(t.hasBuilding) {
      const p=pos(t);
      for(let i=0;i<5;i++) {
        const input=await sharp(path.join(LIVE,`redesign_v3/rural_roof_0${i%4+1}${look==='winter_snow'?'_snow':''}.png`)).resize(29,20).rotate(i*29,{background:'#00000000'}).png().toBuffer(),m=await sharp(input).metadata();
        layers.push({input,left:Math.round(p.x+(i%2?27:-34)-m.width/2),top:Math.round(p.y+(i-2)*17-m.height/2)});
      }
    }
  }
  const result=await sharp(ground).composite(layers).png().toBuffer();
  await sharp(result).toFile(path.join(OUT,`production-${look}.png`));return result;
}
async function main() {
  const cards=[];
  for(let i=0;i<looks.length;i++) {
    const look=looks[i],left=24+(i%3)*824,top=100+Math.floor(i/3)*622;
    const label=Buffer.from(`<svg width="800" height="48"><text x="0" y="32" font-size="27" font-family="Microsoft YaHei,sans-serif" fill="#ded8c4">${names[look]}</text></svg>`);
    cards.push({input:label,left,top},{input:await map(look),left,top:top+52});
  }
  const heading=Buffer.from('<svg width="2496" height="95"><text x="24" y="44" font-size="32" font-family="Microsoft YaHei,sans-serif" fill="#e8dfbe">欧洲地形 · 四季 / 五套游戏资源</text><text x="24" y="78" font-size="18" font-family="Microsoft YaHei,sans-serif" fill="#b3bba6">同一地图与缩放 · 生产材质 / 实际精灵 · CPU 参考合成预览</text></svg>');
  const details=Buffer.from('<svg width="800" height="550"><g font-family="Microsoft YaHei,sans-serif" fill="#ded8c4"><text x="45" y="78" font-size="28">已接入五套外观</text><text x="45" y="139" font-size="23">春 / 夏 / 秋 / 冬季无雪 / 冬季积雪</text><text x="45" y="202" font-size="20">编辑器：关卡 → 季节 → 冬季积雪 有 / 无</text><text x="45" y="248" font-size="20">关卡 → 随机关卡：可直接试玩各季节</text><text x="45" y="310" font-size="20">旧冬季关卡继续显示积雪</text><text x="45" y="356" font-size="20">地面积雪与雨 / 雪 / 雾天气分别设置</text><text x="45" y="418" font-size="20">地形移动、掩护与通行规则保持原值</text><text x="45" y="482" font-size="17" fill="#a7b19c">运行时使用 GPU 合成；本图为同源素材参考。</text></g></svg>');
  cards.push({input:heading,left:0,top:0},{input:details,left:1672,top:774});
  await sharp({create:{width:2496,height:1344,channels:4,background:'#222d23'}}).composite(cards).png().toFile(path.join(OUT,'production-comparison.png'));
  const treeLayers=[];
  for(let row=0;row<looks.length;row++)for(let i=0;i<4;i++) {
    treeLayers.push({input:await sharp(treeFile(looks[row],i)).resize(100,100).png().toBuffer(),left:170+i*160,top:row*132+12});
    treeLayers.push({input:await sharp(treeFile(looks[row],i)).resize(40,40).png().toBuffer(),left:275+i*160,top:row*132+48});
  }
  treeLayers.push({input:Buffer.from(`<svg width="850" height="660">${looks.map((id,i)=>`<text x="14" y="${i*132+65}" fill="#ded8c4" font-size="19" font-family="Microsoft YaHei,sans-serif">${names[id]}</text>`).join('')}</svg>`),left:0,top:0});
  await sharp({create:{width:850,height:660,channels:4,background:'#424b3b'}}).composite(treeLayers).png().toFile(path.join(OUT,'production-trees.png'));
  console.log('Saved production-comparison.png, production-trees.png and five individual maps.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
