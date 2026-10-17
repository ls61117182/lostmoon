// Swap only the versioned European summer assets. Existing UUIDs are retained.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'source_art/terrain/europe-summer-v6-20261015');
const LIVE = path.join(ROOT, 'assets/resources/textures/terrain');
const MATERIALS = path.join(LIVE, 'redesign_v3/materials.json');
const ART_VERSIONS = ['classic', 'detailed', 'detailed-bridge', 'detailed-steel-bridge'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const jsonDigest = value => digest(JSON.stringify(value));
// Cocos may briefly lock imported assets on Windows while refreshing them.
function retryAssetWrite(operation) {
  for (let attempt=0;;attempt++) {
    try { return operation(); } catch(error) {
      if(attempt>=12||!['EACCES','EPERM','EBUSY','UNKNOWN'].includes(error.code))throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
    }
  }
}
function safe(base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw Error('Invalid pack path: ' + relative);
  return target;
}
function readPack(version) {
  const dir = path.join(PACK, version);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const summer = JSON.parse(fs.readFileSync(path.join(dir, 'summer.json'), 'utf8'));
  if (jsonDigest(summer) !== manifest.summerSha256) throw Error('Material pack checksum mismatch');
  const files = manifest.files.map(entry => {
    const bytes = fs.readFileSync(safe(dir, entry.path));
    if (digest(bytes) !== entry.sha256) throw Error('Pack checksum mismatch: ' + entry.path);
    return { ...entry, bytes };
  });
  return { manifest, summer, files };
}
function switchTo(version) {
  if (!ART_VERSIONS.includes(version)) throw Error('Use ' + ART_VERSIONS.join(', '));
  const desired = readPack(version);
  const known = ART_VERSIONS.filter(v => fs.existsSync(path.join(PACK, v, 'manifest.json'))).map(readPack);
  const bundle = JSON.parse(fs.readFileSync(MATERIALS, 'utf8'));
  if (!known.some(p => p.manifest.summerSha256 === jsonDigest(bundle.europeanSummer))) {
    throw Error('European summer materials were edited outside these packs; save those edits before switching.');
  }
  // Validate every target before changing anything, preserving future local edits.
  for (const file of desired.files) {
    const current = digest(fs.readFileSync(safe(LIVE, file.path)));
    if (!known.some(p => p.manifest.files.some(f => f.path === file.path && f.sha256 === current))) {
      throw Error('Asset was edited outside these packs: ' + file.path);
    }
  }
  for (const file of desired.files) retryAssetWrite(()=>fs.copyFileSync(safe(path.join(PACK, version), file.path), safe(LIVE, file.path)));
  bundle.europeanSummer = desired.summer;
  const classic = JSON.parse(fs.readFileSync(path.join(PACK, 'classic/materials.snapshot.json'), 'utf8'));
  // Exact snapshot restoration when no unrelated material edits have happened.
  if (version === 'classic' && JSON.stringify(bundle) === JSON.stringify(classic)) {
    retryAssetWrite(()=>fs.copyFileSync(path.join(PACK, 'classic/materials.snapshot.json'), MATERIALS));
  } else retryAssetWrite(()=>fs.writeFileSync(MATERIALS, JSON.stringify(bundle) + '\n'));
  for (const file of desired.files) {
    if (digest(fs.readFileSync(safe(LIVE, file.path))) !== file.sha256) throw Error('Install verification failed: ' + file.path);
  }
  fs.writeFileSync(path.join(PACK, 'active.json'), JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`European summer art: ${version}; ${desired.files.length} files verified. Reload the game/preview to refresh its asset cache.`);
}
if (require.main === module) {
  try { switchTo(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { ROOT, PACK, LIVE, MATERIALS, ART_VERSIONS, digest, jsonDigest, safe, readPack, switchTo };
