/* ============ API HELPER ============ */
const API = {
  async req(url, opts = {}) {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  },
  get(url) { return this.req(url); },
  post(url, body) {
    return this.req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
  put(url, body) {
    return this.req(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },
  del(url) { return this.req(url, { method: 'DELETE' }); },
  postForm(url, formData) { return this.req(url, { method: 'POST', body: formData }); }
};

/* ============ UTILITIES ============ */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return [...document.querySelectorAll(sel)]; }
function getIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] ? parseInt(parts[1]) : null;
}
function getTabFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[2] || null;
}
function fmtDate(d) {
  if (!d) return 'TBA';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' });
}
function fmtDateTime(date, time) {
  const d = date ? fmtDate(date) : '';
  return [d, time].filter(Boolean).join(' · ') || 'TBA';
}

/* ============ STATUS BADGE ============ */
function statusBadge(status) {
  const s = String(status || '').toUpperCase();
  const map = {
    'LIVE':                 ['badge-live',      '🟢 LIVE'],
    'UPCOMING':             ['badge-upcoming',  '🟡 UPCOMING'],
    'COMPLETED':            ['badge-completed', '⚪ COMPLETED'],
    'CANCELLED':            ['badge-cancelled', '🔴 CANCELLED'],
    'POSTPONED':            ['badge-postponed', '🟠 POSTPONED'],
    'REGISTRATION_OPEN':    ['badge-open',      '🟢 REGISTRATION OPEN'],
    'REGISTRATION_CLOSED':  ['badge-closed',    '🟡 REGISTRATION CLOSED'],
    'STARTED':              ['badge-live',      '🟢 STARTED'],
    'PENDING':              ['badge-upcoming',  '🟡 PENDING'],
    'APPROVED':             ['badge-open',      '🟢 APPROVED'],
    'REJECTED':             ['badge-cancelled', '🔴 REJECTED']
  };
  const [cls, label] = map[s] || ['badge-completed', s || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

/* ============ NAV + FOOTER ============ */
function renderNav(active = '') {
  const links = [
    ['/', 'Home'],
    ['/tournaments', 'Tournaments'],
    ['/teams', 'Teams'],
    ['/matches', 'Matches'],
    ['/points', 'Points'],
    ['/players', 'Players'],
    ['/rules', 'Rules'],
    ['/register', 'Register']
  ];
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="header-inner">
      <a href="/" class="brand">
        <span class="brand-logo">RB</span>
        <span class="brand-name">ROWDY&nbsp;BOYS</span>
      </a>
      <nav class="desktop-nav">
        ${links.map(([h,l]) => `<a href="${h}" class="${active===h?'active':''}">${l}</a>`).join('')}
        <a href="/admin" class="admin-link">Admin</a>
      </nav>
      <button class="menu-btn" id="menuBtn" aria-label="Menu">☰</button>
    </div>
    <div class="mobile-menu" id="mobileMenu">
      ${links.map(([h,l]) => `<a href="${h}" class="${active===h?'active':''}">${l}</a>`).join('')}
      <a href="/admin">Admin</a>
    </div>`;
  document.body.prepend(header);
  qs('#menuBtn').addEventListener('click', () => qs('#mobileMenu').classList.toggle('open'));
}

function renderFooter() {
  const f = document.createElement('footer');
  f.className = 'site-footer';
  f.innerHTML = `<b>ROWDY BOYS</b> · Esports Tournament Platform · © ${new Date().getFullYear()}`;
  document.body.appendChild(f);
}

/* ============ TOAST ============ */
function toast(msg, isError = false) {
  let el = qs('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = 'toast' + (isError ? ' error' : ''), 2800);
}

/* ============ EMPTY / LOADING ============ */
function loadingHTML(text = 'Loading…') {
  return `<div class="loading"><div class="spinner"></div>${esc(text)}</div>`;
}
function emptyHTML(icon, title, sub = '') {
  return `<div class="empty"><div class="empty-icon">${icon}</div><div style="font-weight:700;color:#e5e7eb;margin-bottom:4px">${esc(title)}</div>${sub ? `<div>${esc(sub)}</div>` : ''}</div>`;
}