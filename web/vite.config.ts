import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const legacyPath = (file: string) => decodeURIComponent(new URL(file, import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    include: [
      '@legacy/teaData',
      '@legacy/recommend',
      '@legacy/teaMatch',
      '@legacy/historyOrder',
      '@legacy/lunar',
      '@legacy/teaKnowledge',
      '@legacy/keywordParser',
    ],
  },
  resolve: {
    alias: [
      { find: '@legacy/teaData', replacement: legacyPath('../utils/teaData.js') },
      { find: '@legacy/recommend', replacement: legacyPath('../utils/recommend.js') },
      { find: '@legacy/teaMatch', replacement: legacyPath('../utils/teaMatch.js') },
      { find: '@legacy/historyOrder', replacement: legacyPath('../utils/historyOrder.js') },
      { find: '@legacy/lunar', replacement: legacyPath('../utils/lunar.js') },
      { find: '@legacy/teaKnowledge', replacement: legacyPath('../utils/teaKnowledge.js') },
      { find: '@legacy/keywordParser', replacement: legacyPath('src/logic/legacy/keywordParser.cjs') },
    ],
  },
  build: {
    commonjsOptions: {
      include: [/utils[\\/].*\.js$/, /web[\\/]src[\\/]logic[\\/]legacy[\\/].*\.cjs$/],
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
