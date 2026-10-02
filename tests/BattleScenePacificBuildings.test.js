const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
const source=fs.readFileSync('assets/scripts/view/BattleScene.ts','utf8');
const start=source.indexOf('  private ruralRoofFrame('),end=source.indexOf('\n  private ',start+12);
const code=ts.transpileModule('class Probe {'+source.slice(start,end)+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const Probe=new Function(code+';return Probe;')();
const p=new Probe();p.redesignObjectFrames={};p.usesWinterTerrainVisuals=()=>false;
for(let i=1;i<=4;i++)for(const prefix of ['pacific_roof_0','rural_roof_0'])p.redesignObjectFrames[prefix+i]={id:prefix+i};
for(const theater of ['pacific','europe',undefined]){
  p.mission={data:{theater}};
  for(let variant=0;variant<4;variant++)assert.equal(p.ruralRoofFrame(variant).id,(theater==='pacific'?'pacific_roof_0':'rural_roof_0')+(variant+1));
}
p.mission={data:{theater:'pacific'}};delete p.redesignObjectFrames.pacific_roof_01;
assert.equal(p.ruralRoofFrame(0),null,'missing Pacific art never substitutes a European roof');
p.mission={data:{theater:'europe'}};p.usesWinterTerrainVisuals=()=>true;
for(let i=1;i<=4;i++)p.redesignObjectFrames['rural_roof_0'+i+'_snow']={id:'winter'+i};
for(let i=0;i<4;i++)assert.equal(p.ruralRoofFrame(i).id,'winter'+(i+1));
console.log('Pacific and European roof selection stays independent for all variants.');
