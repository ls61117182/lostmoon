const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const battleScene = fs.readFileSync(path.join(root, 'assets/scripts/view/BattleScene.ts'), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /from\s+'\.\/WeatherVisual'/.test(battleScene)
    && /RAIN_VISUAL_SLOT_COUNT/.test(battleScene)
    && /sampleRainVisual/.test(battleScene),
  'BattleScene should consume the pure rain lifecycle sampler',
);

assert(
  /private\s+readonly\s+rainVisualSample\s*:\s*RainVisualSample/.test(battleScene),
  'BattleScene should reuse one rain sample instead of allocating per-drop objects each frame',
);

assert(
  /雨天\s+命中-1\s*\/\s*视野-1/.test(battleScene)
    && /Rain\s+Hit -1\s*\/\s*Vision -1/.test(battleScene)
    && !/雨天\s+命中\+1\s*\/\s*视野-1/.test(battleScene)
    && !/Rain\s+Hit \+1\s*\/\s*Vision -1/.test(battleScene),
  'Rain HUD should describe the hit chance penalty as Hit -1 instead of threshold +1',
);

const drawWeatherEffects = battleScene.match(
  /private\s+drawWeatherEffects\s*\(\)\s*\{[\s\S]*?\n\s{2}\}/,
);
assert(drawWeatherEffects, 'BattleScene.drawWeatherEffects() should be found');
const body = drawWeatherEffects[0];

assert(
  /for\s*\(let\s+i\s*=\s*0;\s*i\s*<\s*RAIN_VISUAL_SLOT_COUNT;\s*i\+\+\)/.test(body)
    && /sampleRainVisual\(i,\s*this\.unitEffectTime,\s*CANVAS_W,\s*CANVAS_H,\s*sample\)/.test(body),
  'Weather drawing should sample all fixed rain slots without creating nodes',
);

assert(
  /sample\.phase\s*!==\s*'fall'/.test(body)
    && /sample\.streakLength\s*\*\s*sample\.slant/.test(body),
  'Rain paths should be short, near-vertical streaks from the lifecycle sample',
);

assert(
  /g\.lineWidth\s*=\s*2(?:\.0)?/.test(body)
    && /g\.strokeColor\s*=\s*new Color\(210,\s*238,\s*248,\s*218\)/.test(body),
  'Falling rain should be thick and bright enough to remain visible over the battle map',
);

assert(
  /const\s+splashBuckets\s*=\s*3/.test(body)
    && /sample\.phase\s*!==\s*'splash'/.test(body)
    && /g\.circle\(sample\.impactX,\s*sample\.impactY,\s*sample\.splashRadius\)/.test(body),
  'Impacts should draw expanding top-down splash rings in fixed alpha buckets',
);

assert(
  !/const\s+offset\s*=\s*wrap\(this\.unitEffectTime/.test(body),
  'Weather drawing should not use the old endless viewport traversal',
);

const strokeCalls = body.match(/g\.stroke\(\);/g) ?? [];
assert(
  strokeCalls.length <= 2,
  'Source should use one batched rain stroke and one fixed-bucket splash stroke site',
);

console.log('BattleScene weather effects test passed');
