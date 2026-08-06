# 今天喝点什么茶 — 微信小程序产品规格书

> 实现版本：v1.0.3 | 文档校准日期：2026-07-24 | 以当前仓库代码为准

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

| 层级 | 当前实现 | 说明 |
|------|----------|------|
| 客户端 | 原生微信小程序 | WXML + WXSS + CommonJS JavaScript，无 UI 框架 |
| 本地存储 | `wx.getStorageSync` / `wx.setStorageSync` | 主数据 Key 为 `tea_doctor_v1` |
| 云同步 | 微信云开发 | `syncData` 云函数 + `tea_doctor` 云数据库集合 |
| 品饮图片 | 微信云存储 | `tasting-images/` 路径，历史记录保存 fileID 与说明 |
| 天气 | 高德地图 Web 服务 API | `getWeather` 云函数代理，客户端不直接访问高德 |
| AI | OpenAI 兼容 Chat Completions API | 用户配置端点、API Key、解析模型和推荐模型 |
| 日历 | 本地农历/节气数据 | `utils/lunar.js`，不依赖外部日历接口 |
| 可视化 | Canvas 2D | 饮茶统计页环形图 |
| 样式 | 暖屿粉彩主题 + 动态场景 | 时段基底、天气叠加、色温层；字体可选动态加载 |
| 基础库 | 项目配置 `3.16.2` | `project.config.json` 中的当前开发者工具设置 |

### 2.2 项目结构

```text
WhatToDrinkToday/
├── app.js / app.json / app.wxss       # 启动、路由、全局样式
├── sitemap.json                        # 小程序索引规则
├── package.json                        # 本地检查与测试命令
├── README.md                           # 开发、配置、部署说明
├── project.config.json                 # 微信开发者工具项目配置
├── cloudfunctions/
│   ├── getWeather/                     # 高德地理编码与实况天气代理
│   └── syncData/                       # 按 openid 合并主数据
├── pages/
│   ├── index/                          # 今日推荐、动态背景、打卡、每日茶语
│   ├── history/                        # 饮茶记录与品饮感受
│   ├── teaLib/                         # 茶库筛选和增删改停用排序
│   ├── settings/                       # 档案、体质、AI、同步、诊断
│   └── stats/                          # 月度分布、茶性、Top 5、30 日频率
├── utils/
│   ├── data.js                         # 本地缓存、云同步、导入导出
│   ├── parser.js                       # LLM/关键词双阶段解析
│   ├── recommend.js                    # 规则推荐引擎
│   ├── llm.js                          # OpenAI 兼容请求、重试与错误分类
│   ├── weather.js                      # getWeather 云函数客户端封装
│   ├── teaData.js                      # 89 款初始茶与冲泡数据
│   ├── lunar.js                        # 农历和节气
│   ├── tracker.js                      # 本地诊断事件
│   └── font.js                         # 可选衬线字体加载
├── images/                             # TabBar 与动态背景 SVG/PNG
├── scripts/                            # 工程静态检查
├── tests/                              # 无第三方依赖回归测试
└── docs/                               # 动态背景和后续规划
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
  profileUpdatedAt: number;    // 个人档案最后修改时间戳；0 表示未填写

  history: HistoryEntry[];     // 饮茶记录；同步后按日期倒序
  temporaryAvoids: Record<string, TemporaryAvoidState>; // 每款茶的临时回避状态
  settings: {
    avoidDays: number;         // 连续推荐上限，默认 5；连续喝满 5 天后次日硬排除
  };
  settingsUpdatedAt: number;   // 推荐设置最后修改时间戳；0 表示默认设置

  llm: {
    enabled: boolean;          // AI 增强推荐开关
    apiKey: string;            // API Key（解析和推荐共用）
    endpoint: string;          // API 端点 URL（共用）
    recModel: string;          // 推荐模型名称，默认 'deepseek-v4-pro'
    parserModel: string;       // 解析模型名称，当前默认 'deepseek-v4-pro'
    parserEnabled: boolean;    // LLM 解析开关（关闭则仅用关键词匹配）
    noteAnalysisEnabled: boolean; // 新品饮笔记分析开关，默认开启
  };

  teaLibrary: Tea[];           // 用户茶叶库（可编辑的有序整库快照）
  teaLibraryUpdatedAt: number; // 茶库最后修改时间戳；0 表示未编辑的内置默认库
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
  disabled?: boolean;           // 已喝完/停用，不参与推荐但保留历史
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
  id?: string;          // 新记录的稳定事件 ID；旧记录可无
  updatedAt?: number;   // 记录最后修改时间
  date: string;        // ISO 日期 'YYYY-MM-DD'
  teaId: number;       // 茶叶 ID，-1 表示自定义/没喝
  teaName: string;     // 茶名（自定义时为用户输入）
  teaCat: string;      // 分类 key，'unknown' 或 'none'
  teaBrand: string;    // 品牌，自定义时为空
  teaYear?: number | null; // 打卡时的茶叶年份快照；旧记录可从当前茶库关联读取
  type: 'primary' | 'alt' | 'custom' | 'skip';
  tastingNotes?: string;    // 品饮感受（可选），打卡后或从历史页面补充
  imageFileIDs?: Array<{ fileID: string; caption: string }>;  // 品饮图片（可选），最多 6 张云存储 fileID，每张可配 40 字说明
  checkinTime?: string;  // 打卡时间 'HH:MM'（可选），用于时段感知推荐
  notesUpdatedAt?: number; // 品饮文字最后修改时间
  noteAnalysis?: NoteAnalysis; // 仅新品饮文字的保守结构化分析
}

interface TemporaryAvoidState {
  active: boolean;
  markedAt: number;
  expiresAt: number;     // 默认标记后 30 天
  updatedAt: number;     // 同步冲突判断，取消也保留 tombstone
}
```

---

## 4. 页面规格

### 4.1 首页 — 今日推荐

**路由**：`pages/index/index`，TabBar「推荐」。

当前功能：

- 展示公历、农历、星期、节气、节气寓意和民俗。
- 根据小时选择 dawn/day/dusk/night 基底，根据天气选择晴、云、阴、雨、雪、雷、雾等叠加层，并提供开发调试选择器。
- 每日茶语优先使用按天缓存的 AI 文案；无配置或失败时使用内置文案。
- 自由文本实时解析城市、身体状态、回避茶类、偏好茶类和口味。
- 城市变化后调用 `getWeather` 云函数并写回个人档案时间戳。
- 先运行硬过滤和规则评分；深度推荐开启时，将合格候选交给 LLM，失败自动回退规则结果。
- 展示主推、备选、推荐理由、茶性、年份、咖啡因和冲泡参数；推荐成功后主按钮改为“重新推荐”，再次点击时只在本轮排除上一轮主推和备选，不写入历史或长期回避。
- 主推和备选卡片底部直接提供“喝这个”和“近期不想喝”；另设自选茶输入卡片及“喝这个”按钮。
- 自选茶输入按当前茶库匹配：年份是硬条件，名称片段可忽略标点并调换顺序；同名多年份且未填写年份时要求补充年份，无法匹配时才保存为 `teaId: -1` 的自定义茶。
- 首页不再显示“今天喝了什么”的四选一卡片；旧的 `skip` 记录仍可展示和同步。打卡继续记录 `checkinTime`。
- 打卡后可写最多 500 字品饮感受，并上传最多 6 张图片及每张说明；新品饮文字可在保存后后台保守分析。
- AI 请求支持取消、错误分类和有限重试。

### 4.2 饮茶记录

**路由**：`pages/history/history`，TabBar「记录」。

- 时间线按实际饮用时间从新到旧展示主推、备选、自选和未饮茶记录：先按日期、再按打卡时间；缺少时间的旧记录排在同日有时间记录之后，并用稳定记录 ID 的创建时间和原数组位置确定顺序。展示排序不重排持久化数据。
- 展示打卡时间、茶名、品牌、年份、茶类和记录类型；茶叶未标记年份时不显示年份占位。
- “暂时不想喝”仅放在记录展开后的品饮编辑区，不在时间线列表直接展示；默认 30 天内硬排除，也可手动恢复。
- 可补充、修改或清空品饮文字。
- 可上传、预览、删除最多 6 张图片，并编辑图片说明。
- 顶部入口跳转饮茶统计页。

### 4.3 茶叶库

**路由**：`pages/teaLib/teaLib`，TabBar「茶库」。

- 按全部、绿茶、红茶、白茶、乌龙、生普、熟普、调味筛选并按茶类分组。
- 展示茶名、品牌、年份、茶性、咖啡因、停用状态、画像完整度/个人补录数量和多包装库存摘要。
- 编辑模式支持添加、修改、停用/启用、删除、上移和下移排序；编辑已有茶叶时可通过“暂时不想喝”开关设置或取消同一份 30 天推荐回避状态。
- 删除有历史记录的茶时给出风险确认。
- 画像与库存弹层按合同分区展示全部字段的有效值、状态、来源、可信度、证据和来源引用；字段可建立个人覆盖、清空非必填值、恢复基础值并锁定。无基础画像茶款也可建立本地个人补录。`knowledgeBase`、`knowledgeOverrides` 与 `inventory` 当前不进入既有云同步。
- 每次茶库有效变更更新 `teaLibraryUpdatedAt`，茶库作为有序整库快照同步。

### 4.4 设置

**路由**：`pages/settings/settings`，TabBar「设置」。

区块：

1. 个人档案：性别、年龄、常驻城市；点击保存后写入并更新 `profileUpdatedAt`。
2. 体质辨识：5 题问卷，计算偏寒、平和、偏热；保存后影响推荐权重。
3. AI 配置：API Key、端点、解析/推荐开关和模型名；必须点击保存。当前 LLM 合并仍采用本地非空值优先。
4. 推荐设置：连续推荐上限；保存后更新 `settingsUpdatedAt`。默认 5，表示同一款茶可连续喝并获得推荐 5 天，第 6 天不再推荐。
5. 数据管理：立即同步、复制导出 JSON、从文件导入、重置全部数据。
6. 运行诊断：查看和清理本地 tracker 日志。

### 4.5 饮茶统计

**路由**：`pages/stats/stats`，非 TabBar 页面，从饮茶记录进入。

- 本月饮茶次数与茶类环形图。
- 本月茶性分布。
- 全历史最常喝茶 Top 5。
- 最近 30 天饮茶频率、饮茶天数和总次数。

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

使用配置中的 `parserModel` 调用 API；当前新数据默认值为 `deepseek-v4-pro`，用户可以自行改名。

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
- avoidDays: number（连续推荐上限，最小 2）
- temporaryAvoids: 每款茶的临时回避状态
- noteAnalysisEnabled: 是否使用已保存的笔记分析

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
| 连续推荐限制 | -80（硬排除） | 前 X 个完整自然日每天都实际喝过同一款茶时，次日排除 |
| 品质存疑 | -30（硬排除） | note 含"疑似假货"的茶 |
| 暂时不想喝 | -80（硬排除） | 标记后 30 天内排除，可手动恢复 |
| 动态偏好 | -15 ~ +18 | 近期实际饮用与明确笔记态度，30 天半衰期 |

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

**连续推荐限制**：
- `avoidDays = 5` 时，同一款茶可连续喝并获得推荐 5 天；前 5 个完整自然日每天都实际喝过该茶时，第 6 天从规则和 AI 候选池中硬排除。
- 连续记录只看实际饮用打卡；主推、备选和能匹配茶库的自定义打卡都计入，单纯展示推荐不计入。
- 每天可喝多款茶，各茶分别计数；同一天同一款茶喝多次仍只算一天。单次“没喝”和未知自定义茶不覆盖当天其他有效打卡。
- 任一自然日没有实际喝该茶，连续计数即中断；之后再次饮用时从第 1 天重新计算。

**硬排除过滤**：
带 hardFiltered=true 的候选在最终选择前被完全移除，不进入 primary/alt 选择池。

**动态偏好与主备选策略**：
- 实际饮用按 30 天半衰期衰减；自选权重 1.0，主推/备选打卡权重 0.7。茶款饮用加分封顶 12，茶类加分封顶 6。
- 只有置信度至少 0.8 的明确喜欢/不喜欢笔记才影响分数；模糊观察保持 unknown。笔记影响封顶 `[-15,+10]`，总偏好封顶 `[-15,+18]`。
- 主推按“基础适配分 + 完整偏好分”排序。备选只在基础分距最优不超过 20 的候选中探索，使用 25% 偏好分，并奖励 14 天未喝和不同茶类。
- 原有近期 2/5 天重复扣分和茶类轮换扣分已移除；今日已喝与连续上限仍是硬排除。

### 5.3 天气服务

客户端 `utils/weather.js` 不直接请求第三方域名，而是调用 `getWeather` 云函数：

```typescript
interface WeatherData {
  temp: number;
  feelsLike: number;       // 高德无体感字段，当前等于 temp
  humidity: number;
  desc: string;            // 高德中文天气描述
  wind: number;            // 兼容字段，当前为 0
  winddirection: string;
  windpower: string;
  city: string;
  reporttime: string;
}

function fetchWeather(city: string): Promise<WeatherData | null>
```

`cloudfunctions/getWeather` 先通过高德地理编码将城市转为 adcode，再获取实况天气。高德 Key 保存在被 `.gitignore` 排除的 `cloudfunctions/getWeather/config.json`。失败时客户端得到 `null`，推荐继续运行但跳过天气修正。

### 5.4 LLM 调用

`utils/llm.js` 使用 OpenAI 兼容的 `/chat/completions`：

```typescript
function parseWithLLM(input: string, config: LLMConfig): Promise<ParsedInput | null>
function callLLM(eligibleTeas: Tea[], context: RecommendContext, config: LLMConfig): Promise<LLMResult | null>
function generateDailyQuote(context: QuoteContext, config: LLMConfig): Promise<string | null>
function analyzeTastingNote(note: string, tea: Tea, context: object, config: LLMConfig): Promise<NoteAnalysis | null>
function abortCurrent(): void
```

当前行为：

- 解析：`temperature: 0.1`、`max_tokens: 300`，支持时关闭模型思考模式。
- 推荐：`temperature: 0.5`、`max_tokens: 2000`，将硬过滤后的全部候选茶交给 LLM，仅允许从候选中选择并校验返回茶名。
- 每日茶语：`max_tokens: 80`，按天缓存；支持时关闭模型思考模式，失败使用内置文案。
- 品饮笔记：仅保存新文字时后台调用 `parserModel`；原文不会进入推荐 prompt。只允许白名单风味特征，低置信度态度强制归为 unknown，失败不影响笔记保存，也不回填旧笔记。
- 推荐 prompt 只接收压缩后的近期茶款/茶类/明确态度摘要；主推贴近近期口味，备选探索相邻口味。
- Qwen、DeepSeek、GLM 等可切换模型的请求默认关闭思考；thinking-only 模型保持其强制思考行为，避免传入不支持的参数。
- 推荐请求对部分 HTTP/网络错误做有限重试，支持主动取消。
- 统一处理完整 URL、缺少协议、Markdown JSON 代码块、HTTP 状态和网络错误分类。
- 解析失败回退关键词；推荐失败回退规则引擎。

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
- `history`：新记录按稳定 `id` 取并集，同 ID 按 `updatedAt` 选择较新完整记录；旧记录兼容 `date + teaId + type`
- 加载、导入和同步合并后，仅将 `teaId: -1` 且能按名称与年份强唯一匹配茶库的 `custom` 记录重新关联；保留原 ID、时间、笔记和图片，并更新 `updatedAt` 参与同步冲突判断。
- `temporaryAvoids`：每款茶按 `updatedAt` 合并，取消状态作为 tombstone 保留
- `profile`：按 `profileUpdatedAt` 选择较新的完整档案；时间相同或缺失时云端优先
- `settings`：按 `settingsUpdatedAt` 选择较新的完整设置；时间相同或缺失时云端优先
- `llm`：保持本地非空值优先的现有策略
- `teaLibrary`：按 `teaLibraryUpdatedAt` 选择较新的整库快照，确保编辑、删除和排序一致；时间相同或缺失时云端优先，便于新设备恢复

### 5.6 云函数

#### `syncData`

- 通过 `cloud.getWXContext().OPENID` 隔离用户，每个 openid 对应 `tea_doctor` 集合中的一条文档。
- 首次同步创建集合文档；后续同步合并并写回客户端。
- `history` 新记录按稳定 `id` 合并并以 `updatedAt` 判新旧；旧记录仍按 `date + teaId + type` 兼容合并。
- `temporaryAvoids` 每款茶独立按 `updatedAt` 合并，手动恢复会同步为 inactive tombstone。
- `profile`、`settings` 和 `teaLibrary` 分别按各自时间戳选择完整快照；本地时间必须严格更新才覆盖云端，平局由云端胜出。
- `llm` 暂时保持字段级本地非空值优先；这意味着模型名和开关尚不具备可靠的跨设备最后写入语义。

#### `getWeather`

- 输入中文城市名。
- 调用高德地理编码和实况天气接口。
- 热实例内缓存城市 adcode，HTTPS 请求超时为 8 秒。
- Key 通过本地 `config.json` 提供，不进入 Git。

---

## 6. 视觉与动态场景

当前主题以暖色粉彩为主，核心变量定义在 `app.wxss`：

- 背景：`--cream`、`--cream2`、`--blush`。
- 强调：`--coral`、`--coral-deep`、`--sage`、`--sage-deep`。
- 文字：`--cocoa`、`--ink`、`--ink2`、`--ink3`、`--ink4`。
- 卡片：半透明 `--card` 与 `--card-border`。
- 字体：优先 `NotoSerifSC` 和系统宋体；`utils/font.js` 的 `FONT_SOURCE` 为空时安全回退系统字体。

首页动态背景采用三层结构：

1. `base-*.svg`：dawn/day/dusk/night 时段基底。
2. `overlay-*.svg`：太阳、月亮、云、阴、雨、雪、雷、雾等天气层。
3. `scene-tint`：按时段调节前景色温和可读性。

场景在页面显示时初始化，天气返回后更新；每分钟检查时段变化。首页底部的时段/天气选择器仅用于开发预览。

---

## 7. 路由和配置

TabBar 当前包含：推荐、记录、茶库、设置。`pages/stats/stats` 已注册，但通过记录页入口进入，不属于 TabBar。

```json
{
  "pages": [
    "pages/index/index",
    "pages/history/history",
    "pages/teaLib/teaLib",
    "pages/settings/settings",
    "pages/stats/stats"
  ],
  "window": {
    "navigationBarTitleText": "今天喝点什么茶",
    "navigationBarBackgroundColor": "#FBF3E7",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#FBF3E7"
  },
  "cloud": true,
  "sitemapLocation": "sitemap.json"
}
```

云环境 ID 当前直接配置在 `app.js`。项目为个人开发版/预览版用途，不以正式发布为目标。

---

## 8. 外部服务与敏感配置

- 高德天气仅由 `getWeather` 云函数访问：`restapi.amap.com`。
- `cloudfunctions/getWeather/config.json` 必须包含 `amapKey`，并已被 `.gitignore` 排除。
- 客户端会直接访问用户填写的 OpenAI 兼容 LLM 端点；开发工具需要关闭域名校验，真机环境需满足微信请求域名规则。
- `llm.apiKey` 当前同时保存于本地数据和云数据库，这是已知安全欠账，尚未按“仅本地保存”改造。
- 若启用远程字体，需要为 `utils/font.js` 配置 HTTPS `FONT_SOURCE`，并满足下载域名要求。

---

## 9. 已实现与待办边界

### 已实现

- 体质辨识及推荐权重修正。
- 茶库添加、编辑、停用、删除和排序。
- 品饮文字、图片和图片说明。
- 月度茶类/茶性统计、Top 5、最近 30 日频率。
- 每日茶语、农历节气、动态天气背景。
- 本地诊断日志和显式保存按钮。
- `profile`、`settings`、`teaLibrary` 的时间戳同步；旧数据平局由云端优先。

### 尚未实现或仍需改进

- 茶叶产品级知识画像、86 款导入包、本地原子导入、完整字段查看/个人补录、字段锁定、多包装库存和带本地多样化保险的双阶段 LLM 推荐已实现。用户覆盖与库存仍未按记录云同步，微信开发者工具和真机验收仍待完成。实施契约见 `docs/tea-knowledge-profile-plan.md`。
- 自动定位当前城市。
- 推荐结果分享和报告图片分享。
- 茶库详情页的单茶历史聚合、多包装库存（已开封与未开封可并存）、剩余泡数/已撬状态和消耗提醒。
- 二维码或自动收藏式离线备份。
- LLM 配置的可靠跨设备版本合并。
- API Key 仅本地保存。
- 自动化微信开发者工具编译与真机端到端测试。

---

## 10. 验证要求

### 自动检查

根目录工程命令：

```powershell
npm test
npm run check
npm run verify
```

- `npm test`：运行数据同步、文本解析和推荐过滤回归测试。
- `npm run check`：校验 JavaScript 语法、JSON、页面四件套、TabBar 资源、WXML 事件处理器和必要私密配置是否存在。
- `npm run verify`：依次执行静态检查和测试。

### 发布前人工检查

- [x] 微信开发者工具能够无错误编译。
- [x] `syncData` 与 `getWeather` 云函数已安装依赖并部署到当前环境。
- [x] 模拟器修改档案/推荐设置后，手机预览版能通过“立即同步”得到新版本。
- [x] 高德天气在模拟器和真机返回中文描述。
- [x] 规则推荐、AI 回退、卡片内打卡、自定义茶输入和历史 `skip` 记录兼容均正常。
- [x] 品饮图片能够上传、预览、删除并保留说明。
- [x] 动态背景在四个时段及主要天气场景下文字可读。
- [x] 小屏、刘海屏和至少一台安卓真机布局正常。

---

## 11. 文档维护规则

- 数据结构、默认模型、同步策略、云函数或页面路由发生变化时，应在同一变更中更新本文件。
- `docs/phase2.md` 作为后续想法清单；已落地能力以本文件和当前代码为准。
- `docs/tea-knowledge-profile-plan.md` 是茶叶知识画像的实施契约；规划项必须在状态段明确区分已实现、待验收和未实现，不得把未落地的数据结构描述为当前运行行为。
- README 负责开发与部署步骤，本文件负责产品行为和实现契约。
