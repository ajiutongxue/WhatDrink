'use strict';

/**
 * Low-confidence, LLM-style sensory starting points for research-01.
 * They are deliberately conservative and only applied to unknown fields.
 */
module.exports = [
  { teaId: 1, basis: '绿茶；峨眉山；一级', values: { aromaTags: ['清香', '栗香'], flavorTags: ['鲜爽', '甘醇'], aromaIntensity: 3.3, sweetness: 2.5, bitterness: 2.1, astringency: 2.3, body: 2.2, smoothness: 2.5, aftertaste: 2.7, durability: 2.4 } },
  { teaId: 2, basis: '绿茶；峨眉山；明前特级', values: { aromaTags: ['清香', '嫩栗香'], flavorTags: ['鲜爽', '回甘'], aromaIntensity: 3.7, sweetness: 3.0, bitterness: 1.8, astringency: 2.0, body: 2.3, smoothness: 2.7, aftertaste: 3.1, durability: 2.7 } },
  { teaId: 3, basis: '西湖龙井；明前特级', values: { aromaTags: ['清香', '栗香'], flavorTags: ['鲜醇', '甘爽'], aromaIntensity: 3.8, sweetness: 3.1, bitterness: 1.7, astringency: 1.9, body: 2.4, smoothness: 2.8, aftertaste: 3.2, durability: 2.8 } },
  { teaId: 4, basis: '滇红金芽；红茶', values: { aromaTags: ['蜜香', '薯香'], flavorTags: ['甜润', '醇厚'], aromaIntensity: 3.8, sweetness: 3.7, bitterness: 1.3, astringency: 1.4, body: 3.4, smoothness: 3.6, aftertaste: 3.5, durability: 3.2 } },
  { teaId: 5, basis: '祁门红茶；工夫红茶', values: { aromaTags: ['花果香', '蜜糖香'], flavorTags: ['甜醇', '回甘'], aromaIntensity: 4.0, sweetness: 3.5, bitterness: 1.4, astringency: 1.6, body: 3.2, smoothness: 3.5, aftertaste: 3.6, durability: 3.2 } },
  { teaId: 6, basis: '正山小种金妃眉；桐木关；一级', values: { aromaTags: ['花果香', '蜜香'], flavorTags: ['甜醇', '顺滑'], aromaIntensity: 3.7, sweetness: 3.4, bitterness: 1.5, astringency: 1.6, body: 3.0, smoothness: 3.4, aftertaste: 3.4, durability: 3.1 } },
  { teaId: 7, basis: '银骏眉；桐木关；一级', values: { aromaTags: ['花香', '甜香'], flavorTags: ['甜醇', '鲜爽'], aromaIntensity: 3.6, sweetness: 3.3, bitterness: 1.5, astringency: 1.6, body: 2.9, smoothness: 3.3, aftertaste: 3.3, durability: 3.0 } },
  { teaId: 8, basis: '金骏眉；桐木关；特级', values: { aromaTags: ['花果香', '蜜香'], flavorTags: ['甜醇', '回甘'], aromaIntensity: 3.9, sweetness: 3.6, bitterness: 1.4, astringency: 1.5, body: 3.0, smoothness: 3.5, aftertaste: 3.5, durability: 3.1 } },
  { teaId: 9, basis: '金骏眉；红茶', values: { aromaTags: ['花果香', '蜜香'], flavorTags: ['甜醇', '回甘'], aromaIntensity: 3.7, sweetness: 3.4, bitterness: 1.5, astringency: 1.6, body: 3.0, smoothness: 3.4, aftertaste: 3.4, durability: 3.1 } },
  { teaId: 10, basis: '银骏眉；红茶', values: { aromaTags: ['花香', '甜香'], flavorTags: ['甜醇', '鲜爽'], aromaIntensity: 3.5, sweetness: 3.2, bitterness: 1.6, astringency: 1.7, body: 2.8, smoothness: 3.2, aftertaste: 3.2, durability: 2.9 } },
  { teaId: 11, basis: '2020 年紧压寿眉；陈化白茶', values: { aromaTags: ['陈香', '枣香'], flavorTags: ['甜润', '醇厚'], aromaIntensity: 3.8, sweetness: 3.8, bitterness: 0.9, astringency: 1.1, body: 3.5, smoothness: 3.8, aftertaste: 3.8, durability: 3.8 } },
  { teaId: 12, basis: '2022 年紧压寿眉；陈化白茶', values: { aromaTags: ['陈香', '甜香'], flavorTags: ['甜醇', '顺滑'], aromaIntensity: 3.4, sweetness: 3.5, bitterness: 1.1, astringency: 1.3, body: 3.2, smoothness: 3.5, aftertaste: 3.5, durability: 3.5 } },
  { teaId: 13, basis: '2023 年紧压寿眉', values: { aromaTags: ['甜香', '草木香'], flavorTags: ['甜醇', '回甘'], aromaIntensity: 3.3, sweetness: 3.3, bitterness: 1.2, astringency: 1.5, body: 3.0, smoothness: 3.3, aftertaste: 3.3, durability: 3.3 } },
  { teaId: 14, basis: '2024 年紧压寿眉', values: { aromaTags: ['甜香', '草木香'], flavorTags: ['甜醇', '回甘'], aromaIntensity: 3.2, sweetness: 3.2, bitterness: 1.3, astringency: 1.5, body: 3.0, smoothness: 3.2, aftertaste: 3.3, durability: 3.3 } },
  { teaId: 15, basis: '2025 年寿眉散茶；一级', values: { aromaTags: ['清甜香', '草木香'], flavorTags: ['清甜', '鲜爽'], aromaIntensity: 3.1, sweetness: 3.0, bitterness: 1.3, astringency: 1.7, body: 2.7, smoothness: 3.0, aftertaste: 3.1, durability: 3.0 } },
  { teaId: 16, basis: '2025 年白牡丹散茶', values: { aromaTags: ['毫香', '花香'], flavorTags: ['清甜', '鲜醇'], aromaIntensity: 3.6, sweetness: 3.1, bitterness: 1.4, astringency: 1.8, body: 2.6, smoothness: 3.0, aftertaste: 3.2, durability: 3.0 } },
  { teaId: 17, basis: '紧压寿眉；369 具体版本待确认', confidence: 0.30, values: { aromaIntensity: 3.3, sweetness: 3.3, bitterness: 1.2, astringency: 1.5, body: 3.0, smoothness: 3.2, aftertaste: 3.3, durability: 3.3 } },
  { teaId: 18, basis: '2024 年白牡丹散茶', values: { aromaTags: ['毫香', '花香'], flavorTags: ['清甜', '鲜醇'], aromaIntensity: 3.4, sweetness: 3.1, bitterness: 1.5, astringency: 1.9, body: 2.5, smoothness: 2.9, aftertaste: 3.1, durability: 2.9 } },
  { teaId: 19, basis: '2018 年寿眉饼茶；陈化白茶', values: { aromaTags: ['陈香', '枣香'], flavorTags: ['甜润', '醇厚'], aromaIntensity: 3.9, sweetness: 3.9, bitterness: 0.8, astringency: 1.0, body: 3.7, smoothness: 4.0, aftertaste: 4.0, durability: 4.0 } },
  { teaId: 20, basis: '2018 年陈韵寿眉；太姥山；紧压白茶', values: { flavorTags: ['甜润', '醇厚'], aromaIntensity: 3.7, sweetness: 3.8, bitterness: 0.9, astringency: 1.1, body: 3.5, smoothness: 3.8, aftertaste: 3.8, durability: 3.8 } }
];
