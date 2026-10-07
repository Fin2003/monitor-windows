const fs = require('node:fs');
const path = require('node:path');
const { app, net } = require('electron');
const ProviderManager = require('../../electron/providers/ProviderManager');
const { buildState } = require('./core.cjs');
const semantic = require('./semantic.cjs');
const jevDecision = require('./jev-decision.cjs');
const { readTimeline } = require('./timeline-reader.cjs');
const { displayTimeZone } = require('./presentation.cjs');
const manualResets = require('./manual-resets.cjs');
const JEV_HOUR_VERSION = 11;
const INPUT_MODEL = { baseUrl: '', model: '', format: '' };

class TiboRadar {
  constructor(configStore, options = {}) {
    this.configStore = configStore;
    this.model = options.model || null;
    this.jev = options.jev || null;
    this.hasXLogin = options.hasXLogin || (async () => false);
    this.file = options.file || path.join(app.getPath('userData'), 'tibo-radar-state.json');
    // Hand-marked resets (no completion post from Tibo); also read and written by the ESP32 bridge.
    this.manualFile = options.manualFile || path.join(path.dirname(this.file), manualResets.FILE_NAME);
    this.manager = options.manager || new ProviderManager();
    this.posts = new Map();
    this.contextPosts = new Map();
    this.pendingIds = new Set();
    this.suppressedReplyIds = new Set();
    this.bodyFailures = new Map();
    this.jevLastError = '';
    this.meta = { lastAttempt: null, lastSuccess: null, timelineSuccess: null, errors: [], source: 'X 网页 + FxTwitter 全文', coverage: '公开预览，不能保证全部帖子与回复均被收录' };
    this.running = false;
    this.generation = 0;
    this.lastHistory = 0;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const post of saved.posts || []) if (post.id) this.posts.set(post.id, post);
      for (const post of saved.contextPosts || []) if (post.id) this.contextPosts.set(post.id, post);
      this.pendingIds = new Set(saved.pendingIds || []);
      this.meta = { ...this.meta, ...saved.meta, errors: [] };
    } catch (_) {}
    try {
      const imported = JSON.parse(fs.readFileSync(`${this.file}.replies.json`,'utf8'));
      for (const tweet of imported.tweets || []) this.addContextTweet(tweet);
    } catch (_) {}
    let staged;
    try {
      staged = JSON.parse(fs.readFileSync(`${this.file}.reanalysis.json`, 'utf8'));
      for (const tweet of staged.supportingTweets || []) this.addContextTweet(tweet);
    } catch (_) {}
    // Revalidate old JSON locally; a prompt update must not re-bill all history.
    const model = this.model?.get();
    if (model?.baseUrl && model?.model) {
      for (const post of this.posts.values()) {
        const parents = semantic.context(post, this.posts);
        const replies = semantic.timeContext(post, this.posts, this.contextPosts);
        if (post.analysis?.raw && (!replies.length || post.analysis.raw.kind !== 'forecast') && [1,2,3,4].some(version => post.analysis.fingerprint === semantic.fingerprint(post, parents, model, version))) {
          try { post.analysis = { ...semantic.validate(post.analysis.raw, post), analyzedAt: post.analysis.analyzedAt, policyUpdatedAt: Date.now(), fingerprint: semantic.fingerprint(post, parents, model, undefined, replies) }; }
          catch (_) { /* Leave invalid output for the normal retry queue. */ }
        }
      }
      // An explicit offline reanalysis is staged separately from the live cache.
      for (const result of [staged, ...(staged?.results || [])].filter(Boolean)) try {
        const post = this.posts.get(result.id);
        const replies = post ? semantic.timeContext(post, this.posts, this.contextPosts) : [];
        if (post && result.fingerprint === semantic.fingerprint(post, semantic.context(post, this.posts), model, undefined, replies)) {
          post.analysis = { ...semantic.validate(result.raw, post, replies), fingerprint: result.fingerprint };
          post.analysisRetryAt = null;
          post.analysisError = null;
          post.analysisFailures = 0;
        }
      } catch (_) {}
      for (const post of this.posts.values()) {
        const parents = semantic.context(post, this.posts);
        const replies = semantic.timeContext(post, this.posts, this.contextPosts);
        if (post.analysis?.raw && post.analysis?.eta && !post.analysis.eta.timeClass
          && post.analysis.fingerprint === semantic.fingerprint(post, parents, model, undefined, replies)) try {
          post.analysis = { ...semantic.validate(post.analysis.raw, post, replies), fingerprint: post.analysis.fingerprint,
            analyzedAt: post.analysis.analyzedAt };
        } catch (_) {}
      }
    }
    const jevModel = this.jev?.get();
    if (jevModel?.hasApiKey) try {
      const stagedJev = JSON.parse(fs.readFileSync(`${this.file}.jev.json`, 'utf8'));
      for (const entry of stagedJev.results || []) {
        const post = this.posts.get(entry.id);
        if (!post || !entry.jev) continue;
        const parents = semantic.context(post, this.posts);
        const replies = semantic.timeContext(post, this.posts, this.contextPosts);
        if (entry.fingerprint === semantic.fingerprint(post, parents, jevModel, 6, replies)) post.jev = { ...entry.jev, fingerprint: entry.fingerprint };
      }
    } catch (_) {}
    if (jevModel?.hasApiKey) try {
      const stagedHours = JSON.parse(fs.readFileSync(`${this.file}.jev-hours.json`, 'utf8'));
      const allTiboPosts = new Map([...this.posts, ...this.contextPosts]);
      for (const entry of stagedHours.results || []) {
        const post = this.posts.get(entry.id);
        if (!post?.jev || !entry.hour) continue;
        const parents = semantic.context(post, this.posts);
        const replies = semantic.timeContext(post, allTiboPosts);
        const current = semantic.fingerprint(post, parents, jevModel, JEV_HOUR_VERSION, replies);
        if (entry.fingerprint === current || [7, 8].some(version => entry.fingerprint === semantic.fingerprint(post, parents, jevModel, version, replies))) {
          const candidates = jevDecision.hourCandidates(post, replies);
          const candidate = jevDecision.selectedCandidate(candidates, entry.hour.choice);
          if (candidate || (entry.hour.choice === 'unknown' && !candidates.length)) post.jev.hour = {
            ...entry.hour, supported: !!candidate, candidate, fingerprint: current };
        }
      }
    } catch (_) {}
    for (const post of this.posts.values()) {
      post.analysisProvider ||= post.analysis?.source === 'jev' ? 'jev' : 'glm';
      if (post.analysis && !post.analysisInputFingerprint) post.analysisInputFingerprint = this.analysisInput(post).fingerprint;
    }
  }

  config() {
    const saved = this.configStore?.get('tiboRadar') || {};
    return { intervalSeconds: Math.max(60, Math.min(900, Number(saved.intervalSeconds) || 120)), paused: !!saved.paused,
      repliesEnabled: saved.repliesEnabled === true, analysisProvider: saved.analysisProvider === 'jev' ? 'jev' : 'glm',
      displayTimeZone: displayTimeZone(saved.displayTimeZone) };
  }

  configure(value) {
    const next = { ...this.config(), ...value };
    next.intervalSeconds = Math.max(60, Math.min(900, Math.round(Number(next.intervalSeconds) || 120)));
    next.paused = !!next.paused;
    next.repliesEnabled = next.repliesEnabled === true;
    next.analysisProvider = next.analysisProvider === 'jev' ? 'jev' : 'glm';
    next.displayTimeZone = displayTimeZone(next.displayTimeZone);
    if (next.analysisProvider === 'jev' && !(this.jev?.get()?.hasApiKey && this.jev?.get()?.model === 'typesafe-ai/jev')) throw new Error('请先保存 JEV 连接密钥');
    if (!next.repliesEnabled) {
      this.meta.repliesError = null;
      this.meta.repliesRetryAt = null;
      this.meta.repliesDiagnostic = null;
      this.meta.repliesStatus = 'off';
      this.meta.errors = this.meta.errors.filter(error => !error.startsWith('X 回复：'));
    } else if (!this.config().repliesEnabled) this.suppressedReplyIds.clear();
    this.configStore?.set('tiboRadar', next);
    if (this.running && !this.job) this.schedule(next.paused ? 1000 : 0);
    return this.snapshot();
  }

  // value: { action: 'mark', kind: 'hard'|'banked', date: 'YYYY-MM-DD', hour, minute } or { action: 'undo', id }
  manualReset(value = {}) {
    if (value.action === 'undo') manualResets.undo(value.id, { file: this.manualFile });
    else manualResets.mark(value, { radar: this.snapshot(), timeZone: displayTimeZone(this.config().displayTimeZone), file: this.manualFile });
    return this.snapshot();
  }

  analysisInput(post) {
    const repliesEnabled = this.config().repliesEnabled;
    const parents = semantic.context(post, this.posts).filter(parent => repliesEnabled || !parent.replyToId);
    const replies = repliesEnabled ? semantic.timeContext(post, this.posts, this.contextPosts) : [];
    return { parents, replies, fingerprint: semantic.fingerprint(post, parents, INPUT_MODEL, 7, replies) };
  }

  modelEnabled() {
    const provider = this.config().analysisProvider;
    const model = provider === 'jev' ? this.jev?.get() : this.model?.get();
    return !!(model?.baseUrl && model?.model && (provider !== 'jev' || model.hasApiKey));
  }

  snapshot() {
    const config = this.config();
    const modelEnabled = this.modelEnabled();
    const activeModel = config.analysisProvider === 'jev' ? this.jev?.get() : this.model?.get();
    const manual = manualResets.load(this.manualFile);
    const posts = [...this.posts.values(), ...manualResets.syntheticPosts(manual)].filter(post => config.repliesEnabled || !post.replyToId).map(post => {
      let analysis = post.analysis || null;
      if (!config.repliesEnabled && (analysis?.eta?.timeClass === 'inferred' || analysis?.timeWindow?.sourcePostId)) analysis = { ...analysis, eta: null, timeWindow: null, corroboration: null };
      const jev = post.analysisProvider === 'jev' && post.jev ? { ...post.jev,
        hour: post.jev.hour?.supported ? { ...post.jev.hour, estimatedAt: jevDecision.estimatedAt(post.jev.hour.candidate) } : post.jev.hour } : null;
      return { ...post, analysis, jev };
    });
    const state = buildState(posts, Date.now(), { useLLM: true, allowRules: !modelEnabled });
    return { ...state, config, manual: manualResets.pickerInfo({ radar: state, timeZone: displayTimeZone(config.displayTimeZone), list: manual }),
      meta: { ...this.meta, modelEnabled, analysisMode: modelEnabled ? config.analysisProvider : 'rules', modelName: activeModel?.model || '',
        analysisPending: modelEnabled ? posts.filter(post => semantic.candidate(post) && !post.analysis).length : 0,
        analysisProvider: config.analysisProvider, running: this.running, fetching: !!this.job,
        nextPollAt: this.nextPollAt || null, storedPosts: posts.length, backlog: this.pendingIds.size } };
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ posts: [...this.posts.values()], contextPosts: [...this.contextPosts.values()], pendingIds: [...this.pendingIds], meta: this.meta }));
      fs.renameSync(tmp, this.file);
    } catch (error) { this.meta.errors.push(`缓存写入失败：${error.message}`); }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.nextPollAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      if (this.config().paused) { this.schedule(5000); return; }
      this.refresh().catch(() => {});
    }, ms);
  }

  stop() {
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
    this.nextPollAt = null;
    this.controller?.abort();
    this.manager.getScraperIfActive('tibo-radar-public')?.destroy();
    this.manager.getScraperIfActive('tibo-radar-anonymous')?.destroy();
  }

  async json(url, init = {}) {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(16000)]);
    const response = await net.fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  addTweet(tweet) {
    if (!tweet || tweet.author?.screen_name?.toLowerCase() !== 'thsottiaux') return false;
    const publishedAt = Number(tweet.created_timestamp) * 1000 || Date.parse(tweet.created_at);
    // Photo/video or quote-only posts come back with empty text; they are complete, not failed
    // fetches (one such post kept every cycle in 抓取异常 and froze lastSuccess).
    const media = tweet.media?.all?.length ? (tweet.media.videos?.length ? '[视频]' : '[图片]') : '';
    const text = tweet.text || (media || tweet.quote ? [media, tweet.quote ? '[引用帖子]' : ''].filter(Boolean).join(' ') : '');
    if (!/^\d{15,22}$/.test(tweet.id) || !Number.isFinite(publishedAt) || !text) return false;
    tweet = { ...tweet, text };
    const prior = this.posts.get(tweet.id);
    const unchanged = prior?.text === tweet.text && prior.publishedAt === publishedAt;
    const config = this.config();
    this.posts.set(tweet.id, { ...prior, id: tweet.id, text: tweet.text, publishedAt, author: 'thsottiaux', url: `https://x.com/thsottiaux/status/${tweet.id}`, quoteId: tweet.quote?.id || null, replyToId: tweet.replying_to_status || null, fetchedAt: Date.now(), fullText: true,
      analysis: unchanged ? prior.analysis : null, analysisRetryAt: unchanged ? prior.analysisRetryAt : null,
      analysisError: unchanged ? prior.analysisError : null, analysisFailures: unchanged ? prior.analysisFailures : 0,
      jev: unchanged ? prior.jev : null, jevRetryAt: unchanged ? prior.jevRetryAt : null,
      jevFailures: unchanged ? prior.jevFailures : 0, jevHourRetryAt: unchanged ? prior.jevHourRetryAt : null,
      jevHourFailures: unchanged ? prior.jevHourFailures : 0,
      analysisInputFingerprint: unchanged ? prior.analysisInputFingerprint : null,
      analysisProvider: prior?.analysisProvider || config.analysisProvider });
    this.pendingIds.delete(tweet.id);
    if (tweet.quote) this.addTweet(tweet.quote);
    if (tweet.replying_to_status && !this.posts.has(tweet.replying_to_status) && !this.contextPosts.has(tweet.replying_to_status)) this.pendingIds = new Set([tweet.replying_to_status, ...this.pendingIds]);
    return true;
  }

  addContextTweet(tweet) {
    if (tweet?.author?.screen_name?.toLowerCase() === 'thsottiaux') return this.addTweet(tweet);
    const publishedAt = Number(tweet?.created_timestamp)*1000 || Date.parse(tweet?.created_at);
    if (!/^\d{15,22}$/.test(tweet?.id || '') || !tweet.text || !tweet.author?.screen_name || !Number.isFinite(publishedAt)) return false;
    // Other authors are evidence-only: never include them in the event feed.
    this.contextPosts.set(tweet.id,{id:tweet.id,text:tweet.text,publishedAt,author:tweet.author.screen_name,replyToId:tweet.replying_to_status || null,quoteId:tweet.quote?.id || null});
    this.pendingIds.delete(tweet.id);
    while (this.contextPosts.size > 200) this.contextPosts.delete(this.contextPosts.keys().next().value);
    return true;
  }

  async history() {
    const response = await net.fetch('https://codex-resets.com/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_resets', arguments: { limit: 100, order: 'desc' } } }),
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(16000)])
    });
    if (!response.ok) throw new Error(`历史补充 HTTP ${response.status}`);
    const text = await response.text();
    const line = text.split('\n').find(l => l.startsWith('data: '));
    const rpc = JSON.parse(line ? line.slice(6) : text);
    const payload = JSON.parse(rpc.result.content.find(c => c.type === 'text').text);
    if (!Array.isArray(payload.data)) throw new Error('历史数据格式异常');
    for (const entry of payload.data) {
      // Only use the tracker as an ID index. Its observed time is NOT a post timestamp.
      const id = entry.source?.url?.match(/x\.com\/thsottiaux\/status\/(\d+)/)?.[1];
      if (id && !this.posts.has(id) && !this.suppressedReplyIds.has(id)) this.pendingIds.add(id);
    }
    this.lastHistory = Date.now();
  }

  async timeline(replies = false, options = {}) {
    const scraper = this.manager.getOrCreateScraper(replies ? 'tibo-radar-public' : 'tibo-radar-anonymous');
    let timedOut = false;
    try {
      return await readTimeline(scraper,{replies,signal:this.controller.signal,...options});
    } catch (error) {
      timedOut = error.code === 'timeout';
      throw error;
    } finally {
      // A hung page can leave the scraper stuck for every later cycle; start the next one from a new scraper.
      if (timedOut) scraper.destroy();
      else scraper.releaseWindow();
    }
  }

  async refresh({forceReplies=false} = {}) {
    if (!this.running) return this.snapshot();
    if (this.job) return forceReplies ? this.job.then(()=>this.refresh({forceReplies:true})) : this.job;
    if (forceReplies) this.meta.repliesRetryAt = 0;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.controller = new AbortController();
    this.job = this.cycle(generation).finally(() => {
      this.job = null;
      if (this.running) this.schedule(generation !== this.generation ? 0
        : this.config().intervalSeconds * 1000 * Math.min(8, 2 ** (this.failures || 0)));
    });
    return this.job;
  }

  async cycle(generation) {
    this.meta.lastAttempt = Date.now();
    this.meta.errors = [];
    let sourceOk = false;
    try {
      const data = await this.timeline();
      if (generation !== this.generation) return this.snapshot();
      this.meta.timelineSuccess = Date.now();
      this.meta.timelinePosts = data.ids.length;
      // Put newly seen timeline posts before historical backfill.
      this.pendingIds = new Set([...data.ids.filter(id => !this.posts.has(id) && !this.suppressedReplyIds.has(id)),
        ...data.ids.slice(0, 5).filter(id => !this.suppressedReplyIds.has(id)), ...this.pendingIds]);
      sourceOk = true;
      this.meta.timelineDiagnostic = null;
    } catch (error) {
      this.meta.errors.push(`X：${error.message}`);
      this.meta.timelineDiagnostic = error.diagnostic || null;
    }
    if (generation !== this.generation) return this.snapshot();
    // Resolve new main posts before deciding how far the reply timeline must be read.
    await this.fetchPending(generation);
    if (generation !== this.generation) return this.snapshot();
    const repliesEnabled = this.config().repliesEnabled;
    let xConnected = false;
    if (repliesEnabled) try { xConnected = await this.hasXLogin(); }
    catch (error) { this.meta.errors.push(`X 回复：登录态检查失败：${error.message}`); }
    if (generation !== this.generation) return this.snapshot();
    this.meta.xConnected = xConnected;
    if (!repliesEnabled) {
      this.meta.repliesStatus = 'off';
      this.meta.repliesError = null;
      this.meta.repliesRetryAt = null;
      this.meta.repliesDiagnostic = null;
      this.meta.repliesCoverageStart = null;
      this.meta.errors = this.meta.errors.filter(error => !error.startsWith('X 回复：'));
    } else if (!xConnected) {
      this.meta.repliesStatus = 'login_required';
      this.meta.repliesError = '请连接 X 后读取回复';
      this.meta.repliesCoverageStart = null;
      this.meta.repliesRetryAt = null;
      this.meta.errors.push(`X 回复：${this.meta.repliesError}`);
    } else if (!this.meta.repliesRetryAt || Date.now() >= this.meta.repliesRetryAt) try {
      const recentForecasts = [...this.posts.values()].filter(post => post.publishedAt >= Date.now() - 2 * 86400000
        && semantic.needsTimeContext(post) && (!post.analysis || (post.analysis.kind === 'forecast' && !post.analysis.banked)));
      const requiredAt = recentForecasts.length ? Math.min(...recentForecasts.map(post => post.publishedAt - 2 * 86400000)) : null;
      const data = await this.timeline(true, requiredAt !== null ? { oldestRequiredAt: requiredAt, timeoutMs: 45000 } : {});
      if (generation !== this.generation) return this.snapshot();
      if (requiredAt !== null && (!Number.isFinite(data.coverageStart) || data.coverageStart > requiredAt)) {
        const error = new Error('X 回复未覆盖预告前两天');
        error.code = 'coverage_incomplete';
        error.ids = data.ids;
        error.diagnostic = { oldestAt: data.coverageStart ?? null, requiredAt };
        throw error;
      }
      this.meta.repliesSuccess = Date.now();
      this.meta.repliesPosts = data.ids.length;
      this.meta.repliesCoverageStart = Number.isFinite(data.coverageStart) ? data.coverageStart : null;
      this.meta.repliesError = null;
      this.meta.repliesStatus = 'ready';
      this.meta.repliesDiagnostic = null;
      this.meta.repliesFailures = 0;
      this.meta.repliesRetryAt = null;
      this.pendingIds = new Set([...data.ids.filter(id=>!this.posts.has(id) && !this.contextPosts.has(id)), ...this.pendingIds]);
      sourceOk = true;
    } catch (error) {
      if (generation !== this.generation) return this.snapshot();
      this.meta.repliesError = error.message;
      this.meta.repliesStatus = error.code || 'unavailable';
      // The X cookie can outlive the session: X itself showing its login wall means not connected.
      if (error.code === 'login_required') this.meta.xConnected = false;
      this.meta.repliesDiagnostic = error.diagnostic || null;
      this.meta.repliesCoverageStart = Number.isFinite(error.diagnostic?.oldestAt) ? error.diagnostic.oldestAt : null;
      if (error.ids?.length) this.pendingIds = new Set([...error.ids.filter(id=>!this.posts.has(id) && !this.contextPosts.has(id)),...this.pendingIds]);
      this.meta.repliesFailures = (this.meta.repliesFailures || 0) + 1;
      this.meta.repliesRetryAt = Date.now() + Math.min(60, 5 * 2 ** Math.min(this.meta.repliesFailures, 4)) * 60000;
      this.meta.errors.push(`X 回复：${error.message}`);
    }
    else if (this.meta.repliesError) this.meta.errors.push(`X 回复：${this.meta.repliesError}`);
    if (generation !== this.generation) return this.snapshot();
    if (Date.now() - this.lastHistory > 15 * 60000) {
      try { await this.history(); } catch (error) { this.meta.errors.push(`历史补充：${error.message}`); }
    }
    await this.fetchPending(generation);
    if (generation !== this.generation) return this.snapshot();
    await this.analyzePending(generation);
    if (generation !== this.generation) return this.snapshot();
    if (generation !== this.generation) return this.snapshot();
    if (sourceOk && !this.meta.errors.some(e => e.startsWith('正文'))) this.meta.lastSuccess = Date.now();
    // Back off only when the timeline source fails; one unreadable post must not slow every cycle.
    this.failures = sourceOk ? 0 : (this.failures || 0) + 1;
    this.save();
    return this.snapshot();
  }

  async fetchPending(generation) {
    const candidates = [...this.pendingIds].filter(id => !this.suppressedReplyIds.has(id)).slice(0, 15);
    for (let i = 0; i < candidates.length; i += 3) {
      if (generation !== this.generation) return;
      await Promise.all(candidates.slice(i, i + 3).map(async id => {
        try {
          const result = await this.json(`https://api.fxtwitter.com/thsottiaux/status/${id}`);
          if (generation !== this.generation) return;
          if (result.code !== 200 || !result.tweet) throw new Error(result.message || '无正文');
          if (!this.config().repliesEnabled && result.tweet.replying_to_status) {
            this.suppressedReplyIds.add(id);
            this.pendingIds.delete(id);
            return;
          }
          // Quotes may belong to others; never classify their text as Tibo's announcement.
          if (result.tweet.author?.screen_name?.toLowerCase() !== 'thsottiaux') {
            if ([...this.posts.values()].some(p=>p.replyToId === id || p.quoteId === id)) this.addContextTweet(result.tweet);
            this.pendingIds.delete(id); return;
          }
          if (!this.addTweet(result.tweet)) throw new Error('正文或发布时间不完整');
          this.bodyFailures.delete(id);
        } catch (error) {
          if (generation !== this.generation) return;
          const failures = (this.bodyFailures.get(id) || 0) + 1;
          this.bodyFailures.set(id, failures);
          // A deleted or temporarily failing post must not starve the rest of backfill;
          // after three failed reads it stops being retried until the next restart.
          this.pendingIds.delete(id);
          if (failures < 3) {
            this.pendingIds.add(id);
            this.meta.errors.push(`正文 ${id}：${error.message}`);
          }
        }
      }));
    }
  }

  async analyzePending(generation = this.generation) {
    if (!this.modelEnabled()) return;
    let count = 0;
    const batchStarted = Date.now();
    for (const post of [...this.posts.values()].sort((a, b) => b.publishedAt - a.publishedAt)) {
      if (generation !== this.generation || this.controller?.signal.aborted || count >= 4 || Date.now() - batchStarted >= 150000) break;
      if (!semantic.candidate(post) || (!this.config().repliesEnabled && post.replyToId)) continue;
      const input = this.analysisInput(post);
      const changed = post.analysisInputFingerprint !== input.fingerprint && post.analysis?.kind === 'forecast'
        && post.publishedAt >= Date.now() - 3 * 86400000;
      const missingHour = post.analysisProvider === 'jev' && post.jev?.ordinary.choice === 'forecast'
        && post.jev?.banked.choice === 'none' && !post.jev.hour;
      if (post.analysis && !changed && !missingHour) continue;
      const provider = post.analysisProvider === 'jev' ? 'jev' : 'glm';
      const connection = provider === 'jev' ? this.jev : this.model;
      const model = connection?.get();
      if (!model?.baseUrl || !model?.model || (provider === 'jev' && !model.hasApiKey)) {
        this.meta.errors.push(`${provider.toUpperCase()}：请先保存模型连接`);
        break;
      }
      if (post.analysisRetryAt > Date.now()) {
        if (post.analysisError) this.meta.errors.push(`${provider.toUpperCase()} ${post.id}：${post.analysisError}（等待重试）`);
        continue;
      }
      count++;
      try {
        if (provider === 'jev') await this.analyzeJevPost(post, model, input, generation);
        else {
          const { analysis } = await semantic.analyze(this.model, post, input.parents, input.replies, this.controller?.signal);
          if (generation !== this.generation) break;
          post.analysis = { ...analysis, fingerprint: semantic.fingerprint(post, input.parents, model, undefined, input.replies) };
          post.analysisInputFingerprint = input.fingerprint;
        }
        if (generation !== this.generation) break;
        post.analysisRetryAt = null;
        post.analysisError = null;
        post.analysisFailures = 0;
      } catch (error) {
        if (generation !== this.generation || this.controller?.signal.aborted) break;
        post.analysisFailures = (post.analysisFailures || 0) + 1;
        post.analysisRetryAt = Date.now() + Math.min(60, 5 * 2 ** Math.min(post.analysisFailures - 1, 4)) * 60000;
        post.analysisError = error.message;
        this.meta.errors.push(`${provider.toUpperCase()} ${post.id}：${error.message}`);
        // Bad post output is isolated; transport failures still stop this batch.
        if (error.code !== 'INVALID_MODEL_OUTPUT' && !/timeout|timed out|超时/i.test(error.message)) break;
      }
    }
  }

  async analyzeJevPost(post, model, input, generation) {
    const fingerprint = semantic.fingerprint(post, input.parents, model, 10, input.replies);
    if (post.jev?.fingerprint !== fingerprint) {
      const sentAt = Date.now();
      const result = await this.jev.evaluate(jevDecision.state(post, input.parents, input.replies), jevDecision.questions, this.controller?.signal);
      if (generation !== this.generation) return;
      post.jev = { ...jevDecision.parseResult(result), analyzedAt: Date.now(), elapsedMs: Date.now() - sentAt, fingerprint };
      post.analysis = jevDecision.toAnalysis(post, post.jev);
      post.analysisInputFingerprint = input.fingerprint;
    }
    if (post.jev?.ordinary.choice === 'forecast' && post.jev?.banked.choice === 'none') {
      const hourFingerprint = semantic.fingerprint(post, input.parents, model, JEV_HOUR_VERSION, input.replies);
      if (post.jev.hour?.fingerprint !== hourFingerprint) {
        if (post.jevHourRetryAt > Date.now()) {
          this.meta.errors.push(`JEV ${post.id}：选时等待重试`);
          return;
        }
        try {
          const evaluation = jevDecision.hourEvaluation(post, input.parents, input.replies);
          const sentAt = Date.now();
          const result = jevDecision.parseHourResult(await this.jev.evaluate(evaluation.state, evaluation.questions, this.controller?.signal));
          if (generation !== this.generation) return;
          const candidate = jevDecision.selectedCandidate(evaluation.candidates, result.hour.choice);
          post.jev.hour = { ...result.hour, supported: !!candidate, candidate, analyzedAt: Date.now(), elapsedMs: Date.now() - sentAt, fingerprint: hourFingerprint };
          post.jevHourRetryAt = null;
          post.jevHourFailures = 0;
        } catch (error) {
          post.jevHourFailures = (post.jevHourFailures || 0) + 1;
          post.jevHourRetryAt = Date.now() + Math.min(60, 3 * 2 ** Math.min(post.jevHourFailures - 1, 5)) * 60000;
          this.meta.errors.push(`JEV ${post.id} 时间：${error.message}`);
          return;
        }
      }
    }
    post.analysis = jevDecision.toAnalysis(post, post.jev, post.jev.hour, input.replies);
    post.analysisInputFingerprint = input.fingerprint;
  }
}

module.exports = TiboRadar;
