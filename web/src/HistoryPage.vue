<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { sortHistoryForDisplay } from './logic/index.js';

type Tea = {
  id: number;
  name: string;
  brand?: string;
  cat: string;
  year?: number | null;
  nature?: string;
  baseNature?: string;
};
type HistoryImage = { fileID: string; caption?: string; url?: string };
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
  imageFileIDs?: HistoryImage[];
  noteAnalysis?: unknown;
};
type AvoidState = { active?: boolean; expiresAt?: number };
type HistoryPageState = {
  teaLibrary: Tea[];
  history: HistoryEntry[];
  temporaryAvoids: Record<string, unknown>;
};

const props = defineProps<{ state: HistoryPageState | null; busy: boolean; offline?: boolean }>();
const emit = defineEmits<{
  'update-notes': [payload: { id: string; text: string }];
  'clear-notes': [id: string];
  'avoid-tea': [teaId: number];
  'upload-image': [payload: { id: string; file: File }];
  'delete-image': [payload: { id: string; image: HistoryImage }];
  'update-image-description': [payload: { id: string; image: HistoryImage; description: string }];
}>();

const expandedId = ref<string | null>(null);
const editingNotesId = ref<string | null>(null);
const noteDrafts = reactive<Record<string, string>>({});
const imageDescriptionDrafts = reactive<Record<string, string>>({});

const categoryNames: Record<string, string> = {
  green: '绿茶', black: '红茶', white: '白茶', oolong_tieguanyin: '铁观音',
  oolong_wuyi: '武夷岩茶', oolong_dancong: '凤凰单丛', puerh_raw: '普洱生茶',
  puerh_ripe: '普洱熟茶', flavored_jasmine: '茉莉花茶', flavored_other: '调味茶',
  unknown: '自选', none: '',
};
const typeNames: Record<string, string> = { primary: '主推', alt: '备选', custom: '自选', skip: '未饮' };

const rows = computed(() => {
  const state = props.state;
  if (!state) return [];
  const ordered = sortHistoryForDisplay(state.history) as Array<{ entry: HistoryEntry; index: number }>;
  return ordered.map(({ entry, index }) => {
    const tea = state.teaLibrary.find((item) => item.id === entry.teaId);
    const avoid = state.temporaryAvoids[String(entry.teaId)] as AvoidState | undefined;
    const avoided = avoid?.active === true && Number(avoid.expiresAt) > Date.now();
    return {
      key: `${entry.id}:${index}`,
      id: entry.id,
      entry,
      dateLabel: formatDate(entry.date),
      typeName: typeNames[entry.type] || '记录',
      categoryName: categoryNames[entry.teaCat] ?? entry.teaCat ?? '',
      year: entry.teaYear || tea?.year || null,
      canAvoid: entry.type !== 'skip' && Number.isInteger(entry.teaId) && entry.teaId >= 0,
      avoided,
      images: Array.isArray(entry.imageFileIDs) ? entry.imageFileIDs : [],
    };
  });
});

const hasHistory = computed(() => (props.state?.history.length || 0) > 0);
const noteCount = computed(() => {
  const id = editingNotesId.value;
  return id ? (noteDrafts[id] || '').length : 0;
});

function formatDate(value: string) {
  if (!value || value.length < 10) return value || '日期未知';
  return `${value.slice(5, 7)}月${value.slice(8, 10)}日`;
}

function toggleRow(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null;
    editingNotesId.value = null;
    return;
  }
  expandedId.value = id;
  editingNotesId.value = null;
}

function beginEditing(entry: HistoryEntry) {
  if (noteDrafts[entry.id] === undefined) noteDrafts[entry.id] = entry.tastingNotes || '';
  editingNotesId.value = entry.id;
}

function saveNotes(entry: HistoryEntry) {
  const text = (noteDrafts[entry.id] || '').trim().slice(0, 500);
  noteDrafts[entry.id] = text;
  if (text) emit('update-notes', { id: entry.id, text });
  else emit('clear-notes', entry.id);
}

function clearNotes(entry: HistoryEntry) {
  if (!window.confirm('清空这条记录的品饮文字？图片会保留。')) return;
  noteDrafts[entry.id] = '';
  emit('clear-notes', entry.id);
}

function avoidTea(teaId: number) {
  emit('avoid-tea', teaId);
}

function uploadImage(entry: HistoryEntry, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !file.type.startsWith('image/')) return;
  if ((entry.imageFileIDs || []).length >= 6) return;
  emit('upload-image', { id: entry.id, file });
}

function descriptionKey(entry: HistoryEntry, image: HistoryImage, index: number) {
  return `${entry.id}:${image.fileID || index}`;
}

function imageDescription(entry: HistoryEntry, image: HistoryImage, index: number) {
  const key = descriptionKey(entry, image, index);
  return imageDescriptionDrafts[key] ?? image.caption ?? '';
}

function updateDescriptionDraft(entry: HistoryEntry, image: HistoryImage, index: number, value: string) {
  imageDescriptionDrafts[descriptionKey(entry, image, index)] = value.slice(0, 40);
}

function saveDescription(entry: HistoryEntry, image: HistoryImage, index: number) {
  const description = imageDescription(entry, image, index).trim().slice(0, 40);
  imageDescriptionDrafts[descriptionKey(entry, image, index)] = description;
  if (description !== (image.caption || '')) {
    emit('update-image-description', { id: entry.id, image, description });
  }
}

function imageSource(image: HistoryImage) {
  const source = image.url || image.fileID || '';
  if (/^(https?:\/\/|data:image\/|blob:|\/)/i.test(source)) return source;
  // Legacy mini-program cloud IDs are not readable through the PWA attachment route.
  if (!source || /^(cloud|wxfile|file):\/\//i.test(source)) return '';
  return `/api/attachments/${encodeURIComponent(source)}`;
}
</script>

<template>
  <section class="history-page">
    <header class="history-header">
      <div>
        <h1>饮茶记录</h1>
        <p class="history-subtitle">每一杯，都算数</p>
      </div>
      <slot name="actions" />
    </header>

    <p v-if="offline" class="history-status" role="status">离线时品饮文字和近期回避可暂存；图片上传、删除和说明修改需要网络。</p>

    <p v-if="busy" class="history-status" role="status" aria-live="polite">正在处理记录…</p>

    <section v-if="!state" class="surface history-empty" aria-live="polite">
      <span class="empty-icon" aria-hidden="true">🍵</span>
      <strong>正在载入记录</strong>
      <span class="muted">记录准备好后会显示在这里。</span>
    </section>
    <section v-else-if="!hasHistory" class="surface history-empty">
      <span class="empty-icon" aria-hidden="true">🍵</span>
      <strong>还没有饮茶记录</strong>
      <span class="muted">完成一次打卡后会显示在这里。</span>
    </section>
    <section v-else class="surface history-list" aria-label="饮茶时间线">
      <article v-for="row in rows" :key="row.key" class="history-entry" :class="{ 'is-expanded': expandedId === row.id }">
        <button
          class="history-row"
          type="button"
          :disabled="row.entry.type === 'skip'"
          :aria-expanded="expandedId === row.id"
          :aria-controls="`history-detail-${row.id}`"
          @click="toggleRow(row.id)"
        >
          <span class="history-date-col">
            <span class="history-date">{{ row.dateLabel }}</span>
            <span v-if="row.entry.checkinTime" class="history-time">{{ row.entry.checkinTime }}</span>
          </span>
          <span class="history-dot" :class="`cat-${row.entry.teaCat || 'unknown'}`" aria-hidden="true" />
          <span class="history-tea">
            <span class="history-tea-name">{{ row.entry.teaName || '未知茶名' }}</span>
            <span class="history-meta">
              <template v-if="row.entry.teaBrand">{{ row.entry.teaBrand }} · </template>
              <template v-if="row.year">{{ row.year }}年 · </template>
              {{ row.categoryName }}
            </span>
          </span>
          <span class="history-badge" :class="`type-${row.entry.type}`">{{ row.typeName }}</span>
          <span v-if="row.entry.type !== 'skip'" class="history-chevron" aria-hidden="true">{{ expandedId === row.id ? '收起' : '展开' }}</span>
        </button>

        <section v-if="expandedId === row.id" :id="`history-detail-${row.id}`" class="history-detail">
          <div v-if="editingNotesId !== row.id" class="note-display">
            <p v-if="row.entry.tastingNotes" class="saved-note">{{ row.entry.tastingNotes }}</p>
            <p v-else class="note-placeholder">还没有写下这杯茶的感受。</p>
            <div v-if="row.images.length" class="image-grid" aria-label="品饮图片">
              <figure v-for="(image, index) in row.images" :key="`${image.fileID}-${index}`" class="image-card">
                <img v-if="imageSource(image)" :src="imageSource(image)" alt="品饮记录图片" loading="lazy" />
                <div v-else class="image-unavailable" role="img" aria-label="图片已记录，当前无法预览">图片已记录</div>
                <figcaption v-if="image.caption">{{ image.caption }}</figcaption>
              </figure>
            </div>
            <div class="detail-actions">
              <button class="button-secondary" type="button" :disabled="busy" @click="beginEditing(row.entry)">
                {{ row.entry.tastingNotes ? '修改感受' : '写下感受' }}
              </button>
              <button v-if="row.entry.tastingNotes" class="text-button" type="button" :disabled="busy" @click="clearNotes(row.entry)">清空文字</button>
            </div>
          </div>

          <div v-else class="note-editor">
            <label :for="`notes-${row.id}`">品饮感受</label>
            <textarea
              :id="`notes-${row.id}`"
              v-model="noteDrafts[row.id]"
              rows="4"
              maxlength="500"
              placeholder="口感、香气、回甘、体感、心情……"
              :disabled="busy"
            />
            <div class="note-editor-footer">
              <span>{{ noteCount }} / 500</span>
              <div class="detail-actions">
                <button class="button-secondary" type="button" :disabled="busy" @click="saveNotes(row.entry)">保存文字</button>
                <button v-if="row.entry.tastingNotes" class="text-button" type="button" :disabled="busy" @click="clearNotes(row.entry)">清空文字</button>
              </div>
            </div>
          </div>

          <section class="images-section" aria-label="品饮图片管理">
            <div class="images-heading">
              <div><strong>品饮图片</strong><span>{{ row.images.length }} / 6</span></div>
              <label class="upload-button" :class="{ disabled: busy || row.images.length >= 6 }">
                <input
                  type="file"
                  accept="image/*"
                  :disabled="busy || row.images.length >= 6"
                  :aria-label="`为${row.entry.teaName}添加品饮图片`"
                  @change="uploadImage(row.entry, $event)"
                />
                添加图片
              </label>
            </div>
            <p v-if="!row.images.length" class="images-empty">可以为这条记录添加最多 6 张图片。</p>
            <div v-else class="image-edit-list">
              <div v-for="(image, index) in row.images" :key="`${image.fileID}-${index}`" class="image-edit-row">
                <img v-if="imageSource(image)" :src="imageSource(image)" alt="" loading="lazy" />
                <div v-else class="image-unavailable small" aria-hidden="true">图片</div>
                <label class="sr-only" :for="`image-description-${row.id}-${index}`">图片说明</label>
                <input
                  :id="`image-description-${row.id}-${index}`"
                  :value="imageDescription(row.entry, image, index)"
                  maxlength="40"
                  placeholder="添加图片说明"
                  :disabled="busy"
                  @input="updateDescriptionDraft(row.entry, image, index, ($event.target as HTMLInputElement).value)"
                  @blur="saveDescription(row.entry, image, index)"
                />
                <button class="image-delete" type="button" :disabled="busy" :aria-label="`删除第 ${index + 1} 张图片`" @click="emit('delete-image', { id: row.id, image })">删除</button>
              </div>
            </div>
          </section>

          <div v-if="row.canAvoid" class="avoid-row">
            <div><strong>近期推荐</strong><span v-if="row.avoided">30 天内暂不推荐这款茶</span><span v-else>暂时不想喝时，可暂停推荐 30 天</span></div>
            <button class="text-button" type="button" :disabled="busy" @click="avoidTea(row.entry.teaId)">
              {{ row.avoided ? '恢复推荐' : '暂时不想喝' }}
            </button>
          </div>
        </section>
      </article>
    </section>
  </section>
</template>

<style scoped>
.history-page { width: min(calc(100% - 2.5rem), 64rem); margin: 0 auto; padding: 1.5rem 0 7rem; }
.history-header { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1.25rem; }
.history-header h1 { margin: 0 0 .15rem; color: var(--ink-2, #544438); font-family: var(--font-serif, Georgia, 'Songti SC', serif); font-size: 1.5rem; font-weight: 550; letter-spacing: .08em; }
.history-subtitle { margin: 0; color: var(--ink-3, #827c72); font-size: .75rem; letter-spacing: .06em; }
.history-status { margin: 0 0 .8rem; padding: .7rem .9rem; border-radius: .7rem; background: #edf2e9; color: #506b53; font-size: .82rem; }
.history-list { overflow: hidden; padding: .35rem 1.25rem; }
.history-entry + .history-entry { border-top: 1px solid rgba(171, 150, 130, .24); }
.history-row { display: flex; width: 100%; align-items: center; gap: clamp(.55rem, 2vw, 1rem); border: 0; padding: 1rem 0; background: transparent; color: #3b4039; text-align: left; }
.history-row:disabled { cursor: default; }
.history-date-col { display: grid; flex: 0 0 4.35rem; gap: .15rem; color: #988f83; font-size: .76rem; }
.history-time { color: #aaa297; font-size: .68rem; }
.history-dot { width: .62rem; height: .62rem; flex: 0 0 .62rem; border-radius: 50%; background: #9aab8e; }
.cat-black { background: #9c7b6a; }.cat-white { background: #bcc4bc; }.cat-oolong_tieguanyin,.cat-oolong_wuyi,.cat-oolong_dancong { background: #de8260; }.cat-puerh_ripe { background: #6b5344; }.cat-flavored_jasmine,.cat-flavored_other { background: #c98a9a; }.cat-unknown { background: #c96b4c; }.cat-none { background: #c9b8ad; }
.history-tea { display: grid; min-width: 0; flex: 1; gap: .22rem; }
.history-tea-name { overflow: hidden; color: #4d4239; font-family: Georgia, 'Songti SC', serif; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
.history-meta { overflow: hidden; color: #8a857c; font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
.history-badge { flex: 0 0 auto; padding: .28rem .55rem; border-radius: 999px; background: #efeee8; color: #6b6c62; font-size: .68rem; }
.type-primary { background: #f6e8e0; color: #a05d49; }.type-alt { background: #e9efe5; color: #557052; }.type-skip { color: #8d8d84; }
.history-chevron { flex: 0 0 auto; color: #8a8e82; font-size: .7rem; }
.history-detail { padding: 0 0 1.1rem clamp(0rem, 7vw, 5.8rem); }
.saved-note { margin: 0; padding: .8rem .95rem; border-radius: .7rem; background: #f5f0e9; color: #5f574e; font-size: .87rem; line-height: 1.75; white-space: pre-wrap; }
.note-placeholder,.images-empty { margin: 0; color: #8a857c; font-size: .8rem; }
.detail-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; margin-top: .7rem; }
.detail-actions .button-secondary { min-height: 2.25rem; padding: .45rem .9rem; font-size: .78rem; }
.detail-actions .text-button { justify-self: auto; }
.note-editor { display: grid; gap: .5rem; }
.note-editor label { color: #6b655c; font-size: .8rem; }
.note-editor textarea { width: 100%; min-height: 6rem; resize: vertical; border: 1px solid #d7cabc; border-radius: .65rem; padding: .75rem .85rem; background: #fffdf8; color: #3b4039; line-height: 1.65; outline: 0; }
.note-editor textarea:focus,.image-edit-row input:focus { border-color: #6f8d71; box-shadow: 0 0 0 3px rgba(111, 141, 113, .16); }
.note-editor-footer { display: flex; align-items: center; justify-content: space-between; gap: .7rem; color: #8a857c; font-size: .74rem; }
.note-editor-footer .detail-actions { margin: 0; }
.images-section { margin-top: 1rem; padding-top: .9rem; border-top: 1px solid rgba(171, 150, 130, .2); }
.images-heading,.images-heading > div { display: flex; align-items: center; gap: .65rem; }
.images-heading { justify-content: space-between; margin-bottom: .65rem; }
.images-heading strong { color: #65594e; font-size: .8rem; }
.images-heading span { color: #979085; font-size: .7rem; }
.upload-button { position: relative; overflow: hidden; border: 1px solid #d7d9cf; border-radius: 999px; padding: .38rem .75rem; background: #f4f6f0; color: #4f6d52; font-size: .73rem; cursor: pointer; }
.upload-button input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.upload-button.disabled { opacity: .55; cursor: wait; }
.image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr)); gap: .55rem; margin-top: .75rem; }
.image-card { overflow: hidden; margin: 0; border-radius: .65rem; background: #f1ede6; }
.image-card img,.image-unavailable { display: grid; width: 100%; aspect-ratio: 1; object-fit: cover; place-items: center; color: #8f887e; font-size: .7rem; }
.image-card figcaption { padding: .35rem .45rem; color: #6f6a61; font-size: .68rem; line-height: 1.4; overflow-wrap: anywhere; }
.image-edit-list { display: grid; gap: .5rem; }
.image-edit-row { display: grid; grid-template-columns: 2.8rem minmax(0, 1fr) auto; align-items: center; gap: .55rem; }
.image-edit-row > img,.image-unavailable.small { display: grid; width: 2.8rem; height: 2.8rem; border-radius: .5rem; object-fit: cover; place-items: center; background: #f1ede6; color: #8f887e; font-size: .65rem; }
.image-edit-row input { width: 100%; border: 1px solid #ded6cb; border-radius: .5rem; padding: .55rem .65rem; background: #fffdf8; color: #4b4942; font-size: .76rem; outline: 0; }
.image-delete { border: 0; padding: .5rem; background: transparent; color: #9a6652; font-size: .72rem; }
.avoid-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: .9rem; padding-top: .8rem; border-top: 1px solid rgba(171, 150, 130, .2); }
.avoid-row > div { display: grid; gap: .15rem; }
.avoid-row strong { color: #65594e; font-size: .78rem; }.avoid-row span { color: #8a857c; font-size: .7rem; }
.avoid-row .text-button { flex: 0 0 auto; justify-self: auto; }
.history-empty { display: grid; justify-items: center; gap: .55rem; padding: 3rem 1.2rem; text-align: center; }
.history-empty strong { color: #5b5147; font-family: Georgia, 'Songti SC', serif; font-size: 1.05rem; font-weight: 500; }
.history-empty .muted { margin: 0; font-size: .8rem; }
.empty-icon { font-size: 2.2rem; }
:global(.home-shell.phase-night) .history-header h1,:global(.home-shell.phase-night) .history-tea-name,:global(.home-shell.phase-night) .history-empty strong,:global(.home-shell.phase-night) .images-heading strong,:global(.home-shell.phase-night) .avoid-row strong { color: #e4e1e5; }
:global(.home-shell.phase-night) .history-subtitle,:global(.home-shell.phase-night) .history-meta,:global(.home-shell.phase-night) .history-chevron,:global(.home-shell.phase-night) .history-date-col,:global(.home-shell.phase-night) .note-placeholder,:global(.home-shell.phase-night) .images-empty,:global(.home-shell.phase-night) .avoid-row span { color: #c0c1bc; }
:global(.home-shell.phase-night) .history-row,:global(.home-shell.phase-night) .note-editor textarea,:global(.home-shell.phase-night) .image-edit-row input { color: #e4e1e5; }
:global(.home-shell.phase-night) .saved-note,:global(.home-shell.phase-night) .image-card,:global(.home-shell.phase-night) .image-unavailable,:global(.home-shell.phase-night) .image-edit-row > img { background: #3b3c42; color: #dedadd; }
:global(.home-shell.phase-night) .note-editor label { color: #c0c1bc; }
@media (max-width: 520px) {
  .history-page { width: min(calc(100% - 2.5rem), 64rem); padding-top: 1.25rem; }
  .history-list { padding-inline: .85rem; }
  .history-row { gap: .5rem; }
  .history-date-col { flex-basis: 3.7rem; }
  .history-badge { padding-inline: .42rem; }
  .history-chevron { display: none; }
  .history-detail { padding-left: .4rem; }
}
</style>
