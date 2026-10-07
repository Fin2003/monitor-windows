function readPage(replies = false) {
  const articles = [...document.querySelectorAll('article')];
  const tweets = articles.map(article => {
    const time = article.querySelector('time[datetime]');
    const link = time?.closest('a[href]') || (!replies ? article.querySelector('a[href*="/status/"]') : null);
    const id = link?.href.match(/^https:\/\/(?:x|twitter)\.com\/thsottiaux\/status\/(\d{15,22})(?:[/?#]|$)/i)?.[1];
    return id ? { id, at: time ? Date.parse(time.getAttribute('datetime')) : NaN,
      pinned: /^(?:Pinned|置顶)/i.test(article.querySelector('[data-testid="socialContext"]')?.textContent?.trim() || '') } : null;
  }).filter(Boolean);
  const ids = [...new Set(tweets.map(tweet => tweet.id))];
  const times = tweets.filter(tweet => !tweet.pinned).map(tweet => tweet.at).filter(Number.isFinite);
  return {ids,url:location.href,text:document.body.innerText.slice(0,5000),articles:articles.length,oldestAt:times.length ? Math.min(...times) : null};
}
function pageState(page, replies) {
  let url;
  try { url = new URL(page.url); } catch (_) { return 'redirected'; }
  if (!['x.com','twitter.com'].includes(url.hostname)) return 'redirected';
  // X's login wall: /i/flow/login, /login, and since 2026-10 /i/jf/onboarding/web?mode=login.
  if (/\/i\/flow\/(?:login|signup)|\/i\/jf\/onboarding|\/login/.test(url.pathname)) return 'login_required';
  if (url.pathname.replace(/\/$/,'') !== `/thsottiaux${replies ? '/with_replies' : ''}`) return 'redirected';
  if (page.ids?.length) return 'ready';
  const text = page.text || '';
  if (/rate limit|too many requests|频率限制|请求过多/i.test(text)) return 'rate_limited';
  if (/verify (?:you are|you're) human|authenticate your account|验证您是|验证你是/i.test(text)) return 'challenge';
  if (/something went wrong|try reloading|出错了|出了点问题/i.test(text)) return 'page_error';
  if (/log in to (?:view|see)|sign in to (?:view|see)|登录以查看|登录后(?:才能)?查看/i.test(text)) return 'login_required';
  return 'loading';
}
const messages = {
  login_required:'X 要求登录后查看回复，请连接 X 会话',
  page_error:'X 页面返回加载错误，自动重试后仍未恢复',
  rate_limited:'X 请求频率受限，稍后重试',
  challenge:'X 要求人工验证，请打开 X 会话处理',
  redirected:'X 页面发生跳转，不能确认回复列表',
  loading:'X 页面未返回帖子，无法确认回复覆盖',
  coverage_incomplete:'X 回复未覆盖预告前两天',
};
function interrupted(promise, signal) {
  return new Promise((resolve,reject)=>{
    const aborted=()=>{cleanup();reject(signal.reason || new Error('抓取已停止'));};
    const cleanup=()=>signal.removeEventListener('abort',aborted);
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted) aborted(); else signal.addEventListener('abort',aborted,{once:true});
  });
}
function wait(ms,signal) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(signal.reason || new Error('抓取已停止'));};
    const timer=setTimeout(()=>{cleanup();resolve();},ms);
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
}
async function readTimeline(scraper, {replies=false, signal, pause=wait, timeoutMs=35000, oldestRequiredAt=null}={}) {
  const controller=new AbortController();
  // The timeout names the step that hung, so a stuck page load can be told apart from a slow page.
  let stage='加载页面',reads=0,startedAt=Date.now(),loadedAt=null;
  const timer=setTimeout(()=>{
    const error=new Error(`X 页面读取超时（${stage}）`);error.code='timeout';
    // What the page showed when time ran out (no post content, only the page's first visible words).
    error.diagnostic={stage,reads,loadMs:loadedAt && loadedAt-startedAt,state,url:page.url || url,articles:page.articles ?? null,
      text:typeof page.text==='string' ? page.text.replace(/\s+/g,' ').slice(0,160) : null,
      scraper:scraper.debugState?.() ?? null};
    controller.abort(error);
  },timeoutMs);
  const combined=signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
  const run=fn=>{combined.throwIfAborted();return interrupted(fn(),combined);};
  const url=`https://x.com/thsottiaux${replies ? '/with_replies?lang=en' : ''}`;
  let page={},state='loading',retried=false,scrolls=0,oldestAt=null;
  const requiredAt = replies && Number.isFinite(oldestRequiredAt) ? oldestRequiredAt : null;
  const maxScrolls = requiredAt === null ? 3 : 8;
  const found=new Set();
  try {
    await run(()=>scraper.reloadPage(url));
    stage='读取帖子';loadedAt=Date.now();
    for(let attempt=0;attempt<(requiredAt === null ? 10 : 15);attempt++) {
      await pause(1200,combined);
      page=await run(()=>scraper.executeScript(readPage,replies));
      reads++;
      state=pageState(page,replies);
      if(state==='ready') {
        for(const id of page.ids)found.add(id);
        if(Number.isFinite(page.oldestAt)) oldestAt=oldestAt === null ? page.oldestAt : Math.min(oldestAt,page.oldestAt);
        if(!replies || (requiredAt === null ? scrolls>=maxScrolls : oldestAt !== null && oldestAt<=requiredAt))
          return {...page,ids:[...found],retried,coverageStart:oldestAt};
        if(scrolls>=maxScrolls) break;
        await run(()=>scraper.executeScript(()=>window.scrollBy(0,Math.max(innerHeight,800))));
        scrolls++;
      } else if(state==='page_error' && !retried) {
        retried=true;
        const clicked=await run(()=>scraper.executeScript(()=>{
          const retry=[...document.querySelectorAll('button,[role="button"]')].find(b=>/^(?:Retry|重试|重新加载)$/i.test(b.innerText.trim()));
          if(retry){retry.click();return true;}return false;
        }));
        if(!clicked) await run(()=>scraper.reloadPage(url));
      } else if(state!=='loading') break;
    }
    // Partial pages remain a warning: an error after scrolling is not full recovery.
    const code=state==='ready' && requiredAt !== null ? 'coverage_incomplete' : state==='ready' ? 'loading' : state;
    const error=new Error(messages[code] || messages.loading);
    error.code=code;
    error.ids=[...found];
    error.diagnostic={url:page.url || url,status:error.code,retried,found:found.size,oldestAt,requiredAt};
    throw error;
  } finally { clearTimeout(timer); }
}
module.exports={readPage,pageState,readTimeline};
