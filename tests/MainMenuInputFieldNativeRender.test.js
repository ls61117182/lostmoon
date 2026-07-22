const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'scripts', 'view', 'MainMenuScene.ts'),
  'utf8',
);

const methodStart = source.indexOf('private makeInputField(');
const methodEnd = source.indexOf('\n  private setAuthStatus(', methodStart);

if (methodStart < 0 || methodEnd < 0) {
  throw new Error('makeInputField method not found');
}

const method = source.slice(methodStart, methodEnd);

if (method.includes('root.addComponent(Graphics)')) {
  throw new Error('InputField root must not combine Graphics with EditBox on Windows native');
}

if (!method.includes("new Node('InputFieldBackground')") ||
    !method.includes('background.addComponent(Graphics)')) {
  throw new Error('InputField background Graphics must live on a dedicated child node');
}

if (!method.includes('root.addComponent(EditBox)')) {
  throw new Error('InputField root must continue to own the EditBox component');
}
