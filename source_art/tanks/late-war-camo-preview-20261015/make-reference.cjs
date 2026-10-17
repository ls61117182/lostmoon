const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../../..');
const items = [['panzer4','PANZER IV G'],['stug3','STUG III G'],['tiger','TIGER I'],['panther','PANTHER G'],['tigerking','TIGER II'],['jagdpanther','JAGDPANTHER']];
const W=1920,H=1536, layers=[];
const text=(x,y,s,size=24,color='#e5e5da')=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}">${s}</text>`;
let svg=`<svg width="${W}" height="${H}"><rect width="100%" height="100%" fill="#20282d"/>`;
svg+=text(45,53,'GERMAN ARMOUR / LATE-WAR CAMOUFLAGE PREVIEW',34);
svg+=text(45,90,'Existing game sprites / Paint comparison only / Geometry and structure stay fixed',22,'#acb9bf');
['CURRENT GREY','A / THREE-COLOUR','B / AMBUSH'].forEach((s,i)=>{svg+=text(40+i*640,143,s,29);});
(async()=>{
 for(let i=0;i<items.length;i++) {
  const [kind,label]=items[i];
  const src=path.join(root,'assets/resources/textures/units',kind+'_top.png');
  for(let col=0;col<3;col++) {
   const x=25+col*640,y=166+i*204;
   svg+=`<rect x="${x}" y="${y}" width="615" height="190" rx="8" fill="#354047" stroke="#526068"/>`;
   svg+=text(x+18,y+30,label,22,'#cdd4d3');
   const large=await sharp(src).resize({width:550,height:108,fit:'inside',kernel:'nearest'}).png().toBuffer();
   const m=await sharp(large).metadata();
   layers.push({input:large,left:Math.round(x+(615-m.width)/2),top:Math.round(y+44+(108-m.height)/2)});
   const small=await sharp(src).resize({width:110,height:43,fit:'inside',kernel:'nearest'}).png().toBuffer();
   const sm=await sharp(small).metadata();
   layers.push({input:small,left:x+485,top:y+144});
   svg+=text(x+18,y+174,'110 px thumbnail',16,'#8d9ca2');
  }
 }
 svg+=text(45,1443,'A: dark yellow + olive green + red brown / broad irregular patches',23);
 svg+=text(45,1480,'B: the same three colours + sparse contrasting dots / 1944 late-war option',23);
 svg+=text(45,1515,'Concept comparison / existing shapes retained / not yet installed in the game',18,'#acb9bf');
 svg+='</svg>';
 const out=path.join(__dirname,'reference-comparison.png');
 await sharp(Buffer.from(svg)).composite(layers).png().toFile(out);
 fs.writeFileSync(path.join(__dirname,'preview-models.json'),JSON.stringify(items,null,2));
 console.log(out);
})();
