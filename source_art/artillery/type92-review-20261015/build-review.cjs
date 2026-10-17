const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const root = __dirname;
const project = path.resolve(root, '../../..');
const revision = process.argv.includes('--v3') ? 3 : process.argv.includes('--v2') ? 2 : 0;
const revision2 = revision >= 2;
const suffix = revision ? `-v${revision}` : '';
const input = ['normal-generated.png', `destroyed-generated${suffix}.png`];
const output = ['type92_top.png', `type92_top_destroyed${suffix}.png`];

async function bounds(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1, transparent = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * 4 + 3];
    if (a === 0) transparent++;
    if (a > 10) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (right < 0 || transparent === 0) throw new Error(`Invalid transparency: ${file}`);
  return { left, top, right, bottom, width: info.width, height: info.height, transparent };
}

async function main() {
  const b = await Promise.all(input.map(f => bounds(path.join(root, f))));
  if (b[0].width !== b[1].width || b[0].height !== b[1].height) throw new Error('Source canvases differ');
  const left = Math.max(0, Math.min(...b.map(v => v.left)) - 3);
  const top = Math.max(0, Math.min(...b.map(v => v.top)) - 3);
  const right = Math.min(b[0].width - 1, Math.max(...b.map(v => v.right)) + 3);
  const bottom = Math.min(b[0].height - 1, Math.max(...b.map(v => v.bottom)) + 3);
  const crop = revision2
    ? JSON.parse(fs.readFileSync(path.join(root, 'review-audit.json'), 'utf8')).sharedCrop
    : { left, top, width: right - left + 1, height: bottom - top + 1 };
  // Ignore at most two source pixels of antialias fringe to preserve the approved scale.
  const fringe = revision2 ? 2 : 0;
  if (b.some(v => v.left < crop.left - fringe || v.top < crop.top - fringe || v.right >= crop.left + crop.width + fringe || v.bottom >= crop.top + crop.height + fringe)) throw new Error('Artwork extends beyond the shared crop');
  for (let i = 0; i < input.length; i++) {
    await sharp(path.join(root, input[i])).extract(crop).resize({ width: 150, height: 150, fit: 'inside', kernel: 'lanczos3' }).png().toFile(path.join(root, output[i]));
  }
  const text = (x,y,size,t,color='#e8e5cf') => `<text x="${x}" y="${y}" fill="${color}" font-family="Microsoft YaHei, sans-serif" font-size="${size}">${t}</text>`;
  const bg = `<svg width="1000" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="800" fill="#202724"/>${text(36,46,27,'九二式 70 毫米步兵炮 · 美术确认稿')}${text(36,77,15,'正俯视 / 炮口向左 / 透明底 / 正常与击毁状态')}
  <rect x="28" y="100" width="460" height="405" rx="12" fill="#939677"/><rect x="512" y="100" width="460" height="405" rx="12" fill="#939677"/>
  ${text(48,132,20,'正常状态','#202724')}${text(532,132,20,'击毁状态','#202724')}
  ${text(36,547,20,'小尺寸检查：约 65 px（默认 hexSize=60 时）')}${text(50,585,15,'现有资源')}${text(280,585,15,'九二式 · 正常')}${text(520,585,15,'九二式 · 击毁')}${text(750,585,15,`${revision2 ? '击毁' : '正常'} · 3× 像素放大`)}
  ${text(36,770,16,'仅供确认：尚未替换正式贴图、元数据或游戏配置。')}</svg>`;
  const layers = [];
  for (let i=0; i<2; i++) {
    const img=await sharp(path.join(root,input[i])).extract(crop).resize({width:400,height:330,fit:'inside'}).toBuffer({resolveWithObject:true});
    layers.push({input:img.data,left:58+i*484+Math.floor((400-img.info.width)/2),top:155+Math.floor((330-img.info.height)/2)});
  }
  const files = [path.join(project,'assets/resources/textures/units/at_gun_top.png'), ...output.map(f=>path.join(root,f))];
  for (let i=0;i<files.length;i++) {
    const img=await sharp(files[i]).resize({width:65,height:65,fit:'inside'}).toBuffer({resolveWithObject:true});
    layers.push({input:img.data,left:60+i*240,top:610});
    if(i===(revision2 ? 2 : 1)) layers.push({input:await sharp(img.data).resize({width:img.info.width*3,height:img.info.height*3,kernel:'nearest'}).toBuffer(),left:760,top:605});
  }
  await sharp(Buffer.from(bg)).composite(layers).png().toFile(path.join(root,`review-sheet${suffix}.png`));
  const baseline=JSON.parse(fs.readFileSync(path.join(root,'runtime-baseline.json'),'utf8'));
  for (const [file,hash] of Object.entries(baseline)) {
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(project,file))).digest('hex');
    if(actual!==hash) throw new Error(`Runtime file changed: ${file}`);
  }
  const report={sourceBounds:b,sharedCrop:crop,exports:await Promise.all(output.map(async f=>{const m=await sharp(path.join(root,f)).metadata();return {file:f,width:m.width,height:m.height,alpha:m.hasAlpha};})),previewLongestSide:65,runtimeFilesUnchanged:true,inGameVisualInspection:false};
  fs.writeFileSync(path.join(root,`review-audit${suffix}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
main().catch(err=>{console.error(err);process.exitCode=1;});
