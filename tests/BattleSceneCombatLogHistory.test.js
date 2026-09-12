const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'BattleScene.ts'),
  'utf8',
);

test('combat history is a borderless sixty-percent-height scroll list', () => {
  assert.match(source, /height \* 0\.6/);
  assert.match(source, /战斗记录直接显示在战场上，不绘制面板底色或边框/);
  assert.match(source, /sv\.vertical = true/);
  assert.match(source, /sv\.scrollToBottom\(0\)/);
  assert.match(source, /const viewN = new Node\('view'\);\s*viewN\.layer = this\.node\.layer;\s*const vut = viewN\.addComponent\(UITransform\)/);
  assert.match(source, /refreshCombatLogEntryVisibility/);
  assert.match(source, /const contentHeight = Math\.max\(40, viewH, usedHeight\)/);
  assert.match(source, /const topInset = Math\.max\(0, contentHeight - usedHeight\)/);
});

test('only result entries are shown and replayable entries are underlined', () => {
  assert.match(source, /combatLogIsVisible/);
  assert.match(source, /battleLog\.turnEndResult/);
  assert.match(source, /battleLog\.fireCheckResult/);
  assert.match(source, /entry\.replay \? `<u>/);
});

test('a history click waits for the active action and reopens a read-only result', () => {
  assert.match(source, /pendingCombatLogReplay/);
  assert.match(source, /if \(!replay \|\| this\.isBusy\(\)\) return false/);
  assert.match(source, /if \(this\.pendingCombatLogReplay\)[\s\S]*?openPendingCombatLogReplayIfReady\(\)[\s\S]*?return/);
  assert.match(source, /historyReplay: true/);
  assert.match(source, /fireEffectPlayed: true, requireManualClose: true/);
  assert.match(source, /showSettled: true/);
  assert.match(source, /if \(opts\.showSettled\) this\.revealSettledDiceShow\(show\);\s*else playDiceRoll\(\)/);
  assert.match(source, /private revealSettledDiceShow\(show: DiceShow\)[\s\S]*?show\.stage = 'hold'/);
  assert.doesNotMatch(source, /raiseCombatLogAboveModal/);
});

test('closing history resumes the exact AI boundary that was paused for the replay', () => {
  assert.match(source, /private pauseAIFlowForCombatLogReplay\(resume: \(\) => void\)/);
  assert.match(source, /private finishCombatLogReplay\(\)[\s\S]*?const resumeAI = this\.combatLogAIResume[\s\S]*?resumeAI\(\)/);
  assert.match(source, /private runNextEnemyStep\(\)[\s\S]*?pauseAIFlowForCombatLogReplay\(\(\) => this\.runNextEnemyStep\(\)\)/);
  assert.match(source, /private beginCurrentEnemyTurn\(\)[\s\S]*?pauseAIFlowForCombatLogReplay\(\(\) => this\.beginCurrentEnemyTurn\(\)\)/);
  assert.match(source, /private maybeBeginTurnEndEventOrEndEnemyPhase\(\)[\s\S]*?pauseAIFlowForCombatLogReplay\(\(\) => this\.maybeBeginTurnEndEventOrEndEnemyPhase\(\)\)/);
  assert.match(source, /private continueAfterTurnEndEvent\(\)[\s\S]*?pauseAIFlowForCombatLogReplay\(\(\) => this\.continueAfterTurnEndEvent\(\)\)/);
  assert.match(source, /if \(ui\.historyReplay\)[\s\S]*?this\.finishCombatLogReplay\(\)/);
});

test('HE history keeps and displays every collateral infantry result', () => {
  assert.match(source, /highExplosiveCollateral\?: HighExplosiveCollateralResult\[\]/);
  assert.match(source, /const collateral = replay\.highExplosiveCollateral\s*\?\.map\(item => `\$\{unitDisplayName\(item\.target\.kind\)\}：\$\{item\.report\.hit[\s\S]*?highExplosiveOutcomeLabel\(item\.report\)\.text[\s\S]*?battleLog\.combat\.resultMiss/);
  assert.match(source, /highExplosiveCollateral: replay\.highExplosiveCollateral/);
  assert.equal((source.match(/highExplosiveCollateral: collateralResults,/g) ?? []).length >= 4, true);
});

test('combat history uses compact summaries and a distinct turn divider', () => {
  assert.match(source, /private combatLogUnitLabel[\s\S]*?actor\.enemyPrefix[\s\S]*?actor\.allyPrefix/);
  assert.match(source, /entry\.replay\.dice\.reduce\(\(sum, die\) => sum \+ die, 0\)/);
  assert.match(source, /battleLog\.usCasualtyDelta/);
  assert.match(source, /const turnDivider = typeof entry !== 'string' && entry\.key === 'battleLog\.playerTurnStart'/);
  assert.match(source, /new Node\('TurnDividerBand'\)/);
  assert.match(source, /bandGraphics\.roundRect\(0, -26, rowWidth, 26, 4\)/);
  assert.match(source, /label\.verticalAlign = VerticalTextAlignment\.CENTER/);
});

test('combat history truncates at its safe width and only text receives clicks', () => {
  assert.match(source, /private static readonly COMBAT_LOG_W0 = 390/);
  assert.match(source, /private static readonly COMBAT_LOG_TEXT_MAX_W = 310/);
  assert.match(source, /private truncateCombatLogRichLine\(/);
  assert.match(source, /const maxRowWidth = Math\.min\(width, BattleScene\.COMBAT_LOG_TEXT_MAX_W\)/);
  assert.match(source, /const maxTextWidth = Math\.max\(1, maxRowWidth - textInset - 6\)/);
  assert.match(source, /const rowWidth = turnDivider[\s\S]*?truncated\.visibleWidth/);
  assert.match(source, /rowUt\.setContentSize\(rowWidth, h\)/);
  assert.match(source, /rich\.maxWidth = 0/);
  assert.match(source, /textUt\.setContentSize\(Math\.max\(1, rowWidth - textInset\), h\)/);
});

test('combat history prevents top-edge flicker while scrolling and rebuilding', () => {
  assert.match(source, /sv\.elastic = false/);
  assert.match(source, /row\.active = rowTop <= viewH \+ 0\.5 && rowBottom >= -0\.5/);
  assert.match(source, /ut\.setContentSize\(width, contentHeight\);[\s\S]*?this\.syncCombatLogScrollAfterLayout\(\);[\s\S]*?this\.refreshCombatLogEntryVisibility\(\)/);
});

test('combat history appends one row and updates visibility only while scrolling', () => {
  assert.match(source, /scrollN\.on\(ScrollView\.EventType\.SCROLLING, this\.refreshCombatLogEntryVisibility, this\)/);
  assert.match(source, /private pushCombatLogEntry[\s\S]*?createCombatLogEntryNode\(entry, this\.getCombatLogBodyWidth\(\)\)[\s\S]*?layoutCombatLogEntryNodes\(\)/);
  assert.doesNotMatch(source, /private pushCombatLogEntry[\s\S]*?this\.refreshCombatLogText\(\)[\s\S]*?private refreshCombatLogText/);
  assert.doesNotMatch(source, /update\(dt: number\) \{\s*this\.refreshCombatLogEntryVisibility\(\)/);
});

test('combat history has no obsolete fullscreen dimmer and bounds its turn bands', () => {
  assert.doesNotMatch(source, /CombatLogDimmer|combatLogDimmer/);
  assert.match(source, /textInset \+ Math\.ceil\(truncated\.visibleWidth\) \+ 10/);
  assert.match(source, /bandUt\.setContentSize\(rowWidth, 26\)/);
  assert.match(source, /textNode\.setPosition\(textInset, turnDivider \? -13 : 0, 0\)/);
});

test('fire-check history shows only its settled outcome while replay keeps dice', () => {
  assert.match(source, /private fireCheckFinalResultText\(step: FireCheckPreparedStep\)/);
  assert.match(source, /battleLog\.fireCheckSummary/);
  assert.match(source, /kind: 'fire', dice: \[\.\.\.ui\.allDice\][\s\S]*?resultKey: ui\.resultKey/);
  assert.match(source, /entry\.replay\?\.kind === 'fire'[\s\S]*?combatLogFireResultText\(entry\.replay\)/);
  assert.match(source, /replay\.dice\.forEach\(\(die, i\) => this\.setDieLabelFace/);
});

test('existing combat history is rendered from language-neutral replay data', () => {
  assert.match(source, /kind: 'attack'; report: AttackReport; attackerKind: UnitKind; targetKind: UnitKind/);
  assert.match(source, /unitDisplayName\(replay\.attackerKind\)/);
  assert.match(source, /unitDisplayName\(replay\.targetKind\)/);
  assert.match(source, /attackerKind: sherman\.kind, targetKind: target\.kind/);
  assert.doesNotMatch(source, /attackerLabel: t\('actor\.player'\)/);
  assert.match(source, /entry\.params\?\.resultKey \? t\(String\(entry\.params\.resultKey\)\)/);
  assert.match(source, /result: t\(entry\.replay\.effectKey\)/);
  assert.match(source, /private combatLogFireResultText/);
  assert.match(source, /refreshBattleStaticI18n\(\)[\s\S]*?refreshCombatLogText\(\)/);
});

test('combat history uses one localized miss label for every attack type', () => {
  const lang = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'scripts', 'core', 'LangDB.ts'),
    'utf8',
  );
  assert.match(lang, /'battleLog\.combat\.resultMiss': \{ zh: "未命中", en: "MISS" \}/);
  assert.match(lang, /'battleLog\.combatMg\.miss': \{ zh: "未命中", en: "MISS" \}/);
  assert.equal((source.match(/let result = t\('battleLog\.combat\.resultMiss'\)/g) ?? []).length, 2);
  assert.match(source, /highExplosiveCollateral[\s\S]*?t\('battleLog\.combat\.resultMiss'\)/);
});

test('combat history shows the settled crew casualty instead of the crew-check step', () => {
  assert.match(source, /function combatLogDamageOutcomeLabel\(report: AttackReport\)/);
  assert.match(source, /report\.crewCheck \?\? report\.stagedCrewCheck/);
  assert.match(source, /crew\.death\.kia/);
  assert.match(source, /crew\.death\.falseAlarm/);
  assert.equal((source.match(/else if \(report\.hit\) result = combatLogDamageOutcomeLabel\(report\)\.text/g) ?? []).length, 2);
});

test('a hit-doubles commander casualty is retained alongside a ricochet', () => {
  const lang = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'scripts', 'core', 'LangDB.ts'),
    'utf8',
  );
  assert.match(lang, /'battleLog\.combat\.commanderKia': \{ zh: "车长阵亡", en: "Commander KIA" \}/);
  assert.equal((source.match(/report\.hit && report\.commanderKilledByHitDoubles/g) ?? []).length >= 2, true);
  assert.match(source, /const settledResult = `\$\{result\}\$\{commanderResult \? `；\$\{commanderResult\}` : ''\}`/);
  assert.match(source, /richCommanderResult[\s\S]*?richResult\(commanderResult\)/);
});

test('history attack rule details use the report snapshot without live unit objects', () => {
  assert.match(source, /const base = r\.hitBreakdown \?\? \(show\.attacker && show\.target && this\.mission/);
  assert.match(source, /if \(base\) \{[\s\S]*?dice\.rule\.distance[\s\S]*?dice\.rule\.targetSize[\s\S]*?dice\.rule\.trees/);
  assert.match(source, /const hasEffectiveRangeDetails[\s\S]*?!!r\.penetrationBreakdown/);
  assert.match(source, /const penRowCount = \(hasEffectiveRangeDetails \? 8 : 3\)/);
  assert.match(source, /h: Math\.max\(250, 132 \+ penRowCount \* 36\)/);
  assert.match(source, /const showEffectivePen[\s\S]*?!!report\.penetrationBreakdown/);
  assert.match(source, /dice\.rule\.effectiveRange[\s\S]*?dice\.rule\.distance[\s\S]*?dice\.rule\.rangePenalty/);
});

test('combat history stays below modal masks and the turn banner', () => {
  assert.doesNotMatch(source, /raiseCombatLogAboveModal/);
  assert.match(source, /private showTurnTransition[\s\S]*?root\.active = true;\s*\/\/ 回合横幅始终高于普通 HUD[\s\S]*?root\.setSiblingIndex\(this\.node\.children\.length - 1\)/);
  assert.match(source, /const root = new Node\('DiceShow'\)[\s\S]*?this\.node\.addChild\(root\);\s*\n\s*\/\/ 背景遮罩/);
  assert.match(source, /const root = new Node\('FireCheckEventPanel'\)[\s\S]*?root\.setSiblingIndex\(this\.node\.children\.length - 1\);\s*\n\s*const \{ node: mask \}/);
});

test('AI unit attacks settle without automatically opening the dice detail panel', () => {
  assert.match(source, /autoResolveWithoutPanel\?: boolean/);
  assert.match(source, /if \(opts\.autoResolveWithoutPanel\)[\s\S]*?playAttackFireCue[\s\S]*?opts\.onHold\?\.\(\)[\s\S]*?scheduleOnce\(onDone, DICE_HIT_SHOW_DUR\)/);
  assert.equal((source.match(/autoResolveWithoutPanel: true/g) ?? []).length, 5);
  assert.match(source, /highExplosiveCollateral: collateralResults,[\s\S]*?autoResolveWithoutPanel: true/);
  assert.match(source, /keepTurnEndPanel: true,[\s\S]*?autoResolveWithoutPanel: true/);
  assert.match(source, /showSettled: true/);
});

test('the player result popup is controlled by an unchecked HUD checkbox', () => {
  const lang = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'scripts', 'core', 'LangDB.ts'),
    'utf8',
  );
  assert.match(lang, /'battle\.hud\.popupResults': \{ zh: "弹出结果", en: "Show Results" \}/);
  assert.match(source, /private popupPlayerAttackResults = false/);
  assert.match(source, /new Node\('PopupResultsToggle'\)/);
  assert.match(source, /this\.popupPlayerAttackResults = !this\.popupPlayerAttackResults/);
  assert.equal((source.match(/autoResolveWithoutPanel: !this\.popupPlayerAttackResults/g) ?? []).length, 3);
  assert.match(source, /popupResultsToggleRoot\?\.setPosition\(turnEndButtonX - 112, topButtonY, 0\)/);
});

test('a battlefield hex takes priority over combat-log scrolling during the player phase', () => {
  assert.match(source, /private shouldCombatLogTouchTargetMap\(event: EventTouch\)/);
  assert.match(source, /if \(this\.phase !== 'player' \|\| this\.outcome !== 'ongoing'\) return false/);
  assert.doesNotMatch(source, /shouldCombatLogTouchTargetMap\(event: EventTouch\)[\s\S]{0,240}selectedGunDieIdx/);
  assert.match(source, /return this\.pickTileAtScreenUi\(event\) !== null/);
  assert.match(source, /TOUCH_START[\s\S]*?shouldCombatLogTouchTargetMap\(event\)[\s\S]*?sv\.stopAutoScroll\(\)[\s\S]*?sv\.vertical = false/);
  assert.match(source, /TOUCH_END[\s\S]*?sv\.vertical = true[\s\S]*?this\.onTouchMap\(event\)/);
  assert.match(source, /if \(this\.combatLogTouchTargetsMap \|\| this\.shouldCombatLogTouchTargetMap\(event\)\) return/);
});
