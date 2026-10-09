import { get, post, patch } from '../api.js';
import { $, esc, fmtYd, toast, openModal } from '../ui.js';

export default async function kain(view) {
  async function load() {
    const { rows } = await get('/api/materials?all=1');
    view.innerHTML = `
      <div class="page-head"><div><h1>Jenis Kain</h1><p class="muted">Master data kain. Setiap roll yang masuk dikaitkan ke salah satu jenis kain ini.</p></div>
        <button class="btn" id="new">+ Jenis kain baru</button></div>
      <section class="card"><div class="table-wrap"><table>
        <thead><tr><th>Kode</th><th>Nama</th><th>Warna</th><th class="num">Lebar (cm)</th><th class="num">Stok (yd)</th><th class="num">Min. (yd)</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map((m) => `<tr style="${m.active ? '' : 'opacity:.55'}">
          <td class="mono small">${esc(m.code)}</td><td>${esc(m.name)} ${m.active ? '' : '<span class="badge void">nonaktif</span>'}</td><td>${esc(m.color)}</td>
          <td class="num">${m.width_cm ?? ''}</td><td class="num">${fmtYd(m.stock_yards)} <span class="muted small">(${m.stock_rolls} roll)</span></td>
          <td class="num">${m.min_yards ? fmtYd(m.min_yards) : ''}</td>
          <td><button class="btn secondary sm" data-edit="${m.id}">Ubah</button></td></tr>`).join('')
          : '<tr><td colspan="7" class="empty">Belum ada jenis kain.</td></tr>'}</tbody></table></div></section>`;
    $('#new', view).addEventListener('click', () => form());
    view.addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit]');
      if (b) form(rows.find((r) => r.id === Number(b.dataset.edit)));
    });
  }

  function form(m) {
    const edit = !!m;
    openModal({
      title: edit ? 'Ubah jenis kain' : 'Jenis kain baru',
      body: `<div class="form-grid">
        <label class="f">Kode<input id="k-code" maxlength="30" placeholder="VSC-SAGE" value="${esc(m?.code)}"></label>
        <label class="f">Nama kain<input id="k-name" maxlength="80" placeholder="Viscose Print" value="${esc(m?.name)}"></label>
        <label class="f">Warna / motif<input id="k-color" maxlength="40" placeholder="Sage Green" value="${esc(m?.color)}"></label>
        <label class="f">Lebar (cm)<input id="k-width" inputmode="decimal" value="${esc(m?.width_cm ?? '')}"></label>
        <label class="f">Stok minimum (yard)<input id="k-min" inputmode="decimal" value="${esc(m?.min_yards ?? 0)}"></label>
        <label class="f span2">Catatan<input id="k-notes" maxlength="300" value="${esc(m?.notes)}"></label>
        ${edit ? `<label class="check span2"><input type="checkbox" id="k-active" ${m.active ? 'checked' : ''}> Aktif (bisa dipilih saat barang masuk)</label>` : ''}</div>`,
      actions: [
        { label: 'Batal', cls: 'secondary', onClick: (c) => c() },
        { label: 'Simpan', onClick: async (close, box) => {
          const body = {
            code: $('#k-code', box).value, name: $('#k-name', box).value, color: $('#k-color', box).value,
            width_cm: $('#k-width', box).value.replace(',', '.'), min_yards: $('#k-min', box).value.replace(',', '.'), notes: $('#k-notes', box).value,
          };
          if (edit) body.active = $('#k-active', box).checked;
          try {
            await (edit ? patch(`/api/materials/${m.id}`, body) : post('/api/materials', body));
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
