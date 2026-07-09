const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const menu = fs.readFileSync(path.join(repo, 'assets/scripts/view/MainMenuScene.ts'), 'utf8');

assert(
  menu.includes("const importViewport = new Node('ImportMissionViewport')"),
  'level import picker should create a dedicated scroll viewport',
);

assert(
  menu.includes('importViewport.addComponent(Mask)'),
  'level import picker viewport should mask overflowing level buttons',
);

assert(
  menu.includes('const importScroll = importViewport.addComponent(ScrollView)'),
  'level import picker should use a ScrollView for vertical browsing',
);

assert(
  menu.includes('importScroll.vertical = true') && menu.includes('importScroll.horizontal = false'),
  'level import picker ScrollView should scroll vertically only',
);

assert(
  menu.includes("const importContent = new Node('ImportMissionContent')"),
  'level import picker should place level buttons in a scroll content node',
);

assert(
  menu.includes('importScroll.content = importContent'),
  'level import picker should wire the content node to the ScrollView',
);

assert(
  menu.includes('Math.max(importViewportH, importRows * importRowGap + 28)'),
  'level import picker content height should grow with the number of level rows',
);

assert(
  menu.includes('this.makeRectButton(importContent'),
  'level import picker should parent import buttons under the scroll content node',
);

console.log('level editor import scroll test passed');
