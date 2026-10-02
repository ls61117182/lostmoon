// Review-only by default; use --apply to restore the exact pre-install backup.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=path.join(root,'source_art/terrain/backups/pre-v3-20261002/manifest.json');
const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
function safe(rel){const p=path.resolve(root,rel);if(!p.startsWith(root+path.sep))throw Error('Path escapes workspace: '+rel);return p;}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
for(const entry of data.originals){const backup=safe(entry.backup);safe(entry.live);if(hash(backup)!==entry.sha256)throw Error('Backup integrity failure: '+entry.backup);}
for(const p of data.introduced)safe(p);
if(!process.argv.includes('--apply')){console.log(`Backup verified: ${data.originals.length} original files. Use --apply to restore them and remove ${data.introduced.length} V3-only files.`);process.exit(0);}
for(const entry of data.originals){const file=safe(entry.live);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(safe(entry.backup),file);}
for(const rel of data.introduced){const p=safe(rel);if(fs.existsSync(p)&&fs.statSync(p).isFile())fs.unlinkSync(p);}
console.log('Restored pre-V3 terrain resources and BattleScene. Backup retained.');
