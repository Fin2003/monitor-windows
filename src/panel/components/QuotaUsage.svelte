<script>
  import { onMount } from 'svelte';
  let { data } = $props();
  let now = $state(Date.now());
  onMount(() => { const timer = setInterval(() => now = Date.now(), 30000); return () => clearInterval(timer); });
  const amount = value => value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
  function reset(at) {
    const ms = Date.parse(at) - now;
    if (!(ms > 0)) return at ? '待刷新' : '';
    const minutes = Math.ceil(ms / 60000);
    return minutes >= 1440 ? Math.floor(minutes / 1440) + '天后重置' : minutes >= 60 ? Math.floor(minutes / 60) + '时' + minutes % 60 + '分后重置' : minutes + '分后重置';
  }
</script>

{#if data?.plans?.length}
  <div class="quota-usage">
    {#if data.planName}<div class="quota-plan">{data.planName}</div>{/if}
    {#each data.plans as plan, index}
      <div class="quota-item">
        <div class="quota-line">
          <span>{plan.name}</span>
          <strong>
            {#if plan.unlimited}不限量
            {:else if plan.remaining != null}余 {amount(plan.remaining)} {plan.unit || ''}
            {:else if plan.percentage != null}已用 {Math.round(plan.percentage * 10) / 10}%
            {:else if plan.used != null}已用 {amount(plan.used)} {plan.unit || ''}
            {:else}暂无额度数据{/if}
          </strong>
        </div>
        {#if plan.percentage != null && !plan.unlimited}
          <div class="quota-track" role="meter" aria-label={plan.name + '已用额度'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={plan.percentage}>
            <div style:width={Math.max(0, Math.min(100, plan.percentage)) + '%'} class:exhausted={plan.percentage >= 100}></div>
          </div>
        {/if}
        {#if plan.used != null || plan.total != null || plan.resetsAt}
          <div class="quota-detail"><span>{plan.used != null ? '已用 ' + amount(plan.used) + (plan.unit ? ' ' + plan.unit : '') : ''}{plan.total != null ? ' / 总额 ' + amount(plan.total) + (plan.unit ? ' ' + plan.unit : '') : ''}</span><span>{reset(plan.resetsAt)}</span></div>
        {/if}
      </div>
    {/each}
    {#if data._fetchTime}<div class="quota-age">{Math.max(0, Math.floor((now - data._fetchTime) / 60000)) < 1 ? '刚刚更新' : Math.floor((now - data._fetchTime) / 60000) + '分钟前更新'}</div>{/if}
  </div>
{/if}

<style>
  .quota-usage { display: grid; gap: 12px; padding: 12px 0; }
  .quota-plan { font-size: 12px; color: var(--text-secondary, #90949d); }
  .quota-line, .quota-detail { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .quota-line { font-size: 12px; color: var(--text-primary, #e9edf4); }
  strong { font-weight: 600; font-variant-numeric: tabular-nums; }
  .quota-track { height: 5px; margin-top: 7px; border-radius: 5px; background: var(--border-color, #ffffff20); overflow: hidden; }
  .quota-track div { height: 100%; background: var(--accent-color, #6197ff); border-radius: inherit; }
  .quota-track div.exhausted { background: #e96969; }
  .quota-detail, .quota-age { margin-top: 5px; font-size: 10px; line-height: 1.4; color: var(--text-secondary, #90949d); }
  .quota-age { margin-top: 0; text-align: right; }
</style>
