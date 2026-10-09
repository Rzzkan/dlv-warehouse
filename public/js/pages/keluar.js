import { get, post } from '../api.js';
import { $, $$, esc, fmtYd, fmtM, toast, materialName, scanWithCamera, CAM_SUPPORTED, confirmBox } from '../ui.js';

const PURPOSES = ['Produksi / potong', 'Sampel', 'Penjualan kain', 'Retur ke supplier', 'Rusak / reject', 'Lainnya'];
const num = (v) => Number(String(v ?? '').replace(',', '.'));

export default async function keluar(view, ctx) {
  const items = []; // { code, name, current, yards, location }

  function render() {
    // Simpan isian header supaya tidak hilang saat daftar roll berubah
    const prevForm = $('#form', view);
    const prev = prevForm ? Object.fromEntries(new FormData(prevForm).entries()) : null;
    view.innerHTML = `
      <div class="page-head"><div><h1>Barang Keluar</h1>
        <p class="muted">Scan barcode roll, isi yard yang diambil. Bisa sebagian roll — sisa otomatis tercatat.</p></div></div>
      <section class="card">
        <label class="f">Scan / ketik kode roll, lalu Enter
          <div class="scan-box"><input id="scan" autocomplete="off" autocapitalize="characters" inputmode="text" placeholder="DLV2610090001" autofocus>
          <button class="btn" type="button" id="add">Tambah</button>
          ${CAM_SUPPORTED() ? '<button class="btn secondary" type="button" id="cam" title="Scan dengan kamera">📷</button>' : ''}</div></label>
      </section>
      <form id="form">
        <section class="card">
          <h2>Roll yang dikeluarkan</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Kode</th><th>Kain</th><th class="num">Sisa (yd)</th><th>Keluar (yd)</th><th></th></tr></thead>
            <tbody id="rows">${items.length ? items.map((it, i) => `<tr data-i="${i}">
              <td class="mono small">${esc(it.code)}<div class="muted">${esc(it.location)}</div></td>
              <td>${esc(it.name)}</td>
              <td class="num">${fmtYd(it.current)}<div class="muted small">${fmtM(it.current)} m</div></td>
              <td class="nowrap"><input data-f="yards" inputmode="decimal" value="${esc(it.yards)}" placeholder="0" style="width:96px">
                <button type="button" class="btn secondary sm" data-act="all" title="Keluarkan seluruh sisa">Semua</button></td>
              <td><button type="button" class="btn secondary sm" data-act="del" title="Hapus">✕</button></td></tr>`).join('')
              : '<tr><td colspan="5" class="empty">Belum ada roll. Scan barcode di atas.</td></tr>'}</tbody>
          </table></div>
          <p class="muted small" id="sum"></p>
        </section>
        <section class="card">
          <h2>Tujuan</h2>
          <div class="form-grid">
            <label class="f">Keperluan<select name="purpose">${PURPOSES.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
            <label class="f">No. order / batch produksi<input name="ref" maxlength="80" placeholder="mis. PO-KEBAYA-12"></label>
            <label class="f span2">Catatan<input name="notes" maxlength="500"></label>
          </div>
        </section>
        <div class="btn-row"><button class="btn" type="submit" id="save" ${items.length ? '' : 'disabled'}>Catat barang keluar</button></div>
      </form>`;
    if (prev) {
      for (const [k, v] of Object.entries(prev)) {
        const el = $(`[name="${k}"]`, view);
        if (el) el.value = v;
      }
    }
    wire();
    updateSum();
    markInvalid();
  }

  function updateSum() {
    const total = items.reduce((s, it) => s + (num(it.yards) > 0 ? num(it.yards) : 0), 0);
    $('#sum', view).textContent = items.length ? `${items.length} roll · total keluar ${fmtYd(total)} yard (${fmtM(total)} m)` : '';
    const btn = $('#save', view);
    if (btn) btn.disabled = !items.length;
  }

  function markInvalid() {
    $$('#rows tr[data-i]', view).forEach((tr) => {
      const it = items[Number(tr.dataset.i)];
      const y = num(it.yards);
      $('[data-f="yards"]', tr).classList.toggle('invalid', it.yards !== '' && (!(y > 0) || y > it.current + 0.005));
    });
  }

  async function addCode(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    const existing = items.findIndex((it) => it.code === code);
    if (existing >= 0) {
      toast('Roll ini sudah ada di daftar');
      $(`#rows tr[data-i="${existing}"] [data-f="yards"]`, view)?.focus();
      return;
    }
    try {
      const { roll } = await get(`/api/rolls/${encodeURIComponent(code)}`);
      if (roll.status === 'depleted') return toast(`Roll ${roll.code} sudah habis`, 'err');
      if (roll.status === 'void') return toast(`Roll ${roll.code} sudah di-void`, 'err');
      readRows();
      items.push({ code: roll.code, name: materialName(roll), current: roll.current_yards, yards: '', location: roll.location });
      render();
      const idx = items.length - 1;
      $(`#rows tr[data-i="${idx}"] [data-f="yards"]`, view)?.focus();
    } catch (err) {
      toast(err.message, 'err');
      $('#scan', view)?.select();
    }
  }

  function readRows() {
    $$('#rows tr[data-i]', view).forEach((tr) => {
      items[Number(tr.dataset.i)].yards = $('[data-f="yards"]', tr).value;
    });
  }

  function wire() {
    const scan = $('#scan', view);
    scan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = scan.value;
        scan.value = '';
        addCode(v);
      }
    });
    $('#add', view).addEventListener('click', () => {
      const v = scan.value;
      scan.value = '';
      addCode(v);
    });
    $('#cam', view)?.addEventListener('click', () => scanWithCamera(addCode));

    const tbody = $('#rows', view);
    tbody.addEventListener('input', () => {
      readRows();
      markInvalid();
      updateSum();
    });
    tbody.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.f === 'yards') {
        e.preventDefault();
        $('#scan', view).focus(); // lanjut scan roll berikutnya
      }
    });
    tbody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      readRows();
      const i = Number(b.closest('tr').dataset.i);
      if (b.dataset.act === 'del') items.splice(i, 1);
      if (b.dataset.act === 'all') items[i].yards = String(items[i].current);
      render();
    });
    $('#form', view).addEventListener('submit', submit);
  }

  async function submit(e) {
    e.preventDefault();
    readRows();
    const f = Object.fromEntries(new FormData(e.target).entries());
    for (const it of items) {
      const y = num(it.yards);
      if (!(y > 0)) return toast(`Isi yard keluar untuk ${it.code}`, 'err');
      if (y > it.current + 0.005) return toast(`${it.code}: yard keluar melebihi sisa (${fmtYd(it.current)})`, 'err');
    }
    const total = items.reduce((s, it) => s + num(it.yards), 0);
    const ok = await confirmBox('Konfirmasi barang keluar', `${items.length} roll, total <strong>${fmtYd(total)} yard</strong> untuk <strong>${esc(f.purpose)}</strong>${f.ref ? ` (${esc(f.ref)})` : ''}. Lanjutkan?`, 'Catat');
    if (!ok) return;
    const btn = $('#save', view);
    btn.disabled = true;
    try {
      const res = await post('/api/outbound', { ...f, items: items.map((it) => ({ code: it.code, yards: num(it.yards) })) });
      done(res, f);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  }

  function done(res, f) {
    view.innerHTML = `
      <div class="notice ok"><strong>Tercatat.</strong> Dokumen <span class="mono">${esc(res.doc_no)}</span> · ${esc(f.purpose)}${f.ref ? ' · ' + esc(f.ref) : ''}</div>
      <section class="card"><h2>Sisa roll setelah pengeluaran</h2><div class="table-wrap"><table>
        <thead><tr><th>Kode</th><th>Kain</th><th class="num">Sisa (yd)</th><th>Status</th></tr></thead>
        <tbody>${res.rolls.map((r) => `<tr><td class="mono"><a href="#/lacak/${esc(r.code)}">${esc(r.code)}</a></td><td>${esc(materialName(r))}</td>
          <td class="num">${fmtYd(r.current_yards)}</td><td>${r.status === 'depleted' ? '<span class="badge depleted">Habis</span>' : '<span class="badge in_stock">Tersedia</span>'}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <div class="btn-row"><button class="btn" id="next">Catat pengeluaran lain</button><a class="btn secondary" href="#/stok">Lihat stok</a></div>`;
    $('#next', view).addEventListener('click', () => {
      items.length = 0;
      render();
    });
  }

  render();
  if (ctx.param) addCode(ctx.param); // dari halaman Lacak: #/keluar/KODE
}
