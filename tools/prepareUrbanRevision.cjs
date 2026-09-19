// Preserve generated alpha and original framing; export at the existing sprite size.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/terrain/urban_dense');
const target = path.join(root, 'assets/resources/textures/terrain/urban');
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, process.argv[2] || 'revision_manifest.json'), 'utf8'));
  const backup = path.join(root, 'asset_backups/urban-before-revision-20260918');
  for (const entry of manifest.images) {
    for (const [dir, label] of [[source, 'source'], [target, 'runtime']]) {
      const old = path.join(dir, entry.file);
      const saved = path.join(backup, label, entry.file);
      if (fs.existsSync(old) && !fs.existsSync(saved)) {
        fs.mkdirSync(path.dirname(saved), { recursive: true });
        fs.copyFileSync(old, saved);
      }
    }
    if (fs.existsSync(entry.generatedPath)) fs.copyFileSync(entry.generatedPath, path.join(source, entry.file));
    await sharp(path.join(source, entry.file)).resize(222, 256, { fit: 'fill' }).png().toFile(path.join(target, entry.file));
    const meta = await sharp(path.join(target, entry.file)).metadata();
    const stats = await sharp(path.join(target, entry.file)).stats();
    if (!meta.hasAlpha || stats.channels[3].min !== 0 || stats.channels[3].max !== 255) throw new Error('Invalid alpha: ' + entry.file);
    console.log(entry.file + ': 222x256 RGBA verified');
  }
  // Neutral background preview at actual game-asset resolution.
  const panels = [];
  for (let i = 0; i < manifest.preview.length; i++) {
    panels.push({input: path.join(target, manifest.preview[i]), left: 16 + (i % 4) * 238, top: 16 + Math.floor(i / 4) * 272});
  }
  await sharp({create: {width: 968, height: 16 + Math.ceil(manifest.preview.length / 4) * 272, channels: 4, background: '#777970'}}).composite(panels).png().toFile(path.join(source, manifest.previewFile || 'revision_preview.png'));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
