const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../build/multi-region-test/web-desktop');
const fallback = path.resolve(__dirname, '../build/multi-region-test');
const directory = fs.existsSync(path.join(root, 'index.html')) ? root : fallback;
const port = Number(process.argv[2] || 18765);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
http.createServer((req, res) => {
  let filename;
  try { filename = path.resolve(directory, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400); res.end(); return; }
  if (filename !== directory && !filename.startsWith(directory + path.sep)) { res.writeHead(403); res.end(); return; }
  if (filename === directory || req.url.endsWith('/')) filename = path.join(filename, 'index.html');
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(filename).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Multi-region test: http://127.0.0.1:${port} (${directory})`));
