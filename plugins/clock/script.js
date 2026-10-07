const DAYS = ['日', '一', '二', '三', '四', '五', '六'];

function update() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');

  const timeEl = document.getElementById('time');
  const secEl = document.getElementById('seconds');
  const dateEl = document.getElementById('date');

  if (timeEl) timeEl.textContent = h + ':' + m;
  if (secEl) secEl.textContent = s;
  if (dateEl) {
    const y = now.getFullYear();
    const mon = now.getMonth() + 1;
    const d = now.getDate();
    const day = DAYS[now.getDay()];
    dateEl.textContent = y + '年' + mon + '月' + d + '日 周' + day;
  }
}

update();
setInterval(update, 1000);
