const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const serverSource = fs.readFileSync('server/server.js', 'utf8');
const match = serverSource.match(/function pvpSupportKind\(factionId\) \{[\s\S]*?\n\}/);
assert(match, 'server pvpSupportKind() should exist');

const context = {};
vm.runInNewContext(`${match[0]}; this.pvpSupportKind = pvpSupportKind;`, context);

assert.strictEqual(context.pvpSupportKind('usa'), 'american_infantry');
assert.strictEqual(context.pvpSupportKind('japan'), 'japanese_infantry');
assert.strictEqual(context.pvpSupportKind('germany'), 'infantry');

console.log('PVP faction infantry mapping test passed');
