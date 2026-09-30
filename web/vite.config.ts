import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function serviceWorker(): Plugin {
  const templatePath = new URL('./src/service-worker.js', import.meta.url);
  const publicFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
  return {
    name: 'tea-pwa-service-worker',
    generateBundle(_options, bundle) {
      const urls = ['/', '/manifest.webmanifest', ...publicFiles.slice(1).map((file) => `/${file}`),
        ...Object.keys(bundle).filter((file) => file !== 'service-worker.js').map((file) => `/${file}`)];
      const hash = createHash('sha256');
      hash.update(readFileSync(templatePath));
      for (const file of Object.keys(bundle).sort()) {
        const item = bundle[file];
        hash.update(file);
        hash.update(item.type === 'chunk' ? item.code || '' : item.source || '');
      }
      for (const file of publicFiles) {
        hash.update(file);
        hash.update(readFileSync(new URL(`./public/${file}`, import.meta.url)));
      }
      const version = hash.digest('hex').slice(0, 16);
      const source = readFileSync(templatePath, 'utf8')
        .replace('__CACHE_VERSION__', version)
        .replace('__PRECACHE_URLS__', JSON.stringify([...new Set(urls)]));
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}

const legacyPath = (file: string) => decodeURIComponent(new URL(file, import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));

export default defineConfig({
  plugins: [vue(), serviceWorker()],
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
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
