// Visual QA of the production seawall geometry at corners and junctions.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {Graphics,art}=require('./renderNormandyTerrainPreview.cjs');
async function main(){
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="960" height="370"><rect width="960" height="370" fill="#eee8d9"/><g font-family="Microsoft YaHei,sans-serif" fill="#393d35"><text x="28" y="40" font-size="24">海堤连接优化 · 垂直顶视</text>';
  const scenarios=[
    {title:'连续转角',edges:[[0,50,0,-50],[0,-50,86.6,-100],[-86.6,100,0,50]]},
    {title:'三向交汇',edges:[[0,0,0,100],[0,0,-86.6,-50],[0,0,86.6,-50]]},
    {title:'保留通道',edges:[[-120,0,-30,0],[30,0,120,0]]},
  ];
  scenarios.forEach((s,i)=>{
    const x=160+i*320,y=190,g=new Graphics();
    svg+=`<rect x="${x-140}" y="68" width="280" height="247" rx="8" fill="#c2b597"/>`;
    for(const edge of s.edges)art.drawBeachEdge(g,...edge,100,'seawall');
    art.drawSeawallJoints(g,s.edges,100);
    svg+=`<g transform="translate(${x} ${y}) scale(1 -1)">${g.items.join('')}`;
    svg+=`</g><text x="${x}" y="348" text-anchor="middle" font-size="20">${s.title}</text>`;
  });
  svg+='</g></svg>';
  const output=path.resolve(__dirname,'../source_art/terrain/normandy-concept-20261013');
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'seawall-joins-preview.svg'),svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(output,'seawall-joins-preview.png'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
