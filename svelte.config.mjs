import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Svelte 5 uses event delegation by default which can break
    // in Electron BrowserWindow with contextIsolation
  },
};

