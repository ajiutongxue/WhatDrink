# 今天喝点什么茶

个人使用的微信小程序。它会结合个人档案、体质、城市天气、季节时令、当天状态和近期饮茶记录，从个人茶库中生成今日推荐；可选使用 OpenAI 兼容模型做语义解析、深度推荐和每日茶语。

当前应用版本：`1.0.3`。完整行为契约见 [SPEC.md](./SPEC.md)。

## 已实现能力

- 89 款初始茶库，支持添加、编辑、停用、删除和排序。
- 规则推荐、反重复、茶性平衡、体质和时段感知。
- LLM 解析与推荐，失败自动回退规则引擎。
- 高德实况天气云函数。
- 农历、节气、每日茶语和动态天气背景。
- 主推/备选/自定义/没喝打卡。
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
- `npm run check`：检查 JavaScript 语法、JSON、页面文件、TabBar 资源、WXML 事件处理器及云函数配置。
- `npm run verify`：依次运行静态检查和测试。

这些命令不能替代微信开发者工具编译和真机测试。

## 同步语义

主数据使用本地缓存 Key `tea_doctor_v1`，云端使用 `tea_doctor` 集合，并按 openid 隔离。

- `history`：按 `date + teaId + type` 合并。
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
SPEC.md          产品行为和实现契约
```

## 发布前检查

1. `npm run verify` 通过。
2. 微信开发者工具无编译错误。
3. 两个云函数都已部署到 `app.js` 指定的环境。
4. 模拟器和手机预览版分别验证天气、同步、推荐、打卡和图片上传。
5. 如果修改了数据模型或同步策略，同时更新 `SPEC.md` 和回归测试。