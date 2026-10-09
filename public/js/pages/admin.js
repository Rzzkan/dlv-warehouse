import { get, post, put, patch } from '../api.js';
import { $, $$, esc, toast, openModal, debounce, fmtDate } from '../ui.js';
import { labelHtml } from '../label.js';

const TABS = [
  ['printer', 'Printer & Label'],
  ['umum', 'Umum'],
  ['pengguna', 'Pengguna'],
  ['akun', 'Akun saya'],
];

export default async function admin(view, ctx) {
  const tab = TABS.some(([id]) => id === ctx.param) ? ctx.param : 'printer';
  view.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1><p class="muted">Pengaturan printer thermal, barcode, dan pengguna.</p></div></div>
    <div class="tabs" role="tablist">${TABS.map(([id, label]) => `<button role="tab" class="${id === tab ? 'active' : ''}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>
    <div id="panel"></div>`;
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) location.hash = `#/admin/${b.dataset.tab}`;
  });
  const panel = $('#panel', view);
  if (tab === 'printer') await printerTab(panel);
  if (tab === 'umum') await generalTab(panel);
  if (tab === 'pengguna') await usersTab(panel);
  if (tab === 'akun') accountTab(panel, ctx);
}

/* ------------------------------------------------------------------ Printer */

const MODE_HELP = {
  browser: 'Paling mudah. Label dicetak lewat dialog cetak browser ke printer yang terpasang di komputer/HP (printer thermal USB dengan driver bawaan). Di dialog cetak: pilih printer thermal, ukuran kertas = ukuran label, skala 100%, tanpa margin.',
  network: 'Server mengirim perintah TSPL/ZPL langsung ke printer lewat LAN/Wi-Fi (TCP port 9100) tanpa dialog cetak — cocok untuk cetak massal. Server harus berada di jaringan yang sama dengan printer. Cetak self-test printer (biasanya tahan tombol FEED saat menyalakan) untuk melihat alamat IP.',
  system: 'Server mengirim perintah mentah ke antrian printer di komputer tempat server berjalan (printer USB). Linux/macOS: nama antrian CUPS (lihat dengan perintah lpstat -p). Windows: nama share printer; printer harus di-share dan dipanggil sebagai \\\\localhost\\NAMA.',
};

async function printerTab(panel) {
  const { config: saved } = await get('/api/printer/config');
  let current = { ...saved };

  const num = (id, label, attrs = '') => `<label class="f">${label}<input data-k="${id}" type="number" step="any" ${attrs} value="${esc(current[id])}"></label>`;
  const chk = (id, label) => `<label class="check"><input type="checkbox" data-k="${id}" ${current[id] ? 'checked' : ''}> ${label}</label>`;

  panel.innerHTML = `
    <div class="grid" style="grid-template-columns:minmax(0,1fr)" id="layout">
    <div>
    <fieldset><legend>Koneksi printer</legend>
      <div class="form-grid">
        <label class="f span2">Cara mencetak
          <select data-k="mode">
            <option value="browser">Browser / driver sistem (USB, paling mudah)</option>
            <option value="network">Printer jaringan — TCP/IP port 9100</option>
            <option value="system">Antrian printer sistem (USB, kirim data mentah)</option>
          </select></label>
        <label class="f" data-show="network,system">Bahasa printer
          <select data-k="language"><option value="TSPL">TSPL / TSPL2 (TSC, Xprinter, Gprinter, Argox, dll.)</option><option value="ZPL">ZPL II (Zebra)</option></select></label>
        <label class="f" data-show="network">Alamat IP / hostname<input data-k="host" placeholder="192.168.1.50" autocomplete="off"></label>
        <label class="f" data-show="network">Port<input data-k="port" type="number" min="1" max="65535"></label>
        <label class="f" data-show="system">Nama antrian / share printer<input data-k="queue" placeholder="XP-365B" autocomplete="off"></label>
        <label class="f" data-show="network,system">Timeout (ms)<input data-k="timeout_ms" type="number" min="500" max="30000"></label>
      </div>
      <p class="muted small" id="mode-help"></p>
      <div class="btn-row">
        <button type="button" class="btn secondary" id="ping" data-show="network">Tes koneksi</button>
        <button type="button" class="btn secondary" id="test">🖨 Cetak label tes</button>
        <button type="button" class="btn secondary" id="cmds">Lihat perintah printer</button>
      </div>
      <p id="status" class="small" role="status"></p>
    </fieldset>

    <fieldset><legend>Ukuran label &amp; media</legend>
      <div class="form-grid">
        ${num('label_width_mm', 'Lebar label (mm)', 'min="20" max="110"')}
        ${num('label_height_mm', 'Tinggi label (mm)', 'min="15" max="200"')}
        <label class="f">Resolusi printer (DPI)<select data-k="dpi"><option value="203">203 dpi (8 dot/mm)</option><option value="300">300 dpi (12 dot/mm)</option></select></label>
        <label class="f">Jenis media<select data-k="media"><option value="gap">Bergap (stiker)</option><option value="continuous">Kontinu</option><option value="blackmark">Black mark</option></select></label>
        ${num('gap_mm', 'Gap / jarak antar label (mm)', 'min="0" max="10"')}
        ${num('margin_mm', 'Margin dalam (mm)', 'min="0" max="10"')}
        <label class="f">Arah cetak<select data-k="direction"><option value="0">Normal</option><option value="1">Diputar 180°</option></select></label>
        ${num('darkness', 'Kegelapan (0–15)', 'min="0" max="15"')}
        ${num('speed', 'Kecepatan (1–10)', 'min="1" max="10"')}
        ${num('copies', 'Salinan per label', 'min="1" max="20"')}
      </div>
    </fieldset>

    <fieldset><legend>Isi label</legend>
      <div class="form-grid">
        <label class="f span2">Judul / nama brand<input data-k="title" maxlength="40"></label>
        ${num('barcode_height_mm', 'Tinggi barcode (mm)', 'min="5" max="30"')}
        <label class="f">Lebar bar barcode (dot)<select data-k="barcode_module"><option value="1">1 (padat)</option><option value="2">2 (disarankan)</option><option value="3">3</option><option value="4">4</option></select></label>
      </div>
      <div class="form-grid" style="margin-top:.8rem">
        ${chk('show_title', 'Judul brand')}${chk('show_material', 'Nama kain')}${chk('show_color', 'Warna')}${chk('show_code_text', 'Teks kode di bawah barcode')}
        ${chk('show_yards', 'Panjang (yard)')}${chk('show_date', 'Tanggal masuk')}${chk('show_supplier', 'Supplier')}
      </div>
      <p class="muted small">Bila ruang label tidak cukup, elemen dibuang berurutan dari yang prioritasnya paling rendah; barcode selalu dipertahankan.</p>
    </fieldset>
    <div class="btn-row"><button class="btn" id="save">Simpan pengaturan</button><button class="btn secondary" id="reset" type="button">Kembalikan ke tersimpan</button></div>
    </div>

    <aside>
      <section class="card" style="position:sticky;top:5rem">
        <h2>Pratinjau label</h2>
        <div class="preview-stage" id="stage"><span class="muted small">Memuat…</span></div>
        <p class="muted small" id="pv-info"></p>
        <p class="small" id="pv-err" style="color:var(--bad)"></p>
      </section>
    </aside>
    </div>`;

  const layoutEl = $('#layout', panel);
  const wide = window.matchMedia('(min-width: 980px)');
  const applyLayout = () => { layoutEl.style.gridTemplateColumns = wide.matches ? 'minmax(0,1fr) 360px' : 'minmax(0,1fr)'; };
  applyLayout();
  wide.addEventListener('change', applyLayout);

  const fields = $$('[data-k]', panel);
  const write = (cfg) => {
    for (const el of fields) {
      const v = cfg[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    }
    syncMode();
  };
  const read = () => {
    const out = {};
    for (const el of fields) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') out[k] = el.checked;
      else if (el.type === 'number' || ['dpi', 'direction', 'barcode_module'].includes(k)) out[k] = el.value === '' ? '' : Number(el.value);
      else out[k] = el.value;
    }
    return out;
  };

  function syncMode() {
    const mode = $('[data-k="mode"]', panel).value;
    $$('[data-show]', panel).forEach((el) => el.classList.toggle('hidden', !el.dataset.show.split(',').includes(mode)));
    $('#mode-help', panel).textContent = MODE_HELP[mode];
  }

  async function preview() {
    const stage = $('#stage', panel);
    try {
      const res = await post('/api/printer/preview', read());
      $('#pv-err', panel).textContent = '';
      const cfg = res.config;
      const zoom = Math.max(1, Math.min(3.2, 300 / (cfg.label_width_mm * 3.78)));
      stage.innerHTML = `<div style="zoom:${zoom.toFixed(2)}">${labelHtml(cfg, res.label)}</div>`;
      $('#pv-info', panel).textContent = `${cfg.label_width_mm}×${cfg.label_height_mm} mm · ${res.layout.width}×${res.layout.height} dot · bar ${res.layout.narrow} dot`;
    } catch (err) {
      $('#pv-err', panel).textContent = err.message;
    }
  }
  const previewSoon = debounce(preview, 300);

  panel.addEventListener('input', (e) => { if (e.target.dataset.k) previewSoon(); });
  panel.addEventListener('change', (e) => {
    if (e.target.dataset.k === 'mode') syncMode();
    if (e.target.dataset.k) previewSoon();
  });

  const setStatus = (msg, ok) => {
    const s = $('#status', panel);
    s.textContent = msg;
    s.style.color = ok ? 'var(--ok)' : 'var(--bad)';
  };

  $('#save', panel).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { config } = await put('/api/printer/config', read());
      current = config;
      write(config);
      toast('Pengaturan printer tersimpan', 'ok');
      preview();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      e.target.disabled = false;
    }
  });
  $('#reset', panel).addEventListener('click', () => { write(saved); current = { ...saved }; preview(); });

  $('#ping', panel).addEventListener('click', async (e) => {
    e.target.disabled = true;
    setStatus('Menghubungi printer…', true);
    try {
      const r = await post('/api/printer/ping', read());
      setStatus(`Terhubung ke printer (${r.ms} ms).`, true);
    } catch (err) {
      setStatus(err.message, false);
    } finally {
      e.target.disabled = false;
    }
  });

  $('#test', panel).addEventListener('click', async (e) => {
    e.target.disabled = true;
    const win = read().mode === 'browser' ? window.open('', '_blank') : null;
    try {
      const r = await post('/api/printer/test', read());
      if (r.mode === 'browser') {
        if (win) win.location.href = r.url;
        else location.href = r.url;
        setStatus('Halaman cetak dibuka. Pilih printer thermal di dialog cetak.', true);
      } else {
        setStatus('Label tes dikirim ke printer. Periksa hasil cetaknya.', true);
      }
    } catch (err) {
      win?.close();
      setStatus(err.message, false);
    } finally {
      e.target.disabled = false;
    }
  });

  $('#cmds', panel).addEventListener('click', async () => {
    try {
      const r = await post('/api/printer/preview', read());
      openModal({
        title: `Perintah ${r.config.language} (label contoh)`,
        body: `<p class="muted small">Ini data mentah yang dikirim ke printer pada mode jaringan/sistem. Berguna untuk diagnosis.</p><pre class="cmd">${esc(r.commands)}</pre>`,
        actions: [{ label: 'Tutup', cls: 'secondary', onClick: (c) => c() }],
      });
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  write(current);
  preview();
}

/* ------------------------------------------------------------------- Umum */

async function generalTab(panel) {
  const g = await get('/api/settings/general');
  panel.innerHTML = `<section class="card" style="max-width:560px"><h2>Pengaturan umum</h2>
    <div class="form-grid">
      <label class="f span2">Nama usaha<input id="g-name" maxlength="60" value="${esc(g.company_name)}"></label>
      <label class="f span2">Prefix kode barcode<input id="g-prefix" maxlength="5" value="${esc(g.barcode_prefix)}" style="text-transform:uppercase"></label>
    </div>
    <p class="muted small">Format kode roll: <span class="mono">PREFIX + YYMMDD + urut 4 digit</span>, mis. <span class="mono">${esc(g.barcode_prefix)}2610090001</span>.
      Prefix hanya berlaku untuk roll baru; kode yang sudah dicetak tidak berubah.</p>
    <button class="btn" id="g-save">Simpan</button></section>`;
  $('#g-save', panel).addEventListener('click', async () => {
    try {
      await put('/api/settings/general', { company_name: $('#g-name', panel).value, barcode_prefix: $('#g-prefix', panel).value });
      toast('Tersimpan', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

/* --------------------------------------------------------------- Pengguna */

async function usersTab(panel) {
  async function load() {
    const { rows } = await get('/api/users');
    panel.innerHTML = `<div class="page-head"><h2 style="margin:0">Pengguna</h2><button class="btn" id="u-new">+ Pengguna baru</button></div>
      <section class="card"><div class="table-wrap"><table>
        <thead><tr><th>Username</th><th>Nama</th><th>Peran</th><th>Status</th><th>Dibuat</th><th></th></tr></thead>
        <tbody>${rows.map((u) => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.name)}</td>
          <td>${u.role === 'admin' ? 'Admin' : 'Staf gudang'}</td>
          <td>${u.active ? '<span class="badge in_stock">Aktif</span>' : '<span class="badge void">Nonaktif</span>'}</td>
          <td class="small">${esc(fmtDate(u.created_at))}</td>
          <td><button class="btn secondary sm" data-u="${u.id}">Ubah</button></td></tr>`).join('')}</tbody></table></div></section>`;
    $('#u-new', panel).addEventListener('click', () => userForm());
    panel.onclick = (e) => {
      const b = e.target.closest('[data-u]');
      if (b) userForm(rows.find((r) => r.id === Number(b.dataset.u)));
    };
  }

  function userForm(u) {
    const edit = !!u;
    openModal({
      title: edit ? `Ubah ${u.username}` : 'Pengguna baru',
      body: `<div class="form-grid">
        ${edit ? '' : '<label class="f">Username<input id="u-username" maxlength="40" autocomplete="off"></label>'}
        <label class="f">Nama lengkap<input id="u-name" maxlength="80" value="${esc(u?.name)}"></label>
        <label class="f">Peran<select id="u-role"><option value="staff" ${u?.role === 'staff' ? 'selected' : ''}>Staf gudang</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
        <label class="f">${edit ? 'Password baru (kosongkan bila tidak diganti)' : 'Password (min. 8 karakter)'}<input id="u-pass" type="password" autocomplete="new-password"></label>
        ${edit ? `<label class="check span2"><input type="checkbox" id="u-active" ${u.active ? 'checked' : ''}> Akun aktif</label>` : ''}</div>`,
      actions: [
        { label: 'Batal', cls: 'secondary', onClick: (c) => c() },
        { label: 'Simpan', onClick: async (close, box) => {
          const body = { name: $('#u-name', box).value, role: $('#u-role', box).value };
          const pass = $('#u-pass', box).value;
          try {
            if (edit) {
              body.active = $('#u-active', box).checked;
              if (pass) body.password = pass;
              await patch(`/api/users/${u.id}`, body);
            } else {
              await post('/api/users', { ...body, username: $('#u-username', box).value, password: pass });
            }
            close();
            toast('Tersimpan', 'ok');
            await load();
          } catch (err) {
            toast(err.message, 'err');
          }
        } },
      ],
    });
  }
  await load();
}

/* ------------------------------------------------------------------- Akun */

function accountTab(panel, ctx) {
  panel.innerHTML = `<section class="card" style="max-width:460px"><h2>Ganti password</h2>
    <p class="muted small">Masuk sebagai <strong>${esc(ctx.user.username)}</strong>.</p>
    <div class="grid">
      <label class="f">Password saat ini<input id="a-cur" type="password" autocomplete="current-password"></label>
      <label class="f">Password baru (min. 8 karakter)<input id="a-new" type="password" autocomplete="new-password"></label>
      <button class="btn" id="a-save">Ganti password</button>
    </div></section>`;
  $('#a-save', panel).addEventListener('click', async () => {
    try {
      await post('/api/auth/password', { current: $('#a-cur', panel).value, next: $('#a-new', panel).value });
      $('#a-cur', panel).value = '';
      $('#a-new', panel).value = '';
      toast('Password diganti', 'ok');
      await ctx.refreshUser();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}
