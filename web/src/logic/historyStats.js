// The output shape follows pages/stats/stats.js `_compute`; color fields stay
// with the UI, while all date, ordering, percentage, and frequency rules live here.
const NATURE_ORDER = ['寒', '凉', '平', '温', '热', '未知'];
const DEFAULT_CAT_NAMES = {
  green: '绿茶', black: '红茶', white: '白茶', oolong_tieguanyin: '铁观音',
  oolong_wuyi: '武夷岩茶', oolong_dancong: '凤凰单枞', puerh_raw: '普洱生茶',
  puerh_ripe: '普洱熟茶', flavored_jasmine: '茉莉花茶', flavored_other: '调味茶',
};

function pad(value) {
  return value < 10 ? `0${value}` : String(value);
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Browser equivalent of the data calculations in the old statistics page. */
export function getHistoryStats(history, teaLibrary, now = new Date(), categoryNames = DEFAULT_CAT_NAMES) {
  const entries = Array.isArray(history) ? history : [];
  const library = Array.isArray(teaLibrary) ? teaLibrary : [];
  const libraryById = {};
  for (let index = 0; index < library.length; index += 1) libraryById[library[index].id] = library[index];

  const monthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const monthRecords = entries.filter((item) => item.date && item.date.slice(0, 7) === monthKey && item.type !== 'skip');
  const monthTotal = monthRecords.length;

  const catCount = {};
  monthRecords.forEach((item) => {
    const category = item.teaCat || 'unknown';
    catCount[category] = (catCount[category] || 0) + 1;
  });
  const catDist = Object.keys(catCount).map((category) => ({
    key: category,
    name: categoryNames[category] || (category === 'unknown' ? '自选' : category),
    value: catCount[category],
    pct: monthTotal > 0 ? Math.round(catCount[category] / monthTotal * 100) : 0,
  })).sort((left, right) => right.value - left.value);

  const natureCount = { 寒: 0, 凉: 0, 平: 0, 温: 0, 热: 0, 未知: 0 };
  monthRecords.forEach((item) => {
    let nature = null;
    if (item.teaId != null && item.teaId >= 0 && libraryById[item.teaId]) {
      const tea = libraryById[item.teaId];
      nature = tea.nature || tea.baseNature;
    }
    if (nature && natureCount[nature] !== undefined) natureCount[nature] += 1;
    else natureCount.未知 += 1;
  });
  const natureDist = NATURE_ORDER.map((name) => ({
    name,
    value: natureCount[name],
    pct: monthTotal > 0 ? Math.round(natureCount[name] / monthTotal * 100) : 0,
  }));

  const nameCount = {};
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].type !== 'skip') {
      const name = entries[index].teaName || '未知';
      nameCount[name] = (nameCount[name] || 0) + 1;
    }
  }
  const top = Object.keys(nameCount).map((name) => ({ name, value: nameCount[name] }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
  const maxValue = top.length > 0 ? top[0].value : 0;
  const top5 = top.map((item) => ({
    name: item.name,
    value: item.value,
    pct: maxValue > 0 ? Math.round(item.value / maxValue * 100) : 0,
  }));

  const freq = [];
  let freqDays = 0;
  let freqTotal = 0;
  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    const date = new Date(now.getTime() - daysAgo * 86400000);
    const dateString = formatDate(date);
    let count = 0;
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].date === dateString && entries[index].type !== 'skip') count += 1;
    }
    if (count > 0) {
      freqDays += 1;
      freqTotal += count;
    }
    freq.push({
      date: dateString,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count,
      height: count > 0 ? Math.min(120, 20 + count * 35) : 8,
    });
  }

  return {
    monthLabel: `${now.getFullYear()}年${now.getMonth() + 1}月`,
    monthTotal,
    catDist,
    natureDist,
    top5,
    freq,
    freqDays,
    freqTotal,
  };
}
