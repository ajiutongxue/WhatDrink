# UI 镜像原型

这套静态 HTML 原型用于快速迭代“今天喝点什么茶”的视觉设计。它是视觉设计源，不是正式 H5 产品，也不会调用天气、LLM、微信云开发或个人真实数据。

## 运行

```powershell
npm run ui:preview
```

打开终端输出的 `http://127.0.0.1:4173/ui-prototype/`。导航台可以切换页面、状态和 375×812 / 390×844 两种目标视口；推荐页还可以切换清晨/白天/黄昏/夜晚与晴/多云/阴/雨/雷/雪/雾，检查三层动态背景和前景适配。

结构校验：

```powershell
npm run ui:check
npm run verify
```

## 目录职责

- `manifest.json`：原型页面、小程序页面、必须状态和目标视口的映射契约。
- `index.html`：页面、状态和视口导航台。
- `pages/`：五个页面的视觉镜像。
- `styles/tokens.css`：设计 Token；定稿后单向同步至 `app.wxss`。
- `styles/base.css`、`components.css`、`pages.css`：基础、组件和页面样式。
- `scripts/fixtures.js`：脱敏演示数据。
- `scripts/prototype.js`：状态切换和导航台逻辑。

## 新增或调整状态

1. 先在 `manifest.json` 对应页面的 `states` 中登记稳定状态 ID。
2. 在页面中新增匹配的 `data-state="<id>"` 容器，并用 `data-section` 标记主要区块。
3. 在浏览器中完成 375×812 和 390×844 两种视口检查。
4. 定稿后把结构和 Token 变化同步到对应 WXML/WXSS。
5. 在微信开发者工具和真机复核，再运行 `npm run verify`。

原型与 WXML 不要求逐标签相同。必须保持一致的是信息顺序、区块职责、组件语义和用户可见状态；业务逻辑始终以小程序代码和 `SPEC.md` 为准。

## 安全边界

- fixture 不得出现真实 API Key、云环境数据、个人饮茶历史或其他敏感信息。
- 原型不得导入 `utils/data.js`、`utils/llm.js` 或云函数。
- 微信 Picker、Switch、Modal、TabBar 等系统控件仅做视觉替身，最终效果以微信端为准。
