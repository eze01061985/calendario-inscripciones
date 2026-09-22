import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { validDate, validName } from '../src/validation.js';

function fakePool() {
  const rows = []; let nextId = 1;
  return {
    rows,
    async query() { return [[{ ok: 1 }]]; },
    async execute(sql, values = []) {
      if (sql.startsWith('SELECT')) {
        if (sql.includes('WHERE fecha')) return [rows.filter(r => r.fecha >= values[0] && r.fecha < values[1]).sort((a,b) => a.fecha.localeCompare(b.fecha))];
        return [[...rows].sort((a,b) => b.fecha.localeCompare(a.fecha))];
      }
      if (sql.startsWith('INSERT')) {
        if (rows.some(r => r.fecha === values[0])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        const id = nextId++; rows.push({ id, fecha: values[0], nombre: values[1] }); return [{ insertId: id }];
      }
      if (sql.startsWith('UPDATE')) {
        if (rows.some(r => r.fecha === values[0] && r.id !== values[2])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        const row = rows.find(r => r.id === values[2]);
        if (!row) return [{ affectedRows: 0 }];
        Object.assign(row, { fecha: values[0], nombre: values[1] }); return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE')) {
        const i = rows.findIndex(r => r.id === values[0]);
        if (i < 0) return [{ affectedRows: 0 }];
        rows.splice(i, 1); return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected SQL');
    }
  };
}

test('validation rejects malformed and past dates, trims names', () => {
  assert.equal(validName('  Familia   Flores  '), 'Familia Flores');
  assert.throws(() => validName('x'), /nombre/i);
  assert.equal(validName('<script>alert(1)</script>'), '<script>alert(1)</script>'); // React renders this as text, not HTML.
  assert.throws(() => validDate('2026-02-30', { today: new Date('2026-01-01') }), /fecha válida/);
  assert.throws(() => validDate('2026-09-21', { today: new Date('2026-09-22T12:00:00') }), /pasada/);
});

test('public and admin flows enforce unique dates and authorization', async () => {
  const pool = fakePool();
  const app = createApp({ pool, passwordHash: await bcrypt.hash('test-password', 4), sessionSecret: 'test-secret-with-more-than-32-characters', today: () => new Date('2026-09-22T12:00:00') });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = 'GET', body, cookie) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await call('/api/health')).status, 200);
    const booking = { fecha: '2026-10-08', nombre: 'Familia Flores' };
    assert.equal((await call('/api/inscripciones', 'POST', booking)).status, 201);
    assert.equal((await call('/api/inscripciones', 'POST', { ...booking, nombre: 'Familia Gómez' })).status, 409);
    assert.equal((await call('/api/inscripciones', 'POST', { ...booking, fecha: '2026-10-10' })).status, 201);
    assert.equal((await call('/api/inscripciones', 'POST', { ...booking, fecha: '2026-09-21' })).status, 400);
    const list = await (await call('/api/inscripciones?year=2026&month=10')).json();
    assert.deepEqual(list.map(r => r.nombre), ['Familia Flores', 'Familia Flores']);
    assert.equal((await call('/api/inscripciones/1', 'DELETE')).status, 404);
    assert.equal((await call('/api/admin/inscripciones', 'POST', booking)).status, 401);
    assert.equal((await call('/api/admin/inscripciones/1', 'PATCH', booking)).status, 401);
    assert.equal((await call('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
    const login = await call('/api/admin/login', 'POST', { password: 'test-password' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/admin/session', 'GET', null, cookie)).status, 200);
    assert.equal((await call('/api/admin/inscripciones', 'POST', { fecha: '2026-10-12', nombre: 'Familia Gómez' }, cookie)).status, 201);
    assert.equal((await call('/api/admin/inscripciones/3', 'PATCH', { fecha: '2026-10-08', nombre: 'Familia Gómez' }, cookie)).status, 409);
    assert.equal((await call('/api/admin/inscripciones/3', 'PATCH', { fecha: '2026-10-13', nombre: 'Familia Pérez' }, cookie)).status, 200);
    assert.equal((await call('/api/admin/inscripciones/3', 'DELETE', null, cookie)).status, 204);
    assert.equal(pool.rows.length, 2);
    assert.equal((await call('/api/admin/logout', 'POST', null, cookie)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('simultaneous submissions have one winner and one conflict', async () => {
  const pool = fakePool();
  const app = createApp({ pool, passwordHash: await bcrypt.hash('test-password', 4), sessionSecret: 'test-secret-with-more-than-32-characters', today: () => new Date('2026-09-22T12:00:00') });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/inscripciones`;
  try {
    const submit = nombre => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fecha: '2026-10-08', nombre }) });
    const results = await Promise.all([submit('Familia Flores'), submit('Familia Gómez')]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(pool.rows.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
