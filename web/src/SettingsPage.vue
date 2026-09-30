<script setup lang="ts">
import { computed, ref, watch } from 'vue';

type Profile = { gender?: string; age?: string; city?: string; constitution?: string | null; quizAnswers?: Record<string, number> };
type Llm = { enabled: boolean; endpoint: string; recModel: string; parserModel: string; parserEnabled: boolean; noteAnalysisEnabled: boolean; twoStageRecommendationEnabled: boolean; apiKeyConfigured?: boolean };
type SettingsState = { profile: Profile; settings: { avoidDays: number }; llm: Llm; teaLibrary: unknown[]; history: unknown[]; inventory?: unknown[]; knowledgeBase?: { catalogVersion?: string } | null; knowledgeBaseBackup?: unknown };
type SyncStatus = { connected: boolean; needsLogin: boolean; pending: number; syncing: boolean; lastSyncedAt: number | null; failure: string };

const props = defineProps<{ state: SettingsState; revision: number; busy: boolean; offline: boolean; offlineCapable: boolean; syncStatus: SyncStatus }>();
const emit = defineEmits<{
  'save-profile': [profile: Profile]; 'save-quiz': [quizAnswers: Record<string, number>, constitution: string];
  'save-recommend': [avoidDays: number]; 'save-ai': [llm: Llm, key: string];
  'refresh-state': []; 'export-data': []; 'import-data': [file: File];
  'install-knowledge': [file: File]; 'rollback-knowledge': []; 'reset-data': [];
  'retry-sync': []; 'logout': [];
}>();

const profileDraft = ref<Profile>({});
const quizDraft = ref<Record<string, number>>({});
const llmDraft = ref<Llm>({ ...props.state.llm });
const keyDraft = ref('');
const avoidDays = ref(5);
const importInput = ref<HTMLInputElement | null>(null);
const knowledgeInput = ref<HTMLInputElement | null>(null);

const questions = [
  ['平时怕冷还是怕热？', ['怕冷', '差不多', '怕热']],
  ['喜欢喝热水还是冷饮？', ['热水', '都行', '冷饮']],
  ['容易出汗吗？', ['很少出汗', '正常', '容易出汗']],
  ['大便情况？', ['偏稀 / 易腹泻', '正常', '偏干 / 便秘']],
  ['嘴唇颜色？', ['偏淡 / 偏白', '淡红正常', '偏红 / 偏深']],
] as const;
const quizDone = computed(() => questions.every((_, index) => Number.isInteger(quizDraft.value[index])));
const constitution = computed(() => {
  if (!quizDone.value) return null;
  const sum = questions.reduce((total, _, index) => total + quizDraft.value[index], 0);
  return sum <= -2 ? '偏寒' : sum >= 2 ? '偏热' : '平和';
});
const constitutionHint = computed(() => ({ 偏寒: '适合温性茶，少喝绿茶和新生普。', 平和: '各类茶均可，随季节与心情选择。', 偏热: '适合凉性茶，少喝红茶和熟普。' })[constitution.value || props.state.profile.constitution || '平和']);
const connectionLabel = computed(() => props.syncStatus.needsLogin ? '需要重新登录' : props.syncStatus.connected ? (props.offline ? '本地离线使用' : '已连接服务器') : '服务器暂不可达');
const lastSyncedLabel = computed(() => props.syncStatus.lastSyncedAt ? new Date(props.syncStatus.lastSyncedAt).toLocaleString() : '尚无同步记录');

watch(() => props.revision, () => {
  profileDraft.value = { ...props.state.profile };
  quizDraft.value = { ...(props.state.profile.quizAnswers || {}) };
  llmDraft.value = { ...props.state.llm };
  keyDraft.value = '';
  avoidDays.value = props.state.settings.avoidDays;
}, { immediate: true });

function saveProfile() { emit('save-profile', { ...props.state.profile, gender: profileDraft.value.gender || '', age: String(profileDraft.value.age || '').trim(), city: String(profileDraft.value.city || '').trim() }); }
function saveQuiz() { if (quizDone.value && constitution.value) emit('save-quiz', { ...quizDraft.value }, constitution.value); }
function saveAi() { emit('save-ai', { ...llmDraft.value }, keyDraft.value.trim()); }
function selectFile(event: Event, kind: 'data' | 'knowledge') {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) { if (kind === 'data') emit('import-data', file); else emit('install-knowledge', file); }
  input.value = '';
}
function confirmReset() {
  if (window.confirm('确定重置全部个人数据吗？茶库、记录、库存、档案与设置会恢复初始状态。请先导出备份。')) emit('reset-data');
}
</script>

<template>
  <section class="settings-view other-page" aria-labelledby="settings-title">
    <div class="settings-heading"><h1 id="settings-title">设置</h1><button class="text-button" type="button" :disabled="busy || syncStatus.needsLogin" @click="emit('logout')">退出登录</button></div>
    <p class="muted">个人档案、推荐偏好与数据管理。每项保存后才会生效。</p>
    <div class="settings-stack">
      <form class="surface settings-card" @submit.prevent="saveProfile"><h2>👤 个人档案</h2><div class="profile-fields"><label for="profile-gender">性别<select id="profile-gender" v-model="profileDraft.gender"><option value="">暂不填写</option><option value="male">男</option><option value="female">女</option></select></label><label for="profile-age">年龄<input id="profile-age" v-model="profileDraft.age" inputmode="numeric" maxlength="3" /></label><label for="profile-city">常驻城市<input id="profile-city" v-model="profileDraft.city" maxlength="100" placeholder="例如：成都" /></label></div><button class="button-primary" :disabled="busy">保存档案</button></form>
      <form class="surface settings-card" @submit.prevent="emit('save-recommend', Number(avoidDays))"><h2>推荐设置</h2><label for="avoid-days">同一款茶连续推荐上限（天）</label><input id="avoid-days" v-model.number="avoidDays" type="number" min="1" max="30" required /><p class="settings-help">默认 5 天，第 6 天会暂时排除。</p><button class="button-primary" :disabled="busy">保存推荐设置</button></form>
      <details class="surface settings-card constitution-card"><summary>🏥 体质辨识 · {{ state.profile.constitution || '尚未辨识' }}</summary><p class="muted">五个问题用于调整推荐权重，不是医学诊断。已保存：{{ state.profile.constitution || '尚未辨识' }}</p><div v-for="(question, index) in questions" :key="index" class="quiz-question"><h3>{{ index + 1 }}. {{ question[0] }}</h3><div class="quiz-options"><label v-for="(option, optionIndex) in question[1]" :key="option"><input v-model.number="quizDraft[index]" type="radio" :name="`quiz-${index}`" :value="optionIndex - 1" />{{ option }}</label></div></div><p v-if="constitution" class="quiz-result">结果：{{ constitution }} · {{ constitutionHint }}</p><p v-else-if="state.profile.constitution" class="quiz-result">{{ constitutionHint }}</p><button class="button-primary" :disabled="busy || !quizDone" @click="saveQuiz">保存体质结果</button></details>
      <form class="surface settings-card" @submit.prevent="saveAi"><h2>🧠 AI 配置</h2><p class="settings-help">不配置也能使用本地规则推荐。密钥只在服务器加密保存。</p><label class="switch-row"><span>深度推荐</span><input v-model="llmDraft.enabled" type="checkbox" /></label><label class="switch-row"><span>智能解析输入</span><input v-model="llmDraft.parserEnabled" type="checkbox" /></label><label class="switch-row"><span>新品饮笔记分析</span><input v-model="llmDraft.noteAnalysisEnabled" type="checkbox" /></label><label class="switch-row"><span>两阶段推荐（实验）</span><input v-model="llmDraft.twoStageRecommendationEnabled" type="checkbox" /></label><label for="endpoint">API 端点</label><input id="endpoint" v-model="llmDraft.endpoint" type="url" placeholder="https://…/v1" /><label for="rec-model">推荐模型</label><input id="rec-model" v-model="llmDraft.recModel" /><label for="parser-model">解析模型</label><input id="parser-model" v-model="llmDraft.parserModel" /><label for="api-key">API Key · {{ llmDraft.apiKeyConfigured ? '已配置，留空保持不变' : '尚未配置' }}</label><input id="api-key" v-model="keyDraft" type="password" autocomplete="off" placeholder="仅更换时填写" /><button class="button-primary" :disabled="busy">保存 AI 设置</button></form>
      <div class="surface settings-card"><h2>💾 数据管理</h2><p class="muted">当前数据保存在你的服务器。导出文件不包含 AI Key；请妥善保管。</p><div class="settings-actions"><button class="button-secondary" :disabled="busy" @click="emit('refresh-state')">{{ busy ? '正在刷新…' : '刷新服务器数据' }}</button><button class="button-secondary" :disabled="busy" @click="emit('export-data')">导出 JSON</button><button class="button-secondary" :disabled="busy" @click="importInput?.click()">导入 PWA 数据</button><input ref="importInput" class="sr-only" type="file" accept=".json,application/json" @change="selectFile($event, 'data')" /></div><p class="settings-help">旧小程序数据的一次性导入将在步骤六处理。当前入口只接受本应用导出的 JSON。</p><h3>基础知识包 · {{ state.knowledgeBase?.catalogVersion || '内置目录' }}</h3><p class="muted">安装只替换基础画像，不改个人记录和补录。</p><div class="settings-actions"><button class="button-secondary" :disabled="busy" @click="knowledgeInput?.click()">安装知识包</button><button class="button-secondary" :disabled="busy || !state.knowledgeBaseBackup" @click="emit('rollback-knowledge')">恢复上一版</button><input ref="knowledgeInput" class="sr-only" type="file" accept=".json,application/json" @change="selectFile($event, 'knowledge')" /></div><h3>重置全部数据</h3><p class="muted">恢复初始茶库并清除个人记录、库存和设置。操作前请先导出备份。</p><button class="button-secondary" :disabled="busy" @click="confirmReset">重置全部数据</button></div>
      <details class="surface settings-card diagnostics-card"><summary>🩺 运行状态与诊断</summary><div class="diagnostics-content"><p>{{ connectionLabel }} · 当前数据版本 {{ revision }}</p><p class="muted">{{ state.teaLibrary.length }} 款茶、{{ state.history.length }} 条记录、{{ state.inventory?.length || 0 }} 条库存。</p><p>待同步 {{ syncStatus.pending }} 项</p><p class="settings-help">最近同步：{{ lastSyncedLabel }}</p><p v-if="!offlineCapable" class="settings-help">Service Worker 或本地离线存储不可用，离线冷启动可能无法工作。</p><p v-if="syncStatus.failure" class="settings-help" role="status">{{ syncStatus.failure }}</p><button v-if="syncStatus.pending && !syncStatus.needsLogin" class="button-secondary" :disabled="busy || syncStatus.syncing" @click="emit('retry-sync')">{{ syncStatus.syncing ? '正在补交…' : '重试待同步操作' }}</button><p v-else-if="syncStatus.needsLogin && syncStatus.pending" class="settings-help">请在页面顶部重新登录；队列会按原顺序继续补交。</p><button class="button-secondary" :disabled="busy || offline" @click="emit('refresh-state')">刷新服务器状态</button></div></details>
    </div>
  </section>
</template>

<style scoped>
.settings-view{width:min(calc(100% - 2.5rem),64rem);margin-inline:auto;padding:1.25rem 0 7rem}.settings-heading{display:flex;align-items:center;justify-content:space-between}.settings-heading h1{margin:0;color:var(--ink-2,#5f5045);font-family:var(--font-serif,Georgia,serif);font-size:1.65rem;font-weight:550}.settings-view>p{margin:.3rem 0 1rem;font-size:.82rem}.settings-stack{display:grid;gap:.8rem}.settings-card{display:grid;gap:.65rem;padding:1rem 1.05rem}.settings-card h2{margin:0 0 .15rem;color:var(--ink-2,#5f5045);font-size:.95rem;font-weight:600}.settings-card h3{margin:.3rem 0 0;color:var(--ink-2,#5f5045);font-size:.82rem}.settings-card input:not([type=checkbox]):not([type=radio]),.settings-card select{width:100%;min-height:2.55rem;border:1px solid var(--card-border,rgba(222,130,96,.2));border-radius:.7rem;padding:.48rem .7rem;background:var(--cream,#fff9f1);color:var(--ink,#403a35);font:inherit}.settings-card label{font-size:.8rem;color:var(--ink-3,#9a877b)}.settings-card .button-primary,.settings-card .button-secondary{justify-self:start}.profile-fields{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.profile-fields label:last-child{grid-column:1/-1}.settings-actions{display:flex;flex-wrap:wrap;gap:.5rem}.settings-help{font-size:.78rem;color:var(--ink-3,#9a877b);line-height:1.5}.settings-card>.muted{margin:0;font-size:.8rem;line-height:1.55}.quiz-question{border-top:1px solid var(--card-border,rgba(222,130,96,.2));padding-top:.7rem}.quiz-question h3{font-size:.88rem;margin:.1rem 0 .55rem}.quiz-options{display:flex;flex-wrap:wrap;gap:.4rem}.quiz-options label{display:inline-flex;align-items:center;gap:.3rem;border:1px solid var(--card-border,rgba(222,130,96,.2));border-radius:999px;padding:.4rem .65rem;cursor:pointer;color:var(--ink-2,#64574c)}.quiz-result{margin:0;padding:.65rem;border-radius:.7rem;background:var(--sage-soft,#e8efe5);color:var(--sage-deep,#557052)}.switch-row{display:flex;align-items:center;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--card-border,rgba(222,130,96,.15))}.diagnostics-card{display:block}.diagnostics-card summary{cursor:pointer;color:var(--ink-2,#64574c);font-size:.9rem;font-weight:600}.diagnostics-content{display:grid;gap:.55rem;padding-top:.85rem}.diagnostics-content p{margin:0}.constitution-card{display:block}.constitution-card summary{font-size:.95rem;font-weight:600;color:var(--ink-2);cursor:pointer}.constitution-card>.muted{margin-top:.6rem}.constitution-card>.button-primary{margin-top:.7rem}.danger-card{border-color:rgba(201,107,76,.35)}
:global(.home-shell.phase-night) .settings-help{color:#c0c6bb}:global(.home-shell.phase-night) .quiz-result{color:#34483b}
@media(min-width:760px){.settings-stack{gap:.9rem}.settings-card{padding:1.15rem 1.25rem}}
@media(max-width:520px){.settings-view{width:min(calc(100% - 2.5rem),64rem)}.profile-fields{gap:.45rem}}
</style>
