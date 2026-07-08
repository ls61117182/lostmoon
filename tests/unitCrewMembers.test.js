const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readCsv(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '').trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

const units = Object.fromEntries(readCsv('data/units.csv').map((row) => [row.unitKind, row]));
const generated = fs.readFileSync(path.join(root, 'assets/scripts/core/UnitDB.ts'), 'utf8');

assert.strictEqual(units.sherman.crewMembers, '1|2|3|4|5');
assert.strictEqual(units.tiger.crewMembers, '1|2|3|4|5');
assert.strictEqual(units.truck.crewMembers, '4');
assert.strictEqual(units.infantry.crewMembers, '');

assert.match(generated, /sherman: \{[\s\S]*?crewMembers: \[1, 2, 3, 4, 5\]/);
assert.match(generated, /truck: \{[\s\S]*?crewMembers: \[4\]/);

console.log('unit crew member config test passed');
