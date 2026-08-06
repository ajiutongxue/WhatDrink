/**
 * teaData.js - 茶叶数据库
 * 包含用户的完整茶叶库存、分类默认值、分类名称映射、冲泡指南
 * CommonJS module for WeChat Mini Program
 */

// ============================================================
// 分类默认值
// ============================================================
var CAT_DEFAULTS = {
  green:            { baseNature: '寒', caffeine: '中', seasons: ['春', '夏'], avoidSeasons: ['冬'] },
  black:            { baseNature: '温', caffeine: '中', seasons: ['秋', '冬'], avoidSeasons: [] },
  white:            { baseNature: '凉', caffeine: '低', seasons: ['春', '夏', '秋'], avoidSeasons: [] },
  oolong_tieguanyin:{ baseNature: '平', caffeine: '中', seasons: ['春', '秋'], avoidSeasons: [] },
  oolong_wuyi:      { baseNature: '平', caffeine: '中', seasons: ['秋', '冬'], avoidSeasons: [] },
  oolong_dancong:   { baseNature: '平', caffeine: '中', seasons: ['春', '秋'], avoidSeasons: [] },
  puerh_raw:        { baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'] },
  puerh_ripe:       { baseNature: '温', caffeine: '低', seasons: ['秋', '冬'], avoidSeasons: [] },
  flavored_jasmine: { baseNature: '平', caffeine: '低', seasons: ['春', '夏'], avoidSeasons: [] },
  flavored_other:   { baseNature: '平', caffeine: '低', seasons: ['春', '夏', '秋', '冬'], avoidSeasons: [] }
};

// ============================================================
// 分类中文名映射
// ============================================================
var CAT_NAMES = {
  green:            '绿茶',
  black:            '红茶',
  white:            '白茶',
  oolong_tieguanyin:'铁观音',
  oolong_wuyi:      '武夷岩茶',
  oolong_dancong:   '凤凰单枞',
  puerh_raw:        '普洱生茶',
  puerh_ripe:       '普洱熟茶',
  flavored_jasmine: '茉莉花茶',
  flavored_other:   '调味茶'
};

// ============================================================
// 冲泡指南
// ============================================================
var BREW_GUIDE = {
  green: {
    temp: '80-85°C',
    time: '1-2分钟',
    vessels: '玻璃杯/盖碗',
    tips: '水温不宜过高，避免苦涩。明前茶尤为细嫩，建议80°C冲泡。',
    ratio: '1:50（茶:水）'
  },
  black: {
    temp: '90-95°C',
    time: '3-5分钟',
    vessels: '盖碗/紫砂壶',
    tips: '金骏眉等高端红茶可用90°C，普通红茶可稍高。',
    ratio: '1:50（茶:水）'
  },
  white: {
    temp: '90-100°C',
    time: '新茶2-3分钟，老茶可煮',
    vessels: '盖碗/煮茶壶',
    tips: '老白茶（3年以上）可煮饮，风味更佳。新白茶建议盖碗冲泡。',
    ratio: '1:30（茶:水）'
  },
  oolong_tieguanyin: {
    temp: '95-100°C',
    time: '功夫泡法30秒起',
    vessels: '盖碗/紫砂壶',
    tips: '清香型水温可稍低（95°C），浓香型可用沸水。第一泡洗茶。',
    ratio: '1:15（茶:水）'
  },
  oolong_wuyi: {
    temp: '98-100°C',
    time: '功夫泡法15-30秒起',
    vessels: '盖碗/紫砂壶',
    tips: '足火茶需沸水激发香气，每泡递增5-10秒。第一泡洗茶。',
    ratio: '1:15（茶:水）'
  },
  oolong_dancong: {
    temp: '95-100°C',
    time: '功夫泡法15-20秒起',
    vessels: '盖碗',
    tips: '凤凰单枞出汤宜快，闷泡易苦涩。香气高扬，注意闻香。',
    ratio: '1:15（茶:水）'
  },
  puerh_raw: {
    temp: '95-100°C',
    time: '功夫泡法10-20秒起',
    vessels: '盖碗/紫砂壶',
    tips: '新生茶水温可稍低（95°C），老茶用沸水。前两泡洗茶醒茶。',
    ratio: '1:15（茶:水）'
  },
  puerh_ripe: {
    temp: '100°C',
    time: '功夫泡法10-15秒起',
    vessels: '紫砂壶/盖碗',
    tips: '熟茶需沸水冲泡，前两泡洗茶去堆味。可适当闷泡。',
    ratio: '1:15（茶:水）'
  },
  flavored_jasmine: {
    temp: '85-90°C',
    time: '2-3分钟',
    vessels: '玻璃杯/盖碗',
    tips: '水温不宜过高，以免破坏花香。可多次冲泡。',
    ratio: '1:50（茶:水）'
  },
  flavored_other: {
    temp: '90-100°C',
    time: '3-5分钟',
    vessels: '盖碗/煮茶壶',
    tips: '小青柑可整颗冲泡或掰碎冲泡；桂花茶水温可稍低。',
    ratio: '1:30（茶:水）'
  }
};

// ============================================================
// 茶叶陈化函数
// ============================================================

/**
 * 根据茶类和年份计算当前茶性
 * @param {string} cat 茶类 key
 * @param {number|null} year 生产年份
 * @param {string} baseNature 基础茶性
 * @returns {string} 当前茶性
 */
function adjustNature(cat, year, baseNature) {
  if (!year || !cat || !baseNature) return baseNature || '平';

  var currentYear = new Date().getFullYear();
  var age = currentYear - year;
  if (age < 0) age = 0;

  // 白茶陈化：≥3年→平，≥7年→温
  if (cat === 'white') {
    if (age >= 7) return '温';
    if (age >= 3) return '平';
  }

  // 普洱生茶陈化：≥5年→凉，≥10年→平
  if (cat === 'puerh_raw') {
    if (age >= 10) return '平';
    if (age >= 5) return '凉';
  }

  return baseNature;
}

// ============================================================
// 茶叶数据库（用户库存）
// ============================================================
var _currentYear = new Date().getFullYear();

function _n(cat, year, baseNature) {
  return adjustNature(cat, year, baseNature);
}

var TEAS = [
  // ===== 绿茶 (green) =====
  { id: 0,  name: '蒙顶雪芽',         brand: '禹蒙',   cat: 'green', year: 2022, baseNature: '寒', caffeine: '中', seasons: ['春','夏'], avoidSeasons: ['冬'], note: '' },
  { id: 1,  name: '峨眉山甘露',       brand: '竹叶青', cat: 'green', year: 2025, baseNature: '寒', caffeine: '中', seasons: ['春','夏'], avoidSeasons: ['冬'], note: '' },
  { id: 2,  name: '竹叶青',           brand: '竹叶青', cat: 'green', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['春','夏'], avoidSeasons: ['冬'], note: '' },
  { id: 3,  name: '龙井',             brand: '狮峰',   cat: 'green', year: 2025, baseNature: '寒', caffeine: '中', seasons: ['春','夏'], avoidSeasons: ['冬'], note: '' },

  // ===== 红茶 (black) =====
  { id: 4,  name: '滇红金芽',         brand: '小厂茶', cat: 'black', year: 2024, baseNature: '温', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 5,  name: '祁门红茶·1985',   brand: '天之红', cat: 'black', year: 2025, baseNature: '温', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 6,  name: '正山小种金妃眉',   brand: '山尔堂', cat: 'black', year: 2025, baseNature: '温', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 7,  name: '银骏眉',           brand: '山尔堂', cat: 'black', year: 2025, baseNature: '温', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 8,  name: '金骏眉·岁藏',      brand: '山尔堂', cat: 'black', year: 2025, baseNature: '温', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 9,  name: '金骏眉·静享',      brand: '山尔堂', cat: 'black', year: 2025, baseNature: '温', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 10, name: '银骏眉·七彩祥云',  brand: '山尔堂', cat: 'black', year: 2025, baseNature: '温', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },

  // ===== 白茶 (white) =====
  { id: 11, name: '紧压寿眉·晒白金',  brand: '品品香', cat: 'white', year: 2020, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 12, name: '紧压寿眉·晒白金',  brand: '品品香', cat: 'white', year: 2022, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 13, name: '紧压寿眉·晒白金',  brand: '品品香', cat: 'white', year: 2023, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 14, name: '紧压寿眉·马饼',     brand: '品品香', cat: 'white', year: 2024, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 15, name: '寿眉散茶·诗经风雅颂', brand: '绿雪芽', cat: 'white', year: 2025, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '喝过一次，青味较重，茶叶碎渣较多' },
  { id: 16, name: '白牡丹散茶·诗经风雅颂', brand: '绿雪芽', cat: 'white', year: 2025, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 17, name: '紧压寿眉小圆片·369', brand: '绿雪芽', cat: 'white', year: null, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 18, name: '白牡丹散茶',       brand: '虎标',   cat: 'white', year: 2024, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 19, name: '寿眉饼茶',         brand: '虎标',   cat: 'white', year: 2018, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 20, name: '陈韵寿眉',         brand: '虎标',   cat: 'white', year: 2018, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },
  { id: 21, name: '紧压寿眉·金六条',  brand: '绿雪芽', cat: 'white', year: 2019, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '喝过几次，糖水味道，不是很喜欢' },
  { id: 22, name: '寿眉散茶',         brand: '六妙',   cat: 'white', year: 2022, baseNature: '凉', caffeine: '低', seasons: ['春','夏','秋'], avoidSeasons: [], note: '' },

  // ===== 凤凰单枞 (oolong_dancong) =====
  { id: 23, name: '鸭屎香',           brand: '南馥',   cat: 'oolong_dancong', year: 2025, baseNature: '平', caffeine: '中', seasons: ['春','秋'], avoidSeasons: [], note: '' },
  { id: 24, name: '鸭屎香',           brand: '八马',   cat: 'oolong_dancong', year: 2023, baseNature: '平', caffeine: '中', seasons: ['春','秋'], avoidSeasons: [], note: '' },
  { id: 25, name: '蜜韵蜜兰香',       brand: '宋凰',   cat: 'oolong_dancong', year: 2025, baseNature: '平', caffeine: '中', seasons: ['春','秋'], avoidSeasons: [], note: '' },

  // ===== 铁观音 (oolong_tieguanyin) =====
  { id: 26, name: '赛珍珠1000浓香铁观音', brand: '八马', cat: 'oolong_tieguanyin', year: 2025, baseNature: '平', caffeine: '中', seasons: ['春','秋'], avoidSeasons: [], note: '' },
  { id: 27, name: '清香铁观音·秋茶',  brand: '凤山',   cat: 'oolong_tieguanyin', year: 2024, baseNature: '平', caffeine: '中', seasons: ['春','秋'], avoidSeasons: [], note: '收货后喝了一次，当时感觉很难喝' },

  // ===== 武夷岩茶 (oolong_wuyi) =====
  { id: 28, name: '肉桂（中火）',     brand: '虎标',   cat: 'oolong_wuyi', year: 2023, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 29, name: '大红袍（中火）',   brand: '虎标',   cat: 'oolong_wuyi', year: 2022, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 30, name: '黄条大红袍（足火）', brand: '武夷星', cat: 'oolong_wuyi', year: 2022, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 31, name: '山语系列·铁罗汉（中火）', brand: '武夷星', cat: 'oolong_wuyi', year: null, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '以前方铁盒装的，这个系列好几种，其他几个都喝了，实在难喝' },
  { id: 32, name: '铁罗汉（足火）',   brand: '海堤',   cat: 'oolong_wuyi', year: 2022, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 33, name: '喜上眉梢·水晶龟（足火）', brand: '海堤',   cat: 'oolong_wuyi', year: 2021, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 34, name: '新黄罐老枞水仙（足火）', brand: '海堤', cat: 'oolong_wuyi', year: 2021, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 35, name: '黄罐老枞水仙（足火）', brand: '海堤', cat: 'oolong_wuyi', year: 2020, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 36, name: '红罐大红袍（足火）', brand: '海堤', cat: 'oolong_wuyi', year: 2020, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 37, name: '小黄罐老枞水仙（中足火）', brand: '海堤', cat: 'oolong_wuyi', year: 2023, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 38, name: '乐享肉桂（中火）', brand: '海堤',   cat: 'oolong_wuyi', year: 2022, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 39, name: '单枞奇种（足火）', brand: '海堤',   cat: 'oolong_wuyi', year: 2021, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 40, name: '岩值水仙（中足火）·岩值3000特级', brand: '孝文家', cat: 'oolong_wuyi', year: 2026, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 41, name: '岩值肉桂（中足火）·岩值2000一级', brand: '孝文家', cat: 'oolong_wuyi', year: 2025, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 42, name: '岩值肉桂（中足火）·一级', brand: '孝文家', cat: 'oolong_wuyi', year: 2023, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 43, name: '携山肉桂（中火）·开运纳福2000', brand: '孝文家', cat: 'oolong_wuyi', year: 2025, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 44, name: '携山水仙（中火）·富贵花1200', brand: '孝文家', cat: 'oolong_wuyi', year: 2023, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 45, name: '携山大红袍（中火）·富贵花1200', brand: '孝文家', cat: 'oolong_wuyi', year: 2023, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 46, name: '大红袍贡茶（中足火）·MT102', brand: '幔亭', cat: 'oolong_wuyi', year: 2023, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 47, name: '果香肉桂（中轻火）', brand: '小厂茶', cat: 'oolong_wuyi', year: 2023, baseNature: '平', caffeine: '中', seasons: ['秋','冬'], avoidSeasons: [], note: '' },

  // ===== 普洱生茶 (puerh_raw) =====
  { id: 48, name: '陈升一号·解散茶',  brand: '陈升号', cat: 'puerh_raw', year: 2019, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 49, name: '陈升一号·巧克力饼', brand: '陈升号', cat: 'puerh_raw', year: 2022, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 50, name: '陈升一号·饼茶',    brand: '陈升号', cat: 'puerh_raw', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '疑似假货' },
  { id: 51, name: '易武正山饼茶',     brand: '八角亭', cat: 'puerh_raw', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 52, name: '百花谷小饼茶',     brand: '老同志', cat: 'puerh_raw', year: 2025, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '之前喝过，青味很重，没喝出来什么花香' },
  { id: 53, name: '忙麓山饼茶',       brand: '八角亭', cat: 'puerh_raw', year: 2024, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 54, name: '志士·班盆古树茶砖', brand: '八角亭', cat: 'puerh_raw', year: 2018, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 55, name: '胭脂特沱',         brand: '下关',   cat: 'puerh_raw', year: 2024, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 56, name: '7510饼茶',         brand: '八角亭', cat: 'puerh_raw', year: 2024, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 57, name: '小乾坤迷你小饼',   brand: '八角亭', cat: 'puerh_raw', year: 2018, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 58, name: '如珪小饼茶',       brand: '八角亭', cat: 'puerh_raw', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 59, name: '如瑜小饼茶',       brand: '八角亭', cat: 'puerh_raw', year: 2022, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 60, name: '如璠小饼茶',       brand: '八角亭', cat: 'puerh_raw', year: 2022, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 61, name: '那卡茶砖',         brand: '陈升号', cat: 'puerh_raw', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 62, name: '冰岛解散茶·冠千山', brand: '八角亭', cat: 'puerh_raw', year: 2024, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 63, name: '大班章饼茶',       brand: '八角亭', cat: 'puerh_raw', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 64, name: '大雪山试饮',       brand: '吉普号', cat: 'puerh_raw', year: 2025, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 65, name: '007紧压小饼',      brand: '澜沧古茶', cat: 'puerh_raw', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 66, name: '景迈之春散茶',     brand: '澜沧古茶', cat: 'puerh_raw', year: 2025, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },
  { id: 67, name: '昔归饼茶',         brand: '虎标',   cat: 'puerh_raw', year: 2023, baseNature: '寒', caffeine: '中', seasons: ['夏'], avoidSeasons: ['冬'], note: '' },

  // ===== 普洱熟茶 (puerh_ripe) =====
  { id: 68, name: '7572小饼茶',       brand: '大益',   cat: 'puerh_ripe', year: 2025, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 69, name: '7572小饼茶',       brand: '大益',   cat: 'puerh_ripe', year: 2021, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 70, name: '白莲金针茶砖',     brand: '大益',   cat: 'puerh_ripe', year: 2023, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 71, name: '凤凰格格小饼茶·鸡年生肖', brand: '大益', cat: 'puerh_ripe', year: 2017, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 72, name: '旺夫小饼茶·狗年生肖', brand: '大益', cat: 'puerh_ripe', year: 2018, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 73, name: '悟空小饼茶·猴年生肖', brand: '大益', cat: 'puerh_ripe', year: 2022, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 74, name: '颂手撕薄饼·风雅颂', brand: '八角亭', cat: 'puerh_ripe', year: 2020, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 75, name: '0085小茶砖',       brand: '澜沧古茶', cat: 'puerh_ripe', year: 2026, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 76, name: '班章龙珠',         brand: '八角亭', cat: 'puerh_ripe', year: 2019, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 77, name: '魔方小方片',       brand: '老同志', cat: 'puerh_ripe', year: 2023, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 78, name: '霸相班章古树饼茶', brand: '八角亭', cat: 'puerh_ripe', year: 2021, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 79, name: '冰岛地界·715',     brand: '吉普号', cat: 'puerh_ripe', year: 2025, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },
  { id: 80, name: '大雪山·317',       brand: '吉普号', cat: 'puerh_ripe', year: 2025, baseNature: '温', caffeine: '低', seasons: ['秋','冬'], avoidSeasons: [], note: '' },

  // ===== 茉莉花茶 (flavored_jasmine) =====
  { id: 81, name: '茉莉花茶·碧潭飘雪品味一级', brand: '竹叶青', cat: 'flavored_jasmine', year: 2025, baseNature: '平', caffeine: '低', seasons: ['春','夏'], avoidSeasons: [], note: '' },
  { id: 82, name: '茉莉花茶·碧潭飘雪品味特级', brand: '竹叶青', cat: 'flavored_jasmine', year: 2025, baseNature: '平', caffeine: '低', seasons: ['春','夏'], avoidSeasons: [], note: '' },
  { id: 83, name: '茉莉花茶·茉莉香',  brand: '猴王',   cat: 'flavored_jasmine', year: 2025, baseNature: '平', caffeine: '低', seasons: ['春','夏'], avoidSeasons: [], note: '' },
  { id: 84, name: '茉莉花茶·金猴王4号', brand: '猴王', cat: 'flavored_jasmine', year: 2025, baseNature: '平', caffeine: '低', seasons: ['春','夏'], avoidSeasons: [], note: '' },
  { id: 85, name: '茉莉花茶·碧潭飘雪静心特级', brand: '竹叶青', cat: 'flavored_jasmine', year: 2025, baseNature: '平', caffeine: '低', seasons: ['春','夏'], avoidSeasons: [], note: '' },

  // ===== 调味茶 (flavored_other) =====
  { id: 86, name: '小青柑',           brand: '虎标',   cat: 'flavored_other', year: 2024, baseNature: '平', caffeine: '低', seasons: ['春','夏','秋','冬'], avoidSeasons: [], note: '' },
  { id: 87, name: '桂花红茶·桂花香',  brand: '猴王',   cat: 'flavored_other', year: 2025, baseNature: '平', caffeine: '低', seasons: ['春','夏','秋','冬'], avoidSeasons: [], note: '' },
  { id: 88, name: '八宝茶',           brand: '自调',   cat: 'flavored_other', year: null, baseNature: '平', caffeine: '低', seasons: ['春','夏','秋','冬'], avoidSeasons: [], note: '自调配方：茉莉花茶、核桃、熟白芝麻、大枣、桂圆、枸杞、葡萄干、桑葚干' }
];

// Apply aging rules to compute the `nature` field for each tea
TEAS.forEach(function(tea) {
  tea.nature = adjustNature(tea.cat, tea.year, tea.baseNature);
});

module.exports = {
  TEAS: TEAS,
  CAT_DEFAULTS: CAT_DEFAULTS,
  CAT_NAMES: CAT_NAMES,
  BREW_GUIDE: BREW_GUIDE,
  adjustNature: adjustNature
};
