import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        manager: path.resolve(__dirname, 'manager.html'),
        compactOverviewPanel: path.resolve(__dirname, 'compact-overview-panel.html'),
        panel: path.resolve(__dirname, 'panel.html'),
        systemMonitorPanel: path.resolve(__dirname, 'system-monitor-panel.html'),
        tiboRadar: path.resolve(__dirname, 'plugins/tibo-radar/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5178,
    strictPort: true,
  },
});
