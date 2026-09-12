const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const profile = process.argv[2];
if (!['demo', 'development'].includes(profile)) {
  for (const variant of ['demo', 'development']) {
    execFileSync(process.execPath, [__filename, variant], { stdio: 'inherit' });
  }
} else {
  // Exercise both build variants without changing the project's selected profile.
  require.extensions['.ts'] = (module, filename) => {
    let source = fs.readFileSync(filename, 'utf8');
    if (path.basename(filename) === 'BuildProfile.ts') {
      source = source.replace(/(export const BUILD_PROFILE:[^=]+)= '[^']+';/, `$1= '${profile}';`);
    }
    module._compile(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
    }).outputText, filename);
  };
  const storage = new Map();
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  const demo = profile === 'demo';
  const { BUILD_PROFILE, BUILD_FEATURES } = require('../assets/scripts/core/BuildProfile.ts');
  const { MenuProgress, MENU_STATE_KEY, CHAPTERS, getChapterLevels, getImportableMissionLevels } = require('../assets/scripts/core/LevelDB.ts');
  const { GameSession } = require('../assets/scripts/core/GameSession.ts');
  const { SAVE_KEY } = require('../assets/scripts/core/SaveLoad.ts');
  const { getActiveSaveKey, readActiveSaveRaw, writeActiveSaveRaw } = require('../assets/scripts/core/SaveSlot.ts');
  const { missionWithSelectedPlayerTank } = require('../assets/scripts/core/PlayerTankSelection.ts');
  assert.equal(BUILD_PROFILE, profile);
  assert(Object.values(BUILD_FEATURES).every(enabled => enabled === !demo));
  assert.equal(CHAPTERS.some(chapter => chapter.id === 'test'), !demo);
  assert.equal(getChapterLevels('test').length > 0, !demo);
  assert.equal(getImportableMissionLevels().some(level => level.missionId === 'mission_test'), !demo);
  assert(CHAPTERS.some(chapter => chapter.id === 'custom'));
  const original = JSON.stringify({ gameMode: 'classic', selectedPlayerTankKind: 't34', selectedChapterId: 'test' });
  storage.set('lone_sherman_menu_v1', original);
  storage.set('lone_sherman_save_v1', 'legacy battle');
  storage.set('lone_sherman_save_v1:guest', 'development battle');
  assert.equal(MENU_STATE_KEY, demo ? 'lone_sherman_menu_v1:demo' : 'lone_sherman_menu_v1');
  assert.equal(SAVE_KEY, demo ? 'lone_sherman_save_v1:demo' : 'lone_sherman_save_v1');
  assert.equal(readActiveSaveRaw(), demo ? null : 'development battle');
  if (demo) {
    assert.equal(MenuProgress.load().gameMode, 'hardcore');
    assert.equal(MenuProgress.load().selectedPlayerTankKind, 'sherman');
  }
  // Even incompatible settings placed in the active slot must be normalized.
  storage.set(MENU_STATE_KEY, original);
  assert.equal(MenuProgress.load().selectedChapterId, demo ? 'europe' : 'test');
  MenuProgress.replace({ ...MenuProgress.load(), gameMode: 'classic', selectedPlayerTankKind: 't34' });
  MenuProgress.setGameMode('classic');
  MenuProgress.setSelectedPlayerTankKind('t34');
  assert.equal(MenuProgress.load().gameMode, demo ? 'hardcore' : 'classic');
  assert.equal(MenuProgress.load().selectedPlayerTankKind, demo ? 'sherman' : 't34');
  GameSession.setGameMode('classic');
  GameSession.setSelectedPlayerTankKind('t34');
  assert.equal(GameSession.gameMode, demo ? 'hardcore' : 'classic');
  assert.equal(GameSession.selectedPlayerTankKind, demo ? 'sherman' : 't34');
  const source = { sherman: { kind: 't34', faction: 'soviet', at: { col: 2, row: 3 }, facing: 2 } };
  const mission = missionWithSelectedPlayerTank(source, 't34');
  assert.equal(mission.playerTank.kind, demo ? 'sherman' : 't34');
  assert.deepEqual(mission.playerTank.at, source.sherman.at);
  assert.equal(source.sherman.kind, 't34');
  GameSession.selectMission(0, 'missions/mission_test');
  assert.equal(GameSession.selectedMissionPath, demo ? 'missions/mission_01' : 'missions/mission_test');
  GameSession.resumeMission(0, 'missions/mission_test');
  assert.equal(GameSession.resumeFromSave, !demo);
  writeActiveSaveRaw('current battle');
  assert.equal(readActiveSaveRaw(), 'current battle');
  if (demo) {
    assert.equal(storage.get('lone_sherman_menu_v1'), original);
    assert.equal(storage.get('lone_sherman_save_v1:guest'), 'development battle');
    storage.set('lone_sherman_auth_session_v1', JSON.stringify({ mode: 'online', username: 'tester' }));
    assert.equal(getActiveSaveKey(), 'lone_sherman_save_v1:demo:account:tester');
    storage.set('lone_sherman_save_v1:account:tester', 'account development battle');
    assert.equal(readActiveSaveRaw(), null);
    // Run actual method bodies: disabled tools must return before touching scene state.
    for (const [file, names] of [
      ['MainMenuScene', ['buildGameModeSwitch', 'selectGameMode', 'openPlayerTankPicker', 'selectPlayerTank', 'openTankVisualDebugger']],
      ['BattleScene', ['buildCampaignDebugSkipButton', 'debugSkipCampaignSegment']],
    ]) {
      const source = fs.readFileSync(path.join(__dirname, `../assets/scripts/view/${file}.ts`), 'utf8');
      const ast = ts.createSourceFile(`${file}.ts`, source, ts.ScriptTarget.Latest, true);
      const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === file);
      for (const name of names) {
        const method = cls.members.find(n => n.name?.getText(ast) === name);
        const body = ts.transpileModule(`function guard() ${method.body.getText(ast)}`, {}).outputText;
        const guard = new Function('BUILD_FEATURES', `${body}; return guard;`)(BUILD_FEATURES);
        guard.call(new Proxy({}, { get() { throw Error(`${name} touched scene state`); } }));
      }
    }
  } else {
    require('./PlayerTankSelection.test.js');
  }
  console.log(`${profile} build profile tests passed`);
}
