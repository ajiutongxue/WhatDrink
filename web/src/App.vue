<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

type Tea = {
  id: number;
  name: string;
  brand: string;
  cat: string;
  year: number | null;
  nature: string;
  note: string;
};

const password = ref('');
const authenticated = ref(false);
const teas = ref<Tea[]>([]);
const loading = ref(false);
const message = ref('');
const query = ref('');
const count = computed(() => teas.value.length);
const filteredTeas = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return teas.value;
  return teas.value.filter((tea) => `${tea.name} ${tea.brand} ${tea.cat}`.toLowerCase().includes(needle));
});

async function loadState() {
  const response = await fetch('/api/state');
  if (response.status === 401) {
    authenticated.value = false;
    teas.value = [];
    return;
  }
  if (!response.ok) throw new Error('读取茶库失败，请稍后重试。');
  const result = await response.json() as { state: { teaLibrary: Tea[] } };
  teas.value = result.state.teaLibrary;
  authenticated.value = true;
}

async function login() {
  loading.value = true;
  message.value = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    if (!response.ok) {
      message.value = response.status === 401
        ? '密码不正确。'
        : response.status === 429
          ? '尝试次数过多，请稍后再试。'
          : '登录服务暂时不可用。';
      return;
    }
    password.value = '';
    await loadState();
  } catch {
    message.value = '无法连接服务器，请确认前后端都已启动。';
  } finally {
    loading.value = false;
  }
}

async function logout() {
  message.value = '';
  try {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) throw new Error('logout failed');
    authenticated.value = false;
    teas.value = [];
    query.value = '';
  } catch {
    message.value = '退出失败，请检查网络后重试。';
  }
}

onMounted(async () => {
  try {
    const response = await fetch('/api/session');
    const session = await response.json() as { authenticated: boolean };
    if (session.authenticated) await loadState();
  } catch {
    message.value = '服务器暂时不可用。';
  }
});
</script>

<template>
  <main class="page-shell">
    <header class="topbar">
      <a class="wordmark" href="#top" aria-label="今天喝点什么茶首页">
        <span class="wordmark-mark" aria-hidden="true">茶</span>
        <span>今天喝点什么茶</span>
      </a>
      <span class="topbar-note">个人茶库</span>
    </header>

    <section v-if="!authenticated" id="top" class="login-panel" aria-labelledby="login-title">
      <div class="eyebrow">MY TEA JOURNAL</div>
      <h1 id="login-title">欢迎回来</h1>
      <p class="intro">登录后查看你的茶库。</p>
      <form class="login-form" @submit.prevent="login">
        <label for="password">登录密码</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required />
        <button class="primary-button" type="submit" :disabled="loading">
          {{ loading ? '正在登录…' : '进入茶库' }}
        </button>
      </form>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
    </section>

    <section v-else id="top" class="library-panel" aria-labelledby="library-title">
      <div class="library-heading">
        <div>
          <div class="eyebrow">YOUR COLLECTION</div>
          <h1 id="library-title">茶叶清单</h1>
          <p class="intro">收录 {{ count }} 款茶 · 当前为只读预览</p>
        </div>
        <button class="text-button" type="button" @click="logout">退出登录</button>
      </div>
      <label class="search-box" for="tea-search">
        <span aria-hidden="true">⌕</span>
        <input id="tea-search" v-model="query" type="search" placeholder="搜索茶名、品牌或分类" />
      </label>
      <div class="tea-list" aria-live="polite">
        <article v-for="tea in filteredTeas" :key="tea.id" class="tea-row">
          <span class="tea-number">{{ String(tea.id + 1).padStart(2, '0') }}</span>
          <div class="tea-info">
            <h2>{{ tea.name }}</h2>
            <p>{{ tea.brand }}<span v-if="tea.year"> · {{ tea.year }}年</span></p>
          </div>
          <span class="nature-tag">{{ tea.nature }}</span>
        </article>
        <p v-if="filteredTeas.length === 0" class="empty-state">没有找到这款茶</p>
      </div>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
    </section>
    <footer>慢一点，喝一杯。</footer>
  </main>
</template>
