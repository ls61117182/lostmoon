# 俯视角雨滴触地特效实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将无限平移的规则雨线替换为随机错开的短距离近垂直雨滴，并在每次触地后绘制扩散淡出的俯视角小水花。

**Architecture:** 新建纯函数模块 `WeatherVisual.ts`，以槽位序号、时间和画布尺寸为输入，将结果写入复用的采样对象，不依赖 Cocos 且不产生每帧粒子对象。`BattleScene` 复用单个 `Graphics`，分别批量绘制雨线和三个透明度档位的水花。

**Tech Stack:** TypeScript、Cocos Creator 3.8 `Graphics`、Node.js 静态/运行时回归测试。

## Global Constraints

- 固定使用 56 个逻辑槽位。
- 下落距离 50–90 像素，速度 700–1000 像素/秒。
- 横向位移为纵向位移的 2%–6%。
- 水花持续 0.12–0.18 秒，水环半径约 1.5–6 像素。
- 首版覆盖整个战斗画面，天气层保持在 HUD 下方。
- 不新增粒子贴图、粒子系统或每滴雨独立节点。
- 不修改天气玩法、命中、视野或 HUD 规则。

---

### Task 1: 可测试的雨滴生命周期采样器

**Files:**
- Create: `assets/scripts/view/WeatherVisual.ts`
- Create: `assets/scripts/view/WeatherVisual.ts.meta`
- Create: `tests/WeatherVisual.test.js`

**Interfaces:**
- Produces: `RAIN_VISUAL_SLOT_COUNT = 56`
- Produces: `RainVisualSample`，包含 `phase`、撞击点、雨线头部、长度、斜率、透明度、水花半径与射线参数。
- Produces: `sampleRainVisual(slot, time, width, height, out): void`

- [x] **Step 1: 写失败测试**

使用 TypeScript 的 `transpileModule` 加载纯模块，验证相同输入可重复、不同槽位/循环位置不同、下落距离有限、斜率在 `0.02–0.06`、生命周期包含 `fall -> splash -> idle`，并验证水花半径增加且透明度降低。

```js
const first = sample(3, 1.25);
const again = sample(3, 1.25);
assert.deepStrictEqual(first, again);
assert(fall.slant >= 0.02 && fall.slant <= 0.06);
assert(fall.fallDistance >= 50 && fall.fallDistance <= 90);
assert(lateSplash.splashRadius > earlySplash.splashRadius);
assert(lateSplash.alpha < earlySplash.alpha);
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node tests/WeatherVisual.test.js`
Expected: FAIL，因为 `assets/scripts/view/WeatherVisual.ts` 尚不存在。

- [x] **Step 3: 实现最小采样器**

使用确定性 32 位散列生成每槽位周期、相位偏移和每循环参数。周期按槽位分布在约 `0.55–0.90` 秒；每循环重新生成撞击点、距离、速度、长度、透明度和水花参数。通过写入调用方提供的 `out` 对象避免每帧对象分配。

```ts
export const RAIN_VISUAL_SLOT_COUNT = 56;

export interface RainVisualSample {
  phase: 'idle' | 'fall' | 'splash';
  impactX: number;
  impactY: number;
  headX: number;
  headY: number;
  streakLength: number;
  slant: number;
  alpha: number;
  fallDistance: number;
  splashRadius: number;
  splashRayLength: number;
  splashRayCount: number;
  splashRotation: number;
}

export function sampleRainVisual(
  slot: number,
  time: number,
  width: number,
  height: number,
  out: RainVisualSample,
): void;
```

- [x] **Step 4: 运行测试并确认通过**

Run: `node tests/WeatherVisual.test.js`
Expected: `Weather visual lifecycle test passed`

### Task 2: BattleScene 批量雨线和水花绘制

**Files:**
- Modify: `assets/scripts/view/BattleScene.ts:165-210,1337-1345,4157-4190`
- Modify: `tests/BattleSceneWeatherEffects.test.js`

**Interfaces:**
- Consumes: `RAIN_VISUAL_SLOT_COUNT`、`RainVisualSample`、`sampleRainVisual(...)`。
- Produces: 全屏短距离雨线与触地水花的批量 `Graphics` 绘制。

- [x] **Step 1: 更新失败测试**

删除旧的无限循环坐标断言，改为验证 `BattleScene` 导入并调用采样器、使用 56 个槽位、雨线循环内不调用 `stroke()`，并为水花保留固定少量批次。

```js
assert(/sampleRainVisual\(/.test(drawWeatherEffects));
assert(/RAIN_VISUAL_SLOT_COUNT/.test(drawWeatherEffects));
assert(!/for\s*\([^)]*\)[\s\S]*?g\.stroke\(\)/.test(rainLoop));
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node tests/BattleSceneWeatherEffects.test.js`
Expected: FAIL，因为 `BattleScene` 仍使用无限平移雨线。

- [x] **Step 3: 实现批量绘制**

在 `BattleScene` 中持有一个复用的 `RainVisualSample`。每帧先绘制冷色薄幕，再遍历 56 个槽位累积下落雨线并一次描边；随后按三个透明度档位重新采样槽位，批量绘制扩张水环和 2–3 条径向短水花。所有绘制仍位于 `WeatherEffectLayer`，不触碰玩法状态。

```ts
for (let i = 0; i < RAIN_VISUAL_SLOT_COUNT; i++) {
  sampleRainVisual(i, this.unitEffectTime, CANVAS_W, CANVAS_H, sample);
  if (sample.phase !== 'fall') continue;
  g.moveTo(sample.headX + sample.streakLength * sample.slant, sample.headY + sample.streakLength);
  g.lineTo(sample.headX, sample.headY);
}
g.stroke();
```

- [x] **Step 4: 运行专项与相关测试**

Run: `node tests/WeatherVisual.test.js && node tests/BattleSceneWeatherEffects.test.js && node tests/BattleSceneMapInputLayer.test.js`
Expected: 三个测试全部通过。

- [x] **Step 5: 运行编译和差异检查**

Run: `npx tsc --noEmit --ignoreConfig --ignoreDeprecations 6.0 --target ES2020 --module commonjs --moduleResolution node --skipLibCheck assets/scripts/view/WeatherVisual.ts assets/scripts/core/Weather.ts assets/scripts/core/Combat.ts assets/scripts/core/FogOfWar.ts assets/scripts/core/TurnEndEventApply.ts`
Expected: exit code 0。

Run: `git diff --check`
Expected: exit code 0；允许已有的 CRLF 提示。
