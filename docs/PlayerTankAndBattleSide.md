# 玩家坦克与战斗方配置

关卡从新 schema 开始使用 `playerTank` 表示玩家直接控制的坦克。旧字段 `sherman` 仍可读取，加载后会与 `playerTank` 归一为同一对象。

## 核心约定

- `faction` 表示单位国籍，用于国籍美术、地形规则和对应兵种。
- 单位放在 `playerTank` 或 `allies` 中，就属于玩家战斗方。
- 单位放在 `enemies` 中，就属于敌方战斗方。
- 运行时敌我关系只比较 `sideId`，不再通过 `faction` 推断。
- `controller` 表示由本地玩家、远端玩家还是 AI 操作，与国籍和战斗方都独立。

下面的配置会生成一辆德系虎式玩家坦克、一辆美系谢尔曼友军，以及一辆同为德系但属于敌方的虎式：

```json
{
  "playerTank": {
    "kind": "tiger",
    "faction": "german",
    "at": { "col": 0, "row": 2 },
    "facing": 0
  },
  "allies": [
    {
      "kind": "sherman76",
      "faction": "usa",
      "at": { "col": 1, "row": 2 },
      "facing": 0
    }
  ],
  "enemies": [
    {
      "kind": "tiger",
      "faction": "german",
      "at": { "col": 6, "row": 2 },
      "facing": 3
    }
  ]
}
```

## 编辑器与随机任务

关卡编辑器的玩家单位行提供“换车”，只列出坦克种类；选择车型会带入该车型的默认国籍。友军和敌军的车型选择不按国籍过滤，最终敌我关系由其所在列表决定。

随机任务生成器可传入：

```ts
generateRandomMissionPackage('europe', seed, {
  playerTankKind: 'tiger',
  playerTankFaction: 'german',
});
```

`playerTankKind` 必须是坦克，否则生成器会直接报错。

## 兼容性

- 自定义关卡包 schema 已升级到 v2；v1 包会在读取时自动补齐 `playerTank`。
- 战斗存档已升级到 v11，保存 `sideId` 和 `controller`；v2–v10 存档仍可读取。
- 保存时仍写出 `sherman` 兼容字段，供旧版本读取。
- 战役跨段继承玩家当前车型，不再固定重建为 Sherman。
