const fs=require('fs'),path=require('path'),sharp=require('sharp');
async function measure(file,guess){
 const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const dirs=Array.from({length:128},(_,i)=>[Math.cos(i*Math.PI/64),Math.sin(i*Math.PI/64)]);
 function lum(x,y){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=info.width||y>=info.height)return 0;const p=(y*info.width+x)*4;return data[p]*.2126+data[p+1]*.7152+data[p+2]*.0722;}
 function score(cx,cy,r){let sum=0;for(const [x,y]of dirs){const a=lum(cx+x*(r-3),cy+y*(r-3)),b=lum(cx+x*(r+3),cy+y*(r+3));sum+=Math.abs(b-a);}return sum/dirs.length;}
 let best={score:-1};
 for(let x=guess[0]-30;x<=guess[0]+30;x+=5)for(let y=guess[1]-50;y<=guess[1]+50;y+=5)for(let r=guess[2]-25;r<=guess[2]+25;r+=3){const s=score(x,y,r);if(s>best.score)best={x,y,r,score:s};}
 let coarse=best;
 for(let x=coarse.x-5;x<=coarse.x+5;x++)for(let y=coarse.y-5;y<=coarse.y+5;y++)for(let r=coarse.r-3;r<=coarse.r+3;r++){const s=score(x,y,r);if(s>best.score)best={x,y,r,score:s};}
 return {file:path.basename(file),sourceSize:[info.width,info.height],circleCenter:[best.x,best.y],edgeRadius:best.r,radialContrast:best.score};
}
(async()=>{const result={m4a1:await measure(path.join(__dirname,'generated/m4a1_hull-v1.png'),[420,870,250]),m4a1_76_hvss:await measure(path.join(__dirname,'generated/m4a1_76_hvss_hull-v1.png'),[390,1125,200])};fs.writeFileSync(path.join(__dirname,'ring-measurements.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));})();
