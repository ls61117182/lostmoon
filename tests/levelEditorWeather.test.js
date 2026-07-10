const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const menu = fs.readFileSync(path.join(repo, 'assets/scripts/view/MainMenuScene.ts'), 'utf8');

assert(
  menu.includes("import { normalizeWeather } from '../core/Weather';"),
  'level editor should normalize mission weather values through the shared weather helper',
);

assert(
  /type\s+EditorWeatherOption\s*=/.test(menu)
    && /const\s+weatherOptions\s*:\s*EditorWeatherOption\[\]\s*=\s*\[[\s\S]*id:\s*'clear'[\s\S]*label:\s*'无'[\s\S]*id:\s*'rain'[\s\S]*label:\s*'雨天'/.test(menu),
  'level editor should define expandable weather options with current clear and rain choices',
);

assert(
  /let\s+draftWeather\s*:\s*WeatherType\s*=\s*normalizeWeather\(existingPackage\?\.mission\.weather\)/.test(menu),
  'level editor should initialize draft weather from the edited mission',
);

assert(
  /draftWeather\s*=\s*normalizeWeather\(mission\.weather\)/.test(menu),
  'level editor import should copy mission weather into the draft',
);

assert(
  /draftWeather\s*=\s*'clear'/.test(menu),
  'level editor new mission should reset weather to clear',
);

assert(
  /const\s+openWeatherPicker\s*=\s*\(\)\s*=>/.test(menu)
    && /LevelEditorWeatherPicker/.test(menu)
    && /const\s+weatherColumns\s*=\s*3/.test(menu)
    && /const\s+weatherRows\s*=\s*2/.test(menu),
  'level editor should open a weather picker panel with reserved grid space for future weather types',
);

assert(
  /addPlainBtn\(`天气：\$\{weatherLabel\(draftWeather\)\}`/.test(menu)
    && /openWeatherPicker\(\)/.test(menu),
  'level editor mission tab should expose a weather button that opens the picker',
);

assert(
  /if\s*\(draftWeather\s*===\s*'rain'\)\s*mission\.weather\s*=\s*draftWeather;\s*else\s*delete\s+mission\.weather;/.test(menu),
  'level editor should save rain weather and omit clear weather from mission JSON',
);

console.log('level editor weather test passed');
