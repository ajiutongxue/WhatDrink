'use strict';

/**
 * Product-level facts read from the user-confirmed retail pages on 2026-08-04.
 * These facts may enrich tea profiles, while package weights remain in inventory.
 */
module.exports = [
  {
    teaId: 21,
    sourceUrl: 'https://www.wepost.com.my/recommends/items/taobao-jBq4JBUdA9AXM9rCz.html',
    fields: [
      { path: 'identity.form', value: '紧压茶', confidence: 0.9, evidence: '可访问页面标题与关联的绿雪芽旗舰店信息明确写为“2019年寿眉金六条紧压茶”。' },
      { path: 'origin.materialGrade', value: '寿眉', confidence: 0.94, evidence: '可访问页面标题明确标注“2019年寿眉金六条”。' },
      { path: 'craft.compression', value: 'tight', confidence: 0.88, evidence: '可访问页面标题明确标注“紧压茶”；未据此补充具体压制规格。' }
    ]
  },
  {
    teaId: 26,
    sourceUrl: 'https://detail.youzan.com/show/goods?alias=1ydu7b5rh9mnysb&from_source=gbox_seo',
    sourceType: 'official',
    clearFields: ['identity.packagingVariant'],
    fields: [
      { path: 'origin.cultivar', value: '铁观音', confidence: 0.98, evidence: '八马茶业微信公众号认证旗舰店的具体商品标题明确标注“铁观音”。' }
    ]
  },
  {
    teaId: 30,
    sourceUrl: 'https://www.smzdm.com/p/168246185/',
    sourceType: 'community',
    fields: [
      { path: 'origin.region', value: '福建武夷山', confidence: 0.76, evidence: '可访问的具体“武夷星黄条大红袍”商品页标注产自福建武夷山；未进一步推断山场。' },
      { path: 'origin.materialGrade', value: '特级', confidence: 0.72, evidence: '可访问的具体“武夷星黄条大红袍”商品页标注特级。' },
      { path: 'craft.roastLevel', value: 'high', confidence: 0.76, evidence: '可访问的具体“武夷星黄条大红袍”商品页标注足火烘焙；仅将该名称映射为高焙火。' }
    ]
  },
  {
    teaId: 36,
    sourceUrl: 'https://www.jd.com/brand/13202f48b9d21023e854.html',
    conflicts: [
      '可访问的海堤红罐大红袍商品索引将当前款标为 AT103A、125g、足火浓香，但茶库只记录 2020 年红罐大红袍；在未取得该实物或购买链接前，不能确认其是否已使用 AT103A 型号。'
    ]
  },
  {
    teaId: 39,
    sourceUrl: 'https://www.makmur.com.my/chinese-tea/sea-dyke-brand-at101-tan-chung-chi-chong-125g.html',
    fields: [
      { path: 'identity.productCode', value: 'AT101', confidence: 0.9, evidence: '可访问的具体商品页标题明确为“Sea Dyke Brand AT101”，正文同时标注“海堤牌武夷单枞奇种”。' }
    ]
  },
  {
    teaId: 51,
    sourceUrl: 'https://www.jd.com/zuozhe/1320772ce91579686254.html',
    fields: [
      { path: 'origin.region', value: '易武茶区', confidence: 0.88, evidence: '可访问的具体商品索引标题明确为“八角亭2023年易武正山古树普洱茶生茶”。' },
      { path: 'origin.materialGrade', value: '古树', confidence: 0.88, evidence: '可访问的具体商品索引标题明确标注“古树”。' },
      { path: 'identity.packagingVariant', value: '原山系列', confidence: 0.82, evidence: '可访问的具体商品索引标题明确标注“原山系列”。' },
      { path: 'identity.form', value: '紧压饼茶', confidence: 0.9, evidence: '可访问的具体商品索引标题以“300g*1饼”标注该具体商品；不写入包装重量。' },
      { path: 'craft.compression', value: 'tight', confidence: 0.86, evidence: '可访问的具体商品索引以“饼”标注该具体商品；不推断具体压制参数。' }
    ]
  },
  {
    teaId: 54,
    sourceUrl: 'https://www.jd.com/jiage/1320df3dd20ed15af941.html',
    fields: [
      { path: 'origin.region', value: '班盆', confidence: 0.9, evidence: '可访问的具体商品索引标题明确为“八角亭2018年志士班盆古树普洱生茶砖”。' },
      { path: 'origin.materialGrade', value: '古树', confidence: 0.9, evidence: '可访问的具体商品索引标题明确标注“古树”。' },
      { path: 'identity.form', value: '紧压砖茶', confidence: 0.94, evidence: '可访问的具体商品索引标题明确标注“茶砖”。' },
      { path: 'craft.compression', value: 'tight', confidence: 0.9, evidence: '可访问的具体商品索引标题明确标注“茶砖”；不推断具体压制参数。' }
    ]
  },
  {
    teaId: 70,
    sourceUrl: 'https://tao.hooos.com/tag_%E5%A4%A7%E7%9B%8A%E9%87%91%E9%92%88%E7%99%BD%E8%8E%B22301.html',
    fields: [
      { path: 'identity.productCode', value: '2301', confidence: 0.86, evidence: '可访问的具体商品索引标题明确标注“大益正品 2023年2301批次金针白莲砖”。' },
      { path: 'identity.form', value: '紧压砖茶', confidence: 0.92, evidence: '可访问的具体商品索引标题明确标注“金针白莲砖”；不写入包装重量。' },
      { path: 'craft.compression', value: 'tight', confidence: 0.88, evidence: '可访问的具体商品索引标题明确标注“茶砖”；不推断具体压制参数。' }
    ]
  },
  {
    teaId: 82,
    sourceUrl: 'https://www.jd.com/jiage/132020a1f9280615073c.html?electedExtAttrSet=7285%2C&extAttrValue=expand_name%2C%4032941%3A%3A7285&sort_type=sort_default',
    fields: [
      { path: 'origin.region', value: '四川峨眉山', confidence: 0.84, evidence: '可访问的“竹叶青2025碧潭飘雪特级品味”商品索引标题明确标注四川峨眉山。' },
      { path: 'origin.materialGrade', value: '特级', confidence: 0.92, evidence: '可访问的“竹叶青2025碧潭飘雪特级品味”商品索引标题明确标注特级。' },
      { path: 'identity.packagingVariant', value: '品味', confidence: 0.9, evidence: '可访问的具体商品索引标题明确标注“品味”；不写入 54g 包装重量。' }
    ]
  },
  {
    teaId: 85,
    sourceUrl: 'https://www.jd.com/brand/1320baa34ae9f65378b2.html',
    fields: [
      { path: 'identity.packagingVariant', value: '静心', confidence: 0.9, evidence: '可访问的具体商品索引标题明确标注“碧潭飘雪金奖茉莉花茶静心特级”。' },
      { path: 'origin.materialGrade', value: '特级', confidence: 0.92, evidence: '可访问的具体商品索引标题明确标注“静心特级”。' }
    ]
  },
  {
    teaId: 1,
    sourceUrl: 'https://item.m.jd.com/product/10202268306875.html',
    fields: [
      { path: 'origin.region', value: '四川峨眉山', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注峨眉山茶。' },
      { path: 'origin.materialGrade', value: '一级', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注一级。' },
      { path: 'identity.packagingVariant', value: '品味', confidence: 0.82, evidence: '商品标题使用“品味甘露”名称；具体包装为袋装，包装事实另存库存层。' }
    ],
    conflicts: ['SKU 10202268306875 当前页面标注 2026 新茶，而茶库年份为 2025；可能是销售链接更新，暂不覆盖用户年份。']
  },
  {
    teaId: 2,
    sourceUrl: 'https://item.m.jd.com/product/42194246639.html',
    fields: [
      { path: 'origin.region', value: '四川峨眉山', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注峨眉山茶。' },
      { path: 'origin.materialGrade', value: '明前特级', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注明前特级。' },
      { path: 'origin.harvestSeason', value: '明前', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注明前。' },
      { path: 'identity.packagingVariant', value: '金奖·品味', confidence: 0.82, evidence: '商品标题同时包含“金奖”和“品味”版本信息。' }
    ],
    conflicts: ['SKU 42194246639 当前页面标注 2026 新茶，而茶库年份为 2023；可能是销售链接更新，暂不覆盖用户年份。']
  },
  {
    teaId: 3,
    sourceUrl: 'https://item.m.jd.com/product/100033334821.html',
    fields: [
      { path: 'origin.materialGrade', value: '明前特级', confidence: 0.86, evidence: '京东当前具体 SKU 标题明确标注明前特级。' },
      { path: 'origin.harvestSeason', value: '明前', confidence: 0.86, evidence: '京东当前具体 SKU 标题明确标注明前。' }
    ],
    conflicts: [
      'SKU 100033334821 当前页面标注 2026 新茶，而茶库年份为 2025；可能是销售链接更新，暂不覆盖用户年份。',
      '当前页面标题显示 8g 品鉴罐，但页面规格映射对同一 SKU 显示经典双罐 250g；且用户确认手头为品鉴装，克数暂不自动写入库存。'
    ]
  },
  {
    teaId: 6,
    sourceUrl: 'https://item.m.jd.com/product/100101275669.html',
    fields: [
      { path: 'origin.region', value: '福建武夷山桐木关', confidence: 0.92, evidence: '京东当前具体 SKU 标题明确标注武夷山桐木关。' },
      { path: 'origin.materialGrade', value: '一级', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注一级。' }
    ]
  },
  {
    teaId: 7,
    sourceUrl: 'https://item.m.jd.com/product/31249152778.html',
    fields: [
      { path: 'origin.region', value: '福建武夷山桐木关核心产区', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注武夷山桐木关核心产区。' },
      { path: 'origin.materialGrade', value: '一级', confidence: 0.88, evidence: '京东当前具体 SKU 标题明确标注一级。' }
    ],
    conflicts: ['SKU 31249152778 当前页面标注 2026 新茶，而茶库年份为 2025；可能是销售链接更新，暂不覆盖用户年份。']
  },
  {
    teaId: 8,
    sourceUrl: 'https://item.m.jd.com/product/10170266090042.html',
    fields: [
      { path: 'origin.region', value: '福建武夷山桐木关', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确标注武夷山桐木关。' },
      { path: 'origin.materialGrade', value: '特级', confidence: 0.88, evidence: '京东当前具体 SKU 标题明确标注特级。' },
      { path: 'identity.packagingVariant', value: '岁藏', confidence: 0.9, evidence: '京东当前具体 SKU 标题明确包含岁藏版本名。' }
    ],
    conflicts: ['SKU 10170266090042 当前页面标注 2026 新茶，而茶库年份为 2025；可能是销售链接更新，暂不覆盖用户年份。']
  },
  {
    teaId: 11,
    sourceUrl: 'https://item.m.jd.com/product/10107529366433.html',
    fields: [
      { path: 'origin.region', value: '福建福鼎', confidence: 0.94, evidence: '京东当前具体 SKU 标题明确标注福鼎白茶。' },
      { path: 'origin.materialGrade', value: '寿眉', confidence: 0.94, evidence: '京东当前具体 SKU 标题明确标注 2020 年紧压寿眉。' },
      { path: 'identity.packagingVariant', value: '晒白金', confidence: 0.94, evidence: '京东当前具体 SKU 标题明确包含晒白金系列名。' },
      { path: 'craft.agingState', value: '陈化白茶', confidence: 0.86, evidence: '具体商品为 2020 年寿眉，当前页面以老白茶销售；陈化状态仍受实际仓储影响。' }
    ]
  },
  {
    teaId: 12,
    sourceUrl: 'https://item.m.jd.com/product/10221654279529.html',
    fields: [
      { path: 'origin.region', value: '福建福鼎', confidence: 0.94, evidence: '京东当前具体 SKU 标题明确标注福鼎白茶。' },
      { path: 'origin.materialGrade', value: '寿眉', confidence: 0.94, evidence: '页面规格映射确认该 SKU 为 2022 年寿眉品鉴装。' },
      { path: 'identity.packagingVariant', value: '晒白金', confidence: 0.94, evidence: '京东当前具体 SKU 标题明确包含晒白金系列名。' },
      { path: 'craft.agingState', value: '陈化白茶', confidence: 0.82, evidence: '具体商品为 2022 年寿眉，当前页面以老白茶销售；陈化状态仍受实际仓储影响。' }
    ]
  },
  {
    teaId: 15,
    sourceUrl: 'https://item.m.jd.com/product/100327546502.html',
    fields: [
      { path: 'origin.region', value: '福建福鼎', confidence: 0.94, evidence: '京东当前具体 SKU 标题明确标注福鼎白茶。' },
      { path: 'origin.materialGrade', value: '一级寿眉', confidence: 0.94, evidence: '京东当前具体 SKU 标题明确标注 2025 年一级寿眉。' }
    ]
  },
  {
    teaId: 18,
    sourceUrl: 'https://item.taobao.com/item.htm?id=1070897446954',
    removeConflicts: ['SKU 10107948968420 当前页面标题为“虎标云南白毫银针 25g”，与茶库“2024 白牡丹散茶”完全不符；可能是链接被改款或原链接选错，所有产品字段保持原状态。']
  },
  {
    teaId: 20,
    sourceUrl: 'https://detail.tmall.com/item.htm?id=663676941882',
    fields: [
      { path: 'identity.form', value: '紧压茶', confidence: 0.95, evidence: '用户截图中的具体商品标题明确标注紧压白茶。' },
      { path: 'origin.region', value: '福建福鼎太姥山', confidence: 0.92, evidence: '用户截图中的具体商品标题明确标注太姥山老寿眉。' },
      { path: 'origin.materialGrade', value: '寿眉', confidence: 0.98, evidence: '用户截图中的商品标题与包装正面均明确标注寿眉。' },
      { path: 'craft.compression', value: 'tight', confidence: 0.94, evidence: '用户截图中的具体商品标题明确标注紧压白茶。' },
      { path: 'craft.agingState', value: '陈化白茶', confidence: 0.9, evidence: '该茶为 2018 年寿眉，商品标题标注老寿眉；实际陈化表现仍受仓储影响。' },
      { path: 'sensory.aromaTags', value: ['枣香'], confidence: 0.88, evidence: '用户截图中的具体商品标题明确标注枣香。' }
    ],
    removeConflicts: [
      '可访问的零售索引将虎标寿眉小方片描述为“新会陈皮白茶 50g”，与茶库名称未包含陈皮存在差异；在京东具体 SKU 可重新核验前不覆盖名称。',
      '可打开的虎标小方片零售聚合页明确为“新会陈皮白茶寿眉小方片50g”，茶库名称未包含陈皮，不能确认是同一产品。'
    ],
    removeNotes: ['未找到可唯一匹配不含陈皮的虎标2018寿眉小方片具体商品页，因此未采用50g规格或陈皮风味信息。']
  }
];
