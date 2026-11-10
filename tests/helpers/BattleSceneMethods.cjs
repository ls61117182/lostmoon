const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
// Extracted scene methods still need the real shared geometry imports.
const footprintModule = { exports: {} };
const footprintPath = path.join(__dirname, '../../assets/scripts/core/UnitFootprint.ts');
const footprintCode = ts.transpileModule(fs.readFileSync(footprintPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('module', 'exports', footprintCode)(footprintModule, footprintModule.exports);
module.exports = function sceneMethods(names, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../assets/scripts/view/BattleScene.ts'), 'utf8');
  const parsed = ts.createSourceFile('BattleScene.ts', source, ts.ScriptTarget.Latest, true);
  const scene = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BattleScene');
  const methods = names.map(name => {
    const member = scene.members.find(member => member.name?.getText(parsed) === name);
    if (!member) throw new Error(`Missing scene method ${name}`);
    return member.getText(parsed);
  });
  const compiled = ts.transpileModule(`class TestScene { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS } }).outputText;
  return vm.runInNewContext(`${compiled}; TestScene`, { ...footprintModule.exports, ...globals });
};
module.exports.footprintGlobals = footprintModule.exports;
