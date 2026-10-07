// Compile the production fog fragment on WebGL 1/2 and check actual pixels.
const fs = require('fs'), path = require('path'), ts = require('typescript'), { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/fog-gpu');
const moduleData = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/view/FogMaskRaster.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(moduleData, moduleData.exports);
const cells = [];
for (let r = -5; r <= 5; r++) for (let q = -5; q <= 5; q++) {
  const visible = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2 || (r === 0 && q >= 2 && q <= 4);
  cells.push({ x: Math.sqrt(3) * (q + r / 2), y: -1.5 * r, from: visible ? 0 : 1, to: 1 });
}
const start = performance.now();
const mask = moduleData.exports.buildFogMask(cells);
const buildMs = performance.now() - start;
const source = fs.readFileSync(path.join(root, 'assets/resources/effects/fog-overlay.effect'), 'utf8');
const body = source.slice(source.indexOf('CCProgram fog-fs %{') + 'CCProgram fog-fs %{'.length, source.lastIndexOf('}%'));
const shader = body.replace(/#include[^\n]+/g, '').replace(/#pragma[^\n]+/g, '')
  .replace(/layout\(set = 2, binding = 12\) /, '')
  .replace(/uniform FogParams \{ vec4 maskBounds; vec4 fogParams; \};/, 'uniform vec4 maskBounds; uniform vec4 fogParams;')
  .replace('ALPHA_TEST(o);', '');
function browserCheck(input) {
  const result = document.getElementById('result');
  try {
    const compile = (gl, type, text) => {
      const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
      return s;
    };
    const reports = [];
    for (const version of [1, 2]) {
      const canvas = document.createElement('canvas');
      canvas.width = input.mask.width; canvas.height = input.mask.height;
      const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { preserveDrawingBuffer: true, antialias: false });
      if (!gl) throw Error('WebGL ' + version + ' unavailable');
      const vs = version === 2
        ? '#version 300 es\nin vec2 position;out vec2 uv0;out vec4 color;void main(){gl_Position=vec4(position,0,1);uv0=vec2(position.x*.5+.5,.5-position.y*.5);color=vec4(.267,.282,.298,145.0/255.0);}'
        : 'attribute vec2 position;varying vec2 uv0;varying vec4 color;void main(){gl_Position=vec4(position,0,1);uv0=vec2(position.x*.5+.5,.5-position.y*.5);color=vec4(.267,.282,.298,145.0/255.0);}';
      const frag = version === 2
        ? '#version 300 es\n' + input.shader + '\nout vec4 outputColor;void main(){outputColor=frag();}'
        : input.shader.replace(/in vec([24])/g, 'varying vec$1').replace(/\btexture\(/g, 'texture2D(') + '\nvoid main(){gl_FragColor=frag();}';
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const attr = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const m = input.mask;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, m.width, m.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(m.pixels));
      gl.uniform1i(gl.getUniformLocation(program, 'cc_spriteTexture'), 0);
      gl.uniform4f(gl.getUniformLocation(program, 'maskBounds'), m.left, m.top, m.spanX, m.spanY);
      function draw(progress) {
        gl.uniform4f(gl.getUniformLocation(program, 'fogParams'), progress, .055, .25, .75);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const data = new Uint8Array(m.width * m.height * 4);
        gl.readPixels(0, 0, m.width, m.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return data;
      }
      const a = draw(0), b = draw(1), middle = draw(.5), repeated = draw(0);
      let soft = 0, maxMixError = 0;
      for (let i = 3; i < a.length; i += 4) {
        if (a[i] > 10 && a[i] < 135) soft++;
        maxMixError = Math.max(maxMixError, Math.abs(middle[i] - (a[i] + b[i]) / 2));
        if (a[i] !== repeated[i]) throw Error('Static field drifted');
      }
      function alphaAt(x, y, pixels) {
        const px = Math.floor((x - m.left) * m.width / m.spanX);
        const py = m.height - 1 - Math.floor((m.top - y) * m.height / m.spanY);
        return pixels[(py * m.width + px) * 4 + 3];
      }
      if (alphaAt(0, 0, a) !== 0) throw Error('Visible center obscured');
      if (alphaAt(-7, 0, a) < 140) throw Error('Hidden interior revealed');
      if (alphaAt(0, 0, b) < 140) throw Error('End state did not cover center');
      if (!soft || maxMixError > 1) throw Error('Invalid edge or animation interpolation');
      if (a[3] !== 0) throw Error('Fog leaked outside the map');
      if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL drawing error');
      reports.push({ version, softPixels: soft, maxMixError });
      // Show a legible opacity preview rather than transparent grey on white.
      const preview = document.createElement('canvas'); preview.width = m.width; preview.height = m.height;
      const ctx = preview.getContext('2d'), image = ctx.createImageData(m.width, m.height);
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        const i = (y * m.width + x) * 4, j = ((m.height - 1 - y) * m.width + x) * 4;
        const coverage = m.pixels[i + 2] / 255, visibility = 1 - a[j + 3] / 145;
        image.data[i] = coverage ? 70 + visibility * 120 : 24;
        image.data[i + 1] = coverage ? 76 + visibility * 105 : 32;
        image.data[i + 2] = coverage ? 65 + visibility * 64 : 28;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0); document.body.appendChild(preview);
    }
    result.textContent = JSON.stringify({ passed: true, dimensions: [input.mask.width, input.mask.height], buildMs: input.buildMs, reports });
  } catch (error) { result.textContent = JSON.stringify({ passed: false, error: String(error) }); }
}
fs.mkdirSync(out, { recursive: true });
const input = { shader, buildMs, mask: { ...mask, pixels: Array.from(mask.pixels) } };
fs.writeFileSync(path.join(out, 'check.html'), '<!doctype html><meta charset="utf-8"><style>body{background:#18201c;color:#ddd;font:14px monospace}canvas{display:inline-block;width:420px;margin:12px}</style><pre id="result">running</pre><script>(' + browserCheck.toString() + ')(' + JSON.stringify(input) + ')</script>');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const run = spawnSync(chrome, ['--headless', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--user-data-dir=' + path.join(out, 'chrome-profile'), '--virtual-time-budget=5000', '--dump-dom', '--screenshot=' + path.join(out, 'preview.png'), '--window-size=950,650', new URL('file:///' + path.join(out, 'check.html').replace(/\\/g, '/')).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(out, 'chrome.log'), run.stderr || '');
if (run.error) throw run.error;
const reportText = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
if (!reportText) throw Error('No shader result; see tmp/fog-gpu/chrome.log');
const report = JSON.parse(reportText.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
fs.writeFileSync(path.join(out, 'pixel-result.json'), JSON.stringify(report, null, 2));
if (!report.passed) throw Error(report.error);
console.log(JSON.stringify(report, null, 2));
