// Render the production weather shader on WebGL 1/2 using mission 1's footprint.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/weather-fog-gpu');
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/view/FogWeatherRenderer.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(mod, mod.exports, () => ({}));
const mission = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/missions/mission_01.json'), 'utf8'));
const cells = [];
mission.tiles.forEach((row, r) => row.forEach((tile, col) => {
  if (tile) cells.push({ x: Math.sqrt(3) * (col + (r % 2) / 2), y: -1.5 * r, q: col - (r - r % 2) / 2, r, from: 0, to: 0 });
}));
const at = mission.sherman.at;
const player = { x: Math.sqrt(3) * (at.col + (at.row % 2) / 2), y: -1.5 * at.row,
  q: at.col - (at.row - at.row % 2) / 2, r: at.row };
const footprint = mod.exports.buildFogWeatherFootprint(cells);
// Render at a gameplay-sized resolution, where the old mask's steps were visible.
const mask = { ...footprint, width: Math.ceil(footprint.spanX * 64), height: Math.ceil(footprint.spanY * 64),
  vertices: Array.from(footprint.vertices) };
const source = fs.readFileSync(path.join(root, 'assets/resources/effects/weather-fog.effect'), 'utf8');
const marker = 'CCProgram weather-fog-fs %{';
const shader = source.slice(source.indexOf(marker) + marker.length, source.lastIndexOf('}%'))
  .replace(/#include[^\n]+|#pragma[^\n]+/g, '').replace(/layout\(set = 2, binding = 12\) /, '')
  .replace('uniform WeatherFogParams { vec4 mapBounds; vec4 weatherParams; vec4 fogOrigin; };', 'uniform vec4 mapBounds; uniform vec4 weatherParams; uniform vec4 fogOrigin;')
  .replace('ALPHA_TEST(o);', '');
function check(input) {
  try {
    const reports = [];
    const m = input.mask;
    // Reference coverage evaluates the exact hex polygons at screen-pixel centers.
    // It is never uploaded as a texture: the GPU uses the production geometry.
    m.pixels = new Uint8Array(m.width * m.height * 4);
    for (const cell of input.cells) {
      const y0 = Math.max(0, Math.floor((m.top - cell.y - 1) * m.height / m.spanY));
      const y1 = Math.min(m.height - 1, Math.ceil((m.top - cell.y + 1) * m.height / m.spanY));
      for (let y = y0; y <= y1; y++) {
        const dy = Math.abs(m.top - (y + .5) * m.spanY / m.height - cell.y);
        if (dy > 1) continue;
        const extent = Math.sqrt(3) / 2 * Math.min(1, 2 * (1 - dy));
        const x0 = Math.max(0, Math.ceil((cell.x - extent - m.left) * m.width / m.spanX - .5));
        const x1 = Math.min(m.width - 1, Math.floor((cell.x + extent - m.left) * m.width / m.spanX - .5));
        for (let x = x0; x <= x1; x++) m.pixels[(y * m.width + x) * 4 + 2] = 255;
      }
    }
    for (const version of [1, 2]) {
      const canvas = document.createElement('canvas'); canvas.width = input.mask.width; canvas.height = input.mask.height;
      const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { antialias: false, stencil: true, preserveDrawingBuffer: true });
      if (!gl) throw Error('WebGL ' + version + ' unavailable');
      const compile = (type, source) => {
        const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const vs = (version === 2 ? '#version 300 es\nin' : 'attribute') + ' vec2 position;'
        + (version === 2 ? 'out' : 'varying') + ' vec2 uv0;'
        + (version === 2 ? 'out' : 'varying') + ' vec4 color;'
        + 'void main(){gl_Position=vec4(position,0,1);uv0=vec2(position.x*.5+.5,.5-position.y*.5);color=vec4(194.0/255.0,207.0/255.0,214.0/255.0,1);}';
      const frag = version === 2 ? '#version 300 es\n' + input.shader + '\nout vec4 outputColor;void main(){outputColor=frag();}'
        : input.shader.replace(/in vec([24])/g, 'varying vec$1').replace(/\btexture\(/g, 'texture2D(') + '\nvoid main(){gl_FragColor=frag();}';
      const program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const attr = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const param of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, param, gl.LINEAR);
      for (const param of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, param, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
      gl.uniform1i(gl.getUniformLocation(program, 'cc_spriteTexture'), 0);
      gl.uniform4f(gl.getUniformLocation(program, 'mapBounds'), m.left, m.top, m.spanX, m.spanY);
      gl.uniform4f(gl.getUniformLocation(program, 'weatherParams'), 0, .05, .20, .10);
      gl.uniform4f(gl.getUniformLocation(program, 'fogOrigin'), input.player.x, input.player.y, 0, 0);
      // Match Graphics-stencil filling: each production hex is a triangle fan.
      const triangles = [];
      const vertex = i => { triangles.push((m.vertices[i] - m.left) / m.spanX * 2 - 1,
        (m.vertices[i + 1] - m.top) / m.spanY * 2 + 1); };
      for (let start = 0; start < m.vertices.length; start += 12) for (let i = 1; i < 5; i++) {
        vertex(start); vertex(start + i * 2); vertex(start + (i + 1) * 2);
      }
      const stencilBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, stencilBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangles), gl.STATIC_DRAW);
      gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.ALWAYS, 1, 255); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.colorMask(false, false, false, false); gl.drawArrays(gl.TRIANGLES, 0, triangles.length / 2);
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.EQUAL, 1, 255); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
      const draw = (time, flow = .20, player = input.player) => {
        gl.uniform4f(gl.getUniformLocation(program, 'weatherParams'), time, .05, flow, .10);
        gl.uniform4f(gl.getUniformLocation(program, 'fogOrigin'), player.x, player.y, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const data = new Uint8Array(m.width * m.height * 4); gl.readPixels(0, 0, m.width, m.height, gl.RGBA, gl.UNSIGNED_BYTE, data); return data;
      };
      const start = draw(0), repeat = draw(0), near = draw(1 / 60), later = draw(30);
      let min = 255, max = 0, changed = 0, frameDelta = 0;
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        const i = (y * m.width + x) * 4, j = ((m.height - 1 - y) * m.width + x) * 4;
        if (start[j + 3] !== repeat[j + 3]) throw Error('Same time is not deterministic');
        if (!m.pixels[i + 2] && start[j + 3]) throw Error('Fog leaks outside the map');
        if (m.pixels[i + 2] && start[j + 3]) { min = Math.min(min, start[j + 3]); max = Math.max(max, start[j + 3]); }
        // GPU top-left fill rules may omit a pixel centered exactly on the
        // outer mathematical boundary, but must never leave interior cracks.
        if (m.pixels[i + 2] && !start[j + 3] && x > 0 && y > 0 && x + 1 < m.width && y + 1 < m.height
          && m.pixels[i - 2] && m.pixels[i + 6] && m.pixels[i - m.width * 4 + 2] && m.pixels[i + m.width * 4 + 2]) {
          throw Error('Geometric stencil has an interior crack at ' + [x, y]);
        }
        if (Math.abs(start[j + 3] - later[j + 3]) > 2) changed++;
        frameDelta = Math.max(frameDelta, Math.abs(start[j + 3] - near[j + 3]));
      }
      if (min < 12 || max - min < 80) throw Error('Fog distance gradient is unreadable or flat: ' + [min, max]);
      if (changed < 100 || frameDelta > 2) throw Error('Fog must flow slowly and continuously');
      const alphaAt = (pixels, p) => {
        const x = Math.floor((p.x - m.left) * m.width / m.spanX);
        const y = m.height - 1 - Math.floor((m.top - p.y) * m.height / m.spanY);
        return pixels[(y * m.width + x) * 4 + 3];
      };
      let maxBaseError = 0;
      // All real tile centers, from both the initial player location and a new
      // location: verify 5% + 10% per hex independently of the flow texture.
      for (const origin of [input.player, input.cells[Math.floor(input.cells.length / 2)]]) {
        const base = draw(0, 0, origin);
        for (const cell of input.cells) {
          const dq = cell.q - origin.q, dr = cell.r - origin.r;
          const distance = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
          const expected = Math.min(1, .05 + .10 * distance) * 255;
          maxBaseError = Math.max(maxBaseError, Math.abs(alphaAt(base, cell) - expected));
        }
        if (Math.abs(alphaAt(base, origin) - 255 * .05) > 2) throw Error('Player tile must have 5% base fog');
      }
      if (maxBaseError > 2) throw Error('Base fog does not increase by 10% per hex: ' + maxBaseError);
      // Small fractional movement must change opacity smoothly, not snap rings.
      const beforeMove = draw(0, 0), afterMove = draw(0, 0, { x: input.player.x + .01, y: input.player.y });
      let movementDelta = 0;
      for (let i = 3; i < beforeMove.length; i += 4) movementDelta = Math.max(movementDelta, Math.abs(beforeMove[i] - afterMove[i]));
      if (movementDelta > 1) throw Error('Gradient jumps when the player moves');
      if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL drawing error');
      reports.push({ version, stencilResolution: [m.width, m.height], outsidePixelsWithFog: 0,
        minAlpha: min, maxAlpha: max, maxBaseAlphaError: maxBaseError,
        maxMovementAlphaChange: movementDelta, changedAfter30Seconds: changed, maxFrameAlphaChange: frameDelta });
      // Display opacity over an olive ground for visual review.
      const preview = document.createElement('canvas'); preview.width = m.width; preview.height = m.height;
      const ctx = preview.getContext('2d'), image = ctx.createImageData(m.width, m.height);
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        const i = (y * m.width + x) * 4, j = ((m.height - 1 - y) * m.width + x) * 4, a = start[j + 3] / 255;
        [113, 122, 75].forEach((v, c) => { image.data[i + c] = m.pixels[i + 2] ? v * (1 - a) + [194,207,214][c] * a : 24; });
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0); document.body.appendChild(preview);
    }
    document.getElementById('result').textContent = JSON.stringify({ passed: true, reports });
  } catch (error) { document.getElementById('result').textContent = JSON.stringify({ passed: false, error: String(error) }); }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'check.html'), '<!doctype html><meta charset="utf-8"><style>body{background:#18201c;color:#ddd;font:14px monospace}canvas{width:420px;margin:12px}</style><pre id="result">running</pre><script>(' + check.toString() + ')(' + JSON.stringify({ shader, player, cells, mask }) + ')</script>');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const run = spawnSync(chrome, ['--headless', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--user-data-dir=' + path.join(out, 'chrome-profile'), '--virtual-time-budget=5000', '--dump-dom', '--screenshot=' + path.join(out, 'preview.png'), '--window-size=950,650', new URL('file:///' + path.join(out, 'check.html').replace(/\\/g, '/')).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(out, 'chrome.log'), run.stderr || '');
if (run.error) throw run.error;
const match = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (!match) throw Error('Missing shader result; see tmp/weather-fog-gpu/chrome.log');
const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
fs.writeFileSync(path.join(out, 'pixel-result.json'), JSON.stringify(report, null, 2));
if (!report.passed) throw Error(report.error);
console.log(JSON.stringify(report, null, 2));
