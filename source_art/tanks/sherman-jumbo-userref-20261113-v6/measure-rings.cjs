// Fits the generated seat's slight ellipse without stretching the artwork.
const fs=require('fs'),sharp=require('sharp');
(async()=>{
 const {data,info}=await sharp('generated/m4a3e2-hull-v3.png').raw().toBuffer({resolveWithObject:true});
 const dirs=Array.from({length:128},(_,i)=>[Math.cos(i*Math.PI/64),Math.sin(i*Math.PI/64)]);
 function lum(x,y){const n=(Math.round(y)*info.width+Math.round(x))*4;return data[n]*.2126+data[n+1]*.7152+data[n+2]*.0722;}
 function score(cx,cy,rx,ry){let sum=0;for(const[x,y]of dirs)sum+=Math.abs(lum(cx+x*(rx-3),cy+y*(ry-3))-lum(cx+x*(rx+3),cy+y*(ry+3)));return sum/dirs.length;}
 let best={score:-1};for(let cx=408;cx<=424;cx+=2)for(let cy=909;cy<=925;cy+=2)for(let rx=226;rx<=242;rx+=2)for(let ry=234;ry<=250;ry+=2){const s=score(cx,cy,rx,ry);if(s>best.score)best={cx,cy,rx,ry,score:s};}
 fs.writeFileSync('ring-measurements.json',JSON.stringify({m4a3e2:{file:'m4a3e2-hull-v3.png',sourceSize:[info.width,info.height],ellipseCenter:[best.cx,best.cy],edgeRadii:[best.rx,best.ry],outerRadii:[best.rx+3,best.ry+3],contrast:best.score}},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
