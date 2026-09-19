const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const audioSource = fs.readFileSync(path.join(root, 'assets/scripts/audio/GameAudio.ts'), 'utf8');
const battleSource = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');
const audioPath = path.join(root, 'assets/resources/audio/building_collapse.mp3');
const metaPath = `${audioPath}.meta`;

assert.ok(fs.existsSync(audioPath), 'the building damage sound asset must exist');
assert.ok(fs.statSync(audioPath).size > 0, 'the building damage sound asset must not be empty');
assert.equal(JSON.parse(fs.readFileSync(metaPath, 'utf8')).importer, 'audio-clip',
  'Cocos must import the building damage sound as an audio clip');
assert.match(audioSource, /buildingCollapse:\s*'audio\/building_collapse'/,
  'GameAudio must register the building damage sound for preload');
assert.match(audioSource,
  /export function playBuildingCollapse\(\): void \{\s*playSfxKey\(AudioKeys\.buildingCollapse\);\s*\}/,
  'GameAudio must expose the building damage cue');

const helper = battleSource.match(
  /private applyUrbanBuildingDamage\([\s\S]*?\n  \}/,
);
assert.ok(helper, 'BattleScene must centralize destructible-building damage audio');
assert.match(helper[0], /applyUrbanStructureDamage\(tile, highExplosivePower\)/,
  'the helper must apply structure damage');
assert.match(helper[0], /if \(damage > 0\) playBuildingCollapse\(\)/,
  'the cue must play only when the building actually loses structure');
assert.equal((battleSource.match(/this\.applyUrbanBuildingDamage\(/g) ?? []).length, 2,
  'direct building fire and collateral HE fire must both use the building damage cue');

console.log('BattleScene urban building audio tests passed');
