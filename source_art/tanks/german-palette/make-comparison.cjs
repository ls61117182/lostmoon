const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../../..');
const items = [
 ['panzer3','三号坦克'],['panzer3_m_no_schurzen','三号 M 型'],['panzer3_m','三号 M 型 · 附加装甲'],
 ['panzer3_n','三号 N 型'],['panzer3_n_schurzen','三号 N 型 · 附加装甲'],['panzer4','四号 G 型'],
 ['stug3','三号突击炮 G 型'],['panther','豹式 G 型'],['tiger','虎式'],
 ['tigerking','虎王'],['maus','鼠式'],['sturmtiger','突击虎'],
];
const W=1600,H=1530, composites=[];
const unified=process.argv.includes('--unified');
const text=(x,y,s,size=24,color='#d9dfe4')=>`<text x="${x}" y="${y}" font-family="Microsoft YaHei, sans-serif" font-size="${size}" fill="${color}">${s}</text>`;
let svg=`<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="#20272d"/>`;
svg+=text(45,57,unified?'德军车型 · 统一德军灰':'德军车型 · 当前配色对照',34);
svg+=text(45,98,'12 个已接入车型 + 猎虎德军灰参考｜图片按格内等比例放大，不代表车辆实际尺寸',20,'#aebbc6');
async function add(file,x,y,w,h){const b=await sharp(file).trim({threshold:5}).resize({width:w,height:h,fit:'inside',kernel:'nearest'}).png().toBuffer();const m=await sharp(b).metadata();composites.push({input:b,left:Math.round(x+(w-m.width)/2),top:Math.round(y+(h-m.height)/2)});}
(async()=>{
for(let i=0;i<items.length;i++){
 const [kind,label]=items[i],x=35+(i%3)*515,y=125+Math.floor(i/3)*255;
 svg+=`<rect x="${x}" y="${y}" width="500" height="240" rx="10" fill="#303940" stroke="#53606a"/>`;
 svg+=text(x+18,y+35,label,25);
 svg+=text(x+18,y+65,kind,16,'#aebbc6');
 const backup=path.join(__dirname,'unified/before',kind+'_top.png');
 await add(!unified&&fs.existsSync(backup)?backup:path.join(root,'assets/resources/textures/units',kind+'_top.png'),x+20,y+85,460,135);
}
svg+=`<rect x="35" y="1160" width="1530" height="270" rx="10" fill="#303940" stroke="#8ea4b7" stroke-width="2"/>`;
svg+=text(55,1200,'目标色参考：猎虎 · 德军灰（尚未接入游戏）',27);
await add(path.join(root,'source_art/tanks/jagdtiger/top-grey-generated.png'),55,1220,920,180);
const colors=[['#858c92','亮部'],['#626a72','装甲灰'],['#414950','暗部'],['#20272d','轮廓 / 钢铁']];
colors.forEach(([c,l],i)=>{const x=1020+i%2*260,y=1240+Math.floor(i/2)*82;svg+=`<rect x="${x}" y="${y}" width="56" height="48" fill="${c}" stroke="#9fa9b2"/>`;svg+=text(x+68,y+22,l,20);svg+=text(x+68,y+47,c.toUpperCase(),16,'#aebbc6');});
svg+=text(45,1474,unified?'上方为已更新游戏贴图：统一装甲灰，保留各车型结构、透明轮廓和明暗层次。':'下方色板为拟定的统一灰色；本图上方保留修改前贴图原色。',20,'#aebbc6');
svg+='</svg>';
await sharp(Buffer.from(svg)).composite(composites).png().toFile(path.join(__dirname,unified?'unified/german-unified-palette-comparison.png':'german-current-palette-comparison.png'));
fs.writeFileSync(path.join(__dirname,'README.md'),'# 德军当前配色对照\n\n12 个已注册德军坦克/突击炮车型，加上未接入游戏的猎虎灰版。来自当前完整俯视贴图，统一背景，等比例放大用于比较颜色；不代表真实车辆尺寸。灰色板为建议值，尚未应用。\n');
})();
