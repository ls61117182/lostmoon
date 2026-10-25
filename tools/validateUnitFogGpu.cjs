// Compile production sprite, outline and premultiplied Graphics shaders on WebGL 1/2.
const fs = require('fs'), path = require('path'), ts = require('typescript'), { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/unit-fog-gpu');
const moduleData = { exports: {} };
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/view/FogMaskRaster.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(moduleData.exports);
const cells = [];
for (let r = -3; r <= 3; r++) for (let q = -4; q <= 4; q++) {
  cells.push({ x: Math.sqrt(3) * (q + r / 2), y: -1.5 * r, from: q <= 0 ? 0 : 1, to: q <= -1 ? 0 : 1 });
}
const mask = moduleData.exports.buildFogMask(cells);
function shader(file, stage) {
  const source = fs.readFileSync(path.join(root, 'assets/resources/effects', file + '.effect'), 'utf8');
  const programs = [...source.matchAll(/CCProgram\s+(\S+)\s+%\{([\s\S]*?)\}%/g)];
  let code = programs.find(p => new RegExp(`vec4\\s+${stage}\\s*\\(`).test(p[2]))[2];
  for (const name of ['unit-fog-vs', 'unit-fog-fs']) code = code.replace(`#include <${name}>`, fs.readFileSync(path.join(root, 'assets/resources/effects', name + '.chunk'), 'utf8'));
  code = code.replace(/#include[^\n]+/g, '').replace(/#pragma[^\n]+/g, '')
    .replace(/layout\(set = 2, binding = 12\) /g, '')
    .replace(/uniform\s+\w+\s*\{([^}]+)\};/g, (_, members) => members.replace(/vec4\s+(\w+)\s*;/g, 'uniform vec4 $1;'))
    .replace('ALPHA_TEST(o);', '');
  if (stage === 'vert') code = 'uniform mat4 cc_matWorld;uniform mat4 cc_matViewProj;uniform mat4 cc_matView;uniform mat4 cc_matProj;\n' + code;
  if (stage === 'frag') code = code.replace('  vec4 frag ()', '  vec4 frag ()');
  return code;
}
function browserCheck(input) {
  const result = document.getElementById('result');
  try {
    const reports = [];
    for (const version of [1, 2]) {
      const canvas = document.createElement('canvas'); canvas.width = input.mask.width; canvas.height = input.mask.height;
      const gl = canvas.getContext(version === 1 ? 'webgl' : 'webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
      if (!gl) throw Error(`WebGL ${version} unavailable`);
      const derivatives = version === 1 && gl.getExtension('OES_standard_derivatives');
      const compile = (type, code) => {
        const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
        return s;
      };
      const build = source => {
        const p = gl.createProgram();
        for (const stage of ['vert', 'frag']) {
          let code = source[stage];
          if (version === 1) code = code.replace(/^\s*in\s/gm, stage === 'vert' ? 'attribute ' : 'varying ').replace(/^\s*out\s/gm, 'varying ').replace(/\btexture\(/g, 'texture2D(');
          let header = version === 2 ? '#version 300 es\n' : '';
          if (stage === 'frag' && derivatives) header += '#extension GL_OES_standard_derivatives : enable\n';
          header += '#define USE_LOCAL 1\n#define USE_TEXTURE 1\n#define USE_PIXEL_ALIGNMENT 0\n#define SAMPLE_FROM_RT 0\n#define IS_GRAY 0\n';
          if (stage === 'frag') header += `precision highp float;vec4 CCSampleWithAlphaSeparated(sampler2D s,vec2 uv){return ${version === 1 ? 'texture2D' : 'texture'}(s,uv);}\n`;
          code = header + code;
          code += stage === 'vert' ? '\nvoid main(){gl_Position=vert();}' : version === 1 ? '\nvoid main(){gl_FragColor=frag();}' : '\nout vec4 pixel;void main(){pixel=frag();}';
          gl.attachShader(p, compile(stage === 'vert' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER, code));
        }
        gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
        return p;
      };
      const programs = Object.fromEntries(Object.entries(input.programs).map(([name, code]) => [name, build(code)]));
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, -1,1,0,0, 1,-1,1,1, 1,1,1,0]), gl.STATIC_DRAW);
      const texture = (unit, width, height, pixels, linear) => {
        gl.activeTexture(gl.TEXTURE0 + unit); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels));
        return t;
      };
      const terrain = texture(1, input.mask.width, input.mask.height, input.mask.pixels, true);
      const art = texture(0, 2, 2, [255,255,255,0, 255,255,255,255, 255,255,255,255, 255,255,255,255], false);
      const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      function draw(name, progress, shift, enabled, outside) {
        const p = programs[name]; gl.useProgram(p);
        const loc = key => gl.getUniformLocation(p,key);
        for (let i = 0; i < gl.getParameter(gl.MAX_VERTEX_ATTRIBS); i++) gl.disableVertexAttribArray(i);
        for (const [name,size,offset] of [['a_position',2,0],['a_texCoord',2,8]]) {
          const a = gl.getAttribLocation(p,name); if(a < 0) continue;
          gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a,size,gl.FLOAT,false,16,offset);
        }
        const color = gl.getAttribLocation(p,'a_color');
        if (color >= 0) gl.vertexAttrib4f(color,1,1,1,name === 'terrain' ? 145/255 : 1);
        const dist = gl.getAttribLocation(p,'a_dist'); if(dist >= 0) gl.vertexAttrib1f(dist,0);
        const world = [...identity]; world[12] = shift;
        gl.uniformMatrix4fv(loc('cc_matWorld'),false,new Float32Array(world));
        gl.uniformMatrix4fv(loc('cc_matViewProj'),false,new Float32Array(identity));
        gl.uniform4f(loc('unitFogUvX'),.5,0,.5,enabled);
        gl.uniform4f(loc('unitFogUvY'),0,-.5,.5,outside);
        const m = input.mask;
        gl.uniform4f(loc('unitFogBounds'),m.left,m.top,m.spanX,m.spanY);
        gl.uniform4f(loc('maskBounds'),m.left,m.top,m.spanX,m.spanY);
        gl.uniform4f(loc('unitFogShape'),progress,.055,.25,.75);
        gl.uniform4f(loc('fogParams'),progress,.055,.25,.75);
        gl.uniform4f(loc('uvBounds'),0,0,1,1); gl.uniform4f(loc('outlineStep'),.03,0,0,.03);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,name === 'terrain' ? terrain : art);
        gl.uniform1i(loc('cc_spriteTexture'),0);gl.uniform1i(loc('unitFogTexture'),1);
        gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);
        const pixels = new Uint8Array(m.width*m.height*4);gl.readPixels(0,0,m.width,m.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL error in '+name);
        return pixels;
      }
      let cases = 0, soft = 0, maxError = 0;
      for (const progress of [0,.5,1]) {
        const fog = draw('terrain',progress,0,0,0);
        for (const name of ['sprite','graphics','outline']) for (const shift of [-.4,0,.4]) {
          const baseline=draw(name,progress,shift,0,0), masked=draw(name,progress,shift,1,0), known=draw(name,progress,shift,1,1);
          for(let y=0;y<input.mask.height;y++)for(let x=0;x<input.mask.width;x++){
            const i=(y*input.mask.width+x)*4, j=((input.mask.height-1-y)*input.mask.width+x)*4;
            const coverage=input.mask.pixels[j+2];
            if(coverage===255){
              const expected=baseline[i+3]*(1-fog[i+3]/145), error=Math.abs(masked[i+3]-expected);
              maxError=Math.max(maxError,error);
              if(error>3)throw Error(`${name} shared mask mismatch ${error} at ${x},${y}`);
              if(fog[i+3]>5&&fog[i+3]<140&&baseline[i+3]>100)soft++;
              if(baseline[i+3]===0&&masked[i+3]!==0)throw Error('Source alpha hole lost');
            }else if(coverage===0 && [-4,4,-input.mask.width*4,input.mask.width*4].every(offset =>
              j+offset>=0 && j+offset<input.mask.pixels.length && input.mask.pixels[j+offset+2]===0)){
              if(masked[i+3]>1)throw Error(`Hidden unit leaked outside map: ${name} ${shift} ${x},${y} alpha=${masked[i+3]}`);
              if(known[i+3]!==baseline[i+3])throw Error('Known unit overhang clipped');
            }
          }
          cases++;
        }
      }
      if(!soft)throw Error('No partially visible unit pixels');
      draw('sprite',.5,0,1,0);document.body.appendChild(canvas);
      reports.push({version,cases,softPixels:soft,maxAlphaError:maxError});
    }
    result.textContent=JSON.stringify({passed:true,reports});
  }catch(e){result.textContent=JSON.stringify({passed:false,error:String(e)});}
}
const programs = Object.fromEntries([['terrain','fog-overlay'],['sprite','unit-fog-sprite'],['graphics','unit-fog-graphics'],['outline','unit-silhouette']]
  .map(([name,file]) => [name,{vert:shader(file,'vert'),frag:shader(file,'frag')}]));
fs.mkdirSync(out,{recursive:true});
const input={mask:{...mask,pixels:Array.from(mask.pixels)},programs};
fs.writeFileSync(path.join(out,'check.html'),'<meta charset="utf-8"><style>body{background:#304536;color:white}canvas{width:450px;margin:12px}</style><pre id="result">running</pre><script>('+browserCheck.toString()+')('+JSON.stringify(input)+')</script>');
const run=spawnSync(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless','--no-first-run','--disable-background-networking','--disable-component-update','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--allow-file-access-from-files','--user-data-dir='+path.join(out,'chrome-profile'),'--virtual-time-budget=5000','--dump-dom',
  '--screenshot='+path.join(out,'preview.png'),'--window-size=1000,650',new URL('file:///'+path.join(out,'check.html').replace(/\\/g,'/')).href,
],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(out,'chrome.log'),run.stderr||'');
if(run.error)throw run.error;
const text=run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
if(!text)throw Error('No GPU report; see tmp/unit-fog-gpu/chrome.log');
const report=JSON.parse(text.replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&'));
fs.writeFileSync(path.join(out,'pixel-result.json'),JSON.stringify(report,null,2));
if(!report.passed)throw Error(report.error);
console.log(JSON.stringify(report,null,2));
