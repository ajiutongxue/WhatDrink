'use strict';

// Generated from tea-knowledge.contract.json for WeChat Mini Program CommonJS loading.
module.exports = {
  "schemaVersion": 2,
  "description": "茶叶产品级知识画像的数据契约；description 仅用于说明，不参与推荐计算。",
  "knowledgeStatuses": [
    "confirmed",
    "researched",
    "inherited",
    "inferred",
    "personal",
    "conflicted",
    "unknown"
  ],
  "knowledgeStatusDescriptions": {
    "confirmed": "由用户、实物包装或可靠原始记录直接确认。",
    "researched": "通过联网资料查证，并且必须保存来源链接和证据摘要。",
    "inherited": "从茶类通用知识继承，并非该产品独有的已证实特征。",
    "inferred": "LLM 根据名称或已知信息推测，尚未查证。",
    "personal": "来自用户自己的品饮观察或身体感受。",
    "conflicted": "不同来源结论冲突，暂不选定单一值。",
    "unknown": "目前没有足够信息，value 必须为 null。"
  },
  "sourceTypes": [
    "user",
    "package",
    "purchase",
    "official",
    "retailer",
    "community",
    "category_default",
    "llm",
    "unknown"
  ],
  "sourceTypeDescriptions": {
    "user": "用户亲自确认或修改。",
    "package": "茶叶实物包装、标签或说明书。",
    "purchase": "订单、发票或购买记录。",
    "official": "品牌或生产商官方资料。",
    "retailer": "可识别具体商品的零售商页面。",
    "community": "论坛、测评或茶友资料，仅作较低优先级参考。",
    "category_default": "茶类通用默认知识。",
    "llm": "模型推测，必须标记 inferred。",
    "unknown": "尚无来源。"
  },
  "knowledgeFieldDescriptions": {
    "value": "字段的实际值；未知时填写 null。",
    "status": "这个值是确认、查证、继承、推测、个人观察、冲突还是未知。",
    "sourceType": "信息来自用户、包装、官方资料、模型等哪一类来源。",
    "confidence": "可信度，范围 0 到 1；unknown 固定为 0。",
    "updatedAt": "最后更新的 Unix 毫秒时间戳。",
    "evidence": "支持该结论的简短理由，不复制大段网页内容。",
    "sourceRefs": "来源链接或来源记录标识；researched 状态必须提供。"
  },
  "profileLifecycles": [
    "sample",
    "complete",
    "withheld"
  ],
  "catalogPurposes": [
    "sample",
    "import"
  ],
  "sections": {
    "identity": {
      "displayName": {
        "type": "string",
        "requiredValue": true,
        "description": "用于茶库展示和匹配的规范产品名称。"
      },
      "brand": {
        "type": "string",
        "requiredValue": true,
        "description": "品牌或生产商名称。"
      },
      "category": {
        "type": "string",
        "requiredValue": true,
        "description": "程序使用的茶类代码，例如 white、oolong_wuyi、puerh_raw。"
      },
      "year": {
        "type": "integer",
        "min": 1900,
        "max": 2100,
        "description": "生产年份或明确标注的批次年份，不确定时留空。"
      },
      "productCode": {
        "type": "string",
        "description": "厂家货号、型号或产品代码，例如 AT102。"
      },
      "packagingVariant": {
        "type": "string",
        "description": "包装或版本区别，例如旧黄罐、新黄罐、马饼。"
      },
      "form": {
        "type": "string",
        "description": "茶叶外形与成品形态，例如散茶、饼茶、砖茶、沱茶。包装净含量不属于茶叶画像。"
      }
    },
    "origin": {
      "region": {
        "type": "string",
        "description": "原料产区，精确到资料能够可靠支持的层级。"
      },
      "cultivar": {
        "type": "string",
        "description": "茶树品种或品系，例如水仙、肉桂、福鼎大白茶。"
      },
      "materialGrade": {
        "type": "string",
        "description": "原料或采摘等级，例如寿眉、白牡丹、特级；不是品质评分。"
      },
      "harvestSeason": {
        "type": "string",
        "description": "原料采摘季节或节气，例如春茶、秋茶、明前。"
      }
    },
    "craft": {
      "processTags": {
        "type": "string_array",
        "description": "关键制作工艺标签，例如萎凋、晒青、蒸压、足火烘焙。"
      },
      "roastLevel": {
        "type": "enum",
        "values": [
          "none",
          "light",
          "medium",
          "medium_high",
          "high"
        ],
        "description": "标准化焙火程度：无、轻、中、中高、高。"
      },
      "compression": {
        "type": "enum",
        "values": [
          "loose",
          "light",
          "medium",
          "tight"
        ],
        "description": "紧压程度：散茶、轻压、中等、紧压。"
      },
      "agingState": {
        "type": "string",
        "description": "新茶、转化期、陈茶等当前陈化阶段，不只按年份机械判断。"
      }
    },
    "sensory": {
      "aromaTags": {
        "type": "string_array",
        "description": "闻香特征词，例如花香、果香、木质香、焙火香。"
      },
      "flavorTags": {
        "type": "string_array",
        "description": "入口和汤感特征词，例如甜润、清鲜、醇厚、矿物感。"
      },
      "aromaIntensity": {
        "type": "scale_0_5",
        "description": "香气强度，0 最弱，5 最强。"
      },
      "sweetness": {
        "type": "scale_0_5",
        "description": "甜感强度，0 最弱，5 最强。"
      },
      "bitterness": {
        "type": "scale_0_5",
        "description": "苦感强度，0 最弱，5 最强；不是好坏评分。"
      },
      "astringency": {
        "type": "scale_0_5",
        "description": "涩感强度，0 最弱，5 最强；不是好坏评分。"
      },
      "body": {
        "type": "scale_0_5",
        "description": "茶汤厚度与饱满度，0 很轻薄，5 很厚重。"
      },
      "smoothness": {
        "type": "scale_0_5",
        "description": "入口顺滑程度，0 粗糙，5 很顺滑。"
      },
      "aftertaste": {
        "type": "scale_0_5",
        "description": "回甘、生津和余韵的综合持续表现，0 最弱，5 最强。"
      },
      "durability": {
        "type": "scale_0_5",
        "description": "耐泡程度，0 很低，5 很高；应基于相近冲泡条件。"
      }
    },
    "effects": {
      "stimulation": {
        "type": "scale_0_5",
        "description": "主观提神或兴奋强度，0 最弱，5 最强。"
      },
      "emptyStomachFriendliness": {
        "type": "scale_0_5",
        "description": "空腹饮用的相对友好程度，0 很不友好，5 较友好；不是医学结论。"
      },
      "sleepImpact": {
        "type": "scale_0_5",
        "description": "对睡眠的潜在影响，0 很低，5 很高；优先采用用户个人记录。"
      }
    },
    "context": {
      "bestSeasons": {
        "type": "string_array",
        "description": "较适合饮用的季节，例如春、夏、秋、冬。"
      },
      "bestTimes": {
        "type": "string_array",
        "description": "较适合饮用的时段或场景，例如上午、午后、饭后。"
      }
    },
    "brew": {
      "vessels": {
        "type": "string_array",
        "description": "推荐冲泡器具，例如盖碗、紫砂壶、玻璃杯。"
      },
      "waterTempC": {
        "type": "number_range",
        "min": 0,
        "max": 100,
        "description": "建议水温范围，单位摄氏度，格式为 { min, max }。"
      },
      "gramsPer100ml": {
        "type": "number",
        "min": 0,
        "description": "每 100 毫升水建议投茶克数。"
      },
      "firstSteepSeconds": {
        "type": "number_range",
        "min": 0,
        "description": "第一泡建议浸泡秒数范围，格式为 { min, max }。"
      },
      "difficulty": {
        "type": "scale_0_5",
        "description": "冲泡容错难度，0 最容易，5 最难。"
      }
    }
  },
  "inventoryRecord": {
    "description": "用户实际拥有的实体包装；同一 teaId 可以同时关联多条试饮装、正装、已开封和未开封记录。",
    "packageTypes": [
      "sample",
      "retail",
      "split",
      "gift",
      "custom",
      "unknown"
    ],
    "statuses": [
      "sealed",
      "opened",
      "finished",
      "unknown"
    ],
    "fields": {
      "id": {
        "type": "string",
        "requiredValue": true,
        "description": "稳定库存记录 ID。"
      },
      "teaId": {
        "type": "integer",
        "min": 0,
        "requiredValue": true,
        "description": "关联的茶叶画像 ID。"
      },
      "packageType": {
        "type": "enum",
        "values": [
          "sample",
          "retail",
          "split",
          "gift",
          "custom",
          "unknown"
        ],
        "requiredValue": true,
        "description": "实际包装类型：试饮装、正装、分装、礼盒拆分、自定义或未知。"
      },
      "packageLabel": {
        "type": "string",
        "description": "用户可读的包装说明，例如5g试饮装、50g正装。"
      },
      "sku": {
        "type": "string",
        "description": "该实体包装对应的商家 SKU，例如京东商品编号。"
      },
      "purchaseUrl": {
        "type": "string",
        "description": "该实体包装的购买或商品页面。"
      },
      "status": {
        "type": "enum",
        "values": [
          "sealed",
          "opened",
          "finished",
          "unknown"
        ],
        "requiredValue": true,
        "description": "未开封、已开封、已喝完或尚待用户确认。"
      },
      "quantity": {
        "type": "integer",
        "min": 1,
        "requiredValue": true,
        "description": "相同规格未开封包装可合并计数；已开封记录通常为1。"
      },
      "netWeightPerUnit": {
        "type": "number",
        "min": 0,
        "description": "每个实际包装的初始净含量，单位克；记录试饮装时填试饮装克数。"
      },
      "remainingWeight": {
        "type": "number",
        "min": 0,
        "description": "已开封包装当前剩余克数。"
      },
      "remainingSessions": {
        "type": "integer",
        "min": 0,
        "description": "不称重时估算的剩余泡数。"
      },
      "openedAt": {
        "type": "number",
        "min": 0,
        "description": "开封时间，Unix 毫秒时间戳。"
      },
      "note": {
        "type": "string",
        "description": "包装、购买或剩余量的用户备注。"
      },
      "updatedAt": {
        "type": "number",
        "min": 1,
        "requiredValue": true,
        "description": "库存记录最后更新时间。"
      },
      "deletedAt": {
        "type": "number",
        "min": 1,
        "description": "删除墓碑时间，用于多设备同步。"
      }
    }
  }
}
