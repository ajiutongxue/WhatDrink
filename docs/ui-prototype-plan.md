# HTML UI 镜像原型行动计划

> 状态：首版基础设施和五页状态镜像已落地。本文是后续 UI 迭代的执行契约；产品运行行为仍以 `SPEC.md` 为准。

## 目标与边界

建立一套与原生微信小程序页面、区块和视觉状态对应的静态 HTML 原型，用浏览器快速调整配色、字体、间距、卡片、背景和状态层级。

- HTML 原型是视觉设计源，小程序是业务行为源。
- 不迁移推荐算法、云同步、天气、图片上传、LLM 或统计计算。
- 不引入 Taro、React、Vue、Vite、Storybook 或新的 npm 依赖。
- 不把浏览器效果当成最终验收；微信开发者工具和真机仍是最终基准。
- 根目录现有 `ui-references*.html` 是历史视觉探索，保留原样，不作为正式原型扩展。

## 页面与状态矩阵

映射的机器可读版本位于 `ui-prototype/manifest.json`。

| 原型页面 | 小程序页面 | 必须覆盖的状态 |
|---|---|---|
| recommendation | `pages/index/index` | 初始、输入展开、加载、规则推荐、AI 推荐、无结果、已打卡、品饮记录 |
| history | `pages/history/history` | 空记录、普通列表、品饮展开、品饮编辑 |
| tea-library | `pages/teaLib/teaLib` | 分类浏览、筛选为空、管理模式、新增/编辑弹层 |
| settings | `pages/settings/settings` | 默认、体质测试、AI 开关状态、同步中、诊断展开 |
| statistics | `pages/stats/stats` | 空数据、完整统计 |

每个页面必须有稳定的 `data-page`，每个主要区块使用 `data-section`，每个状态使用 `data-state`。保持信息架构和语义结构一致，不要求 HTML DOM 与 WXML 逐标签相同。

## 设计 Token 对照

`ui-prototype/styles/tokens.css` 是浏览器侧的设计 Token 源。设计定稿后，按下表单向同步至 `app.wxss`；命名差异是显式映射，不做运行时共享。

| HTML Token | 小程序 Token | 用途 |
|---|---|---|
| `--cream` | `--cream` | 页面底色 |
| `--cream-2` | `--cream2` | 次级底色 |
| `--blush-soft` | `--blush-soft` | 暖色内容区 |
| `--coral` / `--coral-deep` | 同名 | 主操作与强调 |
| `--sage` / `--sage-deep` / `--sage-soft` | 同名 | 备选、成功与辅助 |
| `--cocoa` / `--ink-*` | `--cocoa` / `--ink*` | 文字层级 |
| `--card` / `--card-border` | 同名 | 卡片 |
| `--radius-*` | `--r-*` | 圆角 |

同步 Token 时同时检查字体、阴影、动效时长和安全区；这些项目不强求同名，但视觉意图必须一致。

## 日常 UI 迭代流程

1. 在正式原型中选择目标页面和状态，先完成浏览器侧设计。
2. 用 375×812 和 390×844 两种视口检查滚动、溢出、层级和安全区。
3. 锁定结构、组件语义和 Token 变化；不要在原型中实现真实业务。
4. 将确认后的变化同步到对应 WXML/WXSS；业务 JS 仅在视觉确实依赖新展示状态时调整。
5. 在微信开发者工具中使用相同状态逐页截图对照。
6. 真机抽查字体、TabBar、安全区、Picker/Switch/Modal、滚动和动态背景。
7. 运行 `npm run ui:check` 与 `npm run verify`，更新下方完成度。

## 完成标准

- [x] 建立五页 manifest 映射和两种目标视口。
- [x] 建立无依赖本地预览与页面/状态导航台。
- [x] 覆盖首页 8 个关键视觉状态。
- [x] 覆盖记录、茶库、设置和统计页关键状态。
- [x] 建立设计 Token、fixture 和安全边界。
- [x] 将结构校验接入项目验证命令。
- [ ] 与微信开发者工具完成五页逐状态截图校准。
- [ ] 在 iOS 与 Android 真机抽查字体、系统控件和安全区。

最后两项属于每次正式视觉定稿的人工验收，不能由静态 HTML 自动替代。发现差异时在本节下追加日期、页面、状态、设备和处理结果。

## 维护规则

- 新增小程序页面或主要视觉状态时，同时更新 manifest、HTML 页面、小程序页面和本清单。
- `npm run ui:check` 负责发现页面、状态和映射缺失，不宣称视觉像素一致。
- fixture 只使用虚构、脱敏内容，不包含 API Key、真实个人记录或云环境数据。
- `ui-prototype/` 不被小程序 `app.json` 引用，不进入小程序包体。
- 原型导致业务行为变化时，必须另行更新 `SPEC.md` 和对应回归测试。
