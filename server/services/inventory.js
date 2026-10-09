import { tx, getSetting, allocateSeq } from '../db.js';
import { bad, notFound, round2, parseYards, cleanStr, reqStr, now, localDate, dayRangeUtc } from '../util.js';

const EPS = 0.005;
export const MAX_ROLLS_PER_RECEIPT = 200;
export const MAX_ITEMS_PER_OUTBOUND = 200;

export const normalizeCode = (code) => cleanStr(code, 64).toUpperCase();

export async function getPrefix(db) {
  const prefix = await getSetting(db, 'barcode_prefix', 'DLV');
  return /^[A-Z0-9]{1,5}$/.test(prefix) ? prefix : 'DLV';
}

const yymmdd = (isoDate) => isoDate.slice(2, 4) + isoDate.slice(5, 7) + isoDate.slice(8, 10);

const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Nomor dokumen harian, mis. GR-261009-001 / OUT-261009-001 (atomik, tanpa lubang saat rollback). */
async function nextDocNo(db, prefix, day) {
  const key = yymmdd(day);
  const n = await allocateSeq(db, `${prefix}:${key}`, 1);
  return `${prefix}-${key}-${String(n).padStart(3, '0')}`;
}

const ROLL_SELECT = `
  SELECT r.*, m.code AS material_code, m.name AS material_name, m.color AS material_color,
         m.width_cm AS material_width_cm,
         rc.receipt_no, rc.supplier, rc.ref_doc, rc.received_at
    FROM rolls r
    JOIN materials m ON m.id = r.material_id
    LEFT JOIN receipts rc ON rc.id = r.receipt_id`;

export async function findRoll(db, code) {
  return (await db.get(`${ROLL_SELECT} WHERE r.code = ?`, [normalizeCode(code)])) || null;
}

export async function getRollOrThrow(db, code) {
  const roll = await findRoll(db, code);
  if (!roll) throw notFound(`Roll dengan kode ${normalizeCode(code)} tidak ditemukan`);
  return roll;
}

/** Kunci baris roll (urut kode, mencegah deadlock) sampai transaksi selesai. Harus di dalam tx(). */
async function lockRolls(db, codes) {
  const sorted = [...new Set(codes.map(normalizeCode).filter(Boolean))].sort();
  if (sorted.length) await db.all('SELECT id FROM rolls WHERE code IN (?) ORDER BY code FOR UPDATE', [sorted]);
}

export async function getRollDetail(db, code) {
  const roll = await getRollOrThrow(db, code);
  const movements = await db.all(
    `SELECT mv.*, u.name AS user_name
       FROM movements mv LEFT JOIN users u ON u.id = mv.user_id
      WHERE mv.roll_id = ? ORDER BY mv.id DESC`,
    [roll.id],
  );
  return { roll, movements };
}

export async function listRolls(db, { q, status, material_id, limit = 50, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (status && status !== 'all') {
    where.push('r.status = ?');
    args.push(status);
  }
  if (material_id) {
    where.push('r.material_id = ?');
    args.push(Number(material_id));
  }
  if (q) {
    const like = `%${cleanStr(q, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push('(r.code LIKE ? OR m.name LIKE ? OR m.code LIKE ? OR m.color LIKE ? OR r.lot LIKE ? OR r.location LIKE ? OR rc.supplier LIKE ?)');
    args.push(like, like, like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const { c: total } = await db.get(
    `SELECT COUNT(*) c FROM rolls r JOIN materials m ON m.id = r.material_id LEFT JOIN receipts rc ON rc.id = r.receipt_id ${clause}`,
    args,
  );
  const rows = await db.all(`${ROLL_SELECT} ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...args, lim, off]);
  return { rows, total };
}

async function insertMovement(db, m) {
  await db.run(
    `INSERT INTO movements(roll_id, type, delta, balance_after, doc_no, purpose, ref, notes, user_id, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [m.roll_id, m.type, m.delta, m.balance_after, m.doc_no || '', m.purpose || '', m.ref || '', m.notes || '', m.user_id ?? null, m.created_at],
  );
}

/**
 * Barang masuk: satu dokumen penerimaan, banyak roll. Setiap roll mendapat kode barcode unik.
 * items: [{ material_id, yards, location?, lot?, notes? }]
 */
export async function receiveRolls(db, user, config, payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) throw bad('Tambahkan minimal satu roll');
  if (items.length > MAX_ROLLS_PER_RECEIPT) throw bad(`Maksimal ${MAX_ROLLS_PER_RECEIPT} roll per penerimaan`);

  const supplier = cleanStr(payload.supplier, 120);
  const refDoc = cleanStr(payload.ref_doc, 80);
  const notes = cleanStr(payload.notes, 500);
  if (payload.received_at && !validDay(payload.received_at)) throw bad('Tanggal terima tidak valid');
  const day = payload.received_at || localDate(config.tzOffsetMinutes);

  // Validasi semua baris di luar transaksi (tanpa menahan kunci)
  const parsed = [];
  for (const [i, it] of items.entries()) {
    const material = await db.get('SELECT id, active FROM materials WHERE id = ?', [Number(it.material_id)]);
    if (!material || !material.active) throw bad(`Baris ${i + 1}: jenis kain tidak valid`);
    parsed.push({
      material_id: material.id,
      yards: parseYards(it.yards, `Baris ${i + 1}: yard`),
      location: cleanStr(it.location, 60),
      lot: cleanStr(it.lot, 60),
      notes: cleanStr(it.notes, 300),
    });
  }

  return tx(db, async (t) => {
    const prefix = await getPrefix(t);
    const at = now();
    const receiptNo = await nextDocNo(t, 'GR', day);
    const rc = await t.run(
      'INSERT INTO receipts(receipt_no, supplier, ref_doc, received_at, notes, user_id, created_at) VALUES(?,?,?,?,?,?,?)',
      [receiptNo, supplier, refDoc, day, notes, user?.id ?? null, at],
    );

    const stem = `${prefix}${yymmdd(day)}`;
    let seq = await allocateSeq(t, `roll:${stem}`, parsed.length);
    const codes = [];

    for (const it of parsed) {
      const code = `${stem}${String(seq++).padStart(4, '0')}`;
      const r = await t.run(
        `INSERT INTO rolls(code, material_id, receipt_id, initial_yards, current_yards, location, lot, notes, status, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?, 'in_stock', ?, ?)`,
        [code, it.material_id, rc.insertId, it.yards, it.yards, it.location, it.lot, it.notes, at, at],
      );
      await insertMovement(t, {
        roll_id: r.insertId,
        type: 'IN',
        delta: it.yards,
        balance_after: it.yards,
        doc_no: receiptNo,
        purpose: 'Barang masuk',
        ref: refDoc,
        notes: supplier ? `Supplier: ${supplier}` : '',
        user_id: user?.id,
        created_at: at,
      });
      codes.push(code);
    }

    const rolls = [];
    for (const c of codes) rolls.push(await findRoll(t, c));
    return { receipt: await t.get('SELECT * FROM receipts WHERE id = ?', [rc.insertId]), rolls };
  });
}

/**
 * Barang keluar (bisa sebagian roll). Roll dikunci, semua baris divalidasi dulu, lalu diterapkan atomik.
 * items: [{ code, yards }]
 */
export async function issueRolls(db, user, config, payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) throw bad('Scan atau tambahkan minimal satu roll');
  if (items.length > MAX_ITEMS_PER_OUTBOUND) throw bad(`Maksimal ${MAX_ITEMS_PER_OUTBOUND} roll per dokumen`);
  const purpose = reqStr(payload.purpose, 'Keperluan', 80);
  const ref = cleanStr(payload.ref, 80);
  const notes = cleanStr(payload.notes, 500);

  return tx(db, async (t) => {
    const seen = new Set();
    const codes = items.map((it, i) => {
      const code = normalizeCode(it.code);
      if (!code) throw bad(`Baris ${i + 1}: kode roll kosong`);
      if (seen.has(code)) throw bad(`Roll ${code} muncul lebih dari sekali`);
      seen.add(code);
      return code;
    });
    await lockRolls(t, codes); // cegah dua pengeluaran bersamaan menghabiskan roll yang sama

    const planned = [];
    for (const [i, it] of items.entries()) {
      const roll = await getRollOrThrow(t, codes[i]);
      if (roll.status === 'void') throw bad(`Roll ${roll.code} sudah di-void`);
      if (roll.status === 'depleted') throw bad(`Roll ${roll.code} sudah habis`);
      const yards = parseYards(it.yards, `Roll ${roll.code}: yard keluar`);
      if (yards > roll.current_yards + EPS) {
        throw bad(`Roll ${roll.code}: yard keluar (${yards}) melebihi sisa (${roll.current_yards})`);
      }
      planned.push({ roll, yards: Math.min(yards, roll.current_yards) });
    }

    const docNo = await nextDocNo(t, 'OUT', localDate(config.tzOffsetMinutes));
    const at = now();
    const results = [];
    for (const { roll, yards } of planned) {
      const remaining = round2(roll.current_yards - yards);
      const depleted = remaining < EPS;
      const balance = depleted ? 0 : remaining;
      await t.run('UPDATE rolls SET current_yards = ?, status = ?, updated_at = ? WHERE id = ?', [
        balance,
        depleted ? 'depleted' : 'in_stock',
        at,
        roll.id,
      ]);
      await insertMovement(t, {
        roll_id: roll.id,
        type: 'OUT',
        delta: -yards,
        balance_after: balance,
        doc_no: docNo,
        purpose,
        ref,
        notes,
        user_id: user?.id,
        created_at: at,
      });
      results.push(await findRoll(t, roll.code));
    }
    return { doc_no: docNo, rolls: results };
  });
}

/** Penyesuaian stok (stock opname): set yard sisa ke nilai yang benar. */
export async function adjustRoll(db, user, code, payload) {
  const notes = reqStr(payload?.notes, 'Alasan penyesuaian', 300);
  const target = Number(String(payload?.new_yards ?? '').replace(',', '.'));
  if (!Number.isFinite(target) || target < 0 || target > 100000) throw bad('Yard baru harus angka 0 atau lebih');
  const newYards = round2(target);

  return tx(db, async (t) => {
    await lockRolls(t, [code]);
    const roll = await getRollOrThrow(t, code);
    if (roll.status === 'void') throw bad('Roll sudah di-void');
    const delta = round2(newYards - roll.current_yards);
    if (Math.abs(delta) < EPS) throw bad('Yard baru sama dengan sisa saat ini');
    const status = newYards < EPS ? 'depleted' : 'in_stock';
    const at = now();
    await t.run('UPDATE rolls SET current_yards = ?, status = ?, updated_at = ? WHERE id = ?', [newYards, status, at, roll.id]);
    await insertMovement(t, {
      roll_id: roll.id,
      type: 'ADJUST',
      delta,
      balance_after: newYards,
      purpose: 'Penyesuaian stok',
      notes,
      user_id: user?.id,
      created_at: at,
    });
    return findRoll(t, roll.code);
  });
}

export async function voidRoll(db, user, code, payload) {
  const reason = reqStr(payload?.reason, 'Alasan void', 300);
  return tx(db, async (t) => {
    await lockRolls(t, [code]);
    const roll = await getRollOrThrow(t, code);
    if (roll.status === 'void') throw bad('Roll sudah di-void');
    const at = now();
    await t.run("UPDATE rolls SET current_yards = 0, status = 'void', updated_at = ? WHERE id = ?", [at, roll.id]);
    await insertMovement(t, {
      roll_id: roll.id,
      type: 'ADJUST',
      delta: -roll.current_yards,
      balance_after: 0,
      purpose: 'VOID',
      notes: reason,
      user_id: user?.id,
      created_at: at,
    });
    return findRoll(t, roll.code);
  });
}

export async function updateRollInfo(db, code, payload) {
  const roll = await getRollOrThrow(db, code);
  const location = payload.location !== undefined ? cleanStr(payload.location, 60) : roll.location;
  const lot = payload.lot !== undefined ? cleanStr(payload.lot, 60) : roll.lot;
  const notes = payload.notes !== undefined ? cleanStr(payload.notes, 300) : roll.notes;
  await db.run('UPDATE rolls SET location = ?, lot = ?, notes = ?, updated_at = ? WHERE id = ?', [location, lot, notes, now(), roll.id]);
  return findRoll(db, roll.code);
}

export async function listMovements(db, config, { type, from, to, q, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (['IN', 'OUT', 'ADJUST'].includes(type)) {
    where.push('mv.type = ?');
    args.push(type);
  }
  if (validDay(from)) {
    where.push('mv.created_at >= ?');
    args.push(dayRangeUtc(from, config.tzOffsetMinutes)[0]);
  }
  if (validDay(to)) {
    where.push('mv.created_at < ?');
    args.push(dayRangeUtc(to, config.tzOffsetMinutes)[1]);
  }
  if (q) {
    const like = `%${cleanStr(q, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push('(r.code LIKE ? OR m.name LIKE ? OR mv.doc_no LIKE ? OR mv.ref LIKE ? OR mv.purpose LIKE ?)');
    args.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM movements mv
      JOIN rolls r ON r.id = mv.roll_id
      JOIN materials m ON m.id = r.material_id
      LEFT JOIN users u ON u.id = mv.user_id ${clause}`;
  const { c: total } = await db.get(`SELECT COUNT(*) c ${base}`, args);
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 5000);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = await db.all(
    `SELECT mv.*, r.code AS roll_code, m.name AS material_name, m.color AS material_color, u.name AS user_name
     ${base} ORDER BY mv.id DESC LIMIT ? OFFSET ?`,
    [...args, lim, off],
  );
  return { rows, total };
}

export async function dashboard(db, config) {
  const today = localDate(config.tzOffsetMinutes);
  const [dayStart, dayEnd] = dayRangeUtc(today, config.tzOffsetMinutes);
  const totals = await db.get("SELECT COUNT(*) rolls, COALESCE(SUM(current_yards),0) yards FROM rolls WHERE status = 'in_stock'");
  const dayStats = await db.all(
    `SELECT type, COUNT(*) n, COALESCE(SUM(ABS(delta)),0) yards
       FROM movements WHERE created_at >= ? AND created_at < ? AND type IN ('IN','OUT') GROUP BY type`,
    [dayStart, dayEnd],
  );
  const stat = (t) => dayStats.find((d) => d.type === t) || { n: 0, yards: 0 };
  const byMaterial = (
    await db.all(
      `SELECT m.id, m.code, m.name, m.color, m.min_yards,
              (SELECT COUNT(*) FROM rolls r WHERE r.material_id = m.id AND r.status = 'in_stock') AS rolls,
              (SELECT COALESCE(SUM(r.current_yards),0) FROM rolls r WHERE r.material_id = m.id AND r.status = 'in_stock') AS yards
         FROM materials m WHERE m.active = 1 ORDER BY yards DESC, m.name`,
    )
  ).map((m) => ({ ...m, yards: round2(m.yards), low: m.min_yards > 0 && m.yards < m.min_yards }));
  return {
    today,
    totals: { rolls: Number(totals.rolls), yards: round2(totals.yards) },
    in_today: { count: Number(stat('IN').n), yards: round2(stat('IN').yards) },
    out_today: { count: Number(stat('OUT').n), yards: round2(stat('OUT').yards) },
    by_material: byMaterial,
    low_stock: byMaterial.filter((m) => m.low),
    recent: (await listMovements(db, config, { limit: 8 })).rows,
  };
}
