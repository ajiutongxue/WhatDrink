<script setup lang="ts">
import { computed, ref, watch } from 'vue';

type Profile = { gender?: string; age?: string; city?: string; constitution?: string | null; quizAnswers?: Record<string, number> };
type Llm = { enabled: boolean; endpoint: string; recModel: string; parserModel: string; parserEnabled: boolean; noteAnalysisEnabled: boolean; twoStageRecommendationEnabled: boolean; apiKeyConfigured?: boolean };
type SettingsState = { profile: Profile; settings: { avoidDays: number }; llm: Llm; teaLibrary: unknown[]; history: unknown[]; inventory?: unknown[]; knowledgeBase?: { catalogVersion?: string } | null; knowledgeBaseBackup?: unknown };

const props = defineProps<{ state: SettingsState; revision: number; busy: boolean }>();
const emit = defineEmits<{
  'save-profile': [profile: Profile]; 'save-quiz': [quizAnswers: Record<string, number>, constitution: string];
  'save-recommend': [avoidDays: number]; 'save-ai': [llm: Llm, key: string];
  'refresh-state': []; 'export-data': []; 'import-data': [file: File];
  'install-knowledge': [file: File]; 'rollback-knowledge': []; 'reset-data': [];
}>();

const section = ref<'default' | 'quiz' | 'ai' | 'data' | 'diagnostics'>('default');
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
    <p class="eyebrow">PREFERENCES</p><h1 id="settings-title">设置</h1>
    <p class="muted">个人档案、推荐偏好与数据管理。每项保存后才会生效。</p>
    <div class="settings-subnav" aria-label="设置分区">
      <button v-for="item in ([['default','档案'],['quiz','体质'],['ai','AI'],['data','数据'],['diagnostics','运行状态']] as const)" :key="item[0]" type="button" :class="{ active: section === item[0] }" @click="section = item[0]">{{ item[1] }}</button>
    </div>

    <div v-if="section === 'default'" class="settings-stack">
      <form class="surface settings-card" @submit.prevent="saveProfile"><h2>个人档案</h2><label for="profile-gender">性别</label><select id="profile-gender" v-model="profileDraft.gender"><option value="">暂不填写</option><option value="male">男</option><option value="female">女</option></select><label for="profile-age">年龄</label><input id="profile-age" v-model="profileDraft.age" inputmode="numeric" maxlength="3" /><label for="profile-city">常驻城市</label><input id="profile-city" v-model="profileDraft.city" maxlength="100" placeholder="例如：成都" /><button class="button-primary" :disabled="busy">保存档案</button></form>
      <form class="surface settings-card" @submit.prevent="emit('save-recommend', Number(avoidDays))"><h2>推荐设置</h2><label for="avoid-days">同一款茶连续推荐上限（天）</label><input id="avoid-days" v-model.number="avoidDays" type="number" min="1" max="30" required /><p class="settings-help">默认 5 天，第 6 天会暂时排除。</p><button class="button-primary" :disabled="busy">保存推荐设置</button></form>
    </div>

    <div v-else-if="section === 'quiz'" class="surface settings-card"><h2>体质辨识</h2><p class="muted">五个问题用于调整推荐权重，不是医学诊断。</p><div v-for="(question, index) in questions" :key="index" class="quiz-question"><h3>{{ index + 1 }}. {{ question[0] }}</h3><div class="quiz-options"><label v-for="(option, optionIndex) in question[1]" :key="option"><input v-model.number="quizDraft[index]" type="radio" :name="`quiz-${index}`" :value="optionIndex - 1" />{{ option }}</label></div></div><p v-if="constitution" class="quiz-result">结果：{{ constitution }} · {{ constitutionHint }}</p><p v-else-if="state.profile.constitution" class="quiz-result">已保存：{{ state.profile.constitution }} · {{ constitutionHint }}</p><button class="button-primary" :disabled="busy || !quizDone" @click="saveQuiz">保存体质结果</button></div>

    <form v-else-if="section === 'ai'" class="surface settings-card" @submit.prevent="saveAi"><h2>AI 服务</h2><p class="settings-help">不配置也能使用本地规则推荐。密钥只在服务器加密保存。</p><label class="switch-row"><span>深度推荐</span><input v-model="llmDraft.enabled" type="checkbox" /></label><label class="switch-row"><span>智能解析输入</span><input v-model="llmDraft.parserEnabled" type="checkbox" /></label><label class="switch-row"><span>新品饮笔记分析</span><input v-model="llmDraft.noteAnalysisEnabled" type="checkbox" /></label><label class="switch-row"><span>两阶段推荐</span><input v-model="llmDraft.twoStageRecommendationEnabled" type="checkbox" /></label><label for="endpoint">API 端点</label><input id="endpoint" v-model="llmDraft.endpoint" type="url" placeholder="https://…/v1" /><label for="rec-model">推荐模型</label><input id="rec-model" v-model="llmDraft.recModel" /><label for="parser-model">解析模型</label><input id="parser-model" v-model="llmDraft.parserModel" /><label for="api-key">API Key · {{ llmDraft.apiKeyConfigured ? '已配置，留空保持不变' : '尚未配置' }}</label><input id="api-key" v-model="keyDraft" type="password" autocomplete="off" placeholder="仅更换时填写" /><button class="button-primary" :disabled="busy">保存 AI 设置</button></form>

    <div v-else-if="section === 'data'" class="settings-stack"><div class="surface settings-card"><h2>数据管理</h2><p class="muted">当前数据保存在你的服务器。导出文件不包含 AI Key；请妥善保管。</p><div class="settings-actions"><button class="button-secondary" :disabled="busy" @click="emit('refresh-state')">{{ busy ? '正在刷新…' : '刷新服务器数据' }}</button><button class="button-secondary" :disabled="busy" @click="emit('export-data')">导出 JSON</button><button class="button-secondary" :disabled="busy" @click="importInput?.click()">导入 PWA 数据</button><input ref="importInput" class="sr-only" type="file" accept=".json,application/json" @change="selectFile($event, 'data')" /></div><p class="settings-help">旧小程序数据的一次性导入将在步骤六处理。当前入口只接受本应用导出的 JSON。</p></div><div class="surface settings-card"><h2>基础知识包</h2><p class="muted">当前版本：{{ state.knowledgeBase?.catalogVersion || '内置目录' }}。安装只替换基础画像，不改个人记录和补录。</p><div class="settings-actions"><button class="button-secondary" :disabled="busy" @click="knowledgeInput?.click()">安装知识包</button><button class="button-secondary" :disabled="busy || !state.knowledgeBaseBackup" @click="emit('rollback-knowledge')">恢复上一版</button><input ref="knowledgeInput" class="sr-only" type="file" accept=".json,application/json" @change="selectFile($event, 'knowledge')" /></div></div><div class="surface settings-card danger-card"><h2>重置全部数据</h2><p class="muted">恢复初始茶库并清除个人记录、库存和设置。操作前请先导出备份。</p><button class="button-secondary" :disabled="busy" @click="confirmReset">重置全部数据</button></div></div>

    <div v-else class="surface settings-card"><h2>运行状态</h2><p>已连接服务器 · 当前数据版本 {{ revision }}</p><p class="muted">{{ state.teaLibrary.length }} 款茶、{{ state.history.length }} 条记录、{{ state.inventory?.length || 0 }} 条库存。</p><p class="settings-help">离线同步和待补交队列将在步骤五提供；这里不显示模拟日志。</p><button class="button-secondary" :disabled="busy" @click="emit('refresh-state')">刷新状态</button></div>
  </section>
</template>

<style scoped>
.settings-view{max-width:64rem;margin-inline:auto}.settings-subnav{display:flex;gap:.45rem;overflow-x:auto;padding:.7rem 0 1rem}.settings-subnav button{border:1px solid rgba(65,83,66,.17);border-radius:999px;background:rgba(255,255,255,.75);padding:.5rem .85rem;white-space:nowrap;color:inherit;cursor:pointer}.settings-subnav button.active{background:#314d40;color:#fff}.settings-stack{display:grid;gap:1rem}.settings-card{display:grid;gap:.65rem}.settings-card h2{margin:0 0 .35rem}.settings-card input:not([type=checkbox]):not([type=radio]),.settings-card select{width:100%;min-height:2.8rem;border:1px solid #c9cfc6;border-radius:.7rem;padding:.5rem .75rem;background:#fff;color:#24372a;font:inherit}.settings-card label{font-size:.92rem}.settings-card .button-primary,.settings-card .button-secondary{justify-self:start}.settings-actions{display:flex;flex-wrap:wrap;gap:.6rem}.settings-help{font-size:.84rem;color:#617166;line-height:1.5}.quiz-question{border-top:1px solid #dfe5dc;padding-top:.8rem}.quiz-question h3{font-size:1rem;margin:.15rem 0 .65rem}.quiz-options{display:flex;flex-wrap:wrap;gap:.5rem}.quiz-options label{display:inline-flex;align-items:center;gap:.35rem;border:1px solid #c9cfc6;border-radius:999px;padding:.45rem .75rem;cursor:pointer}.quiz-result{padding:.8rem;border-radius:.7rem;background:#eef4ea}.danger-card{border-color:#d6b7ae}@media(min-width:760px){.settings-stack{grid-template-columns:repeat(2,minmax(0,1fr))}.danger-card{grid-column:1/-1}}
:global(.phase-night) .settings-subnav button:not(.active){color:#34483b}:global(.phase-night) .settings-help{color:#c0c6bb}:global(.phase-night) .quiz-result{color:#34483b}
</style>
