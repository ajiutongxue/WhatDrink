# 茶叶知识画像：续接交接（2026-08-05）

## 一句话状态

89 款茶的知识画像生产与导入包已完成；本地受控导入、画像/库存编辑入口和双阶段推荐实验链路均已实现。两阶段开关默认关闭：启用后执行“本地硬过滤 → LLM 摘要粗选 → 本地多样化保险 → LLM 详细画像精选”，任一阶段越界或失败均受本地候选边界和规则回退保护。知识画像、个人覆盖与库存仍保持本地存储，尚未实现按记录云同步。

当前分支：`codex/tea-knowledge-profile`。

## 当前开发进度（2026-08-06）

- 阶段：画像详情与个人补录，已完成；自动验证通过，待微信开发者工具和真机验收。
- 已完成全部 35 个合同字段的有效值、状态、来源、可信度、证据和来源引用展示；字段可独立建立个人覆盖、清空非必填值、恢复基础值并锁定。
- 已允许 `teaId 0、25、68` 等无基础画像茶款建立合同校验通过的本地个人补录，不会据此臆造基础画像；个人补录会作为脱敏结构化字段进入第二阶段精选。
- 基础画像、个人覆盖和库存继续分层存储；本阶段没有把本地个人数据加入现有整库云同步。
- 本阶段未包含：用户覆盖/库存的按记录云同步、自动联网补资料、库存记录编辑/删除/消耗管理、微信开发者工具和真机发布验收。
## 已完成

1. 定义并实现 35 字段的产品知识画像 schema、默认构造、验证规则、样例和字段说明。
2. 将 89 款茶分为 5 个研究批次；预留 `teaId` 为 `0`、`25`、`68`，不生成画像，供后续测试“画像缺失时的推荐/编辑行为”。
3. 生成 5 份批次输出，并分别通过 batch 模式校验。
4. 建立两类与基础画像分离的观察记录：
   - `data/teaProductResearchObservations.js`：网页/产品研究观察；
   - `data/teaPackageObservations.js`：用户实际持有包装、产品码、试饮/正装、库存状态等观察。
5. 已将用户补充的第一、第二批产品码、命名、年份、系列等信息应用回对应批次输出；没有把第三至第五批“联网核查的建议”自动写回茶库。
6. 已为第三、第四、第五批的缺失链接清单增加“联网核查（建议调整/保留原因）”列。它是待确认线索，不是已导入事实。
7. 已合并生成最终导入包，并完成 import 模式校验和完整项目验证。
8. 已实现本地 `knowledgeBase` 存储、`importTeaKnowledgePackage()` 受控导入、上一版画像备份和 `rollbackTeaKnowledgePackage()` 回滚；画像不会进入现有 `tea_doctor` 云同步请求。

## 最终导入包

- 文件：`data/tea-knowledge.import-v1.json`
- `purpose`：`import`
- `catalogVersion`：`research-v1`
- 完整画像：86 款
- 预留测试茶：`[0, 25, 68]`
- 合并批次：`research-01` 至 `research-05`

该文件可通过设置页“导入数据 / 知识包”选择，并由 `utils/data.js` 的 `importTeaKnowledgePackage()` 校验、确认后在本地安装；不会启动时自动导入，也不会写入现有云端数据。

## 关键文件地图

| 用途 | 文件 |
| --- | --- |
| 最终导入包 | `data/tea-knowledge.import-v1.json` |
| 5 个批次输出 | `data/tea-knowledge-model-outputs/research-01.output.json` 至 `research-05.output.json` |
| 画像 schema | data/tea-knowledge.contract.json、utils/teaKnowledge.js |
| 本地导入与回滚 | `utils/data.js`、`tests/tea-knowledge-storage.test.js` |
| 茶库基础目录 | `utils/teaData.js` |
| 批量输入与清单 | `data/tea-knowledge-research-batches/`、`data/tea-knowledge.batch-input.json` |
| 产品研究观察 | `data/teaProductResearchObservations.js`、`scripts/apply-tea-product-research.js` |
| 包装/产品码观察 | `data/teaPackageObservations.js`、`scripts/apply-tea-package-observations.js` |
| 感官推断规则 | `data/teaSensoryInference.js`、`scripts/apply-tea-sensory-inference.js` |
| 验证与合并 | `scripts/validate-tea-knowledge-catalog.js`、`scripts/merge-tea-knowledge-batches.js` |
| 字段与批处理规范 | `docs/tea-knowledge-field-guide.md`、`docs/tea-knowledge-batch-rules.md` |
| 全局实施契约 | `docs/tea-knowledge-profile-plan.md` |
| 第 3–5 批核查记录 | `docs/tea-knowledge-missing-links-batch-03.md` 至 `-05.md` |

## 数据与产品边界

- 基础画像：可随目录版本升级而替换，包含身份、产地、工艺、感官、冲泡、适配度、来源和可信度。
- 用户观察：必须独立于基础画像保存；用户感受优先于通用资料。
- 包装/库存：实际试饮装、单片、撬散、已开封与未开封必须按手头包装记录；不要用同名正装重量替代。
- 同一款茶可以同时存在已开封和未开封库存；后续库存模型要能聚合多包装而不互相覆盖。
- `unknown` 是合法且有意的值，不能被 LLM 猜测填满。
- 第三至第五批文档里的“建议调整”尚未确认，不能直接覆盖 `utils/teaData.js` 或导入包。

## 需要优先核实的产品身份

这些只记录在第 3–5 批文档的联网核查列中，尚未写入数据：

| teaId | 问题 | 推荐处理 |
| --- | --- | --- |
| 61 | 陈升号那卡“2023、250g 茶砖”与可查产品形态冲突 | 提供包装照片，确认产品年份和饼/砖形态后再更新。 |
| 73 | 大益悟空标作 2022，但检到的生肖产品为 2016 | 先看包装；若为常规猴年悟空，改为 2016。 |
| 65 | 2023 澜沧古茶 007 有小砖和小萌饼等不同形态 | 用实际包装确定是小砖还是小萌饼。 |
| 77 | 老同志魔方检到的可靠在售版本为 2024，与库内 2023 不一致 | 补包装或订单记录。 |
| 81 | “碧潭飘雪品味一级”未能和 2025 品味特级页面对应 | 以包装正面为准，不要直接改为特级。 |

## 推荐的下一阶段

画像详情、个人补录、覆盖/库存基础编辑和双阶段推荐实验已经落地。若将后续开发编号为第三阶段，建议把第三阶段定义为“库存记录完整生命周期”；其数据合同、稳定记录 ID、更新时间和删除墓碑已经具备，无阻塞性代码前置。开始前应先完成一次开发者工具冒烟验收，并固定剩余量采用克数、泡数或二者并存的交互规则。

下一步建议按以下顺序验收和扩展：

1. **微信开发者工具端到端验收**：检查画像弹层的长列表、键盘和滚动，分别编辑普通画像与 `teaId 0、25、68` 的空画像；再验证正常两次请求、第一轮失败后继续精选、第二轮失败回退规则、少于 12 款候选、强偏好和“重新推荐”一次性排除。
2. **完善库存记录生命周期**：在现有多包装新增/展示基础上，实现单条包装编辑、删除、剩余量/泡数、已撬状态和消耗提醒。
3. **设计按记录云同步**：用户覆盖按字段路径/时间戳合并，库存按稳定记录 ID 与删除墓碑合并；完成前继续禁止上传基础画像、用户覆盖和库存。
4. **建立实验指标并决定发布策略**：记录单阶段/双阶段的延迟、回退率、候选遗漏、硬过滤违规和最终选择，累积真实使用结果后再决定是否默认开启。

推荐流程现已执行的约束：第一轮使用本地硬过滤后的全部 `eligibleTeas` 摘要；本地重建 12～18 款多样化候选池；第二轮才发送候选的脱敏详细画像；两轮返回均按允许的稳定 `teaId` 校验。第一轮失败时由本地规则重建第二轮池，第二轮失败时回退本地规则推荐。
## 常用命令

```powershell
# 校验最终导入包
node scripts/validate-tea-knowledge-catalog.js data/tea-knowledge.import-v1.json --import

# 校验单个批次
node scripts/validate-tea-knowledge-catalog.js data/tea-knowledge-model-outputs/research-03.output.json --batch

# 重新合并（输出文件存在时脚本会拒绝覆盖）
node scripts/merge-tea-knowledge-batches.js `
  data/tea-knowledge-model-outputs/research-01.output.json `
  data/tea-knowledge-model-outputs/research-02.output.json `
  data/tea-knowledge-model-outputs/research-03.output.json `
  data/tea-knowledge-model-outputs/research-04.output.json `
  data/tea-knowledge-model-outputs/research-05.output.json `
  --out data/tea-knowledge.import-v2.json --catalog-version research-v2

# 项目完整验证
npm run verify
```

## 最近一次已验证结果

2026-08-06：

- 5 个批次均通过 batch 校验（20、20、20、20、6 款）。
- 合并结果为 86 款画像，且通过 `--import` 校验。
- 本地导入、回滚、失败恢复、云同步剥离、全部字段个人覆盖、空画像个人补录、字段校验、两阶段请求合同、稳定 ID 边界和候选池多样性测试通过；`npm run verify` 通过，7 个测试文件全部通过。

## 工作区注意事项

当前工作区不是干净状态。除本任务新增的 `data/`、`docs/`、`scripts/`、`tests/tea-knowledge.test.js`、`utils/teaKnowledge.js` 等文件外，还存在此前已有的修改，例如 `SPEC.md`、`docs/phase2.md`、`utils/teaData.js` 和若干 `ui-references*.html`。续接时不要重置、覆盖或顺手提交这些无关内容；应只暂存明确属于下一阶段的文件。

本交接文档、`docs/tea-knowledge-profile-plan.md` 与 `SPEC.md` 已同步到画像详情、个人补录和双阶段推荐完成的状态；下一阶段应从开发者工具/真机验收、库存记录生命周期、按记录云同步或实验指标中明确选择范围。
