<script>
  import Icon from '@shared/components/Icon.svelte';
  import avatar from './assets/tibo.jpg';
  import { eventPresentation, postPresentation, radarState, radarOutlook, formatRadarDate, displayTimeZoneLabel } from './presentation.cjs';
  let { data, now, loading, refreshing, syncIssue, analysisIssue, onRefresh, onSettings, onInspect, onManual = () => {} } = $props();
  let canMark = $derived(!!data.manual?.canMark);
  let manualLast = $derived(data.manual?.last || null);
  function activate(event, mode) { if (event.type === 'click' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onManual(mode); } }
  let tab = $state('events');
  let filter = $state('all');
  let limit = $state(20);
  let events = $derived(data.events.filter(e => (!e.banked || e.pairedBanked) && !e.post && (e.forecast || e.completion)).slice(0, 2));
  let bankCutoff = $derived(now - 30 * 24 * 60 * 60 * 1000);
  let banks = $derived(data.banked.filter(e => !e.post && !e.pairedBanked && e.sortAt >= bankCutoff && e.sortAt <= now).slice(0, 2));
  let filtered = $derived(data.posts.filter(p => filter === 'all' || (filter === 'banked' ? p.banked && p.publishedAt >= bankCutoff && p.publishedAt <= now : p.resetRelated && !p.banked)));
  let posts = $derived(filtered.slice(0, limit));
  let pending = $derived(data.pending.find(e => !e.banked));
  let outlook = $derived(radarOutlook(data, now));
  let issue = $derived([syncIssue, analysisIssue].filter(Boolean).join('\n'));
  let stale = $derived(!data.meta.lastSuccess || now - data.meta.lastSuccess > Math.max(300000, data.config.intervalSeconds * 2500));
  let health = $derived(radarState(data, now).label);
  let recentReset = $derived(data.recentReset || (data.latest ? { publishedAt: data.latest.publishedAt, type: 'Hard' } : null));
  let age = $derived(recentReset ? elapsed(recentReset.publishedAt) : null);
  function date(at) { return at ? formatRadarDate(at, data.config?.displayTimeZone) : '时间未明确'; }
  function clock(at) { return at ? date(at).slice(-5) : '--:--'; }
  function day(at) { return at ? date(at).slice(0, 5) : ''; }
  function elapsed(at) {
    const m = Math.max(0, Math.floor((now - at) / 60000));
    return m < 1 ? { number: '刚刚', unit: '' } : m < 60 ? { number: m, unit: '分钟前' } : m < 1440 ? { number: Math.floor(m / 60), unit: '小时前' } : { number: Math.floor(m / 1440), unit: '天前' };
  }
  function tone(e) { return eventPresentation(e, now).tone; }
  function status(e) { return eventPresentation(e, now).label; }
  function excerpt(p) { return (p?.keyText || p?.text || '').replace(/\s+/g, ' ').trim(); }
  function eventFor(p) { return data.events.find(e => e.forecast?.id === p.id || e.completion?.id === p.id || e.post?.id === p.id); }
  function choose(value) { filter = value; limit = 20; }
  function more() { limit = Math.min(filtered.length, limit + 20); }
  function scroll(e) { const el = e.currentTarget; if (el.scrollHeight - el.clientHeight - el.scrollTop < 140 && limit < filtered.length) more(); }
</script>

<div class="radar-shell"><div class="radar-board">
  <header>
    <div class="brand"><img src={avatar} alt="Tibo" /><h1>Tibo 雷达</h1></div>
    <div class="tools">
      <span class="health" class:warn={!!issue || stale} title={issue || health}><i></i><span>{health}</span></span>
      <button class="icon" aria-label="立即检查新帖" title="立即检查新帖" disabled={refreshing || data.meta.fetching || !data.meta.running} onclick={onRefresh}><Icon name="refresh" size={25} /></button>
      <button class="icon" aria-label="监测设置" title="监测设置" onclick={onSettings}><Icon name="settings" size={25} /></button>
    </div>
  </header>

  <section class="overview" aria-label="重置概况">
    <div class="metric" class:actionable={!!manualLast} role={manualLast ? 'button' : undefined} tabindex={manualLast ? 0 : undefined} title={manualLast ? '手动标记的重置 · 可撤销' : undefined} onclick={e => manualLast && activate(e, 'undo')} onkeydown={e => manualLast && activate(e, 'undo')}><span class="metric-label"><span class="metric-symbol"><Icon name="refresh" size={21} /></span>最近重置{#if recentReset}<span class="reset-type" class:banked={recentReset.type === 'Banked'}>{recentReset.type}</span>{/if}{#if manualLast}<span class="manual-tag">手动</span>{/if}</span><strong class="metric-value" title={recentReset ? date(recentReset.publishedAt) : ''}>{#if age}<span class="age-number">{age.number}</span><span class="age-unit">{age.unit}</span>{:else}无记录{/if}</strong>{#if recentReset}<span class="metric-detail">{date(recentReset.publishedAt)}</span>{/if}</div>
    <div class="next" class:scheduled={!!pending} class:actionable={canMark} role={canMark ? 'button' : undefined} tabindex={canMark ? 0 : undefined} title={canMark ? 'Tibo 没发完成推文？点击手动标记重置' : undefined} onclick={e => canMark && activate(e, 'mark')} onkeydown={e => canMark && activate(e, 'mark')}><span class="metric-label"><span class="metric-symbol"><Icon name={pending ? 'clock' : 'minus'} size={21} /></span>当前状态{#if outlook.badge}<span class="forecast-tag" class:overdue={outlook.late} class:quota={outlook.tone === 'confirmed'} class:banked={outlook.tone === 'banked'} class:prediction={outlook.prediction}>{outlook.badge}</span>{/if}</span><strong class:amber={outlook.late} class:unreported={outlook.label === '未通报时间'}>{outlook.label}</strong>{#if outlook.detail}<span class="metric-detail">{outlook.detail}</span>{/if}</div>
  </section>

  <nav class="viewbar" aria-label="雷达视图">
    <div class="segments" role="tablist" aria-label="消息视图"><button role="tab" aria-selected={tab === 'events'} class:chosen={tab === 'events'} onclick={() => tab = 'events'}>事件</button><button role="tab" aria-selected={tab === 'posts'} class:chosen={tab === 'posts'} onclick={() => tab = 'posts'}>帖子</button></div>
    {#if tab === 'events'}
      <div class="bank-strip">{#each banks as bank (bank.id)}<button class="bank-token" title={`Banked 帖子 · ${date(bank.sortAt)} · 查看原文`} aria-label={`Banked +1 ${day(bank.sortAt)}`} onclick={() => onInspect(bank.completion || bank.forecast)}><span>Banked <b>+1</b></span><small>{day(bank.sortAt)}</small></button>{/each}</div>
    {:else}
      <div class="filters" aria-label="帖子筛选">{#each [['all','全部'],['reset','Reset'],['banked','Banked']] as option}<button class:active={filter === option[0]} aria-pressed={filter === option[0]} onclick={() => choose(option[0])}>{option[1]}</button>{/each}</div>
    {/if}
  </nav>

  <main>
    {#if loading}<div class="empty"><Icon name="refresh" size={36} />正在读取</div>
    {:else if tab === 'events'}
      {#if events.length}<div class="event-grid">
        {#each events as event (event.id)}
          <article class="event-card {tone(event)}" data-event-id={event.id}>
            <div class="card-heading"><button class="reset-token" title="查看 Reset 原文" onclick={() => onInspect(event.completion || event.forecast)}><Icon name="refresh" size={19} />Reset</button><time>{day(event.sortAt)}</time><strong class="badge"><Icon name={event.completion ? 'check' : 'clock'} size={20} />{status(event)}</strong></div>
            <div class="timeline">
              <button class="phase forecast" class:prediction={event.eta?.timeClass === 'prediction'} disabled={!event.forecast} title={event.forecast ? date(event.eta?.at || event.forecast.publishedAt) : '预告'} aria-label="查看预告原文" onclick={() => onInspect(event.forecast)}><span class="node"><Icon name="clock" size={21} /></span><span class="phase-label">{event.eta?.timeClass === 'prediction' ? '预测' : event.forecast ? '预计' : '预告'}</span><strong>{event.eta ? clock(event.eta.at) : event.forecast ? event.timeWindow?.label || '待定' : '—'}</strong></button>
              <span class="connector" class:confirmed={!!event.completion}><Icon name="chevron-right" size={22} /></span>
              <button class="phase completion" class:unsent={!event.completion} disabled={!event.completion} title={event.completion ? date(event.completion.publishedAt) : '完成'} aria-label={event.completion ? '查看完成原文' : '尚未发布完成通知'} onclick={() => onInspect(event.completion)}><span class="node"><Icon name={event.completion ? 'check' : 'minus'} size={21} /></span><span class="phase-label">完成</span><strong>{event.completion ? clock(event.completion.publishedAt) : '--:--'}</strong></button>
            </div>
            <button class="quote" title="查看原文" onclick={() => onInspect(event.completion || event.forecast)}><span>{excerpt(event.completion || event.forecast)}</span><Icon name="chevron-right" size={20} /></button>
          </article>
        {/each}
      </div>{:else}<div class="empty"><Icon name="clock" size={40} /><strong>暂无 Reset</strong></div>{/if}
    {:else}
      <div class="post-list" onscroll={scroll}>
        {#each posts as post (post.id)}
          {@const event = eventFor(post)}
          {@const display = post.display || postPresentation(post)}
          <article class="post-card {display.category === 'banked' || post.superseded ? display.tone : event ? tone(event) : display.tone}" data-post-id={post.id}>
            <div class="post-heading"><img src={avatar} alt="Tibo" /><div class="post-identity"><strong>Tibo</strong><time>{date(post.publishedAt)}</time></div>{#if display.label}<button class="post-tag" title="按此类型筛选" onclick={() => choose(display.category)}>{display.label}</button>{/if}<button class="icon" aria-label="查看帖子原文" title="查看帖子原文" onclick={() => onInspect(post)}><Icon name="eye" size={24} /></button></div>
            <p>{post.text || post.keyText}</p>
          </article>
        {:else}<div class="empty">暂无帖子</div>{/each}
        {#if filtered.length}<div class="post-pagination"><span>{posts.length} / {filtered.length}</span>{#if posts.length < filtered.length}<button onclick={more}><Icon name="chevron-down" size={24} />加载更多</button>{/if}</div>{/if}
      </div>
    {/if}
  </main>
  <footer><span title={issue || date(data.meta.lastSuccess)} class:amber={!!issue}>{radarState(data, now).issueLabel || (issue ? '读取异常' : data.meta.lastSuccess ? `${clock(data.meta.lastSuccess)} 更新` : '等待更新')}</span><span>{displayTimeZoneLabel(data.config?.displayTimeZone)}</span></footer>
</div></div>

<style>
  .radar-board { --muted:color-mix(in srgb,var(--text-primary) 62%,var(--bg)); --bank:light-dark(#147b8b,#67c4d5); width:100%; height:100%; min-width:0; padding:10px 12px 6px; display:grid; grid-template-rows:36px 74px 38px minmax(0,1fr) 22px; gap:8px; overflow:hidden; background:var(--bg); color:var(--text-primary); letter-spacing:0; container-type:size; }
  button { border:0; color:inherit; cursor:pointer; touch-action:manipulation; transition:transform 100ms ease; } button:active:not(:disabled) { transform:scale(.98); } button:disabled { cursor:default; } button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  header,.brand,.tools,.viewbar,.segments,.bank-strip,.filters,.card-heading,.badge,.timeline,.phase,.quote,.post-heading,footer { display:flex; align-items:center; }
  header,.viewbar,footer { justify-content:space-between; gap:10px; min-width:0; } .brand { gap:10px; } .brand img { width:34px; height:34px; object-fit:cover; border-radius:50%; } h1 { font-size:28px; font-weight:700; line-height:1; margin:0; white-space:nowrap; } .tools { gap:6px; } .icon { display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; flex-shrink:0; padding:0; background:transparent; border-radius:6px; } .icon:hover { background:var(--card); } .icon:disabled { opacity:.35; } .health { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:20px; white-space:nowrap; } .health i { width:7px; height:7px; border-radius:50%; background:var(--success); } .health.warn i { background:var(--warning); }
  .overview { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:center; } .metric-label { display:block; color:var(--muted); font-size:21px; line-height:1.2; } .metric-value { display:flex; align-items:baseline; font-size:44px; line-height:1; gap:6px; } .age-number { font-size:56px; } .age-unit { font-size:24px; } .green { color:var(--success); } .amber { color:var(--warning); } .next { border-left:1px solid var(--border); padding-left:20px; position:relative; } .next>strong { display:inline-block; font-size:38px; line-height:1.2; font-weight:600; } .next small { font-size:18px; color:var(--muted); margin-left:10px; }
  .segments { gap:2px; padding:3px; background:var(--card); border-radius:7px; flex-shrink:0; } .segments button { background:transparent; border-radius:5px; padding:3px 12px; font-size:23px; line-height:1; color:var(--muted); height:30px; } .segments .chosen { color:var(--text-primary); background:var(--card-hover); } .bank-strip { gap:8px; min-width:0; } .bank-token { display:flex; align-items:center; gap:8px; background:transparent; border-bottom:2px solid var(--bank); padding:3px 0; color:var(--bank); white-space:nowrap; font-size:21px; } .bank-token b { font-size:25px; } .bank-token small { font-size:17px; color:var(--muted); } .filters { gap:6px; } .filters button { background:transparent; padding:5px; font-size:21px; color:var(--muted); border-bottom:2px solid transparent; } .filters button.active { color:var(--accent); border-color:var(--accent); }
  main { min-height:0; min-width:0; } .event-grid { display:grid; grid-template-rows:repeat(2,minmax(106px,1fr)); gap:8px; height:100%; overflow:auto; } .event-card,.post-card { --state:var(--muted); min-width:0; background:var(--card); border:1px solid var(--border); border-radius:8px; } .done { --state:var(--success); } .waiting { --state:var(--accent); } .late { --state:var(--warning); } .banked { --state:var(--bank); } .related { --state:var(--warning); }
  .event-card { padding:7px 12px; display:grid; grid-template-rows:24px minmax(36px,1fr) 29px; border-top:2px solid var(--state); } .card-heading { gap:10px; font-size:19px; min-width:0; } .reset-token { display:flex; align-items:center; gap:5px; padding:0; background:transparent; color:var(--state); font-size:20px; font-weight:650; } time { color:var(--muted); font-size:19px; font-variant-numeric:tabular-nums; } .badge { margin-left:auto; color:var(--state); gap:5px; font-size:20px; white-space:nowrap; }
  .timeline { gap:12px; min-width:0; } .phase { padding:0; gap:8px; background:transparent; min-width:0; flex:1; } .node { display:flex; justify-content:center; align-items:center; width:30px; height:30px; border-radius:50%; background:color-mix(in srgb,var(--state) 15%,var(--card)); color:var(--state); flex-shrink:0; } .phase-label { font-size:20px; color:var(--muted); } .phase strong { font-size:32px; font-variant-numeric:tabular-nums; font-weight:650; color:var(--state); white-space:nowrap; } .unsent strong,.unsent .node { color:var(--muted); } .connector { display:flex; align-items:center; justify-content:center; flex:1; color:var(--muted); border-top:1px solid var(--border); height:0; } .connector :global(svg) { background:var(--card); } .connector.confirmed { color:var(--state); border-color:var(--state); } .quote { justify-content:space-between; gap:8px; padding:0; text-align:left; background:transparent; color:var(--muted); min-width:0; } .quote span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:24px; line-height:1.2; } .quote :global(svg) { flex-shrink:0; }
  .post-list { height:100%; overflow:auto; overscroll-behavior:contain; } .post-card { padding:14px; margin-bottom:12px; border-left:3px solid var(--state); } .ordinary { color:var(--muted); border-left:1px solid var(--border); } .post-heading { gap:10px; flex-wrap:wrap; } .post-heading img { width:40px; height:40px; border-radius:50%; } .ordinary img { filter:grayscale(1); } .post-identity { flex:1; } .post-identity strong { font-size:24px; } .post-identity time { display:block; } .post-tag { font-size:21px; padding:4px 6px; border-radius:5px; background:color-mix(in srgb,var(--state) 12%,var(--card)); color:var(--state); } .post-card p { font-size:34px; line-height:1.3; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; margin-top:12px; } .post-pagination { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:14px; font-size:22px; padding:16px 0; color:var(--muted); } .post-pagination button { display:flex; align-items:center; gap:6px; background:var(--card); padding:8px 12px; border-radius:6px; font-size:24px; }
  footer { font-size:18px; color:var(--muted); white-space:nowrap; } footer span { min-width:0; overflow:hidden; text-overflow:ellipsis; } .empty { height:100%; display:flex; justify-content:center; align-items:center; gap:12px; color:var(--muted); font-size:28px; }
  @container (min-width:850px) { .event-grid { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:minmax(170px,240px); align-content:start; } .event-card { padding:16px; grid-template-rows:28px 1fr 32px; } .phase { flex-wrap:wrap; } .phase strong { font-size:42px; } .quote span { font-size:28px; } }
  @container (max-width:520px) { .health span,.bank-token small,.next small { display:none; } .bank-strip { gap:6px; } .bank-token { font-size:18px; } .bank-token b { font-size:22px; } .segments button { padding:3px 8px; } .overview { gap:10px; } .next { padding-left:10px; } .next>strong { font-size:34px; } .timeline { gap:5px; } .phase { gap:4px; } .node { display:none; } .phase strong { font-size:30px; } .connector { flex:0; border:0; } .filters { gap:1px; } .filters button { font-size:19px; padding:4px; } }
  @container (max-width:380px) { .segments button { padding:3px 6px; } .filters button { font-size:18px; } .card-heading { gap:6px; } .event-card { padding-left:8px; padding-right:8px; } }
  .radar-board { --bank:#67c4d5; gap:5px; }
  :global([data-theme="light"]) .radar-board { --bank:#147b8b; }
  .bank-token { background:color-mix(in srgb,var(--bank) 10%,var(--bg)); border:0; border-radius:5px; padding:3px 5px; }
  .radar-board { padding:8px 12px 4px; grid-template-rows:34px 100px 36px minmax(0,1fr) 18px; gap:4px; }
  .overview { grid-template-columns:1fr 1fr; gap:24px; padding:4px 2px 8px; border-bottom:1px solid var(--border); }
  .metric,.next { min-width:0; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; }
  .metric-label { display:flex; align-items:center; gap:7px; font-size:21px; }
  .metric-symbol { display:flex; align-items:center; color:var(--success); }
  .next .metric-symbol { color:var(--muted); }
  .next.scheduled .metric-symbol { color:var(--accent); }
  .metric-value { color:var(--text-primary); gap:8px; line-height:1; margin-top:2px; }
  .age-number { font-size:68px; font-weight:650; }
  .age-unit { font-size:26px; color:var(--muted); font-weight:500; }
  .next { border:0; padding-left:18px; }
  .next>strong { font-size:44px; line-height:1.3; margin-top:4px; font-weight:600; }
  .next.scheduled>strong { color:var(--accent); }
  .next.scheduled>strong.amber { color:var(--warning); }
  .next>strong.unreported { font-size:40px; white-space:nowrap; }
  .metric-detail { display:none; font-size:20px; color:var(--muted); }
  .event-grid { grid-template-rows:repeat(2,minmax(99px,1fr)); }
  .event-card { padding:4px 12px; grid-template-rows:24px minmax(34px,1fr) 29px; border-top:1px solid var(--border); border-left:3px solid var(--state); }
  .connector.confirmed { border-color:color-mix(in srgb,var(--state) 45%,var(--border)); }
  .quote span { color:var(--muted); }
  .radar-shell { width:100%; height:100%; min-width:0; min-height:0; container-type:size; }
  @container (min-height:600px) { .radar-board { padding:16px 20px 10px; grid-template-rows:40px minmax(206px,1fr) 44px minmax(220px,1.25fr) 22px; gap:10px; } }
  @container (max-width:520px) { .radar-board { padding-left:12px; padding-right:12px; } }
  @container (min-height:560px) { .overview { padding:12px 8px 22px; gap:32px; } .metric-label { font-size:24px; gap:10px; } .age-number { font-size:104px; } .age-unit { font-size:30px; } .next>strong { font-size:56px; line-height:1.2; margin:12px 0; } .next { padding-left:24px; } .metric-detail { display:block; margin-top:8px; } .event-card { padding:8px 16px; grid-template-rows:24px minmax(36px,1fr) 29px; } }
  @container (min-height:560px) { .next>strong.unreported { font-size:46px; } }
  @container (min-width:850px) { .event-grid { grid-template-rows:minmax(170px,1fr); align-content:stretch; } }
  @container (max-width:520px) { .overview { gap:12px; } .next { padding-left:0; } .next>strong { font-size:34px; } .metric-symbol { display:none; } .age-number { font-size:68px; } .age-unit { font-size:23px; } .metric-label { font-size:21px; } .metric-detail { display:none; } .bank-token { padding:3px; } }
  @container (max-width:520px) { .next>strong.unreported { font-size:29px; } }
  .next .metric-label { flex-wrap:wrap; }
  .forecast-tag { padding:3px 6px; border:1px solid #957c36; border-radius:6px; color:#ffe082; background:#483b19; font-size:18px; white-space:nowrap; }
  .forecast-tag.overdue { color:#ffb98e; background:#512d20; border-color:#ac6445; }
  .forecast-tag.quota { color:#71dba6; background:#244b3a; border-color:#438763; }
  .forecast-tag.banked { color:var(--bank); background:color-mix(in srgb,var(--bank) 12%,var(--bg)); border-color:var(--bank); }
  .forecast-tag.prediction { color:#8cdef0; background:#173840; border-color:#3f8995; }
  .phase.prediction strong { color:var(--muted); }
  .phase.prediction .phase-label { color:var(--state); }
  .next.scheduled>strong,.next.scheduled .metric-symbol { color:#e4bd52; }
  .reset-type { border:1px solid var(--success); border-radius:5px; padding:1px 5px; color:var(--success); font-size:15px; line-height:1.2; font-weight:650; }
  .reset-type.banked { border-color:var(--bank); color:var(--bank); }
  @media(prefers-reduced-motion:reduce) { button { transition:none; } button:active:not(:disabled) { transform:none; } }

  /* Design system shared with the ESP32 screen: flat surfaces, tone only in text and tinted pills. */
  .radar-board { --muted:var(--text-secondary); --bank:var(--violet); background:var(--bg); }
  .waiting { --state:var(--amber); } .done { --state:var(--green); } .late { --state:var(--red); } .banked { --state:var(--violet); } .related { --state:var(--blue); }
  .event-card,.post-card { background:var(--surface); border:0; border-radius:var(--radius-card); }
  .event-card { border-top:0; border-left:0; }
  .post-card { border-left:0; } .ordinary { border-left:0; }
  /* Tagged posts take a card tinted with their tone, like the ESP32 screen; ordinary posts stay neutral. */
  .forecast { --state:var(--amber); } .completed { --state:var(--green); }
  .post-card:not(.ordinary) { background:color-mix(in srgb,var(--state) 14%,var(--surface)); }
  .overview { border-bottom:0; gap:12px; }
  .metric,.next { background:var(--surface); border-radius:var(--radius-card); padding:10px 18px; align-self:stretch; }
  .next { padding-left:18px; }
  .metric-symbol,.next .metric-symbol,.next.scheduled .metric-symbol { display:none; }
  .next.scheduled>strong { color:var(--amber); } .next.scheduled>strong.amber { color:var(--red); }
  .segments { background:var(--surface); border-radius:10px; } .segments .chosen { background:var(--border); }
  .node { background:color-mix(in srgb,var(--state) 18%,var(--surface)); }
  .connector :global(svg) { background:var(--surface); }
  .quote { background:var(--surface-2); border-radius:10px; padding:0 12px; }
  .forecast-tag,.reset-type,.bank-token,.post-tag,.manual-tag { --tone:var(--amber); display:inline-flex; align-items:center; gap:4px; border:0; border-radius:999px; padding:3px 10px; color:var(--tone); background:color-mix(in srgb,var(--tone) 18%,var(--surface)); font-weight:600; }
  .forecast-tag.overdue { --tone:var(--red); } .forecast-tag.quota { --tone:var(--green); } .forecast-tag.banked { --tone:var(--violet); } .forecast-tag.prediction { --tone:var(--cyan); }
  .reset-type { --tone:var(--green); } .reset-type.banked,.bank-token { --tone:var(--violet); }
  .post-tag { --tone:var(--state); border-radius:999px; }
  .manual-tag { --tone:var(--text-secondary); font-size:15px; }
  .bank-token small { color:var(--tone); opacity:.8; }
  .actionable { cursor:pointer; transition:background .15s; }
  .actionable:hover,.actionable:focus-visible { background:var(--surface-2); outline:none; }
</style>
