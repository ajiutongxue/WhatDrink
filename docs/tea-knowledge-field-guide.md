# 茶叶画像字段说明

本说明对应 `data/tea-knowledge.contract.json` 和 `data/tea-knowledge.samples.json`。

标准 JSON 不支持行内注释。因此，简短解释写在契约的 `description` 中，详细解释集中放在本文档。不要把注释直接插入正式导入 JSON，否则文件将无法解析。

## 1. 每个画像字段的通用结构

- `value`：真正用于展示、比较和推荐的值；不知道时必须为 `null`。
- `status`：这个值是确认、查证、继承、推测、个人观察、冲突还是未知。
- `sourceType`：信息来自用户、包装、官方网页、零售页面、模型等哪类来源。
- `confidence`：证据可信度，范围 0～1，不是茶叶品质评分。
- `updatedAt`：最后更新时间，使用 Unix 毫秒时间戳。
- `evidence`：为什么得到这个值的简短说明。
- `sourceRefs`：来源链接或记录编号；联网查证的字段必须填写。

## 2. `status` 状态

| 状态 | 含义 | 例子 |
|---|---|---|
| `confirmed` | 用户、包装或原始记录明确确认 | 用户确认旧黄罐型号为 AT102 |
| `researched` | 已从外部资料查证 | 官方页面列出净含量 300 克 |
| `inherited` | 从茶类知识继承，不一定是产品独有事实 | 普洱生茶通常使用晒青工艺 |
| `inferred` | LLM 根据名称或已有信息推测 | 从饼茶推测为紧压形态 |
| `personal` | 用户自己的品饮或身体感受 | 用户觉得这款茶晚间影响睡眠 |
| `conflicted` | 来源互相冲突，暂不能确定 | 包装年份与订单年份不同 |
| `unknown` | 没有足够信息，`value` 必须为 `null` | 尚未找到采摘季节 |

使用优先级大体为：用户确认与个人记录 → 包装或购买记录 → 官方资料 → 其他外部资料 → 分类继承 → LLM 推测。冲突字段要保留冲突，不能静默覆盖。

## 3. 六组画像字段

### 身份 `identity`

- `displayName`：规范展示名称。
- `brand`：品牌或生产商。
- `category`：程序内部茶类代码，例如 `white`、`oolong_wuyi`。
- `year`：生产或批次年份，不确定时留空。
- `productCode`：厂家货号或型号，是区分 AT102 与 AT102A 的关键字段。
- `packagingVariant`：包装或版本差异，例如旧黄罐、新黄罐、马饼。
- `form`：散茶、饼茶、砖茶、沱茶等成品形态。

### 产地原料 `origin`

- `region`：可靠资料支持的产区层级；只有易武证据时不能自行补成具体村寨。
- `cultivar`：茶树品种或品系，例如水仙、肉桂。
- `materialGrade`：寿眉、白牡丹、特级等原料或采摘等级，不是品质分数。
- `harvestSeason`：春茶、秋茶、明前等采摘季节或节气。

### 工艺陈化 `craft`

- `processTags`：萎凋、晒青、蒸压、足火烘焙等关键工艺。
- `roastLevel`：焙火强度，`none` 到 `high`。
- `compression`：紧压程度；`loose` 是散茶，`tight` 是紧压。
- `agingState`：新茶、转化期、陈茶等当前陈化状态，不能只按年份机械判断。

### 香气滋味 `sensory`

- `aromaTags`、`flavorTags`：闻香与入口滋味特征词。
- `aromaIntensity`：香气强度。
- `sweetness`、`bitterness`、`astringency`：甜、苦、涩的强度，不是好坏评分。
- `body`：茶汤厚度和饱满度。
- `smoothness`：入口顺滑程度。
- `aftertaste`：回甘、生津和余韵的综合表现。
- `durability`：耐泡程度。

上述数值统一为 0～5。冲泡条件差异较大时，应降低可信度或保留冲突。

### 身体影响 `effects`

- `stimulation`：主观提神或兴奋强度。
- `emptyStomachFriendliness`：空腹饮用的相对友好程度，数值越高越友好。
- `sleepImpact`：对睡眠的潜在影响，数值越高影响越大。

这些字段不是医学结论。类别知识只能作为低优先级参考，最终应优先采用用户自己的长期记录。

### 场景 `context`

- `bestSeasons`：较适合的季节。
- `bestTimes`：较适合的时段或场景，例如上午、午后、饭后。

### 冲泡 `brew`

- `vessels`：推荐器具。
- `waterTempC`：建议水温范围，包含 `min` 和 `max`。
- `gramsPer100ml`：每 100 毫升水的建议投茶克数。
- `firstSteepSeconds`：第一泡浸泡秒数范围。
- `difficulty`：冲泡难度，0 最容易、5 最难。

## 4. 整批数据的字段

- `schemaVersion`：结构版本，不匹配时拒绝导入。
- `catalogVersion`：整批知识数据的版本。
- `purpose`：`sample` 是样板，`import` 是正式导入包。
- `generatedAt`：数据包生成时间。
- `expectedTeaCount`：应该覆盖的茶库总数，目前是 89。
- `withheldTeaIds`：故意不获取画像、用于测试的茶叶 ID。
- `batches`：每一批由哪个模型处理了哪些茶叶。
- `teas`：实际茶叶画像数组。
- `profileVersion`：单款茶画像版本。
- `lifecycle`：样板、完成或测试预留状态。
- `research.completeness`：非空字段占 35 个茶叶画像字段的比例，不代表真实性或质量。
- `research.conflicts`：需要人工处理的来源冲突。
- `research.notes`：检索限制、辨认风险或后续待办。

## 5. 包装库存字段

茶叶画像描述茶本身，包装库存描述用户实际拿到的试饮装、正装或分装。净含量不得写进茶叶身份。

- `packageType`：`sample` 为试饮装，`retail` 为正装，`split` 为分装。
- `packageLabel`：例如5g试饮装、50g正装。
- `sku`：该实体包装对应的商家商品编号。
- `purchaseUrl`：购买或商品页面。
- `status`：`sealed`、`opened` 或 `finished`。
- `quantity`：相同规格未开封包装数量。
- `netWeightPerUnit`：每个实际包装的初始克数；试饮装必须记录试饮装克数，不能填正装克数。
- `remainingWeight`：已开封包装剩余克数。
- `remainingSessions`：不称重时估算的剩余泡数。

同一款茶后来购买正装时，继续使用原 `teaId`，新增一条正装库存；只有年份、等级、原料或拼配不同才新建茶叶画像。

## 6. 最容易误解的四点

1. `confidence: 1` 代表证据很确定，不代表茶叶品质满分。
2. `unknown` 不是数据错误，而是明确承认不知道；它比模型编造更可靠。
3. `inherited` 只是茶类共性，优先级低于该产品的查证资料和用户实际感受。
4. 商品正装规格不等于用户实际库存；库存永远记录真实拿到的包装规格。
