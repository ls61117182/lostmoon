const fs = require('fs');
const assert = require('assert');

const battleScene = fs.readFileSync('assets/scripts/view/BattleScene.ts', 'utf8');

assert(
  /private\s+isCurrentCampaignSegmentTile\s*\(\s*pos:\s*Axial\s*\):\s*boolean/.test(battleScene),
  'BattleScene should identify whether a tile belongs to the active campaign segment',
);

assert(
  /private\s+canMoveToBattleTile\s*\(\s*pos:\s*Axial\s*\):\s*boolean/.test(battleScene),
  'BattleScene should centralize the normal battle tile movement check',
);

const drawDriveCandidates = battleScene.match(/private\s+drawDriveCandidates\s*\(\)\s*{[\s\S]*?\n  }\n\n/);
assert(drawDriveCandidates, 'drawDriveCandidates() should be found');
assert(
  drawDriveCandidates[0].includes('this.canMoveToBattleTile(pos)'),
  'Drive preview should mark non-current campaign segment destinations as blocked',
);
assert(
  drawDriveCandidates[0].indexOf('isShermanEvacDrive') < drawDriveCandidates[0].indexOf('this.canMoveToBattleTile(pos)'),
  'Drive preview should preserve the objective exit exception before blocking other segment movement',
);

const driveActionUnavailable = battleScene.match(/private\s+driveActionUnavailable\s*\([^)]*\)\s*:\s*string\s*\|\s*null\s*{[\s\S]*?\n  }\n\n/);
assert(driveActionUnavailable, 'driveActionUnavailable() should be found');
assert(
  driveActionUnavailable[0].indexOf('isShermanEvacDrive') < driveActionUnavailable[0].indexOf('this.canMoveToBattleTile(to)'),
  'Player drive availability should allow objective exit before applying campaign boundary',
);

const tryDriveSherman = battleScene.match(/private\s+tryDriveSherman\s*\([^)]*\)\s*{[\s\S]*?\n  }\n\n/);
assert(tryDriveSherman, 'tryDriveSherman() should be found');
assert(
  tryDriveSherman[0].indexOf('isShermanEvacDrive') < tryDriveSherman[0].indexOf('this.canMoveToBattleTile(to)'),
  'Player drive execution should allow objective exit before applying campaign boundary',
);

const doublesDrive = battleScene.match(/private\s+tryDoublesDriverAdvance\s*\([^)]*\)\s*{[\s\S]*?\n  }\n\n/);
assert(doublesDrive, 'tryDoublesDriverAdvance() should be found');
assert(
  doublesDrive[0].indexOf('isShermanEvacDrive') < doublesDrive[0].indexOf('this.canMoveToBattleTile(to)'),
  'Doubles drive execution should allow objective exit before applying campaign boundary',
);

const chooseAction = battleScene.match(/private\s+chooseActionForEntry\s*\([\s\S]*?\n  }\n\n/);
assert(chooseAction, 'chooseActionForEntry() should be found');
assert(
  chooseAction[0].includes('this.aiMoveDestinationForAction(enemy, a)'),
  'AI action selection should reject tank moves that leave the active campaign segment',
);

const executeAction = battleScene.match(/private\s+executeEnemyAction\s*\([\s\S]*?\n  }\n\n/);
assert(executeAction, 'executeEnemyAction() should be found');
assert(
  executeAction[0].includes('this.canMoveToBattleTile(to)'),
  'AI action execution should guard against movement outside the active campaign segment',
);

const infantryMove = battleScene.match(/private\s+findJapaneseInfantryMove\s*\([\s\S]*?\n  }\n\n/);
assert(infantryMove, 'findJapaneseInfantryMove() should be found');
assert(
  infantryMove[0].includes('this.canMoveToBattleTile(n)'),
  'Japanese infantry movement should skip destinations outside the active campaign segment',
);

assert(
  battleScene.includes("truckSegments.some(seg => seg.type === 'move' && !this.canMoveToBattleTile(seg.to))"),
  'Campaign turn-end truck movement should not move into another campaign segment',
);

assert(
  battleScene.includes('!this.canMoveToBattleTile(tankReinforceMove.to)'),
  'Campaign turn-end tank reinforcement movement should require a current-segment destination',
);

console.log('BattleScene campaign movement boundary test passed');
