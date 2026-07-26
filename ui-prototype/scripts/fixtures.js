(function () {
  'use strict';

  window.UI_FIXTURES = {
    weather: { city: '成都', temperature: 29, description: '多云', solarTerm: '大暑' },
    recommendation: {
      primary: { name: '蒙顶甘露', brand: '川茶', category: '绿茶', nature: '凉', reason: '天气闷热，今天适合一杯清鲜、负担较轻的绿茶。', brew: '85℃ · 90秒 · 4克' },
      alternate: { name: '白牡丹', brand: '福鼎', category: '白茶' }
    },
    history: [
      { date: '07月26日', name: '蒙顶甘露', type: '主推', notes: '清甜，有嫩栗香，第二泡更柔和。' },
      { date: '07月25日', name: '白牡丹', type: '备选', notes: '' },
      { date: '07月24日', name: '凤凰单丛', type: '自选', notes: '蜜兰香明显。' }
    ],
    teas: [
      { name: '蒙顶甘露', category: '绿茶', nature: '凉', year: 2025 },
      { name: '白牡丹', category: '白茶', nature: '平', year: 2023 },
      { name: '凤凰单丛', category: '乌龙茶', nature: '平', year: 2024 },
      { name: '正山小种', category: '红茶', nature: '温', year: 2022 }
    ]
  };
}());
