<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getLunarSummary, getTimeSlot, matchTeaInput, parseInput, recommend, filterEligible, buildPreferenceContext, buildTwoStageCandidatePool, teaCatalog } from './logic/index.js';
import { parseInputWithAI, recommendWithAI, selectCandidatesWithAI, generateDailyQuote, analyzeTastingNote } from './ai/index.js';
import baseDawn from '../../images/base-dawn.svg?url';
import baseDay from '../../images/base-day.svg?url';
import baseDusk from '../../images/base-dusk.svg?url';
import baseNight from '../../images/base-night.svg?url';
import overlayClouds from '../../images/overlay-clouds-a.svg?url';
import overlayRain from '../../images/overlay-rain.svg?url';
import overlaySnow from '../../images/overlay-snow.svg?url';
import overlayThunder from '../../images/overlay-thunder.svg?url';
import overlayFog from '../../images/overlay-fog.svg?url';
import overlayOvercast from '../../images/overlay-overcast.svg?url';
import overlaySun from '../../images/overlay-sun.svg?url';
import overlayMoon from '../../images/overlay-moon.svg?url';

type Tea = { id: number; name: string; brand?: string; cat: string; year?: number | null; nature?: string; baseNature?: string; caffeine?: string; note?: string; _knowledgeSummary?: Record<string, unknown>; _knowledgeDetail?: Record<string, unknown> };
type History = { id: string; updatedAt: number; date: string; teaId: number; teaName: string; teaCat: string; teaBrand: string; teaYear: number | null; type: string; checkinTime: string; tastingNotes?: string; notesUpdatedAt?: number; noteAnalysis?: unknown };
type Weather = { temp: number; humidity: number; desc: string; city: string; [key: string]: unknown };
type Llm = { enabled: boolean; endpoint: string; recModel: string; parserModel: string; parserEnabled: boolean; noteAnalysisEnabled: boolean; twoStageRecommendationEnabled: boolean; apiKeyConfigured?: boolean };
type AppState = { teaLibrary: Tea[]; history: History[]; temporaryAvoids: Record<string, unknown>; profile: { city: string; constitution: string | null; [key: string]: unknown }; settings: { avoidDays: number }; llm: Llm; knowledgeBase?: { profilesByTeaId?: Record<string, unknown> }; knowledgeOverrides?: Record<string, unknown>; inventory?: unknown[] };
type Scored = { tea: Tea; reasons?: string[]; avoids?: string[]; score?: number };
type Parsed = { city?: string | null; states?: string[]; avoidCats?: string[]; preferCats?: string[]; mood?: string | null; strongPreferCats?: string[] };
type Card = { tea: Tea; label: string; reason: string; brew: string; tagline?: string };
type Result = { mode: 'rule' | 'ai'; primary: Card; alt: Card | null; avoidInfo: string };

const password = ref('');
const authenticated = ref(false);
const state = ref<AppState | null>(null);
const revision = ref(0);
const tab = ref<'recommend' | 'library' | 'settings'>('recommend');
const busy = ref(false);
const recommending = ref(false);
const message = ref('');
const notice = ref('');
const now = ref(new Date());
const input = ref('');
const showInput = ref(false);
const customTea = ref('');
const weather = ref<Weather | null>(null);
const weatherNote = ref('');
const result = ref<Result | null>(null);
const noResult = ref(false);
const excludedIds = ref<number[]>([]);
const selectedCheckinId = ref('');
const tastingDraft = ref('');
const tastingOpen = ref(false);
const quote = ref('今日无事，吃茶去。');
const quoteLoading = ref(false);
const libraryQuery = ref('');
const settingsCity = ref('');
const settingsLlm = ref<Llm | null>(null);
const settingsKey = ref('');
let controller: AbortController | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

const today = computed(() => `${now.value.getFullYear()}-${String(now.value.getMonth() + 1).padStart(2, '0')}-${String(now.value.getDate()).padStart(2, '0')}`);
const lunar = computed(() => getLunarSummary(now.value));
const solarTerm = computed(() => { const md = (now.value.getMonth() + 1) * 100 + now.value.getDate(); const terms: Array<[number, string]> = [[105,'小寒'],[120,'大寒'],[204,'立春'],[219,'雨水'],[306,'惊蛰'],[321,'春分'],[405,'清明'],[420,'谷雨'],[506,'立夏'],[521,'小满'],[606,'芒种'],[621,'夏至'],[707,'小暑'],[723,'大暑'],[807,'立秋'],[823,'处暑'],[908,'白露'],[923,'秋分'],[1008,'寒露'],[1023,'霜降'],[1107,'立冬'],[1122,'小雪'],[1207,'大雪'],[1222,'冬至']]; return terms.reduce((value, [day, name]) => md >= day ? name : value, '冬至后'); });
const weekday = computed(() => new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now.value));
const season = computed(() => ['冬', '春', '夏', '秋'][Math.floor(((now.value.getMonth() + 1) % 12) / 3)]);
const phase = computed(() => { const hour = now.value.getHours(); return hour < 5 || hour >= 20 ? 'night' : hour < 8 ? 'dawn' : hour < 17 ? 'day' : 'dusk'; });
const sceneBase = computed(() => ({ dawn: baseDawn, day: baseDay, dusk: baseDusk, night: baseNight })[phase.value]);
const sceneOverlay = computed(() => { const desc = weather.value?.desc || ''; if (/雷/.test(desc)) return overlayThunder; if (/雪/.test(desc)) return overlaySnow; if (/雨/.test(desc)) return overlayRain; if (/雾|霾/.test(desc)) return overlayFog; if (/阴/.test(desc)) return overlayOvercast; if (/云/.test(desc)) return overlayClouds; return phase.value === 'night' ? overlayMoon : overlaySun; });
const todayHistory = computed(() => (state.value?.history || []).filter((item) => item.date === today.value && item.type !== 'skip'));
const selectedCheckin = computed(() => todayHistory.value.find((item) => item.id === selectedCheckinId.value) || todayHistory.value.at(-1) || null);
const filteredTeas = computed(() => { const needle = libraryQuery.value.trim().toLowerCase(); return (state.value?.teaLibrary || []).filter((tea) => !needle || `${tea.name} ${tea.brand || ''} ${tea.cat}`.toLowerCase().includes(needle)); });
const catNames = teaCatalog.CAT_NAMES as Record<string, string>;
const brewGuide = teaCatalog.BREW_GUIDE as Record<string, { temp: string | number; ratio: string; time?: string }>;

function errorText(error: unknown, fallback: string) { notice.value = error instanceof Error && error.message ? error.message : fallback; }
function openTab(next: 'recommend' | 'library' | 'settings') { tab.value = next; notice.value = ''; }
function isoDate() { return today.value; }
function aiError(error: unknown) { if (error instanceof Error && error.name !== 'AbortError') notice.value = `${error.message}，已切换规则推荐。`; }

async function readState(syncDraft = false) {
  const response = await fetch('/api/state');
  if (response.status === 401) { authenticated.value = false; state.value = null; throw new Error('登录已失效，请重新登录。'); }
  if (!response.ok) throw new Error('读取数据失败，请稍后重试。');
  const body = await response.json() as { revision: number; state: AppState };
  revision.value = body.revision; state.value = body.state; authenticated.value = true;
  if (syncDraft) { settingsCity.value = body.state.profile.city || ''; settingsLlm.value = { ...body.state.llm }; selectedCheckinId.value = body.state.history.filter((h) => h.date === isoDate() && h.type !== 'skip').at(-1)?.id || ''; }
}

async function login() {
  busy.value = true; message.value = '';
  try { const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) });
    if (!response.ok) { message.value = response.status === 401 ? '密码不正确。' : response.status === 429 ? '尝试次数过多，请稍后再试。' : '登录服务暂时不可用。'; return; }
    password.value = ''; await readState(true); void refreshWeather().then(() => refreshQuote());
  } catch { message.value = '无法连接服务器，请确认服务已启动。'; } finally { busy.value = false; }
}
async function logout() {
  try { const response = await fetch('/api/logout', { method: 'POST' }); if (!response.ok) throw new Error('退出失败，请检查网络后重试。'); controller?.abort(); authenticated.value = false; state.value = null; result.value = null; weather.value = null; tab.value = 'recommend'; notice.value = ''; }
  catch (error) { errorText(error, '退出失败。'); }
}
async function patchSection(section: 'profile' | 'llm', value: Record<string, unknown>) {
  const response = await fetch(`/api/state/${section}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: revision.value, value }) });
  if (response.status === 409) { await readState(); throw new Error('数据已在其他窗口更新，请检查后重试。'); }
  if (!response.ok) throw new Error(section === 'llm' ? 'AI 设置保存失败。' : '城市保存失败。');
  revision.value = (await response.json() as { revision: number }).revision; await readState();
}
async function mutate(mutation: Record<string, unknown>) {
  const response = await fetch('/api/mutations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: revision.value, mutations: [mutation] }) });
  if (response.status === 409) { await readState(); throw new Error('数据已在其他窗口更新，请重试操作。'); }
  if (!response.ok) throw new Error('保存失败，请检查网络后重试。');
  revision.value = (await response.json() as { revision: number }).revision; await readState();
}
async function refreshWeather(cityOverride?: string) {
  const city = cityOverride || state.value?.profile.city || '';
  let coords: { latitude: number; longitude: number } | null = null;
  if (!cityOverride && navigator.geolocation) coords = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }), () => resolve(null), { timeout: 5000, maximumAge: 1_800_000 }));
  if (!city && !coords) { weatherNote.value = '在设置中填写城市，即可显示天气；推荐仍可使用。'; return; }
  const params = new URLSearchParams(); if (city) params.set('city', city); if (coords) { params.set('latitude', String(coords.latitude)); params.set('longitude', String(coords.longitude)); }
  try { const response = await fetch(`/api/weather?${params}`); const body = await response.json() as { success: boolean; data?: Weather }; if (!response.ok || !body.success || !body.data) throw Error(); weather.value = body.data; weatherNote.value = ''; }
  catch { weather.value = null; weatherNote.value = '天气暂不可用，继续使用规则推荐。'; }
}
function ruleCard(scored: Scored, label: string, parsed: Parsed): Card {
  const tea = scored.tea; const brew = brewGuide[tea.cat] || brewGuide.oolong_other;
  const context = [weather.value ? `${weather.value.city}${weather.value.temp}℃` : '', `${season.value}季`, ...(parsed.states || [])].filter(Boolean).join(' · ');
  return { tea, label, reason: `${context ? `${context}，` : ''}推荐这款${tea.nature || tea.baseNature || '平'}性的${tea.name}${scored.reasons?.length ? `：${scored.reasons.join('，')}。` : '。'}`, brew: [brew?.temp ? String(brew.temp) : '', brew?.time || '', brew?.ratio || ''].filter(Boolean).join(' · ') };
}
function ruleResult(parsed: Parsed) {
  const data = state.value!;
  const scored = recommend(data.teaLibrary, parsed, weather.value, data.history, data.settings.avoidDays, data.profile.constitution, data.temporaryAvoids, data.llm.noteAnalysisEnabled, excludedIds.value) as { primary: Scored | null; alt: Scored | null; candidates: Scored[] };
  if (!scored.primary) { noResult.value = true; return scored; }
  result.value = { mode: 'rule', primary: ruleCard(scored.primary, '本地规则推荐', parsed), alt: scored.alt && (scored.alt.score || 0) > 0 ? ruleCard(scored.alt, '备选 · 换一种口味', parsed) : null, avoidInfo: scored.primary.avoids?.length ? scored.primary.avoids.join('；') : '' };
  showInput.value = false; return scored;
}
function aiContext(parsed: Parsed) {
  const data = state.value!; const hour = now.value.getHours();
  return { hour, timeSlot: getTimeSlot(hour).name, season: season.value, solarTerm: solarTerm.value, weather: weather.value,
    states: parsed.states || [], constitution: data.profile.constitution, avoidCats: parsed.avoidCats || [], preferCats: parsed.preferCats || [], mood: parsed.mood,
    todayDrunk: todayHistory.value.map((h) => ({ name: h.teaName, nature: data.teaLibrary.find((t) => t.id === h.teaId)?.nature || '平', checkinTime: h.checkinTime })),
    preferenceSummary: (buildPreferenceContext(data.history, data.teaLibrary, data.llm.noteAnalysisEnabled) as { summary?: { recentFavorites?: string[]; recentCategories?: string[]; explicitSignals?: string[] } }).summary, profile: data.profile };
}
function aiCard(selection: Record<string, unknown>, tea: Tea, label: string): Card {
  const brew = brewGuide[tea.cat] || brewGuide.oolong_other;
  const reasons = Array.isArray(selection.reasons) ? selection.reasons.filter((r): r is string => typeof r === 'string') : [];
  return { tea, label, tagline: String(selection.tagline || selection.why_different || ''), reason: String(selection.narrative || reasons.join('；') || '今天适合试试这款茶。'), brew: String(selection.brew_tip || [brew?.temp ? String(brew.temp) : '', brew?.time || '', brew?.ratio || ''].filter(Boolean).join(' · ')) };
}
function withKnowledgeContext(teas: Tea[], data: AppState): Tea[] {
  const profiles = data.knowledgeBase?.profilesByTeaId || {};
  return teas.map((tea) => {
    const profile = profiles[String(tea.id)] as Record<string, unknown> | undefined;
    const sensory = (profile?.sensory || {}) as Record<string, { value?: unknown }>;
    const research = (profile?.research || {}) as { completeness?: number };
    const override = (data.knowledgeOverrides?.[String(tea.id)] || {}) as { patch?: Record<string, unknown> };
    const opened = (data.inventory || []).some((row) => { const item = row as { teaId?: number; status?: string; deletedAt?: number }; return item.teaId === tea.id && item.status === 'opened' && !item.deletedAt; });
    const simpleProfile: Record<string, unknown> = {};
    for (const section of ['sensory', 'effects', 'context', 'brew']) {
      const fields = (profile?.[section] || {}) as Record<string, { value?: unknown }>;
      simpleProfile[section] = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value?.value]));
    }
    const personalConclusions = data.history.filter((entry) => {
      const analysis = entry.noteAnalysis as { sourceUpdatedAt?: number } | undefined;
      return entry.teaId === tea.id && analysis && analysis.sourceUpdatedAt === entry.notesUpdatedAt;
    }).slice(-5).map((entry) => ({ date: entry.date, analysis: entry.noteAnalysis }));
    return { ...tea, _knowledgeSummary: { aromaTags: Array.isArray(sensory.aromaTags?.value) ? sensory.aromaTags.value.slice(0, 4) : [], completeness: research.completeness, opened },
      _knowledgeDetail: { profile: simpleProfile, personalFields: override.patch || {}, personalConclusions, opened } };
  });
}
async function generateRecommendation(reroll = false) {
  if (!state.value) return;
  if (reroll && result.value) excludedIds.value.push(result.value.primary.tea.id, ...(result.value.alt ? [result.value.alt.tea.id] : [])); else if (!reroll) excludedIds.value = [];
  controller?.abort(); const request = new AbortController(); controller = request;
  busy.value = true; recommending.value = true; notice.value = ''; noResult.value = false; result.value = null;
  try {
    const data = state.value;
    let skipDeepAI = false;
    const localParsed = await parseInput(input.value) as Parsed;
    const parsed = (data.llm.parserEnabled && data.llm.apiKeyConfigured && data.llm.endpoint
      ? await parseInputWithAI(input.value, localParsed as Parameters<typeof parseInputWithAI>[1], { signal: request.signal, onError: (error) => { aiError(error); if (['network', 'http'].includes((error as { code?: string }).code || '')) skipDeepAI = true; } })
      : localParsed) as Parsed;
    if (request.signal.aborted) return;
    if (parsed.city && parsed.city !== data.profile.city) { try { await patchSection('profile', { ...data.profile, city: parsed.city }); } catch { /* This recommendation still uses the parsed city. */ } await refreshWeather(parsed.city); }
    if (!state.value) return;
    const rule = ruleResult(parsed);
    if (!rule.primary || skipDeepAI || !state.value.llm.enabled || !state.value.llm.apiKeyConfigured || !state.value.llm.endpoint) return;
    const current = state.value;
    let eligible = withKnowledgeContext(filterEligible(current.teaLibrary, parsed, current.history, current.settings.avoidDays, current.temporaryAvoids, excludedIds.value) as Tea[], current);
    if (!eligible.length) return;
    const context = aiContext(parsed);
    if (current.llm.twoStageRecommendationEnabled) {
      const coarse = await selectCandidatesWithAI(eligible, context, { signal: request.signal, onError: aiError });
      eligible = buildTwoStageCandidatePool(eligible, coarse?.candidates || [], rule.candidates, { relaxCategoryCap: !!parsed.strongPreferCats?.length }) as Tea[];
    }
    const ai = await recommendWithAI(eligible, current.llm.twoStageRecommendationEnabled ? { ...context, fine: true } : context, { signal: request.signal, onError: aiError }) as { primary?: Record<string, unknown>; alternative?: Record<string, unknown>; today_avoid_note?: string } | null;
    if (request.signal.aborted || !ai?.primary) return;
    const find = (entry?: Record<string, unknown>) => eligible.find((tea) => tea.id === Number(entry?._teaId ?? entry?.teaId));
    const primary = find(ai.primary); if (!primary) { notice.value = 'AI 返回的茶不在候选池中，已切换规则推荐。'; return; }
    const alt = find(ai.alternative);
    result.value = { mode: 'ai', primary: aiCard(ai.primary, primary, 'AI 深度推荐'), alt: alt && ai.alternative && alt.id !== primary.id ? aiCard(ai.alternative, alt, 'AI 备选') : null, avoidInfo: ai.today_avoid_note || '' };
  } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) errorText(error, 'AI 暂不可用，已切换规则推荐。'); }
  finally { if (controller === request) { controller = null; busy.value = false; recommending.value = false; } }
}
function cancelRecommendation() { if (!recommending.value) return; controller?.abort(); busy.value = false; recommending.value = false; void parseInput(input.value).then((parsed) => { if (state.value) ruleResult(parsed as Parsed); }); notice.value = '已取消 AI 请求，改用规则推荐。'; }
async function checkin(tea: Tea | null, type: 'primary' | 'alt' | 'custom', name = '') {
  if (!state.value || busy.value) return; const stamp = Date.now(); const date = new Date(stamp);
  const entry: History = { id: `h_${stamp}_${Math.random().toString(36).slice(2, 8)}`, updatedAt: stamp, date: isoDate(), teaId: tea?.id ?? -1, teaName: tea?.name || name, teaCat: tea?.cat || 'unknown', teaBrand: tea?.brand || '', teaYear: tea?.year || null, type, checkinTime: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` };
  busy.value = true; notice.value = '';
  try { await mutate({ mutationId: crypto.randomUUID(), type: 'upsert_history', entityId: entry.id, value: entry }); selectedCheckinId.value = entry.id; tastingOpen.value = false; tastingDraft.value = ''; customTea.value = ''; notice.value = `已记录「${entry.teaName}」，可以接着写品饮感受。`; }
  catch (error) { errorText(error, '打卡失败。'); } finally { busy.value = false; }
}
async function checkinCustom() { const name = customTea.value.trim(); if (!name || !state.value) { notice.value = '请先输入茶名。'; return; } const match = matchTeaInput(name, state.value.teaLibrary) as { status: string; tea?: Tea }; if (match.status === 'ambiguous') { notice.value = '茶库中有多款同名茶，请补充年份后再记录。'; return; } await checkin(match.status === 'matched' ? match.tea || null : null, 'custom', name); }
async function avoidTea(tea: Tea) { if (busy.value) return; busy.value = true; notice.value = ''; try { const stamp = Date.now(); await mutate({ mutationId: crypto.randomUUID(), type: 'set_avoid', entityId: String(tea.id), value: { active: true, markedAt: stamp, expiresAt: stamp + 30 * 86_400_000, updatedAt: stamp } }); await generateRecommendation(true); notice.value = `30 天内不再推荐「${tea.name}」。`; } catch (error) { errorText(error, '设置近期回避失败。'); } finally { busy.value = false; } }
function openTasting() { tastingDraft.value = selectedCheckin.value?.tastingNotes || ''; tastingOpen.value = true; }
async function saveTasting() {
  const current = selectedCheckin.value; if (!current || busy.value) return; const text = tastingDraft.value.trim().slice(0, 500); busy.value = true; notice.value = '';
  try { const changed = text !== (current.tastingNotes || ''); const stamp = Date.now(); const entry = { ...current, tastingNotes: text, updatedAt: stamp, notesUpdatedAt: changed ? stamp : current.notesUpdatedAt || stamp }; if (changed) delete entry.noteAnalysis;
    await mutate({ mutationId: crypto.randomUUID(), type: 'upsert_history', entityId: entry.id, value: entry }); tastingOpen.value = false; notice.value = '品饮感受已保存。';
    if (text && changed && state.value?.llm.noteAnalysisEnabled && state.value?.llm.apiKeyConfigured && state.value?.llm.endpoint) {
      const tea = state.value.teaLibrary.find((item) => item.id === entry.teaId);
      void analyzeTastingNote(text, tea || { name: entry.teaName }, { sourceUpdatedAt: entry.notesUpdatedAt }).then(async (analysis: unknown) => {
        if (!analysis || !state.value) return; const latest = state.value.history.find((item) => item.id === entry.id);
        if (!latest || latest.updatedAt !== entry.updatedAt) return;
        try { await mutate({ mutationId: crypto.randomUUID(), type: 'upsert_history', entityId: entry.id, value: { ...latest, noteAnalysis: analysis, updatedAt: Date.now() } }); } catch { /* The note itself is already saved. */ }
      }).catch(() => { /* AI analysis is optional. */ });
    }
  } catch (error) { errorText(error, '保存品饮感受失败。'); } finally { busy.value = false; }
}
async function saveSettings() {
  if (!state.value || !settingsLlm.value || busy.value) return; busy.value = true; notice.value = '';
  try { if (settingsCity.value.trim() !== state.value.profile.city) { await patchSection('profile', { ...state.value.profile, city: settingsCity.value.trim() }); weather.value = null; void refreshWeather(); }
    const { apiKeyConfigured: _configured, ...llm } = settingsLlm.value; const value: Record<string, unknown> = { ...llm }; if (settingsKey.value.trim()) value.apiKey = settingsKey.value.trim();
    await patchSection('llm', value); settingsLlm.value = { ...state.value!.llm }; settingsKey.value = ''; notice.value = '设置已保存。'; void refreshQuote();
  } catch (error) { errorText(error, '设置保存失败。'); } finally { busy.value = false; }
}
const presetQuotes = ['今日无事，吃茶去。', '水沸茶醒，日子也跟着舒展开来。', '不急，先喝口茶，再慢慢说。', '一口回甘，是茶给的小小奖励。'];
async function refreshQuote() {
  const cacheKey = `tea-quote:${isoDate()}`; let cached = '';
  try { cached = localStorage.getItem(cacheKey) || ''; } catch { /* Storage may be unavailable. */ }
  quote.value = cached || presetQuotes[now.value.getDate() % presetQuotes.length];
  if (cached || quoteLoading.value || !state.value?.llm.apiKeyConfigured || !state.value.llm.endpoint) return;
  quoteLoading.value = true;
  try { const text = await generateDailyQuote({ date: isoDate(), weekday: weekday.value, solarTerm: solarTerm.value, season: season.value, weather: weather.value }); if (text) { quote.value = text; try { localStorage.setItem(cacheKey, text); } catch { /* Fine without cache. */ } } } catch { /* Keep preset. */ } finally { quoteLoading.value = false; }
}
onMounted(async () => { clockTimer = setInterval(() => { now.value = new Date(); }, 60_000); try { const response = await fetch('/api/session'); const session = await response.json() as { authenticated: boolean }; if (session.authenticated) { await readState(true); void refreshWeather().then(() => refreshQuote()); } } catch { message.value = '服务器暂时不可用。'; } });
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer); controller?.abort(); });
</script>

<template>
  <main class="app-shell" :class="`phase-${phase}`">
    <div class="scene" aria-hidden="true"><img class="scene-base" :src="sceneBase" alt="" /><img class="scene-overlay" :src="sceneOverlay" alt="" /></div>
    <header class="site-header"><div class="brand"><span class="brand-mark">茶</span><span>今天喝点什么茶</span></div><button v-if="authenticated" class="header-link" type="button" @click="logout">退出</button><span v-else class="header-caption">一杯茶的日常</span></header>
    <section v-if="!authenticated" class="login-panel" aria-labelledby="login-title"><p class="eyebrow">MY TEA JOURNAL</p><h1 id="login-title">欢迎回来</h1><p class="muted">登录后，看看今天适合喝什么。</p><form class="form-stack" @submit.prevent="login"><label for="password">登录密码</label><input id="password" v-model="password" type="password" autocomplete="current-password" required /><button class="button-primary" :disabled="busy">{{ busy ? '正在登录…' : '进入茶园' }}</button></form><p v-if="message" class="notice" role="status">{{ message }}</p></section>
    <template v-else>
      <nav class="main-nav" aria-label="主导航"><button :class="{ active: tab === 'recommend' }" @click="openTab('recommend')">今日推荐</button><button :class="{ active: tab === 'library' }" @click="openTab('library')">我的茶库</button><button :class="{ active: tab === 'settings' }" @click="openTab('settings')">设置</button></nav>
      <section v-if="tab === 'recommend'" class="recommend-page" aria-labelledby="recommend-title"><div class="hero"><div class="hero-meta"><span>{{ today }} · {{ weather?.city || state?.profile.city || '今日' }}</span><span>{{ solarTerm }}</span></div><div class="hero-main"><div><p class="eyebrow">TODAY'S CUP</p><h1 id="recommend-title">{{ now.getDate() }} <small>{{ weekday }}</small></h1><p class="lunar-line">{{ lunar.lunarText }}<span v-if="lunar.jieQi"> · {{ lunar.jieQi }}</span></p></div><div class="weather-block" aria-live="polite"><strong v-if="weather">{{ weather.temp }}°</strong><span v-if="weather">{{ weather.desc }}</span><span v-else>天气未获取</span></div></div><p class="quote">{{ quote }}</p><p v-if="weatherNote" class="weather-note">{{ weatherNote }}</p></div>
        <div class="content-flow"><section class="input-card" aria-label="今日状态输入"><button v-if="!showInput" class="input-prompt" type="button" @click="showInput = true"><strong>{{ input.trim() || '今天想怎么喝？' }}</strong><span>说说状态、口味或城市，推荐会更贴心</span></button><div v-else class="input-editor"><label for="today-input">说说今天的状态</label><textarea id="today-input" v-model="input" rows="3" maxlength="500" placeholder="例如：昨晚没睡好，想喝清爽一点的。"></textarea><button class="text-button" type="button" @click="showInput = false">收起</button></div></section>
          <div class="recommend-toolbar"><button class="button-primary button-rec" type="button" :disabled="busy" @click="generateRecommendation(!!result)">{{ recommending ? '正在寻茶…' : result ? '重新推荐' : '看看今天喝什么' }}</button><button v-if="recommending" class="text-button" type="button" @click="cancelRecommendation">取消</button></div><p v-if="notice" class="notice" role="status">{{ notice }}</p>
          <section v-if="noResult" class="surface empty-result"><p class="eyebrow">NO MATCH</p><h2>今天没有合适的候选</h2><p>可以放宽回避条件，或在茶库启用更多茶叶。</p><button class="button-secondary" @click="showInput = true">重新输入</button></section>
          <div v-if="result" class="cards-grid" aria-live="polite"><article v-for="(card, index) in [result.primary, result.alt].filter(Boolean)" :key="card!.tea.id" class="surface tea-card" :class="{ 'primary-card': index === 0 }"><div class="card-top"><span class="eyebrow">{{ card!.label }}</span><span class="nature-tag">{{ card!.tea.nature || card!.tea.baseNature || '平' }}</span></div><h2>{{ card!.tea.name }}</h2><p class="tea-meta">{{ card!.tea.brand || catNames[card!.tea.cat] || card!.tea.cat }}<span v-if="card!.tea.year"> · {{ card!.tea.year }}年</span></p><div class="tea-tags"><span>{{ catNames[card!.tea.cat] || card!.tea.cat }}</span><span>{{ card!.tea.caffeine || '中' }}咖啡因</span></div><p v-if="card!.tagline" class="tea-tagline">{{ card!.tagline }}</p><p class="tea-reason">{{ card!.reason }}</p><p class="brew-line">冲泡建议 · {{ card!.brew || '按个人习惯冲泡' }}</p><div class="card-actions"><button class="button-primary" :disabled="busy" @click="checkin(card!.tea, index === 0 ? 'primary' : 'alt')">喝这个</button><button class="button-secondary" :disabled="busy" @click="avoidTea(card!.tea)">近期不想喝</button></div></article></div>
          <p v-if="result?.avoidInfo" class="avoid-note">{{ result.avoidInfo }}</p><section v-if="result" class="surface custom-card"><div><p class="eyebrow">DRANK SOMETHING ELSE?</p><h2>我喝了别的</h2></div><form class="custom-form" @submit.prevent="checkinCustom"><label class="sr-only" for="custom-tea">实际喝的茶</label><input id="custom-tea" v-model="customTea" placeholder="输入实际喝的茶" /><button class="button-secondary" :disabled="busy">记录这杯</button></form></section>
          <section v-if="selectedCheckin" class="surface checkin-card"><p class="eyebrow">TODAY'S JOURNAL</p><h2>今天喝了「{{ selectedCheckin.teaName }}」</h2><p class="muted">{{ selectedCheckin.checkinTime }} · {{ selectedCheckin.type === 'primary' ? '主推' : selectedCheckin.type === 'alt' ? '备选' : '自选' }}</p><p v-if="selectedCheckin.tastingNotes" class="saved-note">{{ selectedCheckin.tastingNotes }}</p><button v-if="!tastingOpen" class="button-secondary" @click="openTasting">{{ selectedCheckin.tastingNotes ? '修改品饮感受' : '写几句品饮感受' }}</button><form v-else class="tasting-form" @submit.prevent="saveTasting"><label for="tasting">品饮感受</label><textarea id="tasting" v-model="tastingDraft" rows="4" maxlength="500" placeholder="这一杯的香气、滋味或心情……"></textarea><div class="form-footer"><span>{{ tastingDraft.length }} / 500</span><button class="button-primary" :disabled="busy">保存感受</button></div></form></section>
        </div></section>
      <section v-else-if="tab === 'library'" class="other-page" aria-labelledby="library-title"><p class="eyebrow">YOUR COLLECTION</p><h1 id="library-title">茶叶清单</h1><p class="muted">收录 {{ state?.teaLibrary.length || 0 }} 款茶 · 当前为只读预览</p><label class="search-box" for="tea-search"><span aria-hidden="true">⌕</span><input id="tea-search" v-model="libraryQuery" type="search" placeholder="搜索茶名、品牌或分类" /></label><div class="library-list"><article v-for="tea in filteredTeas" :key="tea.id" class="library-row"><div><h2>{{ tea.name }}</h2><p>{{ tea.brand }}<span v-if="tea.year"> · {{ tea.year }}年</span></p></div><span class="nature-tag">{{ tea.nature || '平' }}</span></article><p v-if="!filteredTeas.length" class="muted">没有找到这款茶。</p></div></section>
      <section v-else class="other-page settings-page" aria-labelledby="settings-title"><p class="eyebrow">PREFERENCES</p><h1 id="settings-title">设置</h1><p class="muted">这里只放步骤 3 需要的城市和 AI 配置；其他设置将在下一步补齐。</p><form v-if="settingsLlm" class="settings-form" @submit.prevent="saveSettings"><div class="surface settings-card"><h2>天气城市</h2><label for="city">定位不可用时使用</label><input id="city" v-model="settingsCity" placeholder="例如：成都" /></div><div class="surface settings-card"><h2>AI 服务</h2><label class="switch-row"><span>深度推荐</span><input v-model="settingsLlm.enabled" type="checkbox" /></label><label class="switch-row"><span>智能解析输入</span><input v-model="settingsLlm.parserEnabled" type="checkbox" /></label><label class="switch-row"><span>新品饮笔记分析</span><input v-model="settingsLlm.noteAnalysisEnabled" type="checkbox" /></label><label class="switch-row"><span>两阶段推荐</span><input v-model="settingsLlm.twoStageRecommendationEnabled" type="checkbox" /></label><label for="endpoint">API 端点</label><input id="endpoint" v-model="settingsLlm.endpoint" type="url" placeholder="https://…/v1" /><label for="rec-model">推荐模型</label><input id="rec-model" v-model="settingsLlm.recModel" /><label for="parser-model">解析模型</label><input id="parser-model" v-model="settingsLlm.parserModel" /><label for="api-key">API Key <span class="key-status">{{ settingsLlm.apiKeyConfigured ? '已配置，留空则保持不变' : '尚未配置' }}</span></label><input id="api-key" v-model="settingsKey" type="password" autocomplete="off" placeholder="仅保存新 Key 时填写" /><p class="settings-help">Key 只在服务器加密保存，页面不会回显。</p></div><button class="button-primary settings-save" :disabled="busy">{{ busy ? '正在保存…' : '保存设置' }}</button></form><p v-if="notice" class="notice" role="status">{{ notice }}</p></section>
    </template><footer class="site-footer">慢一点，喝一杯。</footer>
  </main>
</template>
