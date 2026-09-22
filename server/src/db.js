import mysql from 'mysql2/promise';

export function createPool(url) {
  if (!url) throw new Error('Falta DATABASE_URL');
  return mysql.createPool({ uri: url, waitForConnections: true, connectionLimit: 10, dateStrings: true, timezone: 'Z' });
}

export async function migrate(pool) {
  // The initial schema is idempotent; the second migration upgrades existing deployments.
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inscripciones' AND COLUMN_NAME = 'bloqueado'");
  if (!Number(count)) {
    const upgrade = await readFile(new URL('../migrations/002_blocked_days.sql', import.meta.url), 'utf8');
    await pool.query(upgrade);
  }
}

export async function listMonth(pool, year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const [rows] = await pool.execute('SELECT id, fecha, nombre, bloqueado, creado_en, actualizado_en FROM inscripciones WHERE fecha >= ? AND fecha < ? ORDER BY fecha', [start, next]);
  return rows;
}

export async function createBooking(pool, fecha, nombre) {
  try {
    const [result] = await pool.execute('INSERT INTO inscripciones (fecha, nombre) VALUES (?, ?)', [fecha, nombre]);
    return { id: result.insertId, fecha, nombre, bloqueado: 0 };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new (await import('./validation.js')).HttpError(409, 'Ese día acaba de ser ocupado por otra persona. Elegí otro día disponible.');
    throw error;
  }
}

export async function updateBooking(pool, id, fecha, nombre) {
  try {
    const [result] = await pool.execute('UPDATE inscripciones SET fecha = ?, nombre = ? WHERE id = ? AND bloqueado = 0', [fecha, nombre, id]);
    if (!result.affectedRows) return null;
    return { id, fecha, nombre };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new (await import('./validation.js')).HttpError(409, 'Esa fecha ya está ocupada. Elegí otra.');
    throw error;
  }
}

export async function blockDay(pool, fecha) {
  try {
    const [result] = await pool.execute('INSERT INTO inscripciones (fecha, nombre, bloqueado) VALUES (?, NULL, 1)', [fecha]);
    return { id: result.insertId, fecha, nombre: null, bloqueado: 1 };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new (await import('./validation.js')).HttpError(409, 'Esa fecha ya está ocupada o bloqueada.');
    throw error;
  }
}
