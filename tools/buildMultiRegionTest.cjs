const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { generateMultiRegionPackage, MULTI_REGION_TEST_SEED } = require('../assets/scripts/core/MultiRegionGenerator.ts');
const output = path.join(__dirname, '../assets/resources/missions/multi_region_01.json');
fs.writeFileSync(output, JSON.stringify(generateMultiRegionPackage(MULTI_REGION_TEST_SEED).mission, null, 2) + '\n');
const assets = ['core/MultiRegion', 'core/MultiRegionGenerator', 'core/MultiRegionEvents', 'core/StandardMapLayout', 'core/MultiRegionTerrain'];
for (const asset of assets) {
  const meta = path.join(__dirname, `../assets/scripts/${asset}.ts.meta`);
  if (!fs.existsSync(meta)) fs.writeFileSync(meta, JSON.stringify({ ver: '4.0.24', importer: 'typescript', imported: true,
    uuid: randomUUID(), files: [], subMetas: {}, userData: {} }, null, 2) + '\n');
}
if (!fs.existsSync(output + '.meta')) fs.writeFileSync(output + '.meta', JSON.stringify({
  ver: '2.0.1', importer: 'json', imported: true, uuid: randomUUID(), files: ['.json'], subMetas: {}, userData: {},
}, null, 2) + '\n');
console.log(`Generated ${path.relative(process.cwd(), output)} (seed=${MULTI_REGION_TEST_SEED})`);
