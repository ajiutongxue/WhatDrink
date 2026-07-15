# 今天喝点什么茶 — 微信小程序产品规格书

> 版本：v1.0 MVP | 日期：2026-07-13

---

## 1. 产品概述

「今天喝点什么茶」是一款每日饮茶推荐工具，根据用户的身体状况、所在城市天气、季节时令，从个人茶叶库中智能推荐当天最适合饮用的茶。支持规则引擎推荐和 AI 深度分析两种模式。

### 1.1 核心价值

- **场景驱动推荐**：不是简单地列茶单，而是结合"今天的你"来推荐
- **中医茶疗知识**：每次推荐附带茶性分析和调理建议，喝茶也是养生
- **反重复机制**：避免连续多天推荐同一款茶，保持新鲜感

### 1.2 使用场景

个人自用工具，通过微信开发者工具的**开发版/预览版**运行，不上线正式版。

### 1.3 约束条件

- **不上线**：仅通过微信开发者工具的开发版/预览版运行，不上架正式版
- **云开发**：使用微信小程序云开发做数据同步（云数据库），开发版/预览版免费额度足够个人使用
- **数据可迁移**：支持 JSON 导出/导入，作为云同步之外的离线备份手段

---

## 2. 技术方案

### 2.1 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 框架 | 原生微信小程序 | WXML + WXSS + JS，无第三方框架 |
| 本地存储 | wx.setStorageSync | 离线缓存，10MB 容量上限 |
| 云同步 | 微信云开发（云数据库） | 数据自动同步，换设备不丢数据 |
| 天气 | wttr.in API | 免费、无需 Key、支持中文城市 |
| AI | 阿里云百炼 / OpenAI 兼容 API | wx.request 调用，用户自配 Key |
| 最低版本 | 基础库 2.25.0+ | 支持 env(safe-area-inset-bottom) |

### 2.2 项目结构

```
whatToDrinkToday/
├── app.js                          # 全局逻辑、云开发初始化、数据初始化
├── app.json                        # 页面路由、TabBar 配置
├── app.wxss                        # 全局样式、CSS 变量、组件样式
├── project.config.json             # 项目配置
│
├── cloudfunctions/                  # 云函数目录
│   └── syncData/                   # 数据同步云函数
│       ├── index.js
│       └── package.json
│
├── pages/
│   ├── index/                      # 首页 — 今日推荐
│   │   ├── index.js
│   │   ├── index.json
│   │   ├── index.wxml
│   │   └── index.wxss
│   ├── history/                    # 饮茶记录
│   │   ├── history.js
│   │   ├── history.json
│   │   ├── history.wxml
│   │   └── history.wxss
│   ├── teaLib/                     # 茶叶库
│   │   ├── teaLib.js
│   │   ├── teaLib.json
│   │   ├── teaLib.wxml
│   │   └── teaLib.wxss
│   └── settings/                   # 设置
│       ├── settings.js
│       ├── settings.json
│       ├── settings.wxml
│       └── settings.wxss
│
├── utils/
│   ├── teaData.js                  # 89款茶叶初始数据
│   ├── data.js                     # 数据层（本地缓存 + 云同步，统一接口）
│   ├── recommend.js                # 推荐引擎（评分、排序、反重复）
│   ├── parser.js                   # 自由文本解析器
│   ├── weather.js                  # 天气服务封装
│   └── llm.js                      # LLM API 调用封装
│
└── docs/
    └── phase2.md                   # Phase 2 迭代计划
```

---

## 3. 数据模型

### 3.1 存储 Key：`tea_doctor_v1`

一个 JSON 对象，结构如下：

```typescript
interface AppData {
  profile: {
    gender: 'male' | 'female' | '';
    age: string;               // 年龄
    city: string;              // 常驻城市（输入框提取城市时自动更新）
    constitution: '偏寒' | '平和' | '偏热' | null;  // Phase 2
    quizAnswers: Record<number, number>;             // Phase 2
  };

  history: HistoryEntry[];     // 饮茶记录（按时间正序）

  settings: {
    avoidDays: number;         // 反重复天数，默认 5
  };

  llm: {
    enabled: boolean;          // AI 增强推荐开关
    apiKey: string;            // API Key（解析和推荐共用）
    endpoint: string;          // API 端点 URL（共用）
    recModel: string;          // 推荐模型名称，默认 'deepseek-v4-pro'
    parserModel: string;       // 解析模型名称，默认 'deepseek-v3'（更轻量）
    parserEnabled: boolean;    // LLM 解析开关（关闭则仅用关键词匹配）
  };

  teaLibrary: Tea[];           // 用户茶叶库（可编辑版本，覆盖初始数据）
}
```

### 3.2 茶叶数据 Tea

```typescript
interface Tea {
  id: number;                  // 唯一 ID（数组下标）
  name: string;                // 茶名，如 "蒙顶雪芽"
  brand: string;               // 品牌/系列，如 "禹蒙"
  cat: string;                 // 分类 key（见 3.3）
  year: number | null;         // 生产年份，null 表示未知
  nature: string;              // 当前茶性：寒/凉/平/温/热（含年份推算）
  baseNature: string;          // 原始基础茶性（未推算）
  caffeine: '高' | '中' | '低';
  seasons: string[];           // 适宜季节 ['春','夏']
  avoidSeasons: string[];      // 不宜季节
  note?: string;               // 备注，如 "疑似假货"
}
```

### 3.3 茶叶分类

| Key | 中文名 | 基础茶性 | 基础咖啡因 | 适宜季节 | 陈化规则 |
|-----|--------|----------|-----------|---------|---------|
| green | 绿茶 | 寒 | 中 | 春、夏 | 无 |
| black | 红茶 | 温 | 中 | 秋、冬 | 无 |
| white | 白茶 | 凉 | 低 | 春、夏、秋 | ≥3年→平，≥7年→温 |
| oolong_tieguanyin | 铁观音 | 平 | 中 | 春、秋 | 无 |
| oolong_wuyi | 武夷岩茶 | 平 | 中 | 秋、冬 | 无 |
| oolong_dancong | 凤凰单枞 | 平 | 中 | 春、秋 | 无 |
| puerh_raw | 普洱生茶 | 寒 | 中 | 夏 | ≥5年→凉，≥10年→平 |
| puerh_ripe | 普洱熟茶 | 温 | 低 | 秋、冬 | 无 |
| flavored_jasmine | 茉莉花茶 | 平 | 低 | 春、夏 | 无 |
| flavored_other | 调味茶 | 平 | 低 | 四季 | 无 |

### 3.4 饮茶记录 HistoryEntry

```typescript
interface HistoryEntry {
  date: string;        // ISO 日期 'YYYY-MM-DD'
  teaId: number;       // 茶叶 ID，-1 表示自定义/没喝
  teaName: string;     // 茶名（自定义时为用户输入）
  teaCat: string;      // 分类 key，'unknown' 或 'none'
  teaBrand: string;    // 品牌，自定义时为空
  type: 'primary' | 'alt' | 'custom' | 'skip';
  tastingNotes?: string;    // 品饮感受（可选），打卡后或从历史页面补充
  imageFileIDs?: Array<{ fileID: string; caption: string }>;  // 品饮图片（可选），最多 6 张云存储 fileID，每张可配 40 字说明
  checkinTime?: string;  // 打卡时间 'HH:MM'（可选），用于时段感知推荐
  reaction?: {           // 喝后感（可选），反馈到推荐引擎
    rating: 'good' | 'neutral' | 'bad';
    effects?: string[];  // ['失眠','胃不适','提神','舒适','口干']
  };
}
```

---

## 4. 页面规格

### 4.1 首页 — 今日推荐

**路由**：`pages/index/index`（TabBar 第一个）

**布局**：
1. 顶部标题区（"今天喝点什么茶" + 当前季节/节气，小字灰色）
2. 输入卡片（圆角大卡片，textarea + 解析标签 + 推荐按钮）
3. 推荐结果区（动态渲染，见下方）

**输入卡片**：
- textarea，placeholder 引导用户输入
- 输入时实时解析，下方显示识别到的标签（城市、症状、偏好、回避）
- 底部圆角按钮"开始推荐"

**推荐流程**：
```
用户输入
  → parser.js：LLM 解析（若开启）或关键词匹配
  → 检测到城市变更 → weather.js 拉取新城市天气 → 同步更新 profile.city
  → recommend.js 规则引擎评分 → 过滤硬排除项 → 排序取 top
  → 若 LLM 推荐开启 → llm.js 调用深度模型 → 用 LLM 结果替换推荐和解释
  → 渲染推荐卡片 + 打卡区
```

**推荐结果渲染**：
- **主推卡片**（大卡片）：渐变背景、茶名 24px 粗体、品牌、属性/茶类/咖啡因/年份标签组、推荐说明（带左侧竖线装饰）、冲泡信息
- **备选卡片**（紧凑横排）：左侧茶类图标圆形、右侧茶名+品牌+简短理由
- **AI 标识**：若由 LLM 生成，主推卡片显示"AI 推荐"徽章 + 模型名称
- **打卡区**：4个胶囊按钮——主推茶名（高亮）、备选茶名（虚线边框）、"喝的别的"（展开输入框）、"没喝"

**"喝的别的"交互**：
- 点击后展开输入框 + "记录"按钮
- 输入茶名，支持从茶叶库模糊匹配
- 匹配到则关联 teaId 记录，未匹配则存为自定义条目
- 自定义记录同样参与反重复

**加载状态**：
- 天气获取中：按钮文字变为"获取天气中..."
- LLM 分析中：显示居中大卡片，脑图标 + "AI 正在分析..." + 动画点

### 4.2 饮茶记录

**路由**：`pages/history/history`（TabBar 第二个）

**布局**：
- 时间线列表，最新在上
- 每条记录：日期（MM-DD）+ 彩色圆点（茶类颜色）+ 茶名 + 标签（主推/备选/自选）+ 品牌·茶类
- "没喝"记录：灰色圆点 + 灰色文字"今天没喝茶"
- 空状态：居中提示"还没有饮茶记录"

### 4.3 茶叶库

**路由**：`pages/teaLib/teaLib`（TabBar 第三个）

**布局**：
- 顶部筛选栏：横向滚动的茶类筛选标签（全部/绿茶/红茶/白茶/乌龙/生普/熟普/调味），选中态高亮
- 茶叶列表：每行显示彩色圆点（茶类颜色）+ 茶名 + 属性标签 + 年份 + 咖啡因
- 列表按分类分组，组头显示分类名和数量
- 统计栏：底部显示总数和各分类数量

**Phase 2 扩展**：
- 点击进入茶叶详情（属性、历史饮用记录、编辑）
- 增删茶叶（不重新发布）

### 4.4 设置

**路由**：`pages/settings/settings`（TabBar 第四个）

**区块**：
1. **个人档案**：性别（单选）、年龄（数字输入）、常驻城市（文本输入）
2. **AI 配置**：
   - API Key（密码输入框，解析和推荐共用）
   - API 端点（文本输入，共用）
   - 智能解析：开关 + 模型名称输入（默认 deepseek-v3，轻量快速）
   - 深度推荐：开关 + 模型名称输入（默认 deepseek-v4-pro，深度分析）
3. **推荐设置**：反重复天数（数字输入，默认 5）
4. **数据管理**：
   - 云同步状态：显示上次同步时间 + 「立即同步」按钮
   - 导出 JSON、导入 JSON（wx.chooseMessageFile）、重置所有数据

---

## 5. 核心模块规格

### 5.1 文本解析器 — utils/parser.js

采用**两阶段解析**：先用小模型理解语义，再用关键词匹配兜底。

**解析流程**：
```
用户输入
  → parserEnabled && apiKey 有效？
    → 是：调用 LLM 解析（parserModel）→ 成功则返回结果
                                      → 失败则 fallback
    → 否：关键词匹配
  → 返回 ParsedInput
```

**输入**：用户输入的自由文本字符串

**输出**：
```typescript
interface ParsedInput {
  city: string | null;           // 提取的城市名
  states: string[];              // 识别到的身体状况
  avoidCats: string[];           // 不想喝的茶类 key
  avoidTeas: number[];           // 不想喝的具体茶叶 ID
  preferCats: string[];          // 想喝的茶类 key
  mood: 'light' | 'strong' | 'sweet' | null;  // 口味偏好
}
```

#### 阶段一：LLM 语义解析

使用配置中的 parserModel（默认 deepseek-v3，比推荐模型更轻量快速）调用 API。

**Prompt**：
```
分析以下用户输入，提取饮茶推荐相关的结构化信息。

【茶类列表】绿茶、红茶、白茶、铁观音、武夷岩茶、凤凰单枞、普洱生茶、普洱熟茶、茉莉花茶、调味茶

【身体状况可选值】热证、脾胃寒、感冒、失眠、疲劳、燥、湿重、积食、压力、经期、阳虚、酒后

用户输入："{input}"

请严格按以下JSON返回：
{
  "city": "城市名或null",
  "states": ["识别到的身体状况，可多个"],
  "avoidCats": ["不想喝的茶类中文名，可多个"],
  "preferCats": ["想喝的茶类中文名，可多个"],
  "mood": "light/strong/sweet或null"
}
```

**请求参数**：temperature: 0.1（解析需要确定性），max_tokens: 300

**后处理**：
- LLM 返回的茶类中文名映射为 key（如 "普洱生茶" → "puerh_raw"，"普洱" → ["puerh_raw", "puerh_ripe"]）
- 身体状况值校验（必须在预定义列表内）
- 返回的 avoidCats/preferCats 是中文名，需映射为 cat key

#### 阶段二：关键词匹配（兜底）

当 LLM 解析不可用（未开启、无 API Key、调用失败）时使用。

**身体状况识别关键词表**（12 类）：

| 类别 | 关键词 |
|------|--------|
| 热证 | 上火、长包、长痘、口腔溃疡、喉咙痛、嗓子疼、咽痛、牙疼、牙龈肿、嘴破、口干、口苦 |
| 脾胃寒 | 腹泻、拉肚子、拉稀、肠胃不好、胃不舒服、胃寒、胃凉、肚子凉、肚子疼、着凉 |
| 感冒 | 感冒、鼻塞、流涕、发烧、咳嗽、伤风、头疼、头痛 |
| 失眠 | 失眠、没睡好、睡不着、熬夜、昨晚没睡、睡不好 |
| 疲劳 | 累、疲劳、犯困、困、加班、辛苦、疲惫、乏力、没精神 |
| 燥 | 燥、干燥、上火干燥、口干舌燥、皮肤干 |
| 湿重 | 湿气、湿重、身体沉、困重、舌苔厚、痰多 |
| 积食 | 吃撑、吃多了、吃太油、油腻、胀气、积食、消化不好 |
| 压力 | 压力大、焦虑、紧张、烦躁、心烦、心情不好 |
| 经期 | 经期、姨妈、例假、月经、痛经 |
| 阳虚 | 手脚冷、怕冷、畏寒、手脚冰凉 |
| 酒后 | 喝多了、宿醉、酒 |

**城市提取正则**：`/(?:在|去|到了?)([\u4e00-\u9fa5]{2,4}(?:市|县|区|镇)?)/`

**回避/偏好检测**：
- 回避模式：`不想喝|不喝|不要|别喝|避开` + 茶类关键词
- 偏好模式：`想喝|来点|来个|喝点` + 茶类关键词
- "普洱"作为通用关键词同时匹配 puerh_raw 和 puerh_ripe
- "乌龙"同时匹配铁观音、武夷岩茶、凤凰单枞

### 5.2 推荐引擎 — utils/recommend.js

**输入**：
- teaLibrary: Tea[]（全量茶叶库）
- parsedInput: ParsedInput（解析后的用户输入）
- weather: WeatherData | null（天气数据）
- history: HistoryEntry[]（饮茶记录）
- avoidDays: number（反重复天数）

**输出**：
```typescript
interface RecommendResult {
  primary: ScoredTea | null;    // 主推
  alt: ScoredTea | null;        // 备选（尽量与主推不同茶类）
  candidates: ScoredTea[];      // 全部候选（传给 LLM 用）
}

interface ScoredTea {
  tea: Tea;
  score: number;
  reasons: string[];            // 推荐理由（最多3条）
  avoids: string[];             // 不推荐理由（最多2条）
  hardFiltered: boolean;        // 是否被硬排除
}
```

**评分规则**（基础分 50）：

| 维度 | 分值范围 | 规则 |
|------|---------|------|
| 茶性匹配 | 0 ~ +30 | 与理想茶性的差值，差1级扣15分 |
| 季节匹配 | -12 ~ +15 | 在适宜季节+15，在不宜季节-12 |
| 身体状况 | -25 ~ +20 | 按12类状况分别加减分（见下方详表） |
| 咖啡因+时段 | -15 ~ +10 | 晚间/夜间高咖啡因-10，低咖啡因+8~+10 |
| 回避限制 | -60（硬排除） | 用户指定不想喝的茶类/茶款 |
| 偏好加分 | +20 | 用户指定想喝的茶类 |
| 口味偏好 | +8 | light→低咖啡因+寒凉平，strong→高咖啡因 |
| 反重复 | -80（硬排除） | N天内已喝过的茶 |
| 品质存疑 | -30（硬排除） | note 含"疑似假货"的茶 |

**理想茶性计算**：
```
base = 季节基准（春-0.5, 夏-1.2, 秋+0.3, 冬+1.2）
+ 温度修正（≥33°C: -0.6, ≥28°C: -0.3, ≤0°C: +0.6, ≤8°C: +0.3）
+ 湿度修正（≥75%: +0.3, ≤25%: -0.2）
+ 身体状况修正（热证-1.0, 脾胃寒+1.0, 阳虚+0.8, 感冒+0.3, 燥-0.3, 湿重+0.3, 经期+1.0）
→ clamp(-2, 2)
```

**身体状况加减分详表**：

| 状况 | 加分条件 | 减分条件 |
|------|---------|---------|
| 热证 | 寒/凉性 +18（清热降火） | 温/热性 -25 |
| 脾胃寒 | 温/平性 +12（温和不刺激） | 寒/凉性 -22 |
| 阳虚 | 温/热性 +15（温阳暖身） | 寒/凉性 -18 |
| 感冒 | 温/平性 +8 | 高咖啡因 -10 |
| 失眠/疲劳 | 低咖啡因 +10 | 高咖啡因 -15 |
| 积食 | 熟普 +20，岩茶 +10 | — |
| 湿重 | 熟普 +12 | 凉性生普 -8 |
| 燥 | 白茶 +12（润燥生津） | 温/热性 -12 |
| 压力 | 单枞/铁观音/茉莉 +12（舒缓） | — |
| 经期 | 温性+低咖啡因 +15 | 寒/凉性 -20 |
| 酒后 | 平/凉性 +8 | 高咖啡因 -10 |

**硬排除过滤**：
带 hardFiltered=true 的候选在最终选择前被完全移除，不进入 primary/alt 选择池。

**备选选择策略**：
从过滤后的候选中，选 primary 后第一个与 primary 不同茶类的茶作为 alt。若找不到不同茶类的，取分数次高的。

### 5.3 天气服务 — utils/weather.js

```typescript
interface WeatherData {
  temp: number;           // 温度 °C
  feelsLike: number;      // 体感温度
  humidity: number;       // 湿度 %
  desc: string;           // 天气描述（中文）
  wind: number;           // 风速 km/h
  city: string;           // 城市名
}

// API: https://wttr.in/{city}?format=j1&lang=zh
// 返回 WeatherData 或 null（失败时）
function fetchWeather(city: string): Promise<WeatherData | null>
```

**失败处理**：返回 null，推荐引擎在无天气数据时跳过天气维度评分。

### 5.4 LLM 调用 — utils/llm.js

提供两个函数，共用 API Key 和端点，使用不同模型：

```typescript
interface LLMConfig {
  apiKey: string;
  endpoint: string;           // 如 'https://xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  recModel: string;           // 推荐模型，如 'deepseek-v4-pro'
  parserModel: string;        // 解析模型，如 'deepseek-v3'
}

// === 解析用（轻量模型，快速响应） ===
interface ParsedLLMResult {
  city: string | null;
  states: string[];
  avoidCats: string[];        // 茶类中文名，需后处理映射为 key
  preferCats: string[];
  mood: 'light' | 'strong' | 'sweet' | null;
}

function parseWithLLM(
  input: string,
  config: LLMConfig
): Promise<ParsedLLMResult | null>

// === 推荐用（深度模型，详细分析） ===
interface LLMResult {
  primary: { name: string; reason: string };
  alternative: { name: string; reason: string };
  excluded: string;
}

function callLLM(
  candidates: ScoredTea[],
  parsedInput: ParsedInput,
  weather: WeatherData | null,
  config: LLMConfig,
  profile: Profile
): Promise<LLMResult | null>
```

**parseWithLLM 参数**：temperature: 0.1, max_tokens: 300, model: config.parserModel
**callLLM 参数**：temperature: 0.7, max_tokens: 2000, model: config.recModel

**失败处理**：两个函数均在失败时返回 null，调用方各自 fallback（解析 fallback 到关键词匹配，推荐 fallback 到规则引擎）。

### 5.5 数据层 — utils/data.js

统一封装本地缓存和云同步，对外暴露简洁接口。调用方不关心数据来自本地还是云端。

**本地缓存**：`wx.setStorageSync('tea_doctor_v1', data)`
**云端存储**：微信云开发云数据库，集合 `tea_doctor`（每个用户一条文档，以 openid 为 key）

```typescript
// === 核心接口 ===

// 立即返回本地缓存数据（同步，启动时用）
// 若本地无数据则返回默认值（含初始茶叶库）
function load(): AppData

// 写入数据：先写本地缓存（立即生效），再推云端（防抖 2 秒）
function save(data: AppData): void

// 启动时同步：拉云端数据，与本地合并，返回合并后的数据
// 小程序 onLaunch 中调用，await 完成后再渲染页面
function sync(): Promise<AppData>

// === 数据管理 ===
function exportJSON(): string                      // 导出为 JSON 字符串
function importJSON(json: string): boolean         // 导入，校验格式后写入
function reset(): void                             // 重置为默认值

// === 内部 ===
function getDefaultData(): AppData                 // 默认数据（含 89 款茶叶）
```

**同步时机**：
1. `app.onLaunch`：`await data.sync()` 合并云端数据
2. 每次 `data.save()`：防抖 2 秒后自动推云端
3. 设置页「立即同步」按钮：手动调用 `data.sync()`

**合并策略**（在云函数中执行）：
- `history`：取并集，按 `date + teaId + type` 三元组去重
- `profile`：以云端为准
- `settings` / `llm`：以云端为准
- `teaLibrary`：以云端为准（云端有则覆盖本地）

### 5.6 云函数 — cloudfunctions/syncData

云函数用于处理数据合并逻辑，避免在客户端做复杂的数据比对。

**功能**：接收客户端上传的数据，与云端现有数据合并后写回。

```javascript
// cloudfunctions/syncData/index.js
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const db = cloud.database();
  const collection = db.collection('tea_doctor');

  // 查找当前用户的文档
  const existing = await collection.where({ _openid: openid }).get();

  if (existing.data.length === 0) {
    // 首次同步，直接写入
    await collection.add({ data: { ...event.data, _openid: openid, updatedAt: db.serverDate() } });
  } else {
    // 合并数据
    const cloudData = existing.data[0];
    const merged = mergeData(cloudData, event.data);
    await collection.doc(cloudData._id).update({ data: { ...merged, updatedAt: db.serverDate() } });
  }

  return { success: true };
};

// 合并策略
function mergeData(cloud, local) {
  // history: 取并集，按 date+teaId+type 去重
  const historyMap = new Map();
  [...(cloud.history || []), ...(local.history || [])].forEach(h => {
    historyMap.set(`${h.date}_${h.teaId}_${h.type}`, h);
  });

  return {
    history: [...historyMap.values()],
    profile: local.profile || cloud.profile,
    settings: local.settings || cloud.settings,
    llm: local.llm || cloud.llm,
    teaLibrary: local.teaLibrary || cloud.teaLibrary,
  };
}
```

---

## 6. 全局样式规范

### 6.1 CSS 变量

```css
page {
  --bg: #FAF5ED;
  --bg2: #F0E8DA;
  --card: #FFFDF9;
  --primary: #6B4F3A;
  --accent: #C4793B;
  --accent2: #D4956A;
  --text: #3A2A1E;
  --text2: #8A7668;
  --text3: #B5A89A;
  --border: #E8DFD0;
  --border-light: #F0EBE3;
  --nature-寒: #4A7FB5;
  --nature-凉: #6AAFCF;
  --nature-平: #A8A8A8;
  --nature-温: #D4883A;
  --nature-热: #C25B45;
  --r-sm: 16rpx;
  --r-md: 28rpx;
  --r-lg: 40rpx;
  --r-xl: 56rpx;
}
```

### 6.2 组件视觉规范

| 组件 | 样式 |
|------|------|
| 主推卡片 | 渐变背景 #FDF8F2→#F7EDE0，圆角 56rpx，大阴影，装饰光圈 |
| 备选卡片 | 白底，圆角 40rpx，小阴影，左侧圆形图标 |
| 输入区 | 白底，圆角 56rpx，中阴影，无边框 textarea |
| 推荐按钮 | 深色渐变 #7A5640→#5C3D2E，圆角 56rpx，高度 88rpx |
| 打卡胶囊 | 圆角 56rpx，主推高亮底，备选虚线框，其余弱化 |
| 标签 | 圆角 32rpx，各状态色（见 parser 标签色表） |
| 茶性标签 | 白字圆角标签，颜色跟随茶性变量 |

---

## 7. TabBar 配置

```json
{
  "tabBar": {
    "color": "#B5A89A",
    "selectedColor": "#C4793B",
    "backgroundColor": "#FFFDF9",
    "borderStyle": "white",
    "list": [
      { "pagePath": "pages/index/index", "text": "推荐", "iconPath": "...", "selectedIconPath": "..." },
      { "pagePath": "pages/history/history", "text": "记录", "iconPath": "...", "selectedIconPath": "..." },
      { "pagePath": "pages/teaLib/teaLib", "text": "茶库", "iconPath": "...", "selectedIconPath": "..." },
      { "pagePath": "pages/settings/settings", "text": "设置", "iconPath": "...", "selectedIconPath": "..." }
    ]
  }
}
```

---

## 8. 权限与配置

### 8.1 app.json 核心配置

```json
{
  "pages": [
    "pages/index/index",
    "pages/history/history",
    "pages/teaLib/teaLib",
    "pages/settings/settings"
  ],
  "window": {
    "navigationBarTitleText": "今天喝点什么茶",
    "navigationBarBackgroundColor": "#5C3D2E",
    "navigationBarTextStyle": "white",
    "backgroundColor": "#FAF5ED"
  },
  "cloud": true,
  "sitemapLocation": "sitemap.json"
}
```

> `cloud: true` 启用云开发。云环境 ID 在 `app.js` 的 `wx.cloud.init()` 中配置。

### 8.2 网络域名

开发版/预览版不校验域名白名单，在微信开发者工具中勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」即可。

涉及的外部域名：
- `https://wttr.in` — 天气 API
- 用户自配的 LLM API 域名（如阿里云百炼）

---

## 9. Phase 2 迭代计划（不在 MVP 范围）

### 9.1 体质辨识

- 5 题测试（怕冷/怕热、饮水偏好、出汗、大便、唇色）
- 结果分三档：偏寒、平和、偏热
- 接入推荐引擎，调整理想茶性基准值

### 9.2 茶叶库编辑

- 添加茶叶：名称、品牌、茶类、年份、手动覆盖属性
- 删除/停用茶叶
- 编辑茶叶属性
- 数据存储在本地，无需重新发布

### 9.3 饮茶统计

- 月度饮茶分布（按茶类饼图）
- 饮茶频率趋势（折线图）
- 最常喝的茶 Top 5

### 9.4 微信能力集成（可选）

- wx.getLocation 自动获取城市（需授权）
- 分享推荐结果卡片到聊天

> **不做**：订阅消息（需要上线正式版）、朋友圈分享（需要上线）

---

## 10. 测试清单

### 10.1 功能测试

- [ ] 输入"人在长沙，有点上火" → 正确解析城市+热证 → 推荐寒/凉性茶
- [ ] 输入"不想喝普洱" → 生普+熟普全部排除
- [ ] 输入"昨晚没睡好" → 推荐低咖啡因茶
- [ ] 输入"吃撑了" → 熟普/岩茶获得加分
- [ ] 打卡主推 → 历史记录显示"主推"标签 → 5天内不再推荐该茶
- [ ] 打卡"喝的别的" → 输入茶名 → 模糊匹配成功 → 历史记录显示"自选"标签
- [ ] 打卡"没喝" → 历史记录显示灰色"今天没喝茶"
- [ ] AI 推荐开启 → 等待加载 → 显示 AI 生成的推荐和详细解释
- [ ] AI 推荐失败 → 自动 fallback 到规则引擎
- [ ] 设置页修改城市 → 首页推荐使用新城市天气
- [ ] 导出数据 → 得到合法 JSON → 导入后数据恢复

### 10.2 兼容性测试

- [ ] iPhone SE（小屏）布局正常
- [ ] iPhone 14 Pro（刘海屏）安全区适配
- [ ] 安卓主流机型（华为/小米）正常
- [ ] 微信开发者工具模拟器各机型正常
