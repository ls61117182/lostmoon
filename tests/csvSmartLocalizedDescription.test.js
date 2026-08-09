const assert = require('assert');
const path = require('path');
const { readCsvRowsSmart, withoutLocalizedDescriptionRow } = require('../tools/csvSmart');

assert.deepStrictEqual(
  withoutLocalizedDescriptionRow([
    ['kind', 'value'],
    ['单位类型ID', '数值'],
    ['infantry', '1'],
  ]),
  [
    ['kind', 'value'],
    ['infantry', '1'],
  ],
  'localized field descriptions should not be emitted as runtime records',
);

assert.deepStrictEqual(
  withoutLocalizedDescriptionRow([
    ['id', 'value'],
    ['commander_cupola', '1'],
  ]),
  [
    ['id', 'value'],
    ['commander_cupola', '1'],
  ],
  'a normal first data row should remain untouched',
);

const unitRows = readCsvRowsSmart(path.resolve('data/units.csv'), {
  toolName: 'csvSmartLocalizedDescription.test',
  requiredHeaders: ['unitKind', 'displayName'],
});
assert.strictEqual(unitRows[1][0], 'sherman', 'units.csv should begin with the first real unit after parsing');

console.log('CSV localized description row tests passed');
