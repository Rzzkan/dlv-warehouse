import { get, post } from './api.js';
import { $, esc, toast } from './ui.js';

// short = label ringkas untuk menu bawah di HP; more = masuk menu "Lainnya" di HP
const PAGES = [
  { id: '', label: 'Beranda', short: 'Beranda', icon: '🏠', load: () => import('./pages/dashboard.js') },
  { id: 'masuk', label: 'Barang Masuk', short: 'Masuk', icon: '📥', load: () => import('./pages/masuk.js') },
  { id: 'keluar', label: 'Barang Keluar', short: 'Keluar', icon: '📤', load: () => import('./pages/keluar.js') },
  { id: 'stok', label: 'Stok', short: 'Stok', icon: '📦', load: () => import('./pages/stok.js') },
  { id: 'lacak', label: 'Lacak', short: 'Lacak', icon: '🔎', load: () => import('./pages/lacak.js') },
  { id: 'kain', label: 'Jenis Kain', short: 'Kain', icon: '🧵', more: true, load: () => import('./pages/kain.js') },
  { id: 'riwayat', label: 'Riwayat', short: 'Riwayat', icon: '🕘', more: true, load: () => import('./pages/riwayat.js') },
  { id: 'admin', label: 'Admin', short: 'Admin', icon: '⚙️', more: true, adminOnly: true, load: () => import('./pages/admin.js') },
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
  const pages = PAGES.filter((p) => !p.adminOnly || ctx.user.role === 'admin');
  const link = (p, extra = '') => `<a href="#/${p.id}" class="${p.id === id ? 'active' : ''} ${extra}"><i class="ni" aria-hidden="true">${p.icon}</i><span>${esc(p.label)}</span></a>`;
  const more = pages.filter((p) => p.more);
  // Layar lebar: semua menu di bar atas. HP (CSS): bar bawah berisi menu utama + tombol "Lainnya" yang membuka menu sisanya.
  $('#nav').innerHTML = `${pages.map((p) => link(p, p.more ? 'secondary' : '')).join('')}
    <button type="button" class="more-btn ${more.some((p) => p.id === id) ? 'active' : ''}" id="more-btn" aria-expanded="false" aria-controls="more-sheet"><i class="ni" aria-hidden="true">⋯</i><span>Lainnya</span></button>
    <div class="more-sheet" id="more-sheet" hidden>${more.map((p) => link(p)).join('')}</div>`;
}

// Menu "Lainnya" (HP): buka/tutup, tutup saat memilih menu atau mengetuk di luar
document.addEventListener('click', (e) => {
  const sheet = $('#more-sheet');
  if (!sheet) return;
  const btn = e.target.closest('#more-btn');
  const open = btn ? sheet.hidden : false;
  sheet.hidden = !open;
  $('#more-btn')?.setAttribute('aria-expanded', String(open));
});

// Tabel dijadikan kartu di layar sempit (CSS): isi data-label tiap sel dari judul kolomnya
function labelTables(view) {
  for (const table of view.querySelectorAll('table')) {
    if (table.dataset.nostack !== undefined) continue;
    table.classList.add('stack');
    const heads = [...(table.tHead?.rows[0]?.cells || [])].map((c) => c.textContent.trim());
    for (const row of table.tBodies[0]?.rows || []) {
      const cells = [...row.cells];
      const full = cells.length !== heads.length; // mis. baris "Tidak ada data" dengan colspan
      cells.forEach((c, i) => {
        const label = full ? '' : heads[i] || '';
        if (c.dataset.label !== label) c.dataset.label = label;
      });
    }
  }
}
function watchTables(view) {
  let queued = false;
  const run = () => { queued = false; labelTables(view); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(view, { childList: true, subtree: true });
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
  watchTables(view);
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
