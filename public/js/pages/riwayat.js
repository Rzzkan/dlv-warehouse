import { get, qs } from '../api.js';
import { $, esc, fmtYd, fmtDateTime, typeBadge, materialName, debounce, toast } from '../ui.js';

const PAGE = 100;

export default async function riwayat(view) {
  const state = { type: '', from: '', to: '', q: '', offset: 0, rows: [] };
  view.innerHTML = `
    <div class="page-head"><div><h1>Riwayat Mutasi</h1><p class="muted" id="count"></p></div>
      <a class="btn secondary" id="csv" href="/api/movements.csv">⬇ Unduh CSV</a></div>
    <section class="card"><div class="form-grid">
      <label class="f">Tipe<select id="type"><option value="">Semua</option><option value="IN">Masuk</option><option value="OUT">Keluar</option><option value="ADJUST">Penyesuaian</option></select></label>
      <label class="f">Dari tanggal<input id="from" type="date"></label>
      <label class="f">Sampai tanggal<input id="to" type="date"></label>
      <label class="f span2">Cari<input id="q" type="search" placeholder="Kode roll, kain, no. dokumen, referensi, keperluan"></label>
    </div></section>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>Waktu</th><th>Tipe</th><th>Dokumen</th><th>Roll</th><th>Kain</th><th class="num">Yard</th><th class="num">Sisa</th><th>Keterangan</th><th>Petugas</th></tr></thead>
      <tbody id="body"></tbody></table></div>
      <div class="btn-row" style="margin-top:.8rem"><button class="btn secondary" id="more" hidden>Muat lagi</button></div></section>`;

  const body = $('#body', view);
  const query = () => ({ type: state.type, from: state.from, to: state.to, q: state.q });

  async function load(append) {
    if (!append) state.offset = 0;
    const res = await get(`/api/movements${qs({ ...query(), limit: PAGE, offset: state.offset })}`);
    state.rows = append ? state.rows.concat(res.rows) : res.rows;
    const html = res.rows.map((m) => `<tr class="click" data-code="${esc(m.roll_code)}">
      <td class="small nowrap">${esc(fmtDateTime(m.created_at))}</td><td>${typeBadge(m.type)}</td><td class="mono small">${esc(m.doc_no)}</td>
      <td class="mono small">${esc(m.roll_code)}</td><td>${esc(materialName(m))}</td>
      <td class="num"><strong style="color:var(${m.delta >= 0 ? '--ok' : '--accent'})">${m.delta > 0 ? '+' : ''}${fmtYd(m.delta)}</strong></td>
      <td class="num">${fmtYd(m.balance_after)}</td>
      <td class="small">${esc([m.purpose, m.ref, m.notes].filter(Boolean).join(' · '))}</td><td class="small">${esc(m.user_name)}</td></tr>`).join('');
    if (append) body.insertAdjacentHTML('beforeend', html);
    else body.innerHTML = html || '<tr><td colspan="9" class="empty">Tidak ada data.</td></tr>';
    $('#count', view).textContent = `${state.rows.length} dari ${res.total} catatan`;
    $('#more', view).hidden = state.rows.length >= res.total;
    $('#csv', view).href = `/api/movements.csv${qs(query())}`;
  }
  const refresh = () => load(false).catch((e) => toast(e.message, 'err'));

  for (const id of ['type', 'from', 'to']) {
    $(`#${id}`, view).addEventListener('change', (e) => { state[id] = e.target.value; refresh(); });
  }
  $('#q', view).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); refresh(); }, 300));
  $('#more', view).addEventListener('click', () => { state.offset += PAGE; load(true).catch((e) => toast(e.message, 'err')); });
  body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-code]');
    if (tr) location.hash = `#/lacak/${encodeURIComponent(tr.dataset.code)}`;
  });

  await load(false);
}
