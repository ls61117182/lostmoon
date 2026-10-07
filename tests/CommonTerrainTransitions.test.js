const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),sharp=require('sharp');
const {borderSample,context,PAIRS}=require('../tools/bakeCommonTerrainTransitions.cjs');
const R=48,SQ=Math.sqrt(3),axes=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]],palette={field:[205,208,144],mud:[129,100,73],water:[85,159,178]};
// A shared face and both ends see the same two/three incident materials,
// irrespective of which hex owns the sample.
for(const pair of [['field','mud'],['water','field']])for(let i=0;i<6;i++)for(const u of [-.9,-.5,0,.5,.9]){
 const a=pair[0],b=pair[1],theta=i*Math.PI/3,nx=Math.cos(theta),ny=Math.sin(theta),x=nx*SQ*R/2-ny*u*R/2,y=ny*SQ*R/2+nx*u*R/2;
 const left=Array(6).fill(a),right=Array(6).fill(a);left[i]=b;
 const x2=x-nx*SQ*R,y2=y-ny*SQ*R;
 const sa=borderSample(x,y,a,left,palette),sb=borderSample(x2,y2,b,right,palette);
 for(let k=0;k<3;k++)assert(Math.abs(sa.rgb[k]-sb.rgb[k])<1e-6,'face and corner colors must agree across translated hexes');
}
async function main(){const root='source_art/terrain/prefab-transitions-v1',manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));assert.equal(manifest.entries.length,PAIRS.length*128);let count=0;
 for(const [style,a,b]of PAIRS){const entries=manifest.entries.filter(e=>e.style===style&&[a,b].includes(e.center)&&[a,b].includes(e.other));assert.equal(entries.length,128);for(const center of [a,b])assert.equal(new Set(entries.filter(e=>e.center===center).map(e=>e.neighborMask)).size,64);}
 for(const e of manifest.entries){assert(fs.existsSync(path.join(root,e.color)));assert.equal(e.outerRing.length,12);const topology=context(e.center,e.other,e.neighborMask);assert.deepEqual(e.outerRing,topology.tiles.slice(7).map(t=>[t.pos.q,t.pos.r,t.terrain===e.other?1:0]));if(e.waterMask){assert(fs.existsSync(path.join(root,e.waterMask)));count++;}}
 assert.equal(count,640);
 for(const e of manifest.entries.filter(e=>[0,1,7,21,63].includes(e.neighborMask))){const file=path.join(root,e.color),meta=await sharp(file).metadata();assert.equal(meta.width,170);assert.equal(meta.height,194);assert(meta.hasAlpha);const raw=await sharp(file).raw().toBuffer();assert.equal(raw[3],0,'rectangle corners must be transparent');assert(raw[(97*170+85)*4+3]>0,'hex center must be covered');}
 console.log('Common prefabs: all 1152 topologies, 640 animation masks, alpha bounds and shared-face color continuity passed.');}
main().catch(e=>{console.error(e);process.exitCode=1;});
