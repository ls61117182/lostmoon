// User explicitly authorized direct PNG crop/alignment for tracks in this chat.
// Reuses original tread pixels; preserves armored pixels and does not paint new vehicle parts.
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const R=__dirname;
const variants=[
 {key:'m4a1',source:'m4a1-hull-base.png',width:125,left:40,right:685,front:[28,220],rear:[1718,1788],boxes:{lf:[12,195,24,310],rf:[655,838,24,310],lr:[35,185,1705,1792],rr:[661,813,1705,1792]},templates:{left:[60,1728,112,54],right:[675,1728,112,54]}},
 {key:'m4a1_76_hvss',source:'m4a1-76-hvss-hull-base.png',width:120,left:40,right:632,front:[420,610],rear:[1768,1880],boxes:{lf:[10,195,416,650],rf:[597,782,416,650],lr:[10,181,1725,1885],rr:[613,782,1725,1885]},templates:{left:[28,1800,136,70],right:[627,1800,136,70]}},
];
function hsv(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=60*((g-b)/d%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);if(h<0)h+=360;}return{h,s:max?d/max:0,v:max};}
function tread(data,p){const a=data[p+3];if(a<12)return false;const c=hsv(data[p],data[p+1],data[p+2]);return c.h<=43&&c.s>.08&&c.v>8;}
function metal(data,p){if(data[p+3]<12)return false;const c=hsv(data[p],data[p+1],data[p+2]);return c.h>=45&&c.h<=100&&c.v>16&&c.s>.08;}
function paintedMetal(data,p){if(!metal(data,p))return false;return Math.max(data[p],data[p+1],data[p+2])>45;}
async function cropTexture(file,rect,width){const[left,top,w,h]=rect;const r=await sharp(file).extract({left,top,width:w,height:h}).resize(width,h,{kernel:'lanczos3'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});return r;}
function span(data,info,x0,x1,y0,y1){let lo=info.width,hi=-1,n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const p=(y*info.width+x)*4;if(tread(data,p)){lo=Math.min(lo,x);hi=Math.max(hi,x);n++;}}return{left:lo,right:hi,width:hi>=lo?hi-lo+1:0,pixels:n};}
async function run(v){
 const file=path.join(R,'references',v.source),raw=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true}),src=raw.data,info=raw.info,dst=Buffer.from(src);
 let erased=0,placed=0;const allowed=new Uint8Array(info.width*info.height);
 function trackArea(x,y,corner){
  if(corner[1]!=='f')return true;
  const maxX=v.key==='m4a1'?184-.84*(y-22):182-1.05*(y-420);
  return corner[0]==='l'?x<=maxX:x>=info.width-maxX;
 }
 for(const [corner,box] of Object.entries(v.boxes)){
  const[x0,x1,y0,y1]=box,rows=[];
  for(let y=y0;y<y1;y++){let lo=x1,hi=-1;for(let x=x0;x<x1;x++){const p=(y*info.width+x)*4;if(trackArea(x,y,corner)&&tread(src,p)){lo=Math.min(lo,x);hi=Math.max(hi,x);}}rows.push(hi>=lo?[lo,hi]:null);}
  for(let y=y0;y<y1;y++){
   let range=rows[y-y0];if(!range){for(let d=1;d<=3&&!range;d++)range=rows[y-y0-d]||rows[y-y0+d];}if(!range)continue;
   const lo=Math.max(x0,range[0]-2),hi=Math.min(x1-1,range[1]+2);
   for(let x=lo;x<=hi;x++){
    const p=(y*info.width+x)*4;if(!trackArea(x,y,corner)||src[p+3]<1||metal(src,p))continue;
    // Keep the steel outline directly bordering painted armor; omit this only for rust colors.
    let nearMetal=false;if(Math.max(src[p],src[p+1],src[p+2])<24&&!tread(src,p))for(let dy=-1;dy<=1&&!nearMetal;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<info.width&&yy>=0&&yy<info.height&&metal(src,(yy*info.width+xx)*4)){nearMetal=true;break;}}
    if(nearMetal)continue;dst.fill(0,p,p+4);allowed[y*info.width+x]=1;erased++;
   }
  }
 }
 for(const side of['left','right']){
  const tx=side==='left'?v.left:v.right,tex=await cropTexture(file,v.templates[side],v.width),td=tex.data,th=tex.info.height;
  for(const end of['front','rear']){
   const[y0,y1]=v[end];
   for(let y=y0;y<y1;y++)for(let xx=0;xx<v.width;xx++){
    const x=tx+xx,p=(y*info.width+x)*4,corner=(side==='left'?'l':'r')+(end==='front'?'f':'r');
    // Original paint and steel remains an occlusion layer over the straight belt.
    if(metal(src,p)||(!trackArea(x,y,corner)&&src[p+3]>12))continue;
    if(src[p+3]>16&&!allowed[y*info.width+x]&&!tread(src,p))continue;
    const q=(((y-y0)%th)*v.width+xx)*4;for(let c=0;c<4;c++)dst[p+c]=td[q+c];placed++;
   }
  }
 }
 // Remove residual tread fringes, including black outline fragments left outside the
 // new belt. Keep olive armor and its existing four-pixel steel contour untouched.
 for(const [corner,[x0,x1,y0,y1]]of Object.entries(v.boxes))for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  const outer=corner[0]==='l'?x<v.left:x>=v.right+v.width;if(!outer)continue;
  const p=(y*info.width+x)*4;if(!dst[p+3]||paintedMetal(dst,p))continue;
  let nearMetal=false;
  for(let dy=-4;dy<=4&&!nearMetal;dy++)for(let dx=-4;dx<=4;dx++){
   const xx=x+dx,yy=y+dy;if(xx>=0&&xx<info.width&&yy>=0&&yy<info.height&&paintedMetal(dst,(yy*info.width+xx)*4)){nearMetal=true;break;}
  }
  if(!nearMetal){dst.fill(0,p,p+4);erased++;}
 }
 // Drop disconnected tiny outline fragments inside the edited tip windows only.
 // The actual hull and each tread end are large connected components.
 const boxes=Object.values(v.boxes),inScope=(x,y)=>boxes.some(([x0,x1,y0,y1])=>x>=x0&&x<x1&&y>=y0&&y<y1);
 for(const [x0,x1,y0,y1]of boxes)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  const p=(y*info.width+x)*4;if(dst[p+3]>0&&dst[p+3]<=16){dst.fill(0,p,p+4);erased++;}
 }
 const seen=new Uint8Array(info.width*info.height),queue=new Int32Array(seen.length);let islandsRemoved=0;
 for(let start=0;start<seen.length;start++){
  if(seen[start]||dst[start*4+3]<=16)continue;
  let head=0,tail=1,scoped=true;queue[0]=start;seen[start]=1;
  while(head<tail){const n=queue[head++],x=n%info.width,y=Math.floor(n/info.width);if(!inScope(x,y))scoped=false;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=x+dx,yy=y+dy;if(xx<0||xx>=info.width||yy<0||yy>=info.height)continue;
    const nn=yy*info.width+xx;if(!seen[nn]&&dst[nn*4+3]>16){seen[nn]=1;queue[tail++]=nn;}
   }
  }
  if(scoped&&tail<1500){for(let i=0;i<tail;i++)dst.fill(0,queue[i]*4,queue[i]*4+4);erased+=tail;islandsRemoved++;}
 }
 // Geometry and pixels outside the four explicitly scoped end windows must be identical.
 let outsideDiff=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  const inScope=boxes.some(([x0,x1,y0,y1])=>x>=x0&&x<x1&&y>=y0&&y<y1);if(inScope)continue;
  const p=(y*info.width+x)*4;if(dst[p]!==src[p]||dst[p+1]!==src[p+1]||dst[p+2]!==src[p+2]||dst[p+3]!==src[p+3])outsideDiff++;
 }
 if(outsideDiff)throw Error('Changed pixels outside track tips: '+outsideDiff);
 const output=path.join(R,'generated',v.key+'_hull-pixel-aligned.png');await sharp(dst,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(output);
 const cross=v.key==='m4a1'?{front:[28,35],rear:[1750,1775]}:{front:[423,434],rear:[1800,1860]};
 const measurements={};
 for(const side of['left','right'])for(const end of['front','rear']){const x=side==='left'?v.left:v.right;measurements[side+'_'+end]=span(dst,info,x,x+v.width,cross[end][0],cross[end][1]);}
 return{key:v.key,source:v.source,sourceSize:[info.width,info.height],output:path.basename(output),beltWidth:v.width,bands:{left:[v.left,v.left+v.width],right:[v.right,v.right+v.width]},frontY:v.front,rearY:v.rear,pixelsCleared:erased,pixelsReused:placed,islandsRemoved,outsideTrackWindowsChanged:outsideDiff,crossSections:measurements};
}
(async()=>{const result=[];for(const v of variants)result.push(await run(v));fs.writeFileSync(path.join(R,'track-alignment-audit.json'),JSON.stringify({authorization:'User explicitly approved pixel crop and alignment in this chat.',method:'Crop/reuse existing rear tread texture, equal-width aligned belts under original armored pixels; no chassis widening.',variants:result},null,2)+'\n');console.log(JSON.stringify(result,null,2));})();
