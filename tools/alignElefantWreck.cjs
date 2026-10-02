// Align the generated wreck to intact hull anchors without independently trimming it.
const fs = require('fs');
const sharp = require('sharp');
const dir = 'source_art/tanks/elefant';
async function bounds(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const columns = [];
  for (let x = 250; x < info.width; x++) {
    let count = 0;
    for (let y = 0; y < info.height; y++) if (data[(y * info.width + x) * 4 + 3] > 128) count++;
    if (count > info.height * 0.4) columns.push(x);
  }
  return { left: columns[0], right: columns.at(-1), length: columns.at(-1) - columns[0] + 1 };
}
(async () => {
  const normal = fs.readFileSync(`${dir}/top-aligned.png`);
  const wreck = await sharp(`${dir}/top-grey-destroyed-expanded-generated.png`).resize(1932,814).png().toBuffer();
  const target = await bounds(normal), input = await bounds(wreck);
  const front = await sharp(wreck).extract({ left: 0, top: 0, width: input.left, height: 814 }).resize(target.left,814).toBuffer();
  const hull = await sharp(wreck).extract({ left: input.left, top: 0, width: input.length, height: 814 }).resize(target.length,814).toBuffer();
  const tailWidth = 1932 - target.right - 1;
  const tail = await sharp(wreck).extract({ left: input.right+1, top: 0, width: 1932-input.right-1, height: 814 }).resize(tailWidth,814).toBuffer();
  const output = await sharp({ create: { width:1932,height:814,channels:4,background:'#00000000' } }).composite([{input:front,left:0,top:0},{input:hull,left:target.left,top:0},{input:tail,left:target.right+1,top:0}]).png().toBuffer();
  const result = await bounds(output);
  if (result.left !== target.left || result.right !== target.right) throw Error('Hull anchors do not match');
  fs.writeFileSync(`${dir}/top_destroyed-aligned.png`, output);
  fs.writeFileSync(`${dir}/wreck-alignment-report.json`,JSON.stringify({normal:target,generated:input,aligned:result,canvas:[1932,814]},null,2)+'\n');
  console.log({normal:target,generated:input,aligned:result});
})().catch(e => { console.error(e); process.exitCode=1; });
