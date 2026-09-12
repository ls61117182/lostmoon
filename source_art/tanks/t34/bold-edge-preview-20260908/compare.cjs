const sharp=require('sharp');
const path=require('path');
async function main(){
 const dir=__dirname;
 const {data,info}=await sharp(path.join(dir,'normal.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 // Clear the generated neutral checkerboard outside the painted tank.
 for(let i=0;i<data.length;i+=4){const lo=Math.min(data[i],data[i+1],data[i+2]),hi=Math.max(data[i],data[i+1],data[i+2]);if(data[i+1]>100&&data[i+1]>data[i]*1.6&&data[i+1]>data[i+2]*1.6)data[i+3]=0;}
 const cleaned=await sharp(data,{raw:info}).trim().png().toBuffer();
 await sharp(cleaned).toFile(path.join(dir,'normal-transparent.png'));
 const old=path.resolve(dir,'../../../../assets/resources/textures/units/t34_top.png');
 const layers=[];
 for(const [i,input] of [old,cleaned].entries()){
  const small=await sharp(input).resize({width:110}).png().toBuffer();
  layers.push({input:small,left:65+i*320,top:65});
  layers.push({input:await sharp(small).resize({width:440,kernel:'nearest'}).png().toBuffer(),left:20+i*460,top:155});
 }
 const labels=Buffer.from('<svg width="940" height="390"><style>text{font:18px sans-serif;fill:#eef2e6}</style><text x="65" y="35">CURRENT / 110px</text><text x="385" y="35">PREVIEW / 110px</text><text x="20" y="140">CURRENT / 4x</text><text x="480" y="140">PREVIEW / 4x</text></svg>');
 await sharp({create:{width:940,height:390,channels:4,background:'#667154'}}).composite([...layers,{input:labels,left:0,top:0}]).png().toFile(path.join(dir,'comparison.png'));
}
main().catch(e=>{console.error(e);process.exitCode=1});

