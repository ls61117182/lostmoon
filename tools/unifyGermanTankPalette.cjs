'use strict';
const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..');
const dir=path.join(root,'assets/resources/textures/units');
const out=path.join(root,'source_art/tanks/german-palette/unified');
const kinds=['panzer3','panzer3_m_no_schurzen','panzer3_m','panzer3_n','panzer3_n_schurzen','panzer4','stug3','panther','tiger','tigerking','maus','sturmtiger'];
const luminance=(r,g,b)=>r*.2126+g*.7152+b*.0722;
const quantile=(a,p)=>a[Math.floor((a.length-1)*p)];
function map(v,anchors){for(let j=1;j<anchors.length;j++){if(v<=anchors[j][0]){const [x,y]=anchors[j-1],[xx,yy]=anchors[j];return y+(yy-y)*(v-x)/(xx-x);}}return anchors.at(-1)[1];}
(async()=>{
fs.mkdirSync(out,{recursive:true});const report=[];
for(const kind of kinds){
 const names=['_top','_top_hull','_top_turret','_top_destroyed'].map(s=>kind+s+'.png').filter(n=>fs.existsSync(path.join(dir,n)));
 const inputs=[];
 for(const name of names){const input=path.join(dir,name),backup=path.join(out,'before',name);fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.copyFileSync(input,backup);const raw=await sharp(backup).ensureAlpha().raw().toBuffer({resolveWithObject:true});inputs.push({name,...raw});}
 const sample=inputs.filter(i=>names.some(n=>n.includes('_hull'))?i.name.includes('_hull')||i.name.includes('_turret'):i.name===kind+'_top.png');
 const values=[];for(const i of sample)for(let p=0;p<i.data.length;p+=4){const l=luminance(...i.data.subarray(p,p+3));if(i.data[p+3]>220&&l>60)values.push(l);}values.sort((a,b)=>a-b);
 const mid=quantile(values,.55),high=Math.max(mid+12,quantile(values,.95));
 // Shared armor midtone RGB 98/106/114; dark detail remains dark.
 const anchors=[[0,0],[35,29],[mid,106],[high,139],[255,176]];
 for(const input of inputs){const result=Buffer.from(input.data);for(let p=0;p<result.length;p+=4){if(!result[p+3])continue;const v=map(luminance(...input.data.subarray(p,p+3)),anchors);const tint=Math.min(1,v/65);result[p]=Math.round(Math.max(0,v-8*tint));result[p+1]=Math.round(v);result[p+2]=Math.round(v+8*tint);}
 await sharp(result,{raw:input.info}).png().toFile(path.join(dir,input.name));
 const check=await sharp(path.join(dir,input.name)).ensureAlpha().raw().toBuffer({resolveWithObject:true});if(check.info.width!==input.info.width||check.info.height!==input.info.height)throw Error('Dimensions changed');for(let p=3;p<result.length;p+=4)if(check.data[p]!==input.data[p])throw Error('Alpha changed');
 }
 report.push({kind,files:names,sourceMid:mid,sourceHighlight:high,anchors});
}
fs.writeFileSync(path.join(out,'palette-report.json'),JSON.stringify({armor:[98,106,114],highlight:[131,139,147],geometryAndAlpha:'verified unchanged',models:report},null,2));console.log(`Updated ${report.length} models, ${report.reduce((n,r)=>n+r.files.length,0)} PNGs; dimensions and alpha unchanged.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
