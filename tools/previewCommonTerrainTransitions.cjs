const fs=require('fs'),path=require('path'),sharp=require('sharp');
const {PAIRS}=require('./bakeCommonTerrainTransitions.cjs'),OUT=path.resolve(__dirname,'../source_art/terrain/prefab-transitions-v1'),AXES=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
async function main(){
 for(const [style,a,b]of PAIRS){const layers=[];for(const [row,center]of [a,b].entries())for(const [col,mask]of [0,1,3,7,9,21,31,63].entries()){const flags=AXES.map((_,i)=>mask>>i&1).join('');layers.push({input:await sharp(path.join(OUT,style,`${a}-${b}`,`${center}_${flags}.png`)).resize(136,155).png().toBuffer(),left:col*136,top:row*185+30});}
 const labels=[a,b].map((t,i)=>({input:Buffer.from(`<svg width="1088" height="30"><text x="12" y="22" fill="#eeeeee" font-size="18">${style}: center ${t}, neighbors ${a}/${b} — masks 0, 1, 3, 7, 9, 21, 31, 63</text></svg>`),left:0,top:i*185}));await sharp({create:{width:1088,height:370,channels:4,background:'#263127'}}).composite([...labels,...layers]).png().toFile(path.join(OUT,`${style}-${a}-${b}-preview.png`));
 }
 for(const [style,a,b]of [['europe','field','mud'],['europe','field','water'],['winter','field','water'],['pacific','clear','beach']]){
 const tiles=[],lut=new Map();for(let r=0;r<5;r++)for(let c=0;c<7;c++){const t={q:c-Math.floor(r/2),r,terrain:c>=3+(r%3===1?1:0)?b:a};tiles.push(t);lut.set(`${t.q},${t.r}`,t);}
 const layers=[];for(const t of tiles){const other=t.terrain===a?b:a,flags=AXES.map(([q,r])=>lut.get(`${t.q+q},${t.r+r}`)?.terrain===other?'1':'0').join(''),left=Math.round(Math.sqrt(3)*48*(t.q+t.r/2)*2),top=t.r*144;layers.push({input:path.join(OUT,style,`${a}-${b}`,`${t.terrain}_${flags}.png`),left,top});}
 await sharp({create:{width:1260,height:770,channels:4,background:'#263127'}}).composite(layers).png().toFile(path.join(OUT,`${style}-${a}-${b}-stitched.png`));
 }
 const files=[];for(const d of fs.readdirSync(OUT,{withFileTypes:true}))if(d.isDirectory()){const walk=p=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.png'))files.push(f);}};walk(path.join(OUT,d.name));}
 console.log(`${files.length} tile/mask PNGs; ${(files.reduce((n,f)=>n+fs.statSync(f).size,0)/1048576).toFixed(1)} MiB; previews refreshed.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
