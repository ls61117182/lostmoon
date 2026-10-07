const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/terrain/urban-redraw-20261005');
const target = path.join(root, 'assets/resources/textures/terrain/urban');
const revision = JSON.parse(fs.readFileSync(path.join(source, 'identity-revision.json'), 'utf8'));
const manifestPath = path.join(source, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const backup = path.join(source, 'before-identity-revision');
fs.mkdirSync(backup, { recursive: true });
if (!fs.existsSync(path.join(backup, 'manifest.json'))) fs.copyFileSync(manifestPath, path.join(backup, 'manifest.json'));
for (const entry of revision.images) {
  if (!fs.existsSync(entry.generatedPath)) throw new Error('Missing generated art: ' + entry.generatedPath);
  const raw = path.join(source, 'generated', entry.kind + '_' + entry.key + '_' + entry.state + '.png');
  if (fs.existsSync(raw) && !fs.existsSync(path.join(backup, path.basename(raw)))) fs.copyFileSync(raw, path.join(backup, path.basename(raw)));
  fs.copyFileSync(entry.generatedPath, raw);
  const old = manifest.images.find(e => e.key === entry.key && e.state === entry.state);
  const updated = { ...entry, path: raw.replaceAll('\\', '/'), revision: 'irregular-residential-and-landmarks' };
  if (old) Object.assign(old, updated);
  else manifest.images.push(updated);
  if (entry.kind === 'indestructible') {
    const name = 'urban_dense_indestructible_' + entry.key + '_v1';
    const metaPath = path.join(target, name + '.png.meta');
    if (!fs.existsSync(metaPath)) {
      let template = fs.readFileSync(path.join(target, 'urban_dense_indestructible_theater_v1.png.meta'), 'utf8');
      const uuid = JSON.parse(template).uuid;
      template = template.replaceAll(uuid, randomUUID()).replaceAll('urban_dense_indestructible_theater_v1', name);
      fs.writeFileSync(metaPath, template);
    }
  }
}
// Put the new designs first so the game-size neighbourhood preview includes them.
const priority = ['church', 'town_hall', 'civic_dome', 'rowhouses_l'];
manifest.images.sort((a,b) => {
  const rank = e => priority.includes(e.key) ? priority.indexOf(e.key) : priority.length;
  return rank(a) - rank(b);
});
manifest.identityRevision = { tool: revision.tool, runtimeScale: 1.35, addedVariants: priority.slice(0,3) };
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Installed source art and Cocos metadata for six revised images.');
