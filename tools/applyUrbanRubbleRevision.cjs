const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/terrain/urban-redraw-20261005');
const target = path.join(root, 'assets/resources/textures/terrain/urban');
const backup = path.join(source, 'before-natural-rubble');
const revision = JSON.parse(fs.readFileSync(path.join(source, 'rubble-revision.json'), 'utf8'));
const manifestFile = path.join(source, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
function preserve(file, relative) {
  const saved = path.join(backup, relative);
  if (fs.existsSync(saved)) return;
  fs.mkdirSync(path.dirname(saved), { recursive: true });
  fs.copyFileSync(file, saved);
}
if (revision.images.length !== 4 || revision.images.some(e => e.state !== 'rubble' || !fs.existsSync(e.generatedPath))) throw new Error('Incomplete generated rubble revision');
preserve(manifestFile, 'manifest.json');
preserve(path.join(source, 'validation.json'), 'validation.json');
for (const name of fs.readdirSync(target).filter(name => name.startsWith('urban_dense') && name.endsWith('.png'))) preserve(path.join(target, name), 'runtime/' + name);
for (const entry of revision.images) {
  const old = manifest.images.find(e => e.key === entry.key && e.state === 'rubble');
  if (!old) throw new Error('Unknown rubble variant: ' + entry.key);
  preserve(old.path, 'generated/' + path.basename(old.path));
  fs.copyFileSync(entry.generatedPath, old.path);
  old.previousPrompt = old.prompt;
  old.prompt = entry.prompt;
  old.generatedPath = entry.generatedPath;
  old.revision = 'natural-rubble-20261005';
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log('Saved four revised source sprites and prompts; run installUrbanRedraw.cjs --buildings-only to export.');
