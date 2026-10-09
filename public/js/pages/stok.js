import { get, qs } from '../api.js';
import { $, $$, esc, fmtYd, fmtDate, statusBadge, materialName, debounce, toast } from '../ui.js';
import { printLabels } from '../label.js';

const PAGE = 50;

export default async function stok(view) {
  const { rows: materials } = await get('/api/materials?all=1');
  const state = { q: '', status: 'in_stock', material_id: '', offset: 0, rows: [], total: 0, selected: new Set() };

  view.innerHTML = `
    <div class="page-head"><div><h1>Stok Roll</h1><p class="muted" id="count"></p></div>
      <div class="btn-row"><button class="btn" id="print" disabled>🖨 Cetak label terpilih</button></div></div>
    <section class="card">
      <div class="form-grid">
        <label class="f span2">Cari<input id="q" type="search" placeholder="Kode, nama kain, warna, lot, lokasi, supplier"></label>
        <label class="f">Jenis kain<select id="mat"><option value="">Semua</option>${materials
          .map((m) => `<option value="${m.id}">${esc(materialName({ material_name: m.name, material_color: m.color }))}</option>`).join('')}</select></label>
        <label class="f">Status<select id="status"><option value="in_stock">Tersedia</option><option value="depleted">Habis</option><option value="void">Void</option><option value="all">Semua</option></select></label>
      </div>
    </section>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th><input type="checkbox" id="all" aria-label="Pilih semua"></th><th>Kode</th><th>Kain</th><th class="num">Sisa / Awal (yd)</th><th>Lokasi</th><th>Lot</th><th>Masuk</th><th>Status</th></tr></thead>
      <tbody id="body"></tbody></table></div>
      <div class="btn-row" style="margin-top:.8rem"><button class="btn secondary" id="more" hidden>Muat lagi</button></div>
    </section>`;

  const body = $('#body', view);

  function drawRows(rows, append) {
    const html = rows.map((r) => {
      const pct = r.initial_yards ? Math.max(0, Math.min(100, (r.current_yards / r.initial_yards) * 100)) : 0;
      return `<tr class="click" data-code="${esc(r.code)}">
        <td><input type="checkbox" data-sel="${esc(r.code)}" ${state.selected.has(r.code) ? 'checked' : ''} aria-label="Pilih ${esc(r.code)}"></td>
        <td class="mono small">${esc(r.code)}</td><td>${esc(materialName(r))}</td>
        <td class="num"><strong>${fmtYd(r.current_yards)}</strong> <span class="muted">/ ${fmtYd(r.initial_yards)}</span><div class="bar"><i style="width:${pct}%"></i></div></td>
        <td>${esc(r.location)}</td><td>${esc(r.lot)}</td><td class="small nowrap">${esc(fmtDate(r.received_at || r.created_at))}</td><td>${statusBadge(r.status)}</td></tr>`;
    }).join('');
    if (append) body.insertAdjacentHTML('beforeend', html);
    else body.innerHTML = html || '<tr><td colspan="8" class="empty">Tidak ada roll yang cocok.</td></tr>';
  }

  async function load(append = false) {
    if (!append) state.offset = 0;
    const res = await get(`/api/rolls${qs({ q: state.q, status: state.status, material_id: state.material_id, limit: PAGE, offset: state.offset })}`);
    state.total = res.total;
    state.rows = append ? state.rows.concat(res.rows) : res.rows;
    drawRows(res.rows, append);
    const sum = state.rows.reduce((s, r) => s + r.current_yards, 0);
    $('#count', view).textContent = `${state.rows.length} dari ${res.total} roll · ${fmtYd(sum)} yard (yang tampil)`;
    $('#more', view).hidden = state.rows.length >= res.total;
  }

  const refresh = () => load(false).catch((e) => toast(e.message, 'err'));
  $('#q', view).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); refresh(); }, 300));
  $('#mat', view).addEventListener('change', (e) => { state.material_id = e.target.value; refresh(); });
  $('#status', view).addEventListener('change', (e) => { state.status = e.target.value; refresh(); });
  $('#more', view).addEventListener('click', () => { state.offset += PAGE; load(true).catch((e) => toast(e.message, 'err')); });

  function syncPrint() {
    const n = state.selected.size;
    const b = $('#print', view);
    b.disabled = !n;
    b.textContent = n ? `🖨 Cetak ${n} label` : '🖨 Cetak label terpilih';
  }

  body.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-sel]');
    if (cb) {
      cb.checked ? state.selected.add(cb.dataset.sel) : state.selected.delete(cb.dataset.sel);
      syncPrint();
      return;
    }
    const tr = e.target.closest('tr[data-code]');
    if (tr) location.hash = `#/lacak/${encodeURIComponent(tr.dataset.code)}`;
  });
  $('#all', view).addEventListener('change', (e) => {
    $$('[data-sel]', body).forEach((cb) => {
      cb.checked = e.target.checked;
      e.target.checked ? state.selected.add(cb.dataset.sel) : state.selected.delete(cb.dataset.sel);
    });
    syncPrint();
  });
  $('#print', view).addEventListener('click', async () => {
    try {
      const res = await printLabels([...state.selected]);
      if (res.mode !== 'browser') toast(`${res.sent} label dikirim ke printer`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  await load(false);
}
