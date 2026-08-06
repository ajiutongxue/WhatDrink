'use strict';

/**
 * User-confirmed package observations collected before inventory migration.
 * Package facts stay separate from tea knowledge profiles.
 */
module.exports = [
  { teaId: 22, productCode: '522', packageType: 'unknown', status: 'unknown', note: '用户在第二批补充文档中确认货号 522。' },
  { teaId: 24, url: 'https://item.jd.com/100041815235.html', year: 2023, packageType: 'unknown', status: 'unknown', note: '用户在第二批补充文档中确认当前八马鸭屎香年份为 2023。' },
  { teaId: 27, url: 'https://item.taobao.com/item.htm?id=563277476150', packageType: 'unknown', status: 'unknown' },
  { teaId: 28, url: 'https://detail.tmall.com/item.htm?id=652829709728', packageType: 'unknown', status: 'unknown' },
  { teaId: 29, url: 'https://detail.tmall.com/item.htm?id=733048763165', packageType: 'unknown', status: 'unknown' },
  { teaId: 31, url: 'https://item.jd.com/10347921474.html', packagingVariant: '山语系列', roastLevel: 'medium', packageType: 'unknown', status: 'unknown', note: '用户在第二批补充文档中更正为山语系列铁罗汉（中火）。' },
  { teaId: 32, productCode: 'AT106', packageType: 'unknown', status: 'unknown', note: '用户在第二批补充文档中确认货号 AT106。' },
  { teaId: 33, url: 'https://item.jd.com/47303383698.html', productCode: 'AT665', packagingVariant: '喜上眉梢', packageType: 'unknown', status: 'unknown', note: '用户在第二批补充文档中确认喜上眉梢系列与货号 AT665。' },
  { teaId: 36, productCode: 'AT103', packageType: 'unknown', status: 'unknown', note: '用户在第二批补充文档中确认 2020 红罐大红袍货号为 AT103。' },
  { teaId: 38, productCode: 'XT5131', packagingVariant: '乐享系列', packageType: 'unknown', status: 'unknown', note: '用户在第二批补充文档中更正为乐享系列肉桂，货号 XT5131。' },
  { teaId: 40, url: 'https://item.jd.com/10217699548803.html', packageType: 'unknown', status: 'unknown' },
  {
    teaId: 26,
    packageType: 'sample',
    status: 'unknown',
    netWeightPerUnit: 25,
    productNameOverride: '赛珍珠1000浓香铁观音',
    note: '用户确认手头规格是正装内的一盒品鉴装；“轻享版”属于这份包装，不是茶叶产品版本。'
  },
  { teaId: 1, sku: '10202268306875', url: 'https://item.jd.com/10202268306875.html', packageType: 'unknown', status: 'opened' },
  { teaId: 2, sku: '42194246639', url: 'https://item.jd.com/42194246639.html', packageType: 'unknown', status: 'opened' },
  { teaId: 5, url: 'https://mobile.yangkeduo.com/goods1.html?ps=tIBEtvADzV', packageType: 'retail', status: 'opened', productNameOverride: '祁门红茶·1985' },
  { teaId: 6, sku: '100101275669', url: 'https://item.jd.com/100101275669.html', packageType: 'retail', status: 'sealed', netWeightPerUnit: 50 },
  { teaId: 7, sku: '31249152778', url: 'https://item.jd.com/31249152778.html', packageType: 'sample', status: 'unknown' },
  { teaId: 8, sku: '10170266090042', url: 'https://item.jd.com/10170266090042.html', packageType: 'sample', status: 'unknown' },
  { teaId: 9, packageType: 'sample', status: 'unknown', note: '用户确认是品鉴装，当前网上已找不到商品链接' },
  { teaId: 10, packageType: 'sample', status: 'unknown', note: '用户确认是品鉴装，当前网上已找不到商品链接' },
  { teaId: 11, sku: '10107529366433', url: 'https://item.jd.com/10107529366433.html', packageType: 'sample', status: 'unknown', quantity: 4, netWeightPerUnit: 20 },
  { teaId: 12, sku: '10221654279529', url: 'https://item.jd.com/10221654279529.html', packageType: 'sample', status: 'unknown', quantityNote: '20+盒', netWeightPerUnit: 20 },
  { teaId: 13, sku: '652059313019', url: 'https://detail.tmall.com/item.htm?id=652059313019', packageType: 'sample', status: 'unknown', quantityNote: '10+盒' },
  { teaId: 14, sku: '742835726489', url: 'https://detail.tmall.com/item.htm?id=742835726489', packageType: 'unknown', status: 'opened' },
  { teaId: 15, sku: '100327546502', url: 'https://item.jd.com/100327546502.html', packageType: 'sample', status: 'unknown', netWeightPerUnit: 5 },
  { teaId: 16, sku: '100327585866', url: 'https://item.jd.com/100327585866.html', packageType: 'sample', status: 'unknown' },
  { teaId: 17, sku: '100233959739', url: 'https://item.jd.com/100233959739.html', packageType: 'unknown', status: 'unknown' },
  {
    teaId: 18,
    sku: '1070897446954',
    url: 'https://item.taobao.com/item.htm?id=1070897446954',
    packageType: 'unknown',
    status: 'opened',
    note: '用户确认这是已停产的虎标 2024 白牡丹散茶，目前仅能在三方店看到',
    replacesUrls: ['https://item.jd.com/10107948968420.html'],
    replacesSkus: ['10107948968420']
  },
  { teaId: 19, sku: '10034133776579', url: 'https://item.jd.com/10034133776579.html', packageType: 'unknown', status: 'opened' },
  {
    teaId: 20,
    sku: '663676941882',
    url: 'https://detail.tmall.com/item.htm?id=663676941882',
    packageType: 'retail',
    status: 'opened',
    netWeightPerUnit: 120,
    productNameOverride: '陈韵寿眉',
    note: '商品页和包装图确认是太姥山老寿眉、枣香紧压白茶、120g 铁盒装，内含 5g×24',
    replacesUrls: ['https://item.jd.com/100016448603.html'],
    replacesSkus: ['100016448603']
  },
  { teaId: 3, sku: '100033334821', url: 'https://item.jd.com/100033334821.html', packageType: 'sample', status: 'unknown' }
];
