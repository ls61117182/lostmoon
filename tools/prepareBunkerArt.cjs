// Preserve the original 100x70 sprites; use generated repairs only under the removed gun.
const fs = require('node:fs');
const crypto = require('node:crypto');
const sharp = require('sharp');
const dir = 'assets/resources/textures/units/';
const sources = [
  { name: 'german', asset: 'german_coastal_bunker', pivot: [37, 33],
    mask: (x,y) => (x < 35 && y >= 31 && y <= 36) || (x >= 35 && x <= 38 && y >= 29 && y <= 38),
    repair: (x,y) => x < 39 && y >= 29 && y <= 39, edge: 26 },
  { name: 'japanese', asset: 'heavy_artillery', pivot: [44, 35],
    mask: (x,y) => (x < 39 && y >= 33 && y <= 36) || (x >= 39 && x <= 46 && y >= 33 && y <= 38),
    repair: (x,y) => x < 47 && y >= 32 && y <= 38, edge: 28 },
];
async function main() {
  for (const cfg of sources) {
    const original = await sharp(`source_art/bunkers/${cfg.name}-original.png`).ensureAlpha().raw().toBuffer();
    const repaired = await sharp(`source_art/bunkers/${cfg.name}-body-generated.png`).resize(100,70,{fit:'fill'}).ensureAlpha().raw().toBuffer();
    const hull = Buffer.from(original), turret = Buffer.alloc(original.length);
    for (let y=0;y<70;y++) for (let x=0;x<100;x++) {
      const i=(y*100+x)*4;
      if (cfg.mask(x,y)) original.copy(turret,i,i,i+4);
      if (cfg.repair(x,y)) {
        if(x<cfg.edge) hull.fill(0,i,i+4);
        else repaired.copy(hull,i,i,i+4);
      }
    }
    for (const [role, data] of [['hull',hull],['turret',turret]]) {
      const path=dir+cfg.asset+'_top_'+role+'.png';
      await sharp(data,{raw:{width:100,height:70,channels:4}}).png().toFile(path);
      if (!fs.existsSync(path+'.meta')) {
        const template=fs.readFileSync(dir+cfg.asset+'_top.png.meta','utf8');
        const old=JSON.parse(template).uuid;
        fs.writeFileSync(path+'.meta',template.replaceAll(old,crypto.randomUUID()).replaceAll(cfg.asset+'_top"',cfg.asset+'_top_'+role+'"'));
      }
    }
    await sharp(hull,{raw:{width:100,height:70,channels:4}})
      .composite([{input:turret,raw:{width:100,height:70,channels:4}}]).png().toFile(dir+cfg.asset+'_top.png');
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
