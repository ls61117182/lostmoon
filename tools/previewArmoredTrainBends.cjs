// Render the production geometry and sprites; this is an offline review, not a Cocos capture.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const moduleData = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/core/ArmoredTrainArt.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(moduleData, moduleData.exports);
const { trainTrackPose, trainCouplerPoint, trainCouplingAnchor, trainWeaponPose, trainBodyCrop } = moduleData.exports;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/textures/units/trains/bp44/bp44_art_manifest.json'), 'utf8'));
const radius = 66, step = radius * Math.sqrt(3), side = radius * 2;
const route = i => i <= 0 ? { x: i * step, y: 0 } : { x: i * step / 2, y: -i * step * Math.sqrt(3) / 2 };
const modules = ['panzerjaeger', 'command', 'tender', 'locomotive', 'panzerjaeger'].map(id => manifest.modules.find(m => m.id === id));
const indices = [2, 1, 0, -1, -2];
const png = p => 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets/resources', p.replace('/spriteFrame', '.png'))).toString('base64');
const image = (p, pose, ox, oy, extra = '') => `<g transform="translate(${ox + pose.x},${oy - pose.y}) rotate(${-pose.angleDegrees})"><image x="${-radius}" y="${-radius}" width="${side}" height="${side}" href="${png(p)}" ${extra}/></g>`;
function panel(top, corrected) {
  const ox = 470, oy = top + 88;
  let svg = `<text x="28" y="${top + 29}" fill="#f2eedb" font-family="Microsoft YaHei,sans-serif" font-size="23">${corrected ? '优化后：隐藏固定车钩，一根直杆连接相邻车体' : '优化前：固定车钩加中间连杆，弯道形成 Z 字折线'}</text>`;
  const a = route(-3), b = route(0), c = route(3);
  const rail = `M ${ox + a.x} ${oy - a.y} L ${ox + b.x} ${oy - b.y} L ${ox + c.x} ${oy - c.y}`;
  svg += `<path d="${rail}" fill="none" stroke="#454d43" stroke-width="20"/><path d="${rail}" fill="none" stroke="#85897d" stroke-width="11"/><path d="${rail}" fill="none" stroke="#343d36" stroke-width="7"/>`;
  const poses = indices.map(i => trainTrackPose(route, i));
  for (let i = 0; i < poses.length - 1; i++) {
    const anchor = corrected ? trainCouplingAnchor : trainCouplerPoint;
    const rear = anchor(manifest, modules[i], poses[i], 'rear', radius);
    const front = anchor(manifest, modules[i + 1], poses[i + 1], 'front', radius);
    svg += `<path d="M ${ox + rear.x} ${oy - rear.y} L ${ox + front.x} ${oy - front.y}" stroke="#202523" stroke-width="4.3"/><path d="M ${ox + rear.x} ${oy - rear.y} L ${ox + front.x} ${oy - front.y}" stroke="#a4aea2" stroke-width="1.8"/>`;
  }
  poses.forEach((pose, i) => {
    const module = modules[i], crop = trainBodyCrop(manifest, module, !corrected && i > 0, !corrected && i < poses.length - 1);
    const clip = `clip${top}_${i}`;
    svg += `<defs><clipPath id="${clip}"><rect x="${-radius}" y="${-radius + side * crop.top / 512}" width="${side}" height="${side * crop.height / 512}"/></clipPath></defs>`;
    svg += image(module.body, pose, ox, oy, `clip-path="url(#${clip})"`);
    for (const slot of module.weapons) {
      const angle = (indices[i] < 0 ? -90 : -150) - slot.initialAngleDegrees;
      const weapon = manifest.weapons.find(w => w.id === slot.id);
      const p = trainWeaponPose(manifest, module, slot, pose, angle, radius);
      svg += image(weapon.sprite, { ...p.position, angleDegrees: angle }, ox, oy);
    }
  });
  return svg;
}
async function main() {
  const out = path.join(root, 'source_art/trains/bp44-turning-20261118/bend-review.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="840"><rect width="1000" height="840" fill="#555f45"/>${panel(5, false)}<path d="M 24 410 H 976" stroke="#a8ac8c"/>${panel(425, true)}<text x="24" y="823" fill="#e0e1cc" font-family="Microsoft YaHei,sans-serif" font-size="15">正式资源与运行时几何合成预览；非 Cocos 实机截图。车体尺寸与武器独立朝向保持不变。</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out); console.log(out);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
