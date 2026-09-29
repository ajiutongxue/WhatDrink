<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  adjustNature,
  consumeInventorySession,
  deleteInventoryItem,
  finishInventoryItem,
  listInventory,
  openInventoryItem,
  TEAS as builtInTeas,
  teaCatalog,
  validateInventoryItem,
} from './logic/index.js';
import knowledgeContractJson from '../../data/tea-knowledge.contract.json';

type Tea = {
  id: number;
  name: string;
  brand?: string;
  cat: string;
  year?: number | null;
  nature?: string;
  baseNature?: string;
  caffeine?: string;
  seasons?: string[];
  avoidSeasons?: string[];
  note?: string;
  disabled?: boolean;
};
type KnowledgeField = {
  value: unknown;
  status: string;
  sourceType: string;
  confidence: number;
  updatedAt?: number;
  sourceRefs?: string[];
  evidence?: string;
};
type KnowledgeOverride = {
  teaId: number;
  patch: Record<string, KnowledgeField>;
  lockedPaths: string[];
  tombstones: Record<string, number>;
  updatedAt: number;
};
type InventoryItem = {
  id: string;
  teaId: number;
  packageType: string;
  packageLabel?: string;
  sku?: string;
  purchaseUrl?: string;
  status: string;
  quantity: number;
  netWeightPerUnit?: number;
  remainingWeight?: number;
  remainingSessions?: number;
  openedAt?: number;
  note?: string;
  updatedAt: number;
  deletedAt?: number;
};
type AppState = {
  teaLibrary: Tea[];
  temporaryAvoids?: Record<string, unknown>;
  knowledgeBase?: {
    profilesByTeaId?: Record<string, unknown>;
    withheldTeaIds?: number[];
  } | null;
  knowledgeOverrides?: Record<string, unknown>;
  inventory?: unknown[];
  history?: Array<{ teaId: number; teaName?: string; date?: string }>;
};
type ContractField = { type: string; requiredValue?: boolean; min?: number; max?: number; values?: string[]; description?: string };
type KnowledgeContract = {
  sections: Record<string, Record<string, ContractField>>;
  knowledgeStatuses: string[];
  sourceTypes: string[];
};
type TeaForm = {
  name: string;
  brand: string;
  cat: string;
  year: string;
  nature: string;
  caffeine: string;
  note: string;
};
type InventoryForm = {
  id: string | null;
  packageType: string;
  packageLabel: string;
  status: string;
  quantity: string;
  netWeightPerUnit: string;
  remainingWeight: string;
  remainingSessions: string;
  sku: string;
  purchaseUrl: string;
  note: string;
};

const props = defineProps<{ state: AppState; busy: boolean }>();
const emit = defineEmits<{
  (event: 'save-library', teas: Tea[]): void;
  (event: 'set-avoid', payload: { teaId: number; active: boolean }): void;
  (event: 'save-override', payload: { teaId: number; override: KnowledgeOverride }): void;
  (event: 'save-inventory', items: InventoryItem[]): void;
}>();

const contract = knowledgeContractJson as KnowledgeContract;
const catalog = teaCatalog as unknown as {
  CAT_NAMES: Record<string, string>;
  CAT_DEFAULTS: Record<string, { baseNature: string; caffeine: string; seasons: string[]; avoidSeasons?: string[] }>;
};
const sectionLabels: Record<string, string> = {
  identity: '基本资料', origin: '原料产地', craft: '制作工艺', sensory: '风味画像',
  effects: '个人体感', context: '适饮场景', brew: '冲泡方式',
};
const fieldLabels: Record<string, string> = {
  displayName: '规范名称', brand: '品牌', category: '茶类', year: '年份', productCode: '产品码', packagingVariant: '包装版本', form: '成品形态',
  region: '产区', cultivar: '品种', materialGrade: '原料等级', harvestSeason: '采摘季节',
  processTags: '工艺标签', roastLevel: '焙火程度', compression: '紧压程度', agingState: '陈化阶段',
  aromaTags: '香气标签', flavorTags: '滋味标签', aromaIntensity: '香气强度', sweetness: '甜度', bitterness: '苦度', astringency: '涩度', body: '厚度', smoothness: '顺滑度', aftertaste: '回甘余韵', durability: '耐泡度',
  stimulation: '提神强度', emptyStomachFriendliness: '空腹友好度', sleepImpact: '睡眠影响',
  bestSeasons: '适合季节', bestTimes: '适合时段', vessels: '推荐器具', waterTempC: '水温范围', gramsPer100ml: '每100ml投茶量', firstSteepSeconds: '首泡时间', difficulty: '冲泡难度',
};
const statusLabels: Record<string, string> = {
  confirmed: '已确认', researched: '已查证', inherited: '类别继承', inferred: '模型推测',
  personal: '个人记录', conflicted: '存在冲突', unknown: '待补充',
};
const sourceLabels: Record<string, string> = {
  user: '用户', package: '实物包装', purchase: '购买记录', official: '官方', retailer: '零售页面',
  community: '茶友资料', category_default: '茶类默认', llm: '模型推测', unknown: '未知',
};
const packageTypes = [
  { key: 'sample', label: '试饮装' }, { key: 'retail', label: '正装' }, { key: 'split', label: '分装' },
  { key: 'gift', label: '礼盒拆分' }, { key: 'custom', label: '自定义' }, { key: 'unknown', label: '未知' },
];
const inventoryStatuses = [
  { key: 'sealed', label: '未开封' }, { key: 'opened', label: '已开封' },
  { key: 'finished', label: '已喝完' }, { key: 'unknown', label: '待确认' },
];
const categoryFilters = [
  { key: 'all', label: '全部' }, { key: 'green', label: '绿茶' }, { key: 'black', label: '红茶' },
  { key: 'white', label: '白茶' }, { key: 'oolong', label: '乌龙' }, { key: 'puerh_raw', label: '生普' },
  { key: 'puerh_ripe', label: '熟普' }, { key: 'flavored', label: '调味' },
];
const categoryMap: Record<string, string[]> = {
  green: ['green'], black: ['black'], white: ['white'],
  oolong: ['oolong_tieguanyin', 'oolong_wuyi', 'oolong_dancong'],
  puerh_raw: ['puerh_raw'], puerh_ripe: ['puerh_ripe'],
  flavored: ['flavored_jasmine', 'flavored_other'],
};
const categoryOptions = Object.entries(catalog.CAT_NAMES).map(([key, label]) => ({ key, label }));
const natureOptions = ['寒', '凉', '平', '温', '热'];
const caffeineOptions = ['高', '中', '低'];

const filterKey = ref('all');
const query = ref('');
const manageMode = ref(false);
const notice = ref('');
const formError = ref('');
const teaFormOpen = ref(false);
const editingTeaId = ref<number | null>(null);
const teaForm = ref<TeaForm>(emptyTeaForm());
const formAvoidActive = ref(false);
const knowledgeTeaId = ref<number | null>(null);
const knowledgeEditPath = ref('');
const knowledgeInput = ref('');
const knowledgeLocked = ref(false);
const knowledgeError = ref('');
const inventoryForm = ref<InventoryForm | null>(null);
const inventoryError = ref('');

function emptyTeaForm(cat = 'green'): TeaForm {
  const defaults = catalog.CAT_DEFAULTS[cat] || catalog.CAT_DEFAULTS.green;
  return { name: '', brand: '', cat, year: '', nature: defaults.baseNature, caffeine: defaults.caffeine, note: '' };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function categoryName(cat: string) { return catalog.CAT_NAMES[cat] || cat || '未分类'; }
function teaAvoidActive(teaId: number) {
  const avoid = props.state.temporaryAvoids?.[String(teaId)] as { active?: boolean; expiresAt?: number } | undefined;
  return avoid?.active === true && Number(avoid.expiresAt) > Date.now();
}
function teaInventory(teaId: number) {
  return listInventory((props.state.inventory || []) as InventoryItem[], teaId) as InventoryItem[];
}
function inventorySummary(teaId: number) {
  const rows = teaInventory(teaId).filter((item) => item.status !== 'finished');
  const opened = rows.filter((item) => item.status === 'opened').length;
  const sealed = rows.filter((item) => item.status === 'sealed').reduce((total, item) => total + item.quantity, 0);
  const unknown = rows.filter((item) => item.status === 'unknown').length;
  return [opened ? `已开 ${opened}` : '', sealed ? `未开 ${sealed}` : '', unknown ? `待确认 ${unknown}` : ''].filter(Boolean).join(' · ') || '库存未记录';
}
function personalFieldCount(teaId: number) {
  return Object.keys(overrideForTea(teaId)?.patch || {}).length;
}
function profileSummary(teaId: number) {
  const profile = profileForTea(teaId);
  if (!profile) return personalFieldCount(teaId) ? `个人补录 ${personalFieldCount(teaId)} 项` : '基础身份';
  const completeness = Number((profile.research as { completeness?: number } | undefined)?.completeness || 0);
  return `画像 ${Math.round(completeness * 100)}%${personalFieldCount(teaId) ? ` · 个人补录 ${personalFieldCount(teaId)} 项` : ''}`;
}
function overrideForTea(teaId: number) {
  const value = props.state.knowledgeOverrides?.[String(teaId)];
  return value && typeof value === 'object' ? value as KnowledgeOverride : null;
}
function profileForTea(teaId: number) {
  const value = props.state.knowledgeBase?.profilesByTeaId?.[String(teaId)];
  return value && typeof value === 'object' ? value as Record<string, any> : null;
}

const visibleTeas = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  return (props.state.teaLibrary || []).filter((tea) => {
    const categories = categoryMap[filterKey.value];
    if (categories && !categories.includes(tea.cat)) return false;
    if (!text) return true;
    return `${tea.name} ${tea.brand || ''} ${categoryName(tea.cat)}`.toLocaleLowerCase().includes(text);
  });
});
const groupedTeas = computed(() => {
  const groups = new Map<string, Tea[]>();
  visibleTeas.value.forEach((tea) => {
    if (!groups.has(tea.cat)) groups.set(tea.cat, []);
    groups.get(tea.cat)!.push(tea);
  });
  return [...groups.entries()].map(([cat, teas]) => ({ cat, label: categoryName(cat), teas }));
});
const disabledCount = computed(() => (props.state.teaLibrary || []).filter((tea) => tea.disabled).length);
const activeKnowledgeTea = computed(() => props.state.teaLibrary.find((tea) => tea.id === knowledgeTeaId.value) || null);
const activeProfile = computed(() => knowledgeTeaId.value == null ? null : profileForTea(knowledgeTeaId.value));
const activeOverride = computed(() => knowledgeTeaId.value == null ? null : overrideForTea(knowledgeTeaId.value));
const hasBaseProfile = computed(() => !!activeProfile.value);
const activeCompleteness = computed(() => Math.round(Number((activeProfile.value?.research as { completeness?: number } | undefined)?.completeness || 0) * 100));
const knowledgeSections = computed(() => {
  const tea = activeKnowledgeTea.value;
  if (!tea) return [];
  const profile = activeProfile.value;
  const override = activeOverride.value;
  return Object.entries(contract.sections).map(([section, definitions]) => ({
    key: section,
    label: sectionLabels[section] || section,
    fields: Object.entries(definitions).map(([fieldName, definition]) => {
      const path = `${section}.${fieldName}`;
      let base = (profile?.[section] as Record<string, KnowledgeField> | undefined)?.[fieldName] || null;
      if ((!base || base.value === null || base.value === undefined || base.value === '') && section === 'identity') {
        base = identityField(tea, fieldName);
      }
      const isOverridden = !!override?.patch && Object.prototype.hasOwnProperty.call(override.patch, path);
      const field = isOverridden ? override!.patch[path] : (base || unknownField());
      return {
        path, fieldName, label: fieldLabels[fieldName] || fieldName, definition,
        field, isOverridden, locked: !!override?.lockedPaths?.includes(path),
        base: base || unknownField(),
      };
    }),
  }));
});
const selectedKnowledgeField = computed(() => knowledgeSections.value.flatMap((section) => section.fields).find((field) => field.path === knowledgeEditPath.value) || null);
const inventoryRows = computed(() => knowledgeTeaId.value == null ? [] : teaInventory(knowledgeTeaId.value));
const knowledgeWithheld = computed(() => knowledgeTeaId.value != null && !!props.state.knowledgeBase?.withheldTeaIds?.includes(knowledgeTeaId.value));

function unknownField(): KnowledgeField {
  return { value: null, status: 'unknown', sourceType: 'unknown', confidence: 0 };
}
function identityField(tea: Tea, name: string): KnowledgeField | null {
  const key: Record<string, keyof Tea> = { displayName: 'name', brand: 'brand', category: 'cat', year: 'year' };
  const value = tea[key[name]];
  if (value === null || value === undefined || value === '') return null;
  return { value, status: 'confirmed', sourceType: 'user', confidence: 1, updatedAt: 1, evidence: '来自当前茶库基础信息；不是联网查证结果' };
}
function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '待补充';
  if (Array.isArray(value)) return value.length ? value.join('、') : '待补充';
  if (typeof value === 'object' && value !== null && 'min' in value && 'max' in value) {
    const range = value as { min: number; max: number };
    return `${range.min} ～ ${range.max}`;
  }
  return String(value);
}
function inputValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object' && value !== null && 'min' in value && 'max' in value) {
    const range = value as { min: number; max: number };
    return `${range.min}-${range.max}`;
  }
  return String(value);
}
function fieldHint(definition: ContractField) {
  if (definition.type === 'string_array') return '多个值请用顿号或逗号分隔';
  if (definition.type === 'number_range') return '请输入最小值-最大值';
  if (definition.type === 'scale_0_5') return '请输入 0 到 5';
  if (definition.type === 'enum') return '请选择一个允许的值';
  if (definition.type === 'integer') return '请输入整数';
  if (definition.type === 'number') return '请输入非负数字';
  return '请输入内容';
}

function openAddTea() {
  editingTeaId.value = null;
  teaForm.value = emptyTeaForm();
  formAvoidActive.value = false;
  formError.value = '';
  teaFormOpen.value = true;
}
function openEditTea(tea: Tea) {
  editingTeaId.value = tea.id;
  teaForm.value = {
    name: tea.name, brand: tea.brand || '', cat: tea.cat,
    year: tea.year ? String(tea.year) : '', nature: tea.nature || tea.baseNature || '平',
    caffeine: tea.caffeine || '中', note: tea.note || '',
  };
  formAvoidActive.value = teaAvoidActive(tea.id);
  formError.value = '';
  teaFormOpen.value = true;
}
function setTeaCategory(cat: string) {
  const defaults = catalog.CAT_DEFAULTS[cat];
  if (!defaults) return;
  const year = Number(teaForm.value.year) || null;
  teaForm.value.cat = cat;
  teaForm.value.caffeine = defaults.caffeine;
  teaForm.value.nature = adjustNature(cat, year, defaults.baseNature);
}
function updateTeaYear() {
  const defaults = catalog.CAT_DEFAULTS[teaForm.value.cat];
  if (defaults) teaForm.value.nature = adjustNature(teaForm.value.cat, Number(teaForm.value.year) || null, defaults.baseNature);
}
function saveTea() {
  const form = teaForm.value;
  const name = form.name.trim();
  if (!name) { formError.value = '请输入茶名。'; return; }
  const yearText = form.year.trim();
  const year = yearText ? Number(yearText) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) { formError.value = '年份请输入 1900 到 2100 之间的整数。'; return; }
  const defaults = catalog.CAT_DEFAULTS[form.cat];
  if (!defaults || !natureOptions.includes(form.nature) || !caffeineOptions.includes(form.caffeine)) { formError.value = '请检查茶类、茶性和咖啡因选项。'; return; }
  const current = props.state.teaLibrary || [];
  const previous = editingTeaId.value == null ? null : current.find((tea) => tea.id === editingTeaId.value) || null;
  const id = previous?.id ?? allocateTeaId(current);
  if (!Number.isSafeInteger(id) || id < 0) { formError.value = '无法分配有效的茶款编号，请联系维护者检查现有数据。'; return; }
  const tea: Tea = {
    ...(previous ? clone(previous) : {}),
    id,
    name,
    brand: form.brand.trim(),
    cat: form.cat,
    year,
    baseNature: defaults.baseNature,
    nature: form.nature,
    caffeine: form.caffeine,
    seasons: defaults.seasons.slice(),
    avoidSeasons: (defaults.avoidSeasons || []).slice(),
    note: form.note.trim(),
    disabled: previous?.disabled || false,
  };
  const next = previous ? current.map((item) => item.id === tea.id ? tea : item) : [...current, tea];
  emit('save-library', next);
  teaFormOpen.value = false;
  notice.value = previous ? '已提交茶款修改。' : '已提交新茶款。';
}
function cancelTeaForm() { teaFormOpen.value = false; formError.value = ''; }
function allocateTeaId(library: Tea[]) {
  const seen = [
    ...library.map((tea) => tea.id),
    ...(props.state.history || []).map((entry) => entry.teaId),
    ...((props.state.inventory || []) as InventoryItem[]).map((item) => item.teaId),
    ...Object.keys(props.state.knowledgeOverrides || {}).map((key) => Number(key)),
    ...builtInTeas.map((tea) => tea.id),
  ].filter((id): id is number => Number.isInteger(id));
  let candidate = Math.max(Date.now(), (seen.length ? Math.max(...seen) : -1) + 1);
  while (seen.includes(candidate)) candidate += 1;
  return candidate;
}
function toggleTeaDisabled(tea: Tea) {
  const next = props.state.teaLibrary.map((item) => item.id === tea.id ? { ...item, disabled: !item.disabled } : item);
  emit('save-library', next);
  notice.value = tea.disabled ? `已启用「${tea.name}」。` : `已停用「${tea.name}」。`;
}
function deleteTea(tea: Tea) {
  if (props.state.teaLibrary.length <= 1) {
    notice.value = '茶库至少保留一款茶，不能删除最后一款。';
    return;
  }
  const historyCount = (props.state.history || []).filter((entry) => entry.teaId === tea.id).length;
  const overrideCount = personalFieldCount(tea.id);
  const inventoryCount = teaInventory(tea.id).length;
  const impacts = [
    historyCount ? `${historyCount} 条历史记录` : '',
    overrideCount ? `${overrideCount} 项个人画像覆写` : '',
    inventoryCount ? `${inventoryCount} 条活动库存包装` : '',
  ].filter(Boolean);
  const detail = impacts.length
    ? `这款茶关联${impacts.join('、')}。删除后历史记录会保留茶名快照，但不再关联到茶库；个人画像和库存也会失去这款茶的关联。建议停用；确定仍要删除「${tea.name}」吗？`
    : `确定删除「${tea.name}」吗？`;
  if (!window.confirm(detail)) return;
  emit('save-library', props.state.teaLibrary.filter((item) => item.id !== tea.id));
  notice.value = `已提交删除「${tea.name}」。`;
}
function moveTea(tea: Tea, direction: -1 | 1) {
  const next = props.state.teaLibrary.slice();
  const index = next.findIndex((item) => item.id === tea.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target], next[index]];
  emit('save-library', next);
}
function canMove(tea: Tea, direction: -1 | 1) {
  const index = props.state.teaLibrary.findIndex((item) => item.id === tea.id);
  return index >= 0 && index + direction >= 0 && index + direction < props.state.teaLibrary.length;
}
function toggleAvoid(tea: Tea) {
  const active = !formAvoidActive.value;
  formAvoidActive.value = active;
  emit('set-avoid', { teaId: tea.id, active });
  notice.value = active ? `30 天内不再推荐「${tea.name}」。` : `已恢复「${tea.name}」的推荐。`;
}

function openKnowledge(tea: Tea) {
  knowledgeTeaId.value = tea.id;
  knowledgeEditPath.value = '';
  knowledgeError.value = '';
  inventoryError.value = '';
  inventoryForm.value = null;
}
function closeKnowledge() {
  knowledgeTeaId.value = null;
  knowledgeEditPath.value = '';
  inventoryForm.value = null;
}
function editKnowledgeField(path: string) {
  const row = knowledgeSections.value.flatMap((section) => section.fields).find((field) => field.path === path);
  if (!row) return;
  knowledgeEditPath.value = path;
  knowledgeInput.value = inputValue(row.field.value);
  knowledgeLocked.value = !!row.locked;
  knowledgeError.value = '';
}
function parseKnowledgeValue(raw: string, definition: ContractField): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return definition.requiredValue ? { ok: false, error: '必填字段不能清空，请输入值。' } : { ok: true, value: null };
  if (definition.type === 'string') return { ok: true, value: text };
  if (definition.type === 'string_array') {
    const values = text.split(/[、,，]/).map((part) => part.trim()).filter(Boolean);
    return { ok: true, value: values.length ? values : null };
  }
  if (definition.type === 'enum') return definition.values?.includes(text) ? { ok: true, value: text } : { ok: false, error: '请选择允许的枚举值。' };
  if (definition.type === 'number_range') {
    const parts = text.split(/[-~～至,，]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(Number(part)))) return { ok: false, error: '范围格式应为最小值-最大值。' };
    const [min, max] = parts.map(Number);
    if (min > max || min < (definition.min ?? -Infinity) || max > (definition.max ?? Infinity)) return { ok: false, error: '范围超出允许区间。' };
    return { ok: true, value: { min, max } };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: '请输入有效数字。' };
  if (definition.type === 'integer' && !Number.isInteger(value)) return { ok: false, error: '请输入整数。' };
  if (value < (definition.min ?? -Infinity) || value > (definition.max ?? Infinity)) return { ok: false, error: '数值超出允许区间。' };
  return { ok: true, value };
}
function buildOverride(patch: Record<string, KnowledgeField>, lockedPaths: string[], tombstones: Record<string, number>): KnowledgeOverride {
  return {
    teaId: knowledgeTeaId.value!, patch, lockedPaths, tombstones, updatedAt: Date.now(),
  };
}
function saveKnowledgeField() {
  const row = selectedKnowledgeField.value;
  if (!row || knowledgeTeaId.value == null) return;
  const parsed = parseKnowledgeValue(knowledgeInput.value, row.definition);
  if (!parsed.ok) { knowledgeError.value = parsed.error; return; }
  if (parsed.value === null) { clearKnowledgeField(); return; }
  const current = overrideForTea(knowledgeTeaId.value);
  const patch = { ...(current?.patch || {}) };
  patch[row.path] = {
    value: parsed.value, status: 'personal', sourceType: 'user', confidence: 1,
    updatedAt: Date.now(), evidence: '用户手动记录',
  };
  const tombstones = { ...(current?.tombstones || {}) };
  delete tombstones[row.path];
  const lockedPaths = (current?.lockedPaths || []).filter((path) => path !== row.path);
  if (knowledgeLocked.value) lockedPaths.push(row.path);
  emit('save-override', { teaId: knowledgeTeaId.value, override: buildOverride(patch, lockedPaths, tombstones) });
  knowledgeEditPath.value = '';
}
function clearKnowledgeField() {
  const row = selectedKnowledgeField.value;
  if (!row || knowledgeTeaId.value == null || row.definition.requiredValue) return;
  const current = overrideForTea(knowledgeTeaId.value);
  const patch = { ...(current?.patch || {}) };
  patch[row.path] = { value: null, status: 'unknown', sourceType: 'unknown', confidence: 0, updatedAt: Date.now() };
  const tombstones = { ...(current?.tombstones || {}) };
  delete tombstones[row.path];
  const lockedPaths = (current?.lockedPaths || []).filter((path) => path !== row.path);
  if (knowledgeLocked.value) lockedPaths.push(row.path);
  emit('save-override', { teaId: knowledgeTeaId.value, override: buildOverride(patch, lockedPaths, tombstones) });
  knowledgeEditPath.value = '';
}
function restoreKnowledgeField() {
  const row = selectedKnowledgeField.value;
  if (!row || knowledgeTeaId.value == null) return;
  const current = overrideForTea(knowledgeTeaId.value);
  if (!current?.patch || !Object.prototype.hasOwnProperty.call(current.patch, row.path)) { knowledgeEditPath.value = ''; return; }
  const patch = { ...current.patch };
  delete patch[row.path];
  const tombstones = { ...(current.tombstones || {}), [row.path]: Date.now() };
  const lockedPaths = (current.lockedPaths || []).filter((path) => path !== row.path);
  emit('save-override', { teaId: knowledgeTeaId.value, override: buildOverride(patch, lockedPaths, tombstones) });
  knowledgeEditPath.value = '';
}

function openInventoryEditor(item?: InventoryItem) {
  inventoryError.value = '';
  inventoryForm.value = item ? {
    id: item.id, packageType: item.packageType, packageLabel: item.packageLabel || '', status: item.status,
    quantity: String(item.quantity || 1), netWeightPerUnit: item.netWeightPerUnit == null ? '' : String(item.netWeightPerUnit),
    remainingWeight: item.remainingWeight == null ? '' : String(item.remainingWeight),
    remainingSessions: item.remainingSessions == null ? '' : String(item.remainingSessions),
    sku: item.sku || '', purchaseUrl: item.purchaseUrl || '', note: item.note || '',
  } : {
    id: null, packageType: 'custom', packageLabel: '', status: 'sealed', quantity: '1',
    netWeightPerUnit: '', remainingWeight: '', remainingSessions: '', sku: '', purchaseUrl: '', note: '',
  };
}
function optionalNumber(raw: string, integerOnly = false) {
  const text = raw.trim();
  if (!text) return { ok: true as const, value: undefined };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || (integerOnly && !Number.isInteger(value))) {
    return { ok: false as const, error: integerOnly ? '请输入非负整数。' : '请输入非负数字。' };
  }
  return { ok: true as const, value };
}
function saveInventoryItem() {
  const form = inventoryForm.value;
  if (!form || knowledgeTeaId.value == null) return;
  const weight = optionalNumber(form.netWeightPerUnit);
  const remainingWeight = optionalNumber(form.remainingWeight);
  const sessions = optionalNumber(form.remainingSessions, true);
  if (!weight.ok || !remainingWeight.ok || !sessions.ok) {
    inventoryError.value = !weight.ok ? `每份克数：${weight.error}` : !remainingWeight.ok ? `剩余克数：${remainingWeight.error}` : `剩余泡数：${sessions.error}`;
    return;
  }
  const quantity = Number(form.quantity);
  if (form.status === 'sealed' && (!Number.isInteger(quantity) || quantity < 1)) { inventoryError.value = '未开封包装数量应为正整数。'; return; }
  if (remainingWeight.value !== undefined && weight.value !== undefined && remainingWeight.value > weight.value) { inventoryError.value = '剩余克数不能超过每份克数。'; return; }
  if (form.purchaseUrl.trim() && !/^https?:\/\//i.test(form.purchaseUrl.trim())) { inventoryError.value = '购买链接需要以 http:// 或 https:// 开头。'; return; }
  const now = Date.now();
  const previous = form.id ? ((props.state.inventory || []) as InventoryItem[]).find((item) => item.id === form.id && !item.deletedAt) : null;
  const status = form.status;
  const record: InventoryItem = {
    ...(previous ? clone(previous) : {}),
    id: form.id || `inv_${now}_${Math.random().toString(36).slice(2, 8)}`,
    teaId: knowledgeTeaId.value,
    packageType: form.packageType,
    packageLabel: form.packageLabel.trim() || '未命名包装',
    status,
    quantity: status === 'sealed' ? quantity : 1,
    updatedAt: now,
  };
  if (weight.value !== undefined) record.netWeightPerUnit = weight.value; else delete record.netWeightPerUnit;
  if (status === 'sealed') {
    delete record.remainingWeight; delete record.remainingSessions; delete record.openedAt;
  } else {
    if (remainingWeight.value !== undefined) record.remainingWeight = remainingWeight.value; else delete record.remainingWeight;
    if (sessions.value !== undefined) record.remainingSessions = sessions.value; else delete record.remainingSessions;
    record.openedAt = previous?.openedAt || now;
    if (!previous && status === 'opened' && record.remainingWeight === undefined && record.netWeightPerUnit !== undefined) record.remainingWeight = record.netWeightPerUnit;
    if (status === 'opened' && (record.remainingWeight === 0 || record.remainingWeight === undefined) && (record.remainingSessions === 0 || record.remainingSessions === undefined) && (record.remainingWeight !== undefined || record.remainingSessions !== undefined)) {
      record.status = 'finished';
      if (record.remainingWeight !== undefined) record.remainingWeight = 0;
      if (record.remainingSessions !== undefined) record.remainingSessions = 0;
    }
    if (record.status === 'finished') {
      if (record.remainingWeight !== undefined) record.remainingWeight = 0;
      if (record.remainingSessions !== undefined) record.remainingSessions = 0;
    }
  }
  const optionalFields: Array<keyof InventoryItem> = ['sku', 'purchaseUrl', 'note'];
  optionalFields.forEach((key) => {
    const value = key === 'sku' ? form.sku.trim() : key === 'purchaseUrl' ? form.purchaseUrl.trim() : form.note.trim();
    if (value) (record as Record<string, unknown>)[key] = value;
    else delete (record as Record<string, unknown>)[key];
  });
  const validation = validateInventoryItem(record);
  if (!validation.ok) { inventoryError.value = validation.errors.join('；'); return; }
  const current = (props.state.inventory || []) as InventoryItem[];
  const next = previous ? current.map((item) => item.id === previous.id ? record : item) : [...current, record];
  emit('save-inventory', next);
  inventoryForm.value = null;
}
function inventoryAction(action: 'open' | 'consume' | 'finish' | 'delete', item: InventoryItem) {
  const now = Date.now();
  const current = (props.state.inventory || []) as InventoryItem[];
  if (action === 'open' && !window.confirm(`将为「${item.packageLabel || '未命名包装'}」开封一份${item.quantity > 1 ? '，并保留其余未开封数量' : ''}。继续吗？`)) return;
  if (action === 'finish' && !window.confirm('标记为已喝完后，这份包装不再计入现有库存。继续吗？')) return;
  if (action === 'delete' && !window.confirm('删除后会保留同步用的删除标记，确定删除这条包装记录吗？')) return;
  let result: { inventory: InventoryItem[]; result: { ok?: boolean; item?: InventoryItem; split?: boolean; error?: string } };
  if (action === 'open') result = openInventoryItem(current, item.id, { now, createId: (stamp: number) => `inv_${stamp}_${Math.random().toString(36).slice(2, 8)}` }) as typeof result;
  else if (action === 'consume') result = consumeInventorySession(current, item.id, { now }) as typeof result;
  else if (action === 'finish') result = finishInventoryItem(current, item.id, { now }) as typeof result;
  else result = deleteInventoryItem(current, item.id, { now }) as typeof result;
  if (action === 'delete' && typeof result.result === 'boolean') {
    if (!result.result) { inventoryError.value = '找不到这条库存记录。'; return; }
    emit('save-inventory', result.inventory);
    return;
  }
  if (!result.result.ok) { inventoryError.value = result.result.error || '库存操作失败。'; return; }
  inventoryError.value = '';
  emit('save-inventory', result.inventory);
  if (action === 'open') notice.value = result.result.split ? '已开封一份，并拆分出独立记录。' : '已开封。';
  if (action === 'consume') notice.value = result.result.item?.status === 'finished' ? '已扣减一泡，包装已喝完。' : '已扣减一泡。';
  if (action === 'finish') notice.value = '已标记喝完。';
}
function deleteEditingInventory() {
  const id = inventoryForm.value?.id;
  const item = id ? ((props.state.inventory || []) as InventoryItem[]).find((row) => row.id === id && !row.deletedAt) : null;
  if (!item) { inventoryError.value = '找不到这条库存记录。'; return; }
  if (!window.confirm('删除后会保留同步用的删除标记，确定删除这条包装记录吗？')) return;
  const result = deleteInventoryItem((props.state.inventory || []) as InventoryItem[], item.id, { now: Date.now() }) as { inventory: InventoryItem[]; result: boolean };
  if (!result.result) { inventoryError.value = '找不到这条库存记录。'; return; }
  emit('save-inventory', result.inventory);
  inventoryForm.value = null;
}
function lowStock(item: InventoryItem) {
  return item.status === 'opened' && ((Number.isInteger(item.remainingSessions) && (item.remainingSessions || 0) <= 1) || (typeof item.remainingWeight === 'number' && item.remainingWeight <= 5));
}
function inventoryDescription(item: InventoryItem) {
  const type = packageTypes.find((option) => option.key === item.packageType)?.label || item.packageType;
  const status = inventoryStatuses.find((option) => option.key === item.status)?.label || item.status;
  return [type, status, `${item.quantity} 份`, item.netWeightPerUnit != null ? `每份 ${item.netWeightPerUnit}g` : '', item.remainingWeight != null ? `剩余 ${item.remainingWeight}g` : '', item.remainingSessions != null ? `约 ${item.remainingSessions} 泡` : ''].filter(Boolean).join(' · ');
}
</script>

<template>
  <section class="tea-library-page" aria-labelledby="library-title">
    <div class="page-heading">
      <div>
        <p class="eyebrow">YOUR COLLECTION</p>
        <h1 id="library-title">我的茶库</h1>
        <p class="page-subtitle">共 {{ state.teaLibrary.length }} 款茶叶<span v-if="disabledCount"> · {{ disabledCount }} 款已停用</span></p>
      </div>
      <div class="heading-actions">
        <button class="button-primary" type="button" :disabled="busy" @click="openAddTea">＋ 添加</button>
        <button class="button-secondary" type="button" :disabled="busy" @click="manageMode = !manageMode">{{ manageMode ? '完成' : '管理' }}</button>
      </div>
    </div>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <label class="search-box" for="tea-library-search"><span aria-hidden="true">⌕</span><input id="tea-library-search" v-model="query" type="search" placeholder="搜索茶名、品牌或分类" /></label>
    <div class="filter-row" role="group" aria-label="按茶类筛选">
      <button v-for="item in categoryFilters" :key="item.key" class="filter-pill" :class="{ active: filterKey === item.key }" type="button" :aria-pressed="filterKey === item.key" @click="filterKey = item.key">{{ item.label }}</button>
    </div>

    <template v-if="manageMode">
      <div v-if="visibleTeas.length" class="surface tea-list manage-list">
        <article v-for="tea in visibleTeas" :key="tea.id" class="tea-row" :class="{ disabled: tea.disabled }">
          <div class="tea-primary"><h2>{{ tea.name }}</h2><p>{{ categoryName(tea.cat) }} · {{ tea.nature || tea.baseNature || '平' }}<span v-if="tea.year"> · {{ tea.year }}</span></p><p class="tea-subline">{{ profileSummary(tea.id) }} · {{ inventorySummary(tea.id) }}</p></div>
          <div class="row-actions">
            <button class="small-button" type="button" :disabled="busy || !canMove(tea, -1)" aria-label="上移" title="上移" @click="moveTea(tea, -1)">↑</button>
            <button class="small-button" type="button" :disabled="busy || !canMove(tea, 1)" aria-label="下移" title="下移" @click="moveTea(tea, 1)">↓</button>
            <button class="small-button" type="button" :disabled="busy" @click="openEditTea(tea)">编辑</button>
            <button class="small-button" type="button" :disabled="busy" @click="toggleTeaDisabled(tea)">{{ tea.disabled ? '启用' : '停用' }}</button>
            <button class="small-button danger" type="button" :disabled="busy" @click="deleteTea(tea)">删除</button>
          </div>
        </article>
      </div>
      <article v-else class="surface empty-card"><span>🌿</span><p>该分类下暂无茶叶</p><button class="button-secondary" type="button" @click="filterKey = 'all'; query = ''">清除筛选</button></article>
    </template>
    <template v-else>
      <div v-if="groupedTeas.length" class="tea-groups">
        <section v-for="group in groupedTeas" :key="group.cat" class="tea-group">
          <h2 class="group-title">{{ group.label }} <span>{{ group.teas.length }} 款</span></h2>
          <div class="surface tea-list">
            <article v-for="tea in group.teas" :key="tea.id" class="tea-row" :class="{ disabled: tea.disabled }">
              <button class="tea-open" type="button" :disabled="busy" @click="openKnowledge(tea)">
                <span class="tea-primary"><span class="tea-name">{{ tea.name }}</span><span class="tea-meta">{{ tea.brand || '未记录品牌' }}<span v-if="tea.year"> · {{ tea.year }}</span></span><span class="tea-subline">{{ profileSummary(tea.id) }} · {{ inventorySummary(tea.id) }}</span></span>
                <span class="tea-tags"><span class="nature-tag">{{ tea.nature || tea.baseNature || '平' }}</span><span v-if="tea.disabled" class="status-tag">已停用</span><span v-else-if="teaAvoidActive(tea.id)" class="avoid-tag">暂时回避</span></span>
              </button>
              <button class="small-button edit-shortcut" type="button" :disabled="busy" :aria-label="`编辑${tea.name}`" @click="openEditTea(tea)">编辑</button>
            </article>
          </div>
        </section>
      </div>
      <article v-else class="surface empty-card"><span>🌿</span><p>没有找到符合条件的茶叶</p><button class="button-secondary" type="button" @click="filterKey = 'all'; query = ''">清除筛选</button></article>
    </template>

    <div v-if="teaFormOpen" class="modal-mask" @click.self="cancelTeaForm">
      <form class="modal-sheet" aria-labelledby="tea-form-title" @submit.prevent="saveTea">
        <div class="modal-heading"><div><p class="eyebrow">TEA DETAILS</p><h2 id="tea-form-title">{{ editingTeaId == null ? '添加茶叶' : '编辑茶叶' }}</h2></div><button class="icon-button" type="button" aria-label="关闭" @click="cancelTeaForm">×</button></div>
        <label class="field-label" for="tea-name">茶名 *</label><input id="tea-name" v-model="teaForm.name" class="field" maxlength="80" required />
        <label class="field-label" for="tea-brand">品牌</label><input id="tea-brand" v-model="teaForm.brand" class="field" maxlength="80" />
        <label class="field-label" for="tea-cat">茶类</label><select id="tea-cat" class="field" :value="teaForm.cat" @change="setTeaCategory(($event.target as HTMLSelectElement).value)"><option v-for="item in categoryOptions" :key="item.key" :value="item.key">{{ item.label }}</option></select>
        <div class="field-grid"><div><label class="field-label" for="tea-year">年份</label><input id="tea-year" v-model="teaForm.year" class="field" inputmode="numeric" @blur="updateTeaYear" /></div><div><label class="field-label" for="tea-nature">茶性</label><select id="tea-nature" v-model="teaForm.nature" class="field"><option v-for="item in natureOptions" :key="item">{{ item }}</option></select></div></div>
        <label class="field-label" for="tea-caffeine">咖啡因</label><select id="tea-caffeine" v-model="teaForm.caffeine" class="field"><option v-for="item in caffeineOptions" :key="item">{{ item }}</option></select>
        <label class="field-label" for="tea-note">备注</label><textarea id="tea-note" v-model="teaForm.note" class="field" rows="3" maxlength="300" />
        <div v-if="editingTeaId != null" class="avoid-row"><div><strong>暂时不想喝</strong><p>开启后 30 天内不参与推荐</p></div><button class="switch" :class="{ on: formAvoidActive }" type="button" role="switch" :aria-checked="formAvoidActive" :disabled="busy" @click="toggleAvoid(state.teaLibrary.find((tea) => tea.id === editingTeaId)!)"><span /></button></div>
        <p v-if="formError" class="inline-error" role="alert">{{ formError }}</p>
        <div class="modal-actions"><button class="button-secondary" type="button" :disabled="busy" @click="cancelTeaForm">取消</button><button class="button-primary" type="submit" :disabled="busy">保存</button></div>
      </form>
    </div>

    <div v-if="knowledgeTeaId != null && activeKnowledgeTea" class="modal-mask" @click.self="closeKnowledge">
      <section class="modal-sheet knowledge-sheet" aria-labelledby="knowledge-title">
        <div class="modal-heading"><div><p class="eyebrow">PROFILE & INVENTORY</p><h2 id="knowledge-title">{{ activeKnowledgeTea.name }}</h2><p class="page-subtitle">画像与库存</p></div><button class="icon-button" type="button" aria-label="关闭" @click="closeKnowledge">×</button></div>
        <div class="knowledge-summary"><span class="status-tag" :class="{ amber: !hasBaseProfile }">{{ hasBaseProfile ? `基础画像 ${activeCompleteness}%` : '暂无完整基础画像' }}</span><p v-if="!hasBaseProfile" class="helper-text">{{ knowledgeWithheld ? '已显示当前茶库中的确定信息，可继续个人补录。' : '此茶款尚无基础画像，可先记录个人观察。' }}</p><p v-else-if="activeProfile?.research?.notes?.length" class="helper-text">{{ activeProfile.research.notes.join('；') }}</p></div>
        <div class="knowledge-sections">
          <section v-for="section in knowledgeSections" :key="section.key" class="knowledge-section">
            <h3>{{ section.label }}</h3>
            <article v-for="field in section.fields" :key="field.path" class="knowledge-field">
              <button class="knowledge-field-button" type="button" :disabled="busy" @click="editKnowledgeField(field.path)">
                <span class="knowledge-field-heading"><strong>{{ field.label }}</strong><span v-if="field.isOverridden" class="personal-tag">个人覆盖</span><span v-if="field.locked" class="lock-tag">已锁定</span></span>
                <span class="field-value" :class="{ missing: field.field.value == null }">{{ displayValue(field.field.value) }}</span>
                <span class="field-provenance">{{ statusLabels[field.field.status] || field.field.status }} · {{ sourceLabels[field.field.sourceType] || field.field.sourceType }} · 可信度 {{ Math.round((Number(field.field.confidence) || 0) * 100) }}%</span>
                <span v-if="field.field.evidence" class="field-evidence">{{ field.field.evidence }}</span>
                <span v-if="field.field.sourceRefs?.length" class="field-sources">来源：{{ field.field.sourceRefs.join('、') }}</span>
              </button>
            </article>
          </section>
        </div>

        <section class="inventory-section" aria-labelledby="inventory-title">
          <div class="inventory-heading"><div><h3 id="inventory-title">库存包装</h3><p class="page-subtitle">已喝完的包装保留记录，不计入库存摘要</p></div><button class="button-secondary" type="button" :disabled="busy" @click="openInventoryEditor()">＋ 新增包装</button></div>
          <p v-if="inventoryError" class="inline-error" role="alert">{{ inventoryError }}</p>
          <article v-for="item in inventoryRows" :key="item.id" class="inventory-card">
            <div class="inventory-card-heading"><div><strong>{{ item.packageLabel || '未命名包装' }}</strong><p>{{ inventoryDescription(item) }}</p></div><span class="status-tag" :class="{ amber: item.status === 'opened' || item.status === 'unknown' }">{{ inventoryStatuses.find((option) => option.key === item.status)?.label || item.status }}</span></div>
            <p v-if="item.sku" class="inventory-extra">SKU：{{ item.sku }}</p><p v-if="item.purchaseUrl" class="inventory-extra"><a :href="item.purchaseUrl" target="_blank" rel="noreferrer">购买链接</a></p><p v-if="item.note" class="inventory-extra">{{ item.note }}</p>
            <p v-if="lowStock(item)" class="low-stock">库存较少，可考虑补充或喝完后归档</p>
            <div class="inventory-actions"><button class="small-button" type="button" :disabled="busy" @click="openInventoryEditor(item)">编辑</button><button v-if="item.status === 'sealed'" class="button-primary compact" type="button" :disabled="busy" @click="inventoryAction('open', item)">开封一包</button><button v-if="item.status === 'opened' && Number.isInteger(item.remainingSessions) && (item.remainingSessions || 0) > 0" class="button-primary compact" type="button" :disabled="busy" @click="inventoryAction('consume', item)">喝一泡</button><button v-if="item.status === 'opened'" class="small-button" type="button" :disabled="busy" @click="inventoryAction('finish', item)">喝完</button><button class="small-button danger" type="button" :disabled="busy" @click="inventoryAction('delete', item)">删除</button></div>
          </article>
          <p v-if="!inventoryRows.length" class="empty-inline">还没有库存包装记录。</p>
        </section>
      </section>
    </div>

    <div v-if="knowledgeEditPath && selectedKnowledgeField" class="modal-mask top-mask" @click.self="knowledgeEditPath = ''; knowledgeError = ''">
      <form class="modal-sheet field-sheet" aria-labelledby="knowledge-field-title" @submit.prevent="saveKnowledgeField">
        <div class="modal-heading"><div><p class="eyebrow">PERSONAL FIELD</p><h2 id="knowledge-field-title">{{ selectedKnowledgeField.label }}</h2></div><button class="icon-button" type="button" aria-label="返回画像" @click="knowledgeEditPath = ''; knowledgeError = ''">×</button></div>
        <p class="helper-text">{{ selectedKnowledgeField.definition.description }}<br>{{ fieldHint(selectedKnowledgeField.definition) }}</p>
        <select v-if="selectedKnowledgeField.definition.type === 'enum'" v-model="knowledgeInput" class="field"><option value="">请选择</option><option v-for="value in selectedKnowledgeField.definition.values" :key="value" :value="value">{{ value }}</option></select>
        <textarea v-else v-model="knowledgeInput" class="field" rows="3" :inputmode="['number','integer','scale_0_5','number_range'].includes(selectedKnowledgeField.definition.type) ? 'decimal' : 'text'" />
        <div class="field-current"><span>当前值</span><strong>{{ displayValue(selectedKnowledgeField.field.value) }}</strong><span>{{ selectedKnowledgeField.isOverridden ? '个人覆盖值' : '基础画像值' }}</span></div>
        <label class="lock-row"><span>锁定此项，避免后续画像更新覆盖</span><input v-model="knowledgeLocked" type="checkbox" :disabled="!selectedKnowledgeField.isOverridden && selectedKnowledgeField.field.value == null" /></label>
        <p v-if="knowledgeError" class="inline-error" role="alert">{{ knowledgeError }}</p>
        <div class="modal-actions three-actions"><button class="small-button" type="button" :disabled="busy || selectedKnowledgeField.definition.requiredValue" @click="clearKnowledgeField">清空值</button><button class="small-button" type="button" :disabled="busy || !selectedKnowledgeField.isOverridden" @click="restoreKnowledgeField">恢复基础</button><button class="button-primary" type="submit" :disabled="busy">保存</button></div>
      </form>
    </div>

    <div v-if="inventoryForm" class="modal-mask top-mask" @click.self="inventoryForm = null; inventoryError = ''">
      <form class="modal-sheet inventory-sheet" aria-labelledby="inventory-form-title" @submit.prevent="saveInventoryItem">
        <div class="modal-heading"><div><p class="eyebrow">TEA INVENTORY</p><h2 id="inventory-form-title">{{ inventoryForm.id ? '编辑包装' : '新增包装' }}</h2></div><button class="icon-button" type="button" aria-label="返回库存" @click="inventoryForm = null; inventoryError = ''">×</button></div>
        <label class="field-label" for="inventory-type">包装类型</label><select id="inventory-type" v-model="inventoryForm.packageType" class="field"><option v-for="option in packageTypes" :key="option.key" :value="option.key">{{ option.label }}</option></select>
        <label class="field-label" for="inventory-label">包装名称</label><input id="inventory-label" v-model="inventoryForm.packageLabel" class="field" maxlength="100" placeholder="例如：100g 袋装" />
        <label class="field-label" for="inventory-status">状态</label><select id="inventory-status" v-model="inventoryForm.status" class="field" :disabled="!!inventoryForm.id && inventoryForm.status !== 'unknown'"><option v-for="option in (inventoryForm.id ? inventoryStatuses : inventoryStatuses.filter((item) => item.key === 'sealed' || item.key === 'opened'))" :key="option.key" :value="option.key">{{ option.label }}</option></select><p v-if="inventoryForm.id && inventoryForm.status !== 'unknown'" class="helper-text">已开封/喝完状态请使用库存卡上的操作按钮修改。</p>
        <div class="field-grid"><div><label class="field-label" for="inventory-quantity">未开封份数</label><input id="inventory-quantity" v-model="inventoryForm.quantity" class="field" type="number" min="1" step="1" :disabled="inventoryForm.status !== 'sealed'" /></div><div><label class="field-label" for="inventory-weight">每份净重（克）</label><input id="inventory-weight" v-model="inventoryForm.netWeightPerUnit" class="field" type="number" min="0" step="any" /></div></div>
        <div v-if="inventoryForm.status !== 'sealed'" class="field-grid"><div><label class="field-label" for="inventory-remaining-weight">剩余克数</label><input id="inventory-remaining-weight" v-model="inventoryForm.remainingWeight" class="field" type="number" min="0" step="any" /></div><div><label class="field-label" for="inventory-sessions">剩余泡数</label><input id="inventory-sessions" v-model="inventoryForm.remainingSessions" class="field" type="number" min="0" step="1" /></div></div>
        <label class="field-label" for="inventory-sku">SKU</label><input id="inventory-sku" v-model="inventoryForm.sku" class="field" maxlength="120" />
        <label class="field-label" for="inventory-url">购买链接</label><input id="inventory-url" v-model="inventoryForm.purchaseUrl" class="field" type="url" placeholder="https://…" />
        <label class="field-label" for="inventory-note">备注</label><textarea id="inventory-note" v-model="inventoryForm.note" class="field" rows="2" maxlength="300" />
        <p v-if="inventoryError" class="inline-error" role="alert">{{ inventoryError }}</p>
        <div class="modal-actions"><button class="button-secondary" type="button" :disabled="busy" @click="inventoryForm = null">返回</button><button v-if="inventoryForm.id" class="small-button danger" type="button" :disabled="busy" @click="deleteEditingInventory">删除</button><button class="button-primary" type="submit" :disabled="busy">保存</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.tea-library-page{width:100%;max-width:64rem;margin:0 auto;padding:clamp(1.4rem,4vw,2.8rem) 0 3rem;color:#3b4039}.page-heading,.modal-heading,.inventory-heading,.inventory-card-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.page-heading h1,.modal-heading h2{margin:.35rem 0;color:#544438;font-family:Georgia,'Songti SC',serif;font-weight:500}.page-heading h1{font-size:clamp(2rem,5vw,2.8rem)}.page-subtitle{margin:.3rem 0 0;color:#7a7d75;font-size:.82rem;line-height:1.55}.eyebrow{margin:0;color:#6d8c70;font-size:.68rem;letter-spacing:.19em;font-weight:700}.heading-actions,.row-actions,.inventory-actions{display:flex;align-items:center;justify-content:flex-end;gap:.45rem;flex-wrap:wrap}.button-primary,.button-secondary,.small-button{min-height:2.45rem;border-radius:999px;padding:.55rem .95rem;font-size:.8rem;font-weight:600;white-space:nowrap}.button-primary{border:1px solid #4e7159;background:#4e7159;color:#fffdf9}.button-secondary{border:1px solid #c7d0be;background:#f5f7f1;color:#44604a}.small-button{border:1px solid #ded7cd;background:#fffdf8;color:#615e56}.button-primary:disabled,.button-secondary:disabled,.small-button:disabled{cursor:wait;opacity:.55}.small-button.danger{color:#9c4f3e;border-color:#e5c9bd}.search-box{display:flex;align-items:center;gap:.5rem;max-width:35rem;margin:1.4rem 0 .8rem;border:1px solid #d7cabc;border-radius:.7rem;background:#fffdf8;padding-left:.8rem}.search-box input{width:100%;padding:.75rem .8rem;border:0;background:transparent;color:inherit;outline:0}.search-box span{font-size:1.3rem;color:#777}.filter-row{display:flex;gap:.45rem;overflow:auto;padding:.25rem 0 1.1rem;scrollbar-width:thin}.filter-pill{border:1px solid #ded7cd;border-radius:999px;background:rgba(255,252,247,.8);padding:.48rem .8rem;color:#68685f;font-size:.78rem;white-space:nowrap}.filter-pill.active{border-color:#789275;background:#e9efe5;color:#436248;font-weight:650}.tea-groups{display:grid;gap:1rem}.tea-group{min-width:0}.group-title{display:flex;align-items:baseline;gap:.5rem;margin:.35rem .15rem .45rem;color:#65584c;font-family:Georgia,'Songti SC',serif;font-size:1rem;font-weight:550}.group-title span{color:#8a8d82;font:normal .72rem 'PingFang SC','Microsoft YaHei',sans-serif}.surface{border:1px solid rgba(171,150,130,.32);border-radius:1rem;background:rgba(255,252,247,.9);box-shadow:0 10px 28px rgba(74,60,47,.055)}.tea-list{padding:0 1rem}.tea-row{display:flex;align-items:center;gap:.6rem;min-width:0;padding:.85rem .05rem;border-bottom:1px solid #e9e1d7}.tea-row:last-child{border-bottom:0}.tea-row.disabled{opacity:.58}.tea-open{display:flex;flex:1;align-items:center;justify-content:space-between;gap:.75rem;min-width:0;padding:0;border:0;background:transparent;text-align:left;color:inherit}.tea-primary{display:flex;flex-direction:column;gap:.16rem;min-width:0}.tea-name,.tea-primary h2{font-family:Georgia,'Songti SC',serif;color:#51473d;font-size:.98rem;font-weight:550;line-height:1.35}.tea-meta,.tea-subline,.tea-primary p{margin:0;color:#84857c;font-size:.73rem;line-height:1.45}.tea-subline{color:#71806d;font-size:.68rem}.tea-tags{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}.nature-tag,.status-tag,.avoid-tag,.personal-tag,.lock-tag{border-radius:999px;padding:.25rem .52rem;background:#eaf0e7;color:#527058;font-size:.68rem;white-space:nowrap}.status-tag{background:#efeee8;color:#76786e}.status-tag.amber,.avoid-tag{background:#f8ecdf;color:#9a6844}.edit-shortcut{padding:.4rem .65rem;min-height:2.15rem}.manage-list{padding:0 1rem}.manage-list .tea-row{padding:.75rem .05rem}.manage-list .tea-primary{flex:1}.row-actions{flex:0 1 auto;gap:.3rem}.row-actions .small-button{min-height:2rem;padding:.38rem .55rem;font-size:.72rem}.empty-card{display:grid;justify-items:center;gap:.35rem;padding:2.1rem 1rem;text-align:center;color:#8a8b82}.empty-card span{font-size:1.5rem}.empty-card p{margin:.2rem}.notice,.inline-error{margin:.9rem 0;padding:.72rem .9rem;border-radius:.7rem;background:#fff3e9;color:#884b36;font-size:.8rem;line-height:1.5}.inline-error{margin:.25rem 0;background:#fff0ef;color:#9b433b}.modal-mask{position:fixed;z-index:50;inset:0;display:flex;align-items:flex-end;justify-content:center;padding:1rem;background:rgba(41,38,33,.45);backdrop-filter:blur(3px)}.top-mask{z-index:60}.modal-sheet{display:grid;gap:.62rem;width:min(100%,36rem);max-height:min(92dvh,58rem);overflow:auto;padding:1.25rem;border:1px solid rgba(171,150,130,.4);border-radius:1.2rem 1.2rem 0 0;background:#fffdf8;box-shadow:0 18px 50px rgba(42,35,29,.22);overscroll-behavior:contain}.modal-heading{margin-bottom:.15rem}.modal-heading h2{font-size:1.45rem}.icon-button{width:2.25rem;height:2.25rem;border:1px solid #e4d9cd;border-radius:50%;background:#fff;color:#6b655c;font-size:1.4rem;line-height:1}.field-label{margin-top:.25rem;color:#6b655c;font-size:.78rem}.field{width:100%;min-width:0;padding:.72rem .8rem;border:1px solid #d7cabc;border-radius:.65rem;background:#fff;color:#3b4039;outline:0}.field:focus{border-color:#6f8d71;box-shadow:0 0 0 3px rgba(111,141,113,.15)}textarea.field{resize:vertical;line-height:1.55}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.field-grid>div{min-width:0}.avoid-row,.lock-row{display:flex;align-items:center;justify-content:space-between;gap:.8rem;padding:.7rem 0;border-top:1px solid #ece4da}.avoid-row strong{font-size:.82rem;color:#55564d}.avoid-row p{margin:.2rem 0 0;color:#87877e;font-size:.7rem}.switch{width:2.7rem;height:1.55rem;padding:.16rem;border:0;border-radius:999px;background:#d4d2ca}.switch span{display:block;width:1.22rem;height:1.22rem;border-radius:50%;background:white;box-shadow:0 1px 3px #0002;transition:transform .16s}.switch.on{background:#6f8d71}.switch.on span{transform:translateX(1.12rem)}.modal-actions{display:flex;justify-content:flex-end;gap:.55rem;margin-top:.45rem;padding-top:.75rem;border-top:1px solid #ece4da}.modal-actions>*{min-width:6rem}.knowledge-sheet{width:min(100%,48rem);max-height:92dvh;border-radius:1.2rem}.knowledge-summary{padding:.65rem .75rem;border-radius:.8rem;background:#f5f2ea}.helper-text{margin:.2rem 0;color:#7b7d75;font-size:.75rem;line-height:1.6}.knowledge-sections{display:grid;gap:.8rem}.knowledge-section{padding:.75rem .85rem;border:1px solid #ebe3d8;border-radius:.8rem;background:#fff}.knowledge-section h3,.inventory-heading h3{margin:0 0 .45rem;color:#625449;font-family:Georgia,'Songti SC',serif;font-size:1rem;font-weight:550}.knowledge-field{border-top:1px solid #f0ebe4}.knowledge-field-button{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.25rem .7rem;width:100%;padding:.62rem 0;border:0;background:transparent;text-align:left;color:inherit}.knowledge-field-heading{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}.knowledge-field-heading strong{font-size:.76rem;color:#55564d}.field-value{max-width:13rem;color:#4f624e;text-align:right;font-size:.78rem;overflow-wrap:anywhere}.field-value.missing{color:#aaa99f}.field-provenance,.field-evidence,.field-sources{grid-column:1/-1;color:#898a81;font-size:.66rem;line-height:1.45}.field-evidence{color:#76796f}.field-sources{color:#73816d;overflow-wrap:anywhere}.personal-tag,.lock-tag{padding:.15rem .4rem;font-size:.58rem}.personal-tag{background:#f4eadf;color:#996547}.lock-tag{background:#eeece7;color:#78756d}.inventory-section{display:grid;gap:.6rem;padding-top:.8rem;border-top:1px solid #e9e1d7}.inventory-heading{align-items:flex-start}.inventory-card{padding:.8rem;border:1px solid #e7ded2;border-radius:.8rem;background:#fff}.inventory-card-heading{align-items:flex-start}.inventory-card-heading strong{font-size:.83rem;color:#544c42}.inventory-card-heading p,.inventory-extra{margin:.2rem 0 0;color:#85857c;font-size:.69rem;line-height:1.5;overflow-wrap:anywhere}.inventory-extra a{color:#56785a}.inventory-actions{justify-content:flex-start;margin-top:.6rem}.button-primary.compact{min-height:2rem;padding:.42rem .7rem;font-size:.7rem}.low-stock{margin:.45rem 0 0;color:#9b6541;font-size:.7rem}.empty-inline{margin:0;padding:.8rem;color:#888a81;text-align:center;font-size:.77rem}.field-current{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.6rem;padding:.65rem .7rem;border-radius:.7rem;background:#f5f2ea;color:#87877e;font-size:.69rem}.field-current strong{color:#4e614d;font-size:.78rem;text-align:right;overflow-wrap:anywhere}.lock-row{font-size:.75rem;color:#5f6259}.lock-row input{width:1rem;height:1rem;accent-color:#4e7159}.three-actions{justify-content:space-between}.three-actions>*{min-width:0;flex:1}.inventory-sheet{width:min(100%,38rem)}
@media(min-width:700px){.tea-library-page{padding-top:2.1rem}.modal-mask{align-items:center}.modal-sheet{border-radius:1.2rem}.knowledge-sheet{max-height:88dvh}.tea-row{padding-block:1rem}.manage-list .tea-row{padding-block:.9rem}}
@media(max-width:560px){.page-heading{align-items:flex-start}.heading-actions{gap:.35rem}.heading-actions .button-primary,.heading-actions .button-secondary{min-height:2.25rem;padding:.48rem .7rem;font-size:.74rem}.tea-library-page{padding-top:1.2rem}.tea-list{padding-inline:.75rem}.tea-row{gap:.35rem}.tea-tags{max-width:5rem}.edit-shortcut{padding:.32rem .5rem;font-size:.68rem}.manage-list{padding-inline:.7rem}.manage-list .tea-row{align-items:flex-start;flex-wrap:wrap}.row-actions{width:100%;justify-content:flex-start;padding-left:0}.row-actions .small-button{flex:1}.modal-mask{padding:.55rem}.modal-sheet{padding:1rem}.field-grid{gap:.5rem}.knowledge-field-button{grid-template-columns:minmax(0,1fr) minmax(4.8rem,45%)}.field-value{max-width:none}.inventory-heading{flex-direction:column}.inventory-heading .button-secondary{align-self:flex-start}}
</style>
