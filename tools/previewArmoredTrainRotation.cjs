const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp'),ts=require('typescript');
const {ROOT,SOURCE,OUT,SIZE}=require('./prepareArmoredTrainArt.cjs');
const geometrySource=ts.transpileModule(fs.readFileSync(path.join(ROOT,'assets/scripts/core/ArmoredTrainArt.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const geometry={};new Function('exports',geometrySource)(geometry);
const manifest=JSON.parse(fs.readFileSync(path.join(OUT,'bp44_art_manifest.json'),'utf8'));
geometry.validateArmoredTrainArt(manifest);
const resource=p=>path.join(ROOT,'assets/resources',p.replace('/spriteFrame','.png'));
async function rotated(file,degrees){const png=await sharp(file).rotate(-degrees,{background:'#00000000'}).png().toBuffer(),m=await sharp(png).metadata();return sharp(png).extract({left:Math.floor((m.width-SIZE)/2),top:Math.floor((m.height-SIZE)/2),width:SIZE,height:SIZE}).png().toBuffer();}
async function compose(id,bodyAngleDegrees,aim={}){
  const module=geometry.trainModuleArt(manifest,id),layers=[];
  for(const slot of module.weapons){
    const weapon=geometry.trainWeaponArt(manifest,slot.id),angle=aim[slot.slotId]??bodyAngleDegrees-slot.initialAngleDegrees;
    const p=geometry.trainWeaponPose(manifest,module,slot,{x:SIZE/2,y:SIZE/2,angleDegrees:bodyAngleDegrees},angle,SIZE/2);
    layers.push({input:await rotated(resource(weapon.sprite),angle),left:Math.round(p.position.x-SIZE/2),top:Math.round(SIZE-p.position.y-SIZE/2)});
  }
  return sharp(await rotated(resource(module.body),bodyAngleDegrees)).composite(layers).png().toBuffer();
}
async function sheet(){
  const width=1536,height=1110,layers=[];
  let labels='<g font-family="Microsoft YaHei,sans-serif" fill="#e8e3cf"><text x="20" y="36" font-size="27">车厢与武器 · 独立旋转验证</text><text x="20" y="66" font-size="16">同一套独立 PNG；武器围绕自己的安装轴旋转，车厢轮廓保持独立。</text>';
  ['独立车厢（无武器）','初始合成','仅主武器转向','另一武器 / 车厢转向'].forEach((name,i)=>labels+=`<text x="${210+i*330}" y="105" font-size="17">${name}</text>`);
  const examples=[
    {id:'howitzer',poses:[[0,{}],[0,{main_gun:90}],[60,{main_gun:90}]],note:'右列：车厢转 60°，炮塔方向保持'},
    {id:'artillery_flak',poses:[[0,{}],[0,{main_gun:90}],[0,{main_gun:90,anti_aircraft:45}]],note:'右列：主炮保持，防空炮单独转向'},
    {id:'panzerjaeger',poses:[[0,{}],[0,{anti_tank:90}],[60,{anti_tank:90}]],note:'右列：车厢转 60°，反坦克炮方向保持'},
  ];
  for(const [row,example]of examples.entries()){
    const module=geometry.trainModuleArt(manifest,example.id),y=125+row*320;
    labels+=`<text x="20" y="${y+70}" font-size="18">${module.label}</text><text x="20" y="${y+290}" font-size="13">${example.note}</text>`;
    layers.push({input:await sharp(resource(module.body)).resize(280,280).png().toBuffer(),left:185,top:y});
    for(const [i,[angle,aim]]of example.poses.entries())layers.push({input:await sharp(await compose(example.id,angle,aim)).resize(280,280).png().toBuffer(),left:515+i*330,top:y});
  }
  const header=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</g></svg>`);
  await sharp({create:{width,height,channels:4,background:'#283129'}}).composite([{input:header,left:0,top:0},...layers]).png().toFile(path.join(SOURCE,'previews/bp44-independent-rotation.png'));
}
async function interactive(){
  const images={};for(const p of [...manifest.modules.map(m=>m.body),...manifest.weapons.map(w=>w.sprite)])images[p]='data:image/png;base64,'+fs.readFileSync(resource(p)).toString('base64');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>BP44 独立武器旋转</title><style>body{background:#253026;color:#eee9d6;font:16px system-ui;max-width:1050px;margin:24px auto}h1{font-size:25px}main{display:flex;gap:20px;flex-wrap:wrap}#stage{width:600px;height:600px;position:relative;background:#354333;border:1px solid #65745b;overflow:visible}#stage img{position:absolute;width:384px;height:384px;pointer-events:none}aside{width:350px}label{display:block;margin:20px 0 6px}input{width:100%}select,button{font:inherit;color:inherit;background:#465740;padding:7px;border:1px solid #94a081}small,p{line-height:1.7}#stage .mark{position:absolute;width:5px;height:5px;border-radius:50%;background:#f6bc5b;transform:translate(-50%,-50%);pointer-events:none}#stage .muzzle{background:#8de4e2;width:4px;height:4px}</style><h1>BP 44 · 车厢与武器独立旋转</h1><p>拖动一项只改变对应部分的角度。车厢转向时安装位随车体移动，武器保持当前瞄准方向。</p><main><div id="stage"></div><aside><label>模块 <select id="module"></select></label><label>车厢角度 <span id="bodyValue">0°</span><input id="body" type="range" min="-180" max="180" value="0"></label><div id="controls"></div><button id="reset">恢复初始方向</button><p>角度按逆时针计算，0° 朝上。橙点为转轴，青点为炮口。</p><small>旋转范围仅用于验证美术分层；具体射界和战斗规则待后续确定。</small></aside></main><script>
const geometry={};((exports)=>{${geometrySource}})(geometry);
const manifest=${JSON.stringify(manifest)},images=${JSON.stringify(images)};
const stage=document.querySelector('#stage'),picker=document.querySelector('#module'),body=document.querySelector('#body'),controls=document.querySelector('#controls');
let selected='artillery_flak',aim={},inputs={},nodes={};
for(const m of manifest.modules.filter(m=>m.weapons.length)){const o=document.createElement('option');o.value=m.id;o.textContent=m.label;picker.appendChild(o)}picker.value=selected;
function image(path){const node=document.createElement('img');node.src=images[path];stage.appendChild(node);return node}
function put(node,pivot,position,angle){const scale=384/512;node.style.left=(300+position.x-pivot.x*scale)+'px';node.style.top=(300-position.y-pivot.y*scale)+'px';node.style.transformOrigin=(pivot.x*scale)+'px '+(pivot.y*scale)+'px';node.style.transform='rotate('+(-angle)+'deg)'}
function draw(){const m=geometry.trainModuleArt(manifest,selected),angle=Number(body.value);document.querySelector('#bodyValue').textContent=angle+'°';stage.querySelectorAll('.mark').forEach(n=>n.remove());put(nodes.body,m.pivot,{x:0,y:0},angle);for(const slot of m.weapons){const w=geometry.trainWeaponArt(manifest,slot.id),p=geometry.trainWeaponPose(manifest,m,slot,{x:0,y:0,angleDegrees:angle},aim[slot.slotId],192);put(nodes[slot.slotId],w.pivot,p.position,p.angleDegrees);inputs[slot.slotId].label.textContent=w.label+' '+aim[slot.slotId]+'°';for(const [i,point]of[p.position,...p.muzzles].entries()){const dot=document.createElement('i');dot.className='mark'+(i?' muzzle':'');dot.style.left=(300+point.x)+'px';dot.style.top=(300-point.y)+'px';stage.appendChild(dot)}}}
function rebuild(){stage.innerHTML='';controls.innerHTML='';body.value='0';aim={};inputs={};nodes={};const m=geometry.trainModuleArt(manifest,selected);nodes.body=image(m.body);for(const slot of m.weapons){const w=geometry.trainWeaponArt(manifest,slot.id);aim[slot.slotId]=-slot.initialAngleDegrees;nodes[slot.slotId]=image(w.sprite);const label=document.createElement('label'),input=document.createElement('input');input.type='range';input.min='-180';input.max='180';input.value=String(aim[slot.slotId]);input.oninput=()=>{aim[slot.slotId]=Number(input.value);draw()};controls.appendChild(label);controls.appendChild(input);inputs[slot.slotId]={label,input}}draw()}
picker.onchange=()=>{selected=picker.value;rebuild()};body.oninput=draw;document.querySelector('#reset').onclick=rebuild;rebuild();
</script></html>`;
  fs.writeFileSync(path.join(SOURCE,'previews/bp44-independent-rotation.html'),html);
}
async function main(){await sheet();await interactive();console.log('Independent rotation sheet and offline interactive preview saved.');}
module.exports={compose,geometry,manifest};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
