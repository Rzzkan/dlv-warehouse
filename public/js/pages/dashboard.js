import { get } from '../api.js';
import { esc, fmtYd, fmtDateTime, typeBadge, materialName } from '../ui.js';

export default async function dashboard(view) {
  const d = await get('/api/dashboard');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Beranda</h1><p class="muted">Ringkasan gudang kain · ${esc(d.today)}</p></div>
      <div class="btn-row">
        <a class="btn" href="#/masuk">+ Barang Masuk</a>
        <a class="btn secondary" href="#/keluar">Barang Keluar</a>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="n">${fmtYd(d.totals.rolls)}</div><div class="l">Roll tersedia</div></div>
      <div class="stat"><div class="n">${fmtYd(d.totals.yards)}</div><div class="l">Total yard tersedia</div></div>
      <div class="stat in"><div class="n">+${fmtYd(d.in_today.yards)}</div><div class="l">Yard masuk hari ini (${d.in_today.count} roll)</div></div>
      <div class="stat out"><div class="n">−${fmtYd(d.out_today.yards)}</div><div class="l">Yard keluar hari ini (${d.out_today.count} roll)</div></div>
    </div>

    ${d.low_stock.length ? `<div class="notice">⚠ Stok di bawah minimum: ${d.low_stock
      .map((m) => `<strong>${esc(m.name)}${m.color ? ' · ' + esc(m.color) : ''}</strong> (${fmtYd(m.yards)} / min ${fmtYd(m.min_yards)} yd)`)
      .join(', ')}</div>` : ''}

    <div class="grid cols-2">
      <section class="card">
        <h2>Stok per jenis kain</h2>
        ${d.by_material.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Kain</th><th class="num">Roll</th><th class="num">Yard</th></tr></thead>
          <tbody>${d.by_material.map((m) => `<tr>
            <td>${esc(materialName({ material_name: m.name, material_color: m.color }))} ${m.low ? '<span class="badge low">menipis</span>' : ''}<div class="muted small mono">${esc(m.code)}</div></td>
            <td class="num">${fmtYd(m.rolls)}</td><td class="num">${fmtYd(m.yards)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">Belum ada jenis kain. <a href="#/kain">Tambah jenis kain</a> dulu.</p>'}
      </section>

      <section class="card">
        <h2>Aktivitas terakhir</h2>
        ${d.recent.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Waktu</th><th>Tipe</th><th>Roll</th><th class="num">Yard</th></tr></thead>
          <tbody>${d.recent.map((m) => `<tr class="click" data-code="${esc(m.roll_code)}">
            <td class="small nowrap">${esc(fmtDateTime(m.created_at))}</td><td>${typeBadge(m.type)}</td>
            <td class="mono small">${esc(m.roll_code)}</td><td class="num">${m.delta > 0 ? '+' : ''}${fmtYd(m.delta)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">Belum ada aktivitas.</p>'}
      </section>
    </div>`;

  view.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-code]');
    if (tr) location.hash = `#/lacak/${encodeURIComponent(tr.dataset.code)}`;
  });
}
