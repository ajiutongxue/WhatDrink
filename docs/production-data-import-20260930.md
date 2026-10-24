# 原小程序正式源数据导入 · 2026-09-30

用户指定：“原微信小程序使用的数据就是正式数据，把那个数据导入线上数据库”。本次输入直接来自原 `utils/data.js` 的 `getDefaultData()`，复用其茶库和内置知识目录；未改动原源文件。

这份源码数据不包含手机上的 `tea_doctor_v1` 缓存或微信云端后续个人记录。历史、库存、临时回避和个人覆盖原本为空，无 AI Key。`data/teaPackageObservations.js` 属于包装观察材料，没有转换成库存。

## 输入与执行

- 本地生成文件：`server/.test-runtime/tea-miniprogram-bundled-data-20260930.json`（忽略目录，不提交个人导出）。
- 服务器输入：`/tmp/tea-miniprogram-bundled-data-20260930.json`。
- SHA-256：`31e47d3eb7458345cb2527fbd3529dfd8ee225150172886d739b601c5718b6ec`；上传前后相同，导入后原文件哈希不变。
- 执行用户：`yang`；数据库：`/home/yang/webapp/tea-data/tea.sqlite3`。
- 工具：现有独立 `python -m server.legacy_import`。本地与服务器 dry-run 均通过，warnings、generatedHistoryIds、ignoredImageFileIDs 为空。
- 正式导入先用 SQLite backup API 创建快照，再在单事务内写入，保留一次性迁移标记；此次没有使用 `--allow-repeat`。
- 导入前快照：`/home/yang/webapp/tea-data/backups/tea-before-change-1790759163-94c091aa.sqlite3`。

## 导入前后

| 项目 | 导入前 | 导入后 | 与输入一致 |
| --- | ---: | ---: | --- |
| 数据版本 revision | 0 | 1 | 是 |
| 茶叶 | 89 | 89 | 是 |
| 持久化完整知识画像 | 0 | 86 | 是 |
| 历史 | 0 | 0 | 是 |
| 库存 | 0 | 0 | 是 |
| 临时回避 | 0 | 0 | 是 |
| 个人知识覆盖 | 0 | 0 | 是 |

三个预留茶款 `0、25、68` 保留，不生成额外研究画像。画像抽样 `teaId=1、10、11` 的 lifecycle 均为 complete，profileVersion 为 1；推荐设置 avoidDays 为 5。

## 验证

- 在只读 SQLite 连接中重新解析迁移输入，逐项对比 `teaLibrary`、`history`、`temporaryAvoids`、`profile`、`settings`、`llm`、`knowledgeBase`、`knowledgeOverrides`、`inventory`：全部相同。
- 迁移标记哈希与输入相同，当前库 `PRAGMA integrity_check=ok`；导入前快照存在、版本为 0、完整性为 ok。
- AI Key 行数为 0，状态 JSON 不含 `llm.apiKey`。
- Tea API 直连健康接口 204，Nginx 代理健康接口 204，Nginx 与原拼写服务 active。
- 无软件安装、系统配置修改、文件删除或服务重启；每日备份 timer 未启用。

本记录仅证明此次指定源码数据已完整导入。不代表手机缓存、云端个人记录、微信图片或旧端停止写入已经迁移/完成，也不代表这次 UI 修复代码已部署到线上。
