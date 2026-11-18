// Side-by-side QA of the actual compositor outputs, including fog and game-size crops.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'source_art/terrain/pacific-highland-edge-v2-20261118');
const uri=b=>'data:image/png;base64,'+b.toString('base64');
async function main(){
  const before=fs.readFileSync(path.join(OUT,'before/map.png'));
  const after=fs.readFileSync(path.join(ROOT,'source_art/terrain/pacific-highland-elevation-20261117/runtime-compositor-map.png'));
  fs.writeFileSync(path.join(OUT,'after-map.png'),after);
  const crop={left:650,top:48,width:220,height:210};
  const oldCrop=await sharp(before).extract(crop).png().toBuffer(),newCrop=await sharp(after).extract(crop).png().toBuffer();
  const smallOld=await sharp(oldCrop).resize(110,105).png().toBuffer(),smallNew=await sharp(newCrop).resize(110,105).png().toBuffer();
  const fog=await sharp({create:{width:220,height:210,channels:4,background:{r:69,g:76,b:68,alpha:.30}}}).png().toBuffer();
  const fogOld=await sharp(oldCrop).composite([{input:fog}]).png().toBuffer(),fogNew=await sharp(newCrop).composite([{input:fog}]).png().toBuffer();
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="980"><rect width="1200" height="980" fill="#242a25"/>
  <g font-family="Microsoft YaHei,sans-serif" fill="#eee8d6"><text x="38" y="46" font-size="27">岩石高地边缘 · 岩面与投影分开表现</text>
  <text x="38" y="78" font-size="15" fill="#c1c5b6">缩窄岩壁 / 向阳面提亮 / 不规则岩块裂隙 / 窄接触阴影与背光投影 / 坡脚零散碎石</text>
  <text x="40" y="117" font-size="18">调整前：宽暗带、模糊黑边、重复竖纹</text><text x="635" y="117" font-size="18">调整后：浅色岩壁、局部背光、不规则断面</text>
  <image href="${uri(oldCrop)}" x="45" y="140" width="286" height="273"/><image href="${uri(newCrop)}" x="640" y="140" width="286" height="273"/>
  <image href="${uri(smallOld)}" x="375" y="164" width="110" height="105"/><image href="${uri(smallNew)}" x="970" y="164" width="110" height="105"/>
  <text x="370" y="299" font-size="14">缩小显示</text><text x="965" y="299" font-size="14">缩小显示</text>
  <image href="${uri(fogOld)}" x="350" y="320" width="176" height="168"/><image href="${uri(fogNew)}" x="945" y="320" width="176" height="168"/>
  <text x="370" y="511" font-size="14">模拟迷雾</text><text x="965" y="511" font-size="14">模拟迷雾</text>
  <image href="${uri(before)}" x="35" y="550" width="550" height="303"/><image href="${uri(after)}" x="630" y="550" width="550" height="303"/>
  <text x="40" y="907" font-size="16">连片高地仅在外围形成岩壁；通行边界、格心及高度规则均不变。</text>
  <text x="40" y="946" font-size="13" fill="#b7bfae">生产合成器离线对照，并非 Cocos 实机截图。模拟迷雾只用于检查低对比下的可读性。</text></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT,'before-after.png'));
  await sharp(smallNew).toFile(path.join(OUT,'small-scale.png'));
  console.log('Saved Pacific highland edge before/after review.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
