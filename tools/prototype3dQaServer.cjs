/** Local-only Cocos preview diagnostics. No browser control or project state changes. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const out = path.resolve(__dirname, '../outputs/prototype3d');
fs.mkdirSync(out, { recursive: true });
const probe = `<script>
window.__prototypeErrors=[];
for(const level of ['error','warn']){const original=console[level];console[level]=(...args)=>{if(window.__prototypeErrors.length<100)window.__prototypeErrors.push(level+': '+args.map(String).join(' '));original.apply(console,args);};}
addEventListener('error',e=>window.__prototypeErrors.push(String(e.message)));
addEventListener('unhandledrejection',e=>window.__prototypeErrors.push(String(e.reason?.stack||e.reason)));
addEventListener('load',()=>{
  let previous='',pending=false,smokeStarted=false;
  const timer=setInterval(async()=>{
    try {
      if(!window.System) return;
      const cc=await System.import('cc'),scene=cc.director.getScene();
      const instance=scene?.getComponentsInChildren('Prototype3DScene')[0];
      const b=instance?.battle;
      const state={scene:scene?.name,ready:!!b,errors:window.__prototypeErrors};
      if(b) Object.assign(state,{turn:b.turn,playerHP:b.playerHP,enemyHP:b.enemyHP,moves:b.moves,fired:b.fired,
        outcome:b.outcome,player:b.player,busy:instance.busy,status:instance.status?.string,
        camera:[instance.yaw,instance.pitch,instance.distance],meshes:instance.meshes?.length,
        materials:instance.materials?.length,canvas:[cc.game.canvas.width,cc.game.canvas.height],
        tankWorld:instance.player?.root.position,shadows:scene.globals.shadows.enabled});
      const json=JSON.stringify(state);
      if(json===previous||pending)return;
      previous=json;pending=true;
      fetch('/__qa/state',{method:'POST',body:json});
      if(b&&instance.status){
        cc.director.once(cc.Director.EVENT_AFTER_DRAW,()=>{
          try{fetch('/__qa/frame',{method:'POST',body:cc.game.canvas.toDataURL('image/png')});}catch(e){}
        });
        if(new URLSearchParams(location.search).has('smoke')&&!smokeStarted){smokeStarted=true;window.runPrototypeSmoke(cc,scene);}
      }
      pending=false;
    } catch(e){
      fetch('/__qa/state',{method:'POST',body:JSON.stringify({probeError:String(e.stack||e),errors:window.__prototypeErrors})});
    }
  },750);
});
</script>`;
http.createServer((req,res)=>{
  if(req.url==='/__qa/smoke.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(__dirname,'prototype3dRuntimeSmoke.js')));return;}
  if(req.url.startsWith('/__qa/')) {
    if(req.method==='GET'){
      res.setHeader('Content-Type','application/json');
      res.end(fs.existsSync(path.join(out,'runtime.json'))?fs.readFileSync(path.join(out,'runtime.json')):'{}');return;
    }
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
      const body=Buffer.concat(chunks).toString();
      if(req.url.startsWith('/__qa/frame')) {
        const name=new URL(req.url,'http://localhost').searchParams.get('name')||'latest';
        if(/^[a-z]+$/.test(name)&&body.startsWith('data:image/png;base64,')) fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(body.split(',')[1],'base64'));
      } else {fs.writeFileSync(path.join(out,req.url==='/__qa/smoke'?'smoke.json':'runtime.json'),body);console.log(body);}
      res.end('ok');
    });return;
  }
  const requestHeaders={...req.headers,host:'localhost:7456'};
  delete requestHeaders['if-none-match'];delete requestHeaders['if-modified-since'];
  const upstream=http.request({hostname:'127.0.0.1',port:7456,path:req.url,method:req.method,headers:requestHeaders},response=>{
    const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
      let body=Buffer.concat(chunks);const headers={...response.headers};
      if(headers['content-encoding']==='gzip')body=zlib.gunzipSync(body);
      else if(headers['content-encoding']==='br')body=zlib.brotliDecompressSync(body);
      else if(headers['content-encoding']==='deflate')body=zlib.inflateSync(body);
      if((headers['content-type']||'').includes('text/html')) body=Buffer.from(body.toString().replace('</head>', '<script src="/__qa/smoke.js"></script>'+probe+'</head>'));
      if((headers['content-type']||'').includes('javascript')&&body.includes(Buffer.from('_export("Prototype3DScene"'))) {
        body=Buffer.from(body.toString().replace('onLoad() {','onLoad() { try {').replace(/}\s*material\(name, hex, unlit\)/,'}catch(error){window.__prototypeErrors.push(String(error.stack));throw error;} } material(name, hex, unlit)'));
      }
      delete headers['content-length'];delete headers['content-encoding'];
      delete headers.etag;headers['cache-control']='no-store';
      res.writeHead(response.statusCode,headers);res.end(body);
    });
  });upstream.on('error',e=>{res.writeHead(502);res.end(String(e));});req.pipe(upstream);
}).listen(7460,'127.0.0.1',()=>console.log('Prototype QA: http://localhost:7460/?scene=0ef7f5b5-6d81-486f-8ceb-1e646888c19b'));
