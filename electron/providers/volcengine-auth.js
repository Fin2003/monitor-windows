// Runs inside the browser context; keep this function self-contained.
function readLoginState() {
  if (location.protocol !== "https:" || location.hostname !== "console.volcengine.com") return "pending";
  const text = document.body?.innerText || "";
  const visible = el => el.getClientRects().length > 0;
  if (/\/login(?:\/|$)/.test(location.pathname) ||
      /立即登录使用|请先登录/.test(text) ||
      Array.from(document.querySelectorAll('input[type="password"], .login-container')).some(visible)) {
    return "unauthorized";
  }
  if (document.readyState === "loading" || !text.trim()) return "pending";
  // Neither a redirect nor the absence of a password field proves login.
  const account = /账号\s*ID\s*[:：]?\s*\d+/i.test(text) || /退出登录|退出账号/.test(text);
  const usage = /当前会话|近\s*5\s*小时/.test(text) && /\d+(?:\.\d+)?\s*%/.test(text);
  const subscription = /\/ark\//.test(location.pathname) &&
    /Coding\s*Plan|Agent\s*Plan/i.test(text) && /立即订阅|查看套餐概览/.test(text);
  return account || usage || subscription ? "connected" : "pending";
}

module.exports = { readLoginState };
