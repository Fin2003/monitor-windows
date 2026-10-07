<script>
  import { onMount } from 'svelte';
  import Settings from '../manager/components/CompactOverviewSettings.svelte';
  let enabled = $state(false), error = $state('');
  async function toggle(value) { await window.api.togglePlugin('compact-overview', value); enabled = value; }
  onMount(async () => { const config = await window.api.getConfig(); document.documentElement.setAttribute('data-theme', config.theme || 'dark'); const plugins = await window.api.getPlugins(); enabled = plugins.some(p => p.id === 'compact-overview' && p.enabled); });
</script>
<main><h1>缩略总览管理</h1><Settings {enabled} onToggle={toggle} /><p>ESP32 屏幕固定为 1024 × 600。触屏预览在主窗口的“ESP32 屏幕”页。</p></main>
<style>main{padding:24px;max-width:900px;margin:auto}h1{font-size:20px;margin-bottom:20px}p{font-size:13px;color:var(--text-secondary);margin-top:20px}</style>
