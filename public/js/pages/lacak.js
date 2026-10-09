import { get, post, patch } from '../api.js';
import {
  $, esc, fmtYd, fmtM, fmtDate, fmtDateTime, statusBadge, typeBadge, toast, openModal,
  scanWithCamera, CAM_SUPPORTED,
} from '../ui.js';
import { printLabels } from '../label.js';

export default async function lacak(view, ctx) {
  view.innerHTML = `
    <div class="page-head"><div><h1>Lacak Roll</h1><p class="muted">Scan barcode atau ketik kode untuk melihat posisi, sisa, dan seluruh riwayat roll.</p></div></div>
    <section class="card"><form id="f" class="scan-box">
      <input id="code" autocomplete="off" autocapitalize="characters" placeholder="Scan / ketik kode roll" value="${esc(ctx.param)}" ${ctx.param ? '' : 'autofocus'}>
      <button class="btn" type="submit">Cari</button>
      ${CAM_SUPPORTED() ? '<button class="btn secondary" type="button" id="cam">📷</button>' : ''}
    </form></section>
    <div id="result"></div>`;

  const go = (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (c) location.hash = `#/lacak/${encodeURIComponent(c)}`;
  };
  $('#f', view).addEventListener('submit', (e) => {
    e.preventDefault();
    go($('#code', view).value);
  });
  $('#cam', view)?.addEventListener('click', () => scanWithCamera(go));

  if (!ctx.param) {
    $('#result', view).innerHTML = '<p class="empty">Belum ada roll dipilih.</p>';
    return;
  }

  const out = $('#result', view);
  let data;
  try {
    data = await get(`/api/rolls/${encodeURIComponent(ctx.param)}`);
  } catch (err) {
    out.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`;
    return;
  }
  draw(data);

  function draw({ roll, movements }) {
    const pct = roll.initial_yards ? Math.max(0, Math.min(100, (roll.current_yards / roll.initial_yards) * 100)) : 0;
    const isAdmin = ctx.user.role === 'admin';
    out.innerHTML = `
      <section class="card">
        <div class="page-head">
          <div><div class="big-code mono">${esc(roll.code)}</div><div>${statusBadge(roll.status)}</div></div>
          <div class="btn-row">
            <button class="btn" id="print">🖨 Cetak label</button>
            ${roll.status === 'in_stock' ? `<a class="btn secondary" href="#/keluar/${esc(roll.code)}">Keluarkan</a>` : ''}
            <button class="btn secondary" id="edit">Ubah info</button>
            ${roll.status !== 'void' ? '<button class="btn secondary" id="adjust">Penyesuaian stok</button>' : ''}
            ${isAdmin && roll.status !== 'void' ? '<button class="btn danger" id="void">Void</button>' : ''}
          </div>
        </div>
        <div class="grid cols-2">
          <div>
            <img class="barcode-img" alt="Barcode ${esc(roll.code)}" src="/api/barcode/${encodeURIComponent(roll.code)}.svg">
            <p style="margin:.8rem 0 .2rem"><strong style="font-size:1.4rem">${fmtYd(roll.current_yards)} yd</strong>
              <span class="muted"> dari ${fmtYd(roll.initial_yards)} yd · ${fmtM(roll.current_yards)} m</span></p>
            <div class="bar" style="max-width:360px"><i style="width:${pct}%"></i></div>
          </div>
          <dl class="kv">
            <div><dt>Kain</dt><dd>${esc(roll.material_name)}</dd></div>
            <div><dt>Warna</dt><dd>${esc(roll.material_color) || '–'}</dd></div>
            <div><dt>Kode kain</dt><dd class="mono">${esc(roll.material_code)}</dd></div>
            <div><dt>Lebar</dt><dd>${roll.material_width_cm ? esc(roll.material_width_cm) + ' cm' : '–'}</dd></div>
            <div><dt>Lokasi</dt><dd>${esc(roll.location) || '–'}</dd></div>
            <div><dt>Lot / batch</dt><dd>${esc(roll.lot) || '–'}</dd></div>
            <div><dt>Supplier</dt><dd>${esc(roll.supplier) || '–'}</dd></div>
            <div><dt>Penerimaan</dt><dd class="mono">${esc(roll.receipt_no) || '–'}</dd></div>
            <div><dt>Tanggal masuk</dt><dd>${esc(fmtDate(roll.received_at || roll.created_at))}</dd></div>
            <div><dt>Catatan</dt><dd>${esc(roll.notes) || '–'}</dd></div>
          </dl>
        </div>
      </section>
      <section class="card"><h2>Riwayat pergerakan</h2>
        <ul class="timeline">${movements.map((m) => `<li>
          <div>${typeBadge(m.type)}</div>
          <div><strong>${esc(m.purpose || '')}</strong> ${m.doc_no ? `<span class="mono small muted">${esc(m.doc_no)}</span>` : ''}
            <div class="muted small">${esc([m.ref, m.notes].filter(Boolean).join(' · '))}</div>
            <div class="muted small">${esc(fmtDateTime(m.created_at))} · ${esc(m.user_name || '–')}</div></div>
          <div class="right"><div class="delta ${m.delta >= 0 ? 'pos' : 'neg'}">${m.delta > 0 ? '+' : ''}${fmtYd(m.delta)}</div><div class="muted small">sisa ${fmtYd(m.balance_after)}</div></div></li>`).join('')}</ul>
      </section>`;

    $('#print', out).addEventListener('click', async () => {
      try {
        const res = await printLabels([roll.code]);
        if (res.mode !== 'browser') toast('Label dikirim ke printer', 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    const reload = async () => draw(await get(`/api/rolls/${encodeURIComponent(roll.code)}`));

    $('#edit', out).addEventListener('click', () => openModal({
      title: 'Ubah info roll',
      body: `<div class="form-grid">
        <label class="f">Lokasi rak<input id="m-loc" maxlength="60" value="${esc(roll.location)}"></label>
        <label class="f">Lot / batch<input id="m-lot" maxlength="60" value="${esc(roll.lot)}"></label>
        <label class="f span2">Catatan<input id="m-notes" maxlength="300" value="${esc(roll.notes)}"></label></div>`,
      actions: [
        { label: 'Batal', cls: 'secondary', onClick: (c) => c() },
        { label: 'Simpan', onClick: async (close, box) => {
          try {
            await patch(`/api/rolls/${encodeURIComponent(roll.code)}`, { location: $('#m-loc', box).value, lot: $('#m-lot', box).value, notes: $('#m-notes', box).value });
            close();
            toast('Tersimpan', 'ok');
            await reload();
          } catch (err) {
            toast(err.message, 'err');
          }
        } },
      ],
    }));

    $('#adjust', out)?.addEventListener('click', () => openModal({
      title: 'Penyesuaian stok (opname)',
      body: `<p class="muted small">Gunakan bila sisa fisik berbeda dengan sistem. Perubahan tercatat di riwayat beserta alasannya.</p>
        <div class="form-grid"><label class="f">Sisa sebenarnya (yard)<input id="m-y" inputmode="decimal" value="${esc(roll.current_yards)}"></label>
        <label class="f span2">Alasan<input id="m-r" maxlength="300" placeholder="mis. selisih hasil opname Oktober"></label></div>`,
      actions: [
        { label: 'Batal', cls: 'secondary', onClick: (c) => c() },
        { label: 'Simpan penyesuaian', onClick: async (close, box) => {
          try {
            await post(`/api/rolls/${encodeURIComponent(roll.code)}/adjust`, { new_yards: $('#m-y', box).value, notes: $('#m-r', box).value });
            close();
            toast('Stok disesuaikan', 'ok');
            await reload();
          } catch (err) {
            toast(err.message, 'err');
          }
        } },
      ],
    }));

    $('#void', out)?.addEventListener('click', () => openModal({
      title: 'Void roll',
      body: `<p>Roll <strong class="mono">${esc(roll.code)}</strong> akan dinyatakan tidak berlaku dan sisa menjadi 0. Tindakan ini tidak bisa dibatalkan.</p>
        <label class="f">Alasan<input id="m-r" maxlength="300" placeholder="mis. kode label salah cetak / roll rusak"></label>`,
      actions: [
        { label: 'Batal', cls: 'secondary', onClick: (c) => c() },
        { label: 'Void roll', cls: 'danger', onClick: async (close, box) => {
          try {
            await post(`/api/rolls/${encodeURIComponent(roll.code)}/void`, { reason: $('#m-r', box).value });
            close();
            toast('Roll di-void', 'ok');
            await reload();
          } catch (err) {
            toast(err.message, 'err');
          }
        } },
      ],
    }));
  }
}
