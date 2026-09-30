<script setup lang="ts">
import { computed } from 'vue';
// @ts-expect-error The shared helper is JavaScript and has no declaration file.
import { getHistoryStats } from './logic/historyStats.js';

type Tea = { id: number; name: string; cat: string; nature?: string; baseNature?: string };
type HistoryEntry = {
  id: string;
  updatedAt: number;
  date: string;
  teaId: number;
  teaName: string;
  teaCat: string;
  teaBrand: string;
  teaYear: number | null;
  type: string;
  checkinTime: string;
  tastingNotes?: string;
  notesUpdatedAt?: number;
  imageFileIDs?: Array<{ fileID: string; caption?: string }>;
  noteAnalysis?: unknown;
};
type StatsPageState = {
  teaLibrary: Tea[];
  history: HistoryEntry[];
};
type Distribution = { key: string; name: string; value: number; pct: number };
type Stats = {
  monthLabel: string;
  monthTotal: number;
  catDist: Distribution[];
  natureDist: Array<{ name: string; value: number; pct: number }>;
  top5: Array<{ name: string; value: number; pct: number }>;
  freq: Array<{ date: string; label: string; count: number; height: number }>;
  freqDays: number;
  freqTotal: number;
};

const props = defineProps<{ state: StatsPageState | null; busy: boolean }>();

const stats = computed(() => {
  if (!props.state) return null;
  return getHistoryStats(props.state.history, props.state.teaLibrary, new Date()) as Stats;
});

const categoryColors: Record<string, string> = {
  green: '#8FAE87', black: '#8A7060', white: '#A8B0A8',
  oolong_tieguanyin: '#DE8260', oolong_wuyi: '#C96B4C', oolong_dancong: '#E0987A',
  puerh_raw: '#8FAE87', puerh_ripe: '#5A4A3A', flavored_jasmine: '#C98A8A',
  flavored_other: '#D9A090', unknown: '#C9B8AD',
};
const natureColors: Record<string, string> = {
  寒: '#7FA6C0', 凉: '#8FC0C8', 平: '#A8A89C', 温: '#D99A6A', 热: '#CE7A66', 未知: '#C9B8AD',
};

const donutStyle = computed(() => {
  const data = stats.value;
  if (!data?.monthTotal || !data.catDist.length) return { background: 'conic-gradient(#e9e3da 0 100%)' };
  let cursor = 0;
  const stops = data.catDist.map((item) => {
    const start = cursor;
    cursor += item.value / data.monthTotal * 100;
    return `${categoryColors[item.key] || '#C9B8AD'} ${start}% ${cursor}%`;
  });
  return { background: `conic-gradient(${stops.join(', ')})` };
});

const maxNature = computed(() => Math.max(1, ...(stats.value?.natureDist.map((item) => item.value) || [0])));
const maxFrequency = computed(() => Math.max(1, ...(stats.value?.freq.map((item) => item.count) || [0])));

function frequencyHeight(count: number) {
  return `${count ? Math.max(14, count / maxFrequency.value * 100) : 5}%`;
}
</script>

<template>
  <section class="stats-page">
    <header class="stats-header">
      <div>
        <h1>饮茶统计</h1>
        <p class="stats-subtitle">{{ stats?.monthLabel || '看看每一杯的累积' }}</p>
      </div>
      <slot name="actions" />
    </header>

    <p v-if="busy" class="stats-status" role="status" aria-live="polite">正在更新记录统计…</p>
    <section v-if="!stats" class="surface stats-empty-page" aria-live="polite">
      <span aria-hidden="true">📊</span><strong>正在载入统计</strong><p>记录准备好后会显示在这里。</p>
    </section>
    <section v-else-if="!state?.history.length" class="surface stats-empty-page">
      <span aria-hidden="true">🍃</span><strong>本月暂无饮茶记录</strong><p>完成打卡后生成统计。</p>
    </section>
    <div v-else class="stats-sections">
      <section v-if="stats.monthTotal" class="surface stats-card" aria-labelledby="category-title">
        <div class="section-heading"><span aria-hidden="true">🥧</span><div><h2 id="category-title">本月茶类分布</h2><p>{{ stats.monthTotal }} 次饮茶记录</p></div></div>
        <div class="category-layout">
          <div class="donut" :style="donutStyle" role="img" :aria-label="`${stats.monthLabel}共有 ${stats.monthTotal} 次饮茶记录`">
            <div><strong>{{ stats.monthTotal }}</strong><span>次</span></div>
          </div>
          <ul v-if="stats.catDist.length" class="category-legend">
            <li v-for="item in stats.catDist" :key="item.key">
              <span class="legend-dot" :style="{ background: categoryColors[item.key] || '#C9B8AD' }" aria-hidden="true" />
              <span class="legend-name">{{ item.name }}</span>
              <strong>{{ item.value }} 次 · {{ item.pct }}%</strong>
            </li>
          </ul>
          <p v-else class="section-empty">本月暂无饮茶记录。</p>
        </div>
      </section>

      <section v-if="stats.monthTotal" class="surface stats-card" aria-labelledby="nature-title">
        <div class="section-heading"><span aria-hidden="true">⚖️</span><div><h2 id="nature-title">本月茶性分布</h2><p>按茶库中的茶性归类</p></div></div>
        <div v-if="stats.monthTotal" class="nature-list">
          <div v-for="item in stats.natureDist" :key="item.name" class="nature-row">
            <span>{{ item.name }}</span>
            <div class="bar-track" role="img" :aria-label="`${item.name} ${item.value} 次，占 ${item.pct}%`">
              <div class="bar-fill" :style="{ width: `${item.value / maxNature * 100}%`, background: natureColors[item.name] }" />
            </div>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
        <p v-else class="section-empty">本月暂无饮茶记录。</p>
      </section>

      <section class="surface stats-card" aria-labelledby="top-title">
        <div class="section-heading"><span aria-hidden="true">🏆</span><div><h2 id="top-title">最常喝的茶 Top 5</h2><p>从全部饮茶记录中统计</p></div></div>
        <ol v-if="stats.top5.length" class="top-list">
          <li v-for="(item, index) in stats.top5" :key="item.name" class="top-row">
            <span class="rank" :class="{ podium: index < 3 }">{{ index + 1 }}</span>
            <div class="top-info"><span class="top-name">{{ item.name }}</span><div class="bar-track"><div class="bar-fill top-fill" :style="{ width: `${item.pct}%` }" /></div></div>
            <strong>{{ item.value }} 次</strong>
          </li>
        </ol>
        <p v-else class="section-empty">还没有可统计的饮茶记录。</p>
      </section>

      <section class="surface stats-card frequency-card" aria-labelledby="frequency-title">
        <div class="section-heading"><span aria-hidden="true">📈</span><div><h2 id="frequency-title">最近 30 天饮茶频率</h2><p>按实际打卡次数计算</p></div></div>
        <div v-if="stats.freqTotal" class="frequency-chart" role="img" :aria-label="`近 30 天饮茶 ${stats.freqDays} 天，共 ${stats.freqTotal} 次`">
          <div v-for="item in stats.freq" :key="item.date" class="frequency-column" :title="`${item.date}：${item.count} 次`">
            <span class="frequency-bar" :class="{ active: item.count > 0 }" :style="{ height: frequencyHeight(item.count) }" />
          </div>
        </div>
        <div v-if="stats.freqTotal" class="frequency-axis"><span>{{ stats.freq[0]?.label }}</span><span>近 30 天</span><span>{{ stats.freq[stats.freq.length - 1]?.label }}</span></div>
        <p v-if="stats.freqTotal === 0" class="frequency-empty">近 30 天暂无饮茶打卡。</p>
        <div class="frequency-summary"><span>饮茶 {{ stats.freqDays }} 天</span><i aria-hidden="true">·</i><span>共 {{ stats.freqTotal }} 次</span></div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.stats-page { width: min(calc(100% - 2.5rem), 64rem); margin: 0 auto; padding: 1.5rem 0 7rem; }
.stats-header { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1.25rem; }
.stats-header h1 { margin: .35rem 0 .2rem; color: var(--ink-2, #544438); font-family: var(--font-serif, Georgia, 'Songti SC', serif); font-size: 1.65rem; font-weight: 550; }
.stats-subtitle { margin: 0; color: #827c72; font-size: .85rem; }
.stats-status { margin: 0 0 .8rem; padding: .7rem .9rem; border-radius: .7rem; background: #edf2e9; color: #506b53; font-size: .82rem; }
.stats-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.stats-card { min-width: 0; padding: clamp(1rem, 2.5vw, 1.4rem); }
.section-heading { display: flex; align-items: center; gap: .65rem; margin-bottom: 1rem; }
.section-heading > span { display: grid; width: 2.15rem; height: 2.15rem; flex: 0 0 2.15rem; place-items: center; border-radius: 50%; background: #f3eee6; font-size: 1rem; }
.section-heading h2 { margin: 0; color: #51473f; font-family: Georgia, 'Songti SC', serif; font-size: 1.05rem; font-weight: 500; }
.section-heading p { margin: .2rem 0 0; color: #8a857c; font-size: .72rem; }
.category-layout { display: grid; grid-template-columns: minmax(8rem, .85fr) minmax(0, 1.15fr); align-items: center; gap: 1rem; min-height: 10.5rem; }
.donut { display: grid; width: min(100%, 10rem); aspect-ratio: 1; place-items: center; margin: auto; border-radius: 50%; }
.donut > div { display: flex; width: 64%; height: 64%; flex-direction: column; align-items: center; justify-content: center; border-radius: 50%; background: rgba(255, 252, 247, .96); color: #574a3f; }
.donut strong { font-size: 1.65rem; font-weight: 600; line-height: 1.05; }.donut span { margin-top: .12rem; color: #8b8278; font-size: .7rem; }
.category-legend { display: grid; gap: .6rem; margin: 0; padding: 0; list-style: none; }
.category-legend li { display: grid; grid-template-columns: .55rem minmax(0, 1fr) auto; align-items: center; gap: .42rem; font-size: .72rem; }
.legend-dot { width: .48rem; height: .48rem; border-radius: 50%; }.legend-name { overflow: hidden; color: #666159; text-overflow: ellipsis; white-space: nowrap; }.category-legend strong { color: #685e52; font-size: .69rem; font-weight: 550; white-space: nowrap; }
.nature-list,.top-list { display: grid; gap: .72rem; }.nature-row { display: grid; grid-template-columns: 2.1rem minmax(0, 1fr) 1.55rem; align-items: center; gap: .55rem; color: #686258; font-size: .75rem; }.nature-row strong { color: #675c50; font-size: .72rem; text-align: right; }
.bar-track { height: .53rem; overflow: hidden; border-radius: 999px; background: #f0ebe3; }.bar-fill { height: 100%; min-width: 0; border-radius: inherit; transition: width .25s ease; }
.top-list { margin: 0; padding: 0; list-style: none; }.top-row { display: grid; grid-template-columns: 1.4rem minmax(0, 1fr) 3rem; align-items: center; gap: .6rem; }.rank { display: grid; width: 1.35rem; height: 1.35rem; place-items: center; border-radius: 50%; background: #f0eee8; color: #777368; font-size: .69rem; }.rank.podium { background: #f6e8e0; color: #a05d49; }.top-info { display: grid; min-width: 0; gap: .35rem; }.top-name { overflow: hidden; color: #5b5147; font-size: .77rem; text-overflow: ellipsis; white-space: nowrap; }.top-row > strong { color: #6a6257; font-size: .7rem; font-weight: 550; text-align: right; white-space: nowrap; }.top-fill { background: #c4793b; }
.frequency-card { grid-column: 1 / -1; }.frequency-chart { display: flex; height: 6.3rem; align-items: end; gap: clamp(2px, .65vw, 7px); padding: .25rem 0 0; }.frequency-column { display: flex; height: 100%; min-width: 0; flex: 1; align-items: end; justify-content: center; }.frequency-bar { display: block; width: min(100%, .75rem); min-height: 3px; border-radius: .3rem .3rem 0 0; background: #eee8dd; }.frequency-bar.active { background: #c4793b; }.frequency-axis { display: flex; justify-content: space-between; margin-top: .45rem; color: #90897f; font-size: .68rem; }.frequency-summary { display: flex; justify-content: center; align-items: center; gap: .55rem; margin-top: .9rem; color: #5d6f57; font-size: .82rem; }.frequency-summary i { color: #a99a8a; font-style: normal; }.frequency-empty { margin: .55rem 0 0; color: #90897f; font-size: .73rem; text-align: center; }
.section-empty { margin: 0; color: #8c867d; font-size: .8rem; line-height: 1.6; }.stats-empty-page { display: grid; justify-items: center; gap: .55rem; padding: 3rem 1rem; text-align: center; }.stats-empty-page > span { font-size: 2rem; }.stats-empty-page strong { color: #5b5147; font-family: Georgia, 'Songti SC', serif; font-size: 1.05rem; font-weight: 500; }.stats-empty-page p { margin: 0; color: #8c867d; font-size: .8rem; }
:global(.home-shell.phase-night) .stats-header h1,:global(.home-shell.phase-night) .section-heading h2,:global(.home-shell.phase-night) .donut > div,:global(.home-shell.phase-night) .top-name,:global(.home-shell.phase-night) .top-row > strong,:global(.home-shell.phase-night) .nature-row,:global(.home-shell.phase-night) .nature-row strong { color: #e4e1e5; }
:global(.home-shell.phase-night) .stats-subtitle,:global(.home-shell.phase-night) .section-heading p,:global(.home-shell.phase-night) .legend-name,:global(.home-shell.phase-night) .section-empty,:global(.home-shell.phase-night) .frequency-empty,:global(.home-shell.phase-night) .frequency-axis { color: #c0c1bc; }
:global(.home-shell.phase-night) .section-heading > span,:global(.home-shell.phase-night) .donut > div { background: #3b3c42; }
:global(.home-shell.phase-night) .category-legend strong { color: #dedadd; }
@media (max-width: 700px) { .stats-page { width: min(calc(100% - 2.5rem), 64rem); }.stats-sections { grid-template-columns: 1fr; }.frequency-card { grid-column: auto; } }
@media (max-width: 420px) { .category-layout { grid-template-columns: minmax(7rem, .75fr) minmax(0, 1.25fr); gap: .6rem; }.category-legend { gap: .48rem; }.category-legend li { gap: .3rem; font-size: .66rem; }.category-legend strong { font-size: .62rem; }.donut { width: min(100%, 8rem); } }
@media (prefers-reduced-motion: reduce) { .bar-fill { transition: none; } }
</style>
