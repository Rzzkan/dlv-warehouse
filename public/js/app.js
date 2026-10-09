import { get, post } from './api.js';
import { $, esc, toast } from './ui.js';

const PAGES = [
  { id: '', label: 'Beranda', load: () => import('./pages/dashboard.js') },
  { id: 'masuk', label: 'Barang Masuk', load: () => import('./pages/masuk.js') },
  { id: 'keluar', label: 'Barang Keluar', load: () => import('./pages/keluar.js') },
  { id: 'stok', label: 'Stok', load: () => import('./pages/stok.js') },
  { id: 'lacak', label: 'Lacak', load: () => import('./pages/lacak.js') },
  { id: 'kain', label: 'Jenis Kain', load: () => import('./pages/kain.js') },
  { id: 'riwayat', label: 'Riwayat', load: () => import('./pages/riwayat.js') },
  { id: 'admin', label: 'Admin', load: () => import('./pages/admin.js'), adminOnly: true },
];

const ctx = { user: null };
let renderToken = 0;

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [id = '', ...rest] = path.split('/');
  return { id, param: rest.length ? decodeURIComponent(rest.join('/')) : '', query: new URLSearchParams(query) };
}

function renderNav() {
  const { id } = parseHash();
  $('#nav').innerHTML = PAGES.filter((p) => !p.adminOnly || ctx.user.role === 'admin')
    .map((p) => `<a href="#/${p.id}" class="${p.id === id ? 'active' : ''}">${esc(p.label)}</a>`)
    .join('');
}

async function route() {
  if (!ctx.user) return;
  const { id, param, query } = parseHash();
  const page = PAGES.find((p) => p.id === id) || PAGES[0];
  if (page.adminOnly && ctx.user.role !== 'admin') {
    location.hash = '#/';
    return;
  }
  renderNav();
  // Elemen baru di setiap navigasi supaya listener halaman sebelumnya ikut terbuang
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  const token = ++renderToken;
  view.innerHTML = '<p class="muted">Memuat…</p>';
  try {
    const mod = await page.load();
    if (token !== renderToken) return; // navigasi sudah berpindah
    view.innerHTML = '';
    await mod.default(view, { ...ctx, param, query, refreshUser });
    view.focus({ preventScroll: true });
  } catch (err) {
    if (token === renderToken) view.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`;
  }
}

function renderBanner() {
  const b = $('#banner');
  b.innerHTML = ctx.user.must_change
    ? '<div class="notice">Anda masih memakai password bawaan. Ganti sekarang di <a href="#/admin/akun">Admin → Akun saya</a>.</div>'
    : '';
}

async function refreshUser() {
  const { user } = await get('/api/auth/me');
  ctx.user = user;
  if (user) renderBanner();
}

function showLogin(message = '') {
  ctx.user = null;
  $('#shell').classList.add('hidden');
  const el = $('#login');
  el.classList.remove('hidden');
  el.innerHTML = `<form class="card" id="login-form" autocomplete="on">
      <h1>Delova Gudang</h1>
      <p class="muted small" style="text-align:center;margin-top:0">Sistem pergudangan kain roll</p>
      ${message ? `<div class="notice bad">${esc(message)}</div>` : ''}
      <div class="grid">
        <label class="f">Username<input name="username" autocomplete="username" autocapitalize="none" required autofocus></label>
        <label class="f">Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Masuk</button>
      </div>
    </form>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      const { user } = await post('/api/auth/login', { username: f.get('username'), password: f.get('password') });
      ctx.user = user;
      showApp();
    } catch (err) {
      showLogin(err.message);
    }
  });
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  $('#whoami').textContent = `${ctx.user.name} (${ctx.user.role === 'admin' ? 'admin' : 'staf'})`;
  renderBanner();
  route();
}

$('#logout').addEventListener('click', async () => {
  try {
    await post('/api/auth/logout');
  } catch {
    /* abaikan */
  }
  showLogin();
});

window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => {
  if (ctx.user) {
    toast('Sesi berakhir, silakan login lagi', 'err');
    showLogin();
  }
});

(async function boot() {
  try {
    await refreshUser();
  } catch {
    /* server belum siap */
  }
  if (ctx.user) showApp();
  else showLogin();
})();
