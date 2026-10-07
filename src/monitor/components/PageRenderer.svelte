<script>
  let { plugin } = $props();

  let iframeSrc = $derived(plugin?.htmlPath ? `file://${plugin.htmlPath}` : '');
</script>

<div class="renderer">
  {#if iframeSrc}
    <iframe
      src={iframeSrc}
      sandbox="allow-scripts allow-same-origin"
      frameborder="0"
      allowfullscreen
      title={plugin?.name || 'Plugin'}
    ></iframe>
  {/if}
</div>

<style>
  .renderer {
    width: 100%;
    height: 100%;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: var(--bg);
  }
</style>
