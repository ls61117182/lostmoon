const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);

const { getUnitStats } = require('../assets/scripts/core/UnitDB.ts');
const root = path.resolve(__dirname, '..');
const groups = {
  'audio/tank_move_heavy': ['sherman_jumbo', 'm26_pershing', 'kv1', 'is2', 'su152', 'tiger', 'tigerking', 'maus', 'panther', 'sturmtiger', 'jagdtiger', 'jagdpanther', 'elefant'],
  'audio/tank_move': ['sherman', 'sherman76', 't34', 't34_85', 'panzer4', 'panzer4_f', 'stug3', 'panzer3', 'panzer3_m', 'panzer3_m_no_schurzen', 'panzer3_n', 'panzer3_n_schurzen', 'type95', 'type97', 'type4', 'truck'],
  '': ['infantry', 'german_infantry', 'soviet_infantry', 'officer', 'at_gun', 'pak38', 'flak88', 'japanese_infantry', 'american_infantry', 'heavy_artillery', 'german_heavy_artillery'],
};

for (const theater of ['europe', 'pacific']) {
  for (const [key, kinds] of Object.entries(groups)) {
    for (const kind of kinds) {
      assert.equal(getUnitStats(kind, theater).moveSound, key, `${theater}: ${kind} movement audio`);
    }
  }
}

for (const key of Object.keys(groups).filter(Boolean)) {
  const asset = path.join(root, 'assets/resources', `${key}.mp3`);
  assert.ok(fs.statSync(asset).size > 0, `${key} has audio data`);
  assert.equal(JSON.parse(fs.readFileSync(`${asset}.meta`, 'utf8')).importer, 'audio-clip');
}

const audio = fs.readFileSync(path.join(root, 'assets/scripts/audio/GameAudio.ts'), 'utf8');
assert.match(audio, /tankManeuverHeavy:\s*'audio\/tank_move_heavy'/, 'preload the heavy movement clip');

console.log('Tank movement audio tests passed');
