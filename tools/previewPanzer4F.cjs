'use strict';
const assert = require('assert');
const path = require('path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const art = path.join(root,'assets/resources/textures/units');
async function main() {
  for (const suffix of ['top_hull','top_destroyed']) {
    const a = await sharp(path.join(art,`panzer4_${suffix}.png`)).raw().toBuffer();
    const b = await sharp(path.join(art,`panzer4_f_${suffix}.png`)).raw().toBuffer();
    assert(a.equals(b),`${suffix} must reuse G pixels exactly`);
    console.log(`${suffix}: identical G/F pixels`);
  }
  const layers=[];
  for (const [kind,left,label] of [['panzer4',20,'Ausf. G'],['panzer4_f',650,'Ausf. F1']]) {
    const file = path.join(art,`${kind}_top.png`);
    const meta = await sharp(file).metadata();
    layers.push({input:await sharp(file).resize(meta.width*3,meta.height*3,{kernel:'nearest'}).png().toBuffer(),left,top:55});
    layers.push({input:Buffer.from(`<svg width="600" height="50"><text x="0" y="30" font-family="Arial" font-size="25" fill="white">${label}</text></svg>`),left,top:10});
    layers.push({input:await sharp(file).png().toBuffer(),left,top:320});
  }
  await sharp({create:{width:1200,height:420,channels:4,background:'#535f44'}}).composite(layers).png().toFile(path.join(root,'source_art/tanks/panzer4_f/preview-comparison.png'));
  const correction=[];
  for(const [file,left,label] of [
    [path.join(root,'source_art/tanks/panzer4_f/top-before-barrel-correction.png'),20,'Before'],
    [path.join(art,'panzer4_f_top.png'),560,'Corrected'],
  ]) {
    const meta=await sharp(file).metadata();
    correction.push({input:await sharp(file).resize(meta.width*3,meta.height*3,{kernel:'nearest'}).png().toBuffer(),left,top:55});
    correction.push({input:Buffer.from(`<svg width="500" height="50"><text x="0" y="30" font-family="Arial" font-size="25" fill="white">${label}</text></svg>`),left,top:10});
    correction.push({input:await sharp(file).png().toBuffer(),left,top:320});
  }
  await sharp({create:{width:1080,height:420,channels:4,background:'#535f44'}}).composite(correction).png().toFile(path.join(root,'source_art/tanks/panzer4_f/preview-barrel-correction.png'));
  const contour=[];
  for(const [file,left,label] of [
    [path.join(root,'source_art/tanks/panzer4_f/top-before-contour-correction.png'),20,'Before'],
    [path.join(art,'panzer4_f_top.png'),560,'Corrected'],
  ]) {
    const meta=await sharp(file).metadata();
    contour.push({input:await sharp(file).resize(meta.width*3,meta.height*3,{kernel:'nearest'}).png().toBuffer(),left,top:55});
    contour.push({input:Buffer.from(`<svg width="500" height="50"><text x="0" y="30" font-family="Arial" font-size="25" fill="white">${label}</text></svg>`),left,top:10});
    contour.push({input:await sharp(file).png().toBuffer(),left,top:320});
  }
  await sharp({create:{width:1080,height:420,channels:4,background:'#535f44'}}).composite(contour).png().toFile(path.join(root,'source_art/tanks/panzer4_f/preview-contour-correction.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
