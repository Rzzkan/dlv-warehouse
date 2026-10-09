import { get, post } from '../api.js';
import { $, $$, esc, fmtYd, fmtDate, todayLocal, toast, materialName, openModal } from '../ui.js';
import { printLabels } from '../label.js';
import { compressImage, uploadRollPhoto, photoButtons, showPhoto } from '../photo.js';

export default async function masuk(view) {
  const { rows: materials } = await get('/api/materials');
  if (!materials.length) {
    view.innerHTML = `<h1>Barang Masuk</h1><div class="notice">Belum ada jenis kain. <a href="#/kain">Tambahkan jenis kain</a> terlebih dahulu, lalu kembali ke sini.</div>`;
    return;
  }
  const rows = [{ material_id: materials[0].id, yards: '', location: '', lot: '', photo: '' }];

  const matOptions = (sel) =>
    materials.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.code)} · ${esc(materialName({ material_name: m.name, material_color: m.color }))}</option>`).join('');

  function renderForm() {
    view.innerHTML = `
      <div class="page-head"><div><h1>Barang Masuk</h1>
        <p class="muted">Catat kain roll yang diterima. Setiap roll otomatis mendapat kode barcode unik untuk dicetak &amp; ditempel.</p></div></div>
      <form id="form">
        <section class="card">
          <h2>Dokumen penerimaan</h2>
          <div class="form-grid">
            <label class="f">Supplier<input name="supplier" maxlength="120" placeholder="mis. CV Sinar Textile"></label>
            <label class="f">No. surat jalan / PO<input name="ref_doc" maxlength="80"></label>
            <label class="f">Tanggal terima<input name="received_at" type="date" value="${todayLocal()}" required></label>
            <label class="f span2">Catatan<input name="notes" maxlength="500"></label>
          </div>
        </section>
        <section class="card">
          <div class="page-head" style="margin-bottom:.5rem"><h2 style="margin:0">Daftar roll</h2>
            <div class="btn-row"><button type="button" class="btn secondary sm" id="bulk">+ Banyak roll sekaligus</button>
            <button type="button" class="btn secondary sm" id="add">+ Tambah roll</button></div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Jenis kain</th><th>Panjang (yard)</th><th>Foto</th><th>Lokasi rak</th><th>Lot / batch</th><th></th></tr></thead>
            <tbody id="rows">${rows.map((r, i) => `<tr data-i="${i}">
              <td class="muted">${i + 1}</td>
              <td><select data-f="material_id">${matOptions(r.material_id)}</select></td>
              <td><input data-f="yards" inputmode="decimal" placeholder="0" value="${esc(r.yards)}" style="min-width:90px"></td>
              <td>${r.photo
                ? `<div class="photo-cell"><img class="thumb" alt="Foto roll ${i + 1}" src="${r.photo}" data-zoom="${i}"><button type="button" class="btn secondary sm" data-act="rmphoto" title="Hapus foto">✕</button></div>`
                : photoButtons(i)}</td>
              <td><input data-f="location" maxlength="60" placeholder="A-01" value="${esc(r.location)}"></td>
              <td><input data-f="lot" maxlength="60" value="${esc(r.lot)}"></td>
              <td class="nowrap"><button type="button" class="btn secondary sm" data-act="dup" title="Duplikat baris">⧉</button>
                <button type="button" class="btn secondary sm" data-act="del" title="Hapus baris" ${rows.length === 1 ? 'disabled' : ''}>✕</button></td></tr>`).join('')}</tbody>
          </table></div>
          <p class="muted small" id="sum"></p>
          <p class="muted small">Tips: tekan Enter di kolom yard untuk menambah baris baru dengan kain yang sama. Tombol 📷 membuka kamera HP untuk memotret roll; 🖼 memilih dari galeri.</p>
        </section>
        <div class="btn-row"><button class="btn" type="submit" id="save">Simpan &amp; buat barcode</button></div>
      </form>
      <section class="card" style="margin-top:1.5rem"><h2>Penerimaan terakhir</h2><div id="recent" class="muted">Memuat…</div></section>`;
    wire();
    updateSum();
    loadRecent();
  }

  function updateSum() {
    const valid = rows.filter((r) => Number(String(r.yards).replace(',', '.')) > 0);
    const total = valid.reduce((s, r) => s + Number(String(r.yards).replace(',', '.')), 0);
    $('#sum', view).textContent = `${valid.length} roll · total ${fmtYd(total)} yard`;
  }

  function readRows() {
    $$('#rows tr', view).forEach((tr) => {
      const r = rows[Number(tr.dataset.i)];
      $$('[data-f]', tr).forEach((el) => {
        r[el.dataset.f] = el.dataset.f === 'material_id' ? Number(el.value) : el.value;
      });
    });
  }

  function wire() {
    const tbody = $('#rows', view);
    tbody.addEventListener('input', () => {
      readRows();
      updateSum();
    });
    tbody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.dataset.f !== 'yards') return;
      e.preventDefault();
      readRows();
      const i = Number(e.target.closest('tr').dataset.i);
      rows.splice(i + 1, 0, { ...rows[i], yards: '', photo: '' });
      renderKeep(i + 1);
    });
    tbody.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-photo-in]');
      if (!inp || !inp.files?.[0]) return;
      readRows();
      const i = Number(inp.dataset.photoIn);
      try {
        rows[i].photo = await compressImage(inp.files[0]);
      } catch (err) {
        return toast(err.message, 'err');
      }
      renderKeep(i);
    });
    tbody.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zoom]');
      if (z) return showPhoto(z.src, `Foto roll ${Number(z.dataset.zoom) + 1}`);
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      readRows();
      const i = Number(btn.closest('tr').dataset.i);
      if (btn.dataset.act === 'dup') rows.splice(i + 1, 0, { ...rows[i], photo: '' });
      if (btn.dataset.act === 'rmphoto') {
        rows[i].photo = '';
        return renderKeep(i);
      }
      if (btn.dataset.act === 'del' && rows.length > 1) rows.splice(i, 1);
      renderKeep(btn.dataset.act === 'dup' ? i + 1 : Math.max(0, i - 1));
    });
    $('#add', view).addEventListener('click', () => {
      readRows();
      const last = rows[rows.length - 1];
      rows.push({ ...last, yards: '', photo: '' });
      renderKeep(rows.length - 1);
    });
    $('#bulk', view).addEventListener('click', bulkDialog);
    $('#form', view).addEventListener('submit', submit);
  }

  // Render ulang tabel sambil mempertahankan isian header
  function renderKeep(focusIdx) {
    const header = Object.fromEntries(new FormData($('#form', view)).entries());
    renderForm();
    for (const [k, v] of Object.entries(header)) {
      const el = $(`[name="${k}"]`, view);
      if (el) el.value = v;
    }
    const target = $(`#rows tr[data-i="${focusIdx}"] [data-f="yards"]`, view);
    if (target) target.focus();
  }

  function bulkDialog() {
    openModal({
      title: 'Tambah banyak roll',
      body: `<p class="muted small">Untuk kain dengan panjang roll yang sama. Panjang tiap roll tetap bisa diubah setelah ditambahkan.</p>
        <div class="form-grid">
          <label class="f span2">Jenis kain<select id="b-mat">${matOptions(materials[0].id)}</select></label>
          <label class="f">Jumlah roll<input id="b-n" type="number" min="1" max="100" value="5"></label>
          <label class="f">Yard per roll<input id="b-y" inputmode="decimal" placeholder="mis. 100"></label>
        </div>`,
      actions: [
        { label: 'Batal', cls: 'secondary', onClick: (c) => c() },
        { label: 'Tambahkan', onClick: (close, box) => {
          const n = Math.min(100, Math.max(1, Number($('#b-n', box).value) || 0));
          const y = $('#b-y', box).value;
          if (!(Number(String(y).replace(',', '.')) > 0)) return toast('Isi yard per roll', 'err');
          readRows();
          if (rows.length === 1 && !rows[0].yards) rows.length = 0;
          for (let i = 0; i < n; i++) rows.push({ material_id: Number($('#b-mat', box).value), yards: y, location: '', lot: '', photo: '' });
          close();
          renderKeep(rows.length - 1);
        } },
      ],
    });
  }

  async function submit(e) {
    e.preventDefault();
    readRows();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const filled = rows.filter((r) => String(r.yards).trim() !== '');
    const items = filled.map(({ photo, ...rest }) => rest); // foto diunggah terpisah setelah roll dibuat
    if (!items.length) return toast('Isi yard minimal pada satu roll', 'err');
    const btn = $('#save', view);
    btn.disabled = true;
    try {
      const res = await post('/api/receipts', { ...f, items });
      // Urutan roll hasil = urutan baris yang dikirim
      const photos = new Map(res.rolls.map((r, i) => [r.code, { url: filled[i].photo || '', state: filled[i].photo ? 'pending' : 'none' }]));
      renderDone(res, photos);
      uploadPending(res.rolls, photos);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  }

  function renderDone({ receipt, rolls }, photos) {
    const total = rolls.reduce((s, r) => s + r.initial_yards, 0);
    view.innerHTML = `
      <div class="notice ok"><strong>Tersimpan.</strong> Penerimaan <span class="mono">${esc(receipt.receipt_no)}</span> · ${rolls.length} roll · ${fmtYd(total)} yard</div>
      <div class="page-head"><h1>Label barcode</h1>
        <div class="btn-row"><button class="btn" id="print-all">🖨 Cetak semua label (${rolls.length})</button>
        <button class="btn secondary" id="again">Input penerimaan baru</button></div></div>
      <section class="card"><div class="table-wrap"><table>
        <thead><tr><th>Kode barcode</th><th>Foto</th><th>Kain</th><th class="num">Yard</th><th>Lokasi</th><th>Barcode</th><th></th></tr></thead>
        <tbody>${rolls.map((r) => `<tr>
          <td class="mono"><a href="#/lacak/${esc(r.code)}">${esc(r.code)}</a></td>
          <td data-pcell="${esc(r.code)}"></td>
          <td>${esc(materialName(r))}</td><td class="num">${fmtYd(r.initial_yards)}</td><td>${esc(r.location)}</td>
          <td><img alt="" src="/api/barcode/${encodeURIComponent(r.code)}.svg" style="width:150px;height:36px;background:#fff"></td>
          <td><button class="btn secondary sm" data-print="${esc(r.code)}">Cetak</button></td></tr>`).join('')}</tbody>
      </table></div></section>`;
    const drawPhotoCell = (code) => {
      const cell = view.querySelector(`[data-pcell="${CSS.escape(code)}"]`);
      if (!cell) return;
      const p = photos.get(code);
      if (p.state === 'ok') cell.innerHTML = `<div class="photo-cell"><img class="thumb" alt="Foto ${esc(code)}" src="${p.url}" data-zoom="${esc(code)}"><span class="small" style="color:var(--ok)">✓ tersimpan</span></div>`;
      else if (p.state === 'pending') cell.innerHTML = `<div class="photo-cell"><img class="thumb" alt="" src="${p.url}"><span class="muted ph-state">mengunggah…</span></div>`;
      else cell.innerHTML = `<div class="photo-cell">${photoButtons(code)}${p.state === 'fail' ? '<span class="ph-state" style="color:var(--bad)">gagal, ulangi</span>' : ''}</div>`;
    };
    renderPhotoCell = drawPhotoCell;
    rolls.forEach((r) => drawPhotoCell(r.code));
    const run = async (codes) => {
      try {
        const res = await printLabels(codes);
        if (res.mode !== 'browser') toast(`${res.sent} label dikirim ke printer`, 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    $('#print-all', view).addEventListener('click', () => run(rolls.map((r) => r.code)));
    $('#again', view).addEventListener('click', () => {
      recentCache = null; // segarkan daftar penerimaan terakhir
      rows.length = 0;
      rows.push({ material_id: materials[0].id, yards: '', location: '', lot: '', photo: '' });
      renderForm();
    });
    view.addEventListener('click', (e) => {
      const b = e.target.closest('[data-print]');
      if (b) run([b.dataset.print]);
      const z = e.target.closest('[data-zoom]');
      if (z && photos.has(z.dataset.zoom)) showPhoto(photos.get(z.dataset.zoom).url, `Foto ${z.dataset.zoom}`);
    });
    view.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-photo-in]');
      if (!inp || !inp.files?.[0] || !photos.has(inp.dataset.photoIn)) return;
      const code = inp.dataset.photoIn;
      try {
        photos.set(code, { url: await compressImage(inp.files[0]), state: 'pending' });
      } catch (err) {
        return toast(err.message, 'err');
      }
      renderPhotoCell(code);
      await uploadPending([{ code }], photos);
    });
  }

  let renderPhotoCell = () => {};

  // Unggah foto yang menunggu (maks 3 sekaligus); kegagalan tidak membatalkan penerimaan, bisa diulang per roll
  async function uploadPending(rolls, photos) {
    const queue = rolls.map((r) => r.code).filter((c) => photos.get(c)?.state === 'pending');
    let failed = 0;
    const worker = async () => {
      while (queue.length) {
        const code = queue.shift();
        const p = photos.get(code);
        try {
          await uploadRollPhoto(code, p.url);
          p.state = 'ok';
        } catch (err) {
          p.state = 'fail';
          failed++;
        }
        renderPhotoCell(code);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (failed) toast(`${failed} foto gagal diunggah. Coba lagi lewat tombol 📷 di baris roll.`, 'err');
  }

  let recentCache = null;
  async function loadRecent() {
    const box = $('#recent', view);
    try {
      if (!recentCache) recentCache = (await get('/api/receipts?limit=8')).rows;
      const list = recentCache;
      if (!list.length) {
        box.textContent = 'Belum ada penerimaan.';
        return;
      }
      box.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>No.</th><th>Tanggal</th><th>Supplier</th><th class="num">Roll</th><th class="num">Yard</th><th></th></tr></thead>
        <tbody>${list.map((r) => `<tr><td class="mono">${esc(r.receipt_no)}</td><td>${esc(fmtDate(r.received_at))}</td>
          <td>${esc(r.supplier)} <span class="muted small">${esc(r.ref_doc)}</span></td>
          <td class="num">${r.roll_count}</td><td class="num">${fmtYd(r.total_yards)}</td>
          <td><button class="btn secondary sm" data-reprint="${r.id}">Cetak ulang label</button></td></tr>`).join('')}</tbody></table></div>`;
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-reprint]');
        if (!b) return;
        try {
          const { codes } = await get(`/api/receipts/${b.dataset.reprint}/rolls`);
          const res = await printLabels(codes);
          if (res.mode !== 'browser') toast(`${res.sent} label dikirim ke printer`, 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    } catch (err) {
      box.textContent = err.message;
    }
  }

  renderForm();
}
