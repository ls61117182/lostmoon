# 坦克移动音效

音效路径由 `data/units.csv` 的 `moveSound` 配置；修改后运行 `node tools/buildUnitDB.js` 生成 `UnitDB.ts`。前进、后退和车体转向均使用该车型配置，循环随动画结束停止。

| 音效 | 车型 |
| --- | --- |
| `audio/tank_move`（原音效） | 谢尔曼、谢尔曼76、T-34/76、T-34/85、三号各型、四号各型、三号突击炮、九五式、九七式、四式；卡车沿用原配置 |
| `audio/tank_move_heavy` | 巨无霸、潘兴、KV-1、IS-2、SU-152、虎式、虎王、鼠式、豹式、突击虎、猎虎、猎豹（项目 ID `jagdpanther`）、象式 |

这是游戏音色的轻重分组：较重的中型坦克、加强装甲车辆及重型突击炮也使用重音效。

目前 `tank_move_heavy.mp3` 使用原 `tank_move.mp3` 的完整副本，恢复原移动声音和音量，同时保留重型车辆分类及独立资源路径。之后只需替换 `assets/resources/audio/tank_move_heavy.mp3`，保留其 `.meta` 文件，即可更换所有重型车辆的移动音效，无需修改车型配置。

验证：`node --test tests/TankMovementAudio.test.js tests/BattleSceneAudioCleanup.test.js tests/BattleSceneTurretAudio.test.js`。
