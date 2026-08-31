const assert = require('assert');
const { rowsToEntries } = require('../tools/buildLangDB');

assert.deepStrictEqual(
  rowsToEntries([
    ['en', 'key', 'zh'],
    ['Start', 'menu.start', '开始'],
  ]),
  [{ key: 'menu.start', zh: '开始', en: 'Start' }],
  'lang.csv should be read by header name regardless of column order',
);

console.log('buildLangDB column-order test passed');
