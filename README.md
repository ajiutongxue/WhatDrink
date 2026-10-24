# 今天喝点什么茶

个人使用的微信小程序。它会结合个人档案、体质、城市天气、季节时令、当天状态和近期饮茶记录，从个人茶库中生成今日推荐；可选使用 OpenAI 兼容模型做语义解析、深度推荐和每日茶语。

当前应用版本：`1.0.3`。完整行为契约见 [SPEC.md](./SPEC.md)。

微信小程序迁移为个人自用 PWA 的分步骤执行安排见 [PWA 实施方案](./docs/pwa-implementation-plan.md)。截至 2026-09-30，PWA 已部署到 [HTTP 在线试用站点](http://tea.xense.com.cn)，复用 ECS 的 Nginx，API 以 `yang` 的 `nohup` 后台进程运行，日常备份由用户手动管理。部署路径、HTTP 配置、启动方式和验收记录见 [部署说明](./deploy/README.md)。当前公网 HTTP 尚不支持 Service Worker 离线验收，真实数据迁移和正式切换仍待完成；以下说明保留微信小程序的运行和发布方式。

## 已实现能力

- 89 款初始茶库，支持添加、编辑、停用、删除和排序。
- 规则推荐、连续推荐上限、茶性平衡、体质和时段感知。
- LLM 解析与推荐，失败自动回退规则引擎。
- 高德实况天气云函数。
- 农历、节气、每日茶语和动态天气背景。
- 主推和备选卡片内直接打卡或设为“近期不想喝”，另有自选茶输入卡片。
- 品饮文字、图片和图片说明。
- 月度茶类/茶性统计、Top 5、最近 30 日频率。
- 本地缓存、微信云同步、JSON 导入导出和运行诊断。

## 环境要求

- Node.js 18 或更高版本，仅用于本地检查和测试。
- 微信开发者工具，项目基础库当前配置为 `3.16.2`。
- 已开通微信云开发环境；当前环境 ID 配置在 `app.js`。
- 高德开放平台 Web 服务 Key。
- 可选：OpenAI 兼容的 Chat Completions API。

根目录没有运行时 npm 依赖，不需要执行 `npm install`。`syncData` 云函数有自己的 `wx-server-sdk` 依赖，由微信开发者工具部署时安装。

## 首次配置

### 1. 导入小程序

在微信开发者工具中导入仓库根目录。`project.config.json` 已包含项目 AppID 和云函数根目录配置。

如果使用不同的微信小程序或云环境，需要同步修改：

- `project.config.json` 中的 `appid`。
- `app.js` 中 `wx.cloud.init({ env })` 的环境 ID。

### 2. 配置高德天气

复制示例文件：

```powershell
Copy-Item cloudfunctions\getWeather\config.example.json cloudfunctions\getWeather\config.json
```

将 `config.json` 中的 `amapKey` 替换为高德 Web 服务 Key。真实文件已被 `.gitignore` 排除，不要提交。

在微信开发者工具中分别上传并部署：

1. `cloudfunctions/getWeather`：云端安装依赖。
2. `cloudfunctions/syncData`：云端安装依赖。

天气调用链为：小程序 → `getWeather` 云函数 → 高德地理编码 → 高德实况天气。

### 3. 配置 AI（可选）

在设置页填写：

- API Key
- OpenAI 兼容端点，例如以 `/v1` 结束的基础地址
- 解析模型名
- 推荐模型名
- 对应功能开关

必须点击 AI 配置区的“保存”。开发者工具模拟器通常还需要关闭请求域名校验；真机预览需满足微信网络域名规则。

注意：API Key 当前会进入主数据并同步到云数据库。这是已知安全欠账，不适合共享账号或生产用途。

## 本地验证

```powershell
npm test
npm run check
npm run verify
```

- `npm test`：运行全部 `tests/*.test.js`。
- `npm run check`：检查 JavaScript 语法、JSON、页面文件、TabBar 资源、WXML 事件处理器、云函数配置和主包体积。
- `npm run verify`：依次运行项目静态检查、UI 原型结构检查和全部测试。

这些命令不能替代微信开发者工具编译和真机测试。

## 包体积

小程序主包上限为 2 MB。`project.config.json` 的 `packOptions.ignore` 排除了不参与运行的文件：文档、测试、脚本、UI 原型，以及 `data/` 下的茶叶知识研究产物（模型原始输出、批次输入、生成源 JSON）。运行时只需要 `data/teaKnowledgeCatalog.js` 和 `data/teaKnowledgeContract.js`，其余知识数据是离线生产物料，留在仓库里供重新生成，但不进包。

`npm run check` 会在打包体积超过 1.8 MB 时告警、超过 2 MB 时报错。往 `data/` 或 `utils/` 新增大文件后必须重跑，否则真机预览会因超限失败。

如果体积再次逼近上限，优先把资产移入分包，而不是继续扩充主包。

## UI 设计迭代

项目包含一套与五个小程序页面及关键状态对应的静态 HTML 镜像原型：

```powershell
npm run ui:preview
npm run ui:check
```

浏览器原型是视觉设计源，不请求真实天气、云数据或 LLM；业务行为仍以小程序和 `SPEC.md` 为准。页面映射、状态矩阵和双端校准流程见 [HTML UI 镜像原型行动计划](./docs/ui-prototype-plan.md)，具体运行方式见 [原型说明](./ui-prototype/README.md)。

## 同步语义

主数据使用本地缓存 Key `tea_doctor_v1`，云端使用 `tea_doctor` 集合，并按 openid 隔离。

- `history`：新记录按稳定 `id` 合并并以 `updatedAt` 判新旧，旧记录兼容 `date + teaId + type`。
- `temporaryAvoids`：每款茶按 `updatedAt` 合并，取消状态也同步。
- `profile`：`profileUpdatedAt` 较新的完整档案胜出。
- `settings`：`settingsUpdatedAt` 较新的完整设置胜出。
- `teaLibrary`：`teaLibraryUpdatedAt` 较新的有序整库快照胜出。
- 版本相同或旧数据没有时间戳时云端优先。
- `llm`：目前仍采用字段级本地非空值优先，尚不能可靠同步模型名和开关。

修改云同步代码后，必须重新部署 `syncData` 云函数，并重新生成手机预览版；只修改本地文件不会改变已部署云函数。

## 目录说明

```text
cloudfunctions/  微信云函数
pages/           小程序页面
utils/           数据、解析、推荐、天气、LLM、节气等模块
images/          TabBar 与动态场景资源
scripts/         工程静态检查与组合验证
 tests/          无第三方依赖回归测试
ui-prototype/    五页 HTML UI 镜像原型
docs/            实施计划与后续规划
SPEC.md          产品行为和实现契约
```

## 发布前检查

1. `npm run verify` 通过。
2. 微信开发者工具无编译错误。
3. 两个云函数都已部署到 `app.js` 指定的环境。
4. 模拟器和手机预览版分别验证天气、同步、推荐、打卡和图片上传。
5. 如果修改了数据模型或同步策略，同时更新 `SPEC.md` 和回归测试。
