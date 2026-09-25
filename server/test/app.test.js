import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { validDate, validName } from '../src/validation.js';

function fakePool() {
  const rows = []; let nextId = 1;
  let publicMonth = '2026-10-01';
  return {
    rows,
    async getConnection() { return { execute: this.execute.bind(this), async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; },
    async query() { return [[{ ok: 1 }]]; },
    async execute(sql, values = []) {
      if (sql.startsWith('SELECT mes FROM configuracion_calendario')) return [[{ mes: publicMonth }]];
      if (sql.startsWith('UPDATE configuracion_calendario')) { publicMonth = values[0]; return [{ affectedRows: 1 }]; }
      if (sql.startsWith('SELECT')) {
        if (sql.includes('WHERE fecha')) return [rows.filter(r => r.fecha >= values[0] && r.fecha < values[1]).sort((a,b) => a.fecha.localeCompare(b.fecha))];
        if (sql.includes('WHERE bloqueado = 0')) return [rows.filter(r => !r.bloqueado).sort((a,b) => b.fecha.localeCompare(a.fecha))];
        if (sql.includes('WHERE bloqueado = 1')) return [rows.filter(r => r.bloqueado).sort((a,b) => a.fecha.localeCompare(b.fecha))];
        return [[...rows]];
      }
      if (sql.startsWith('INSERT')) {
        if (rows.some(r => r.fecha === values[0])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        const blocked = sql.includes('bloqueado');
        const id = nextId++; rows.push({ id, fecha: values[0], nombre: blocked ? null : values[1], bloqueado: blocked ? 1 : 0 }); return [{ insertId: id }];
      }
      if (sql.startsWith('UPDATE')) {
        if (rows.some(r => r.fecha === values[0] && r.id !== values[2])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        const row = rows.find(r => r.id === values[2] && !r.bloqueado);
        if (!row) return [{ affectedRows: 0 }];
        Object.assign(row, { fecha: values[0], nombre: values[1] }); return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE')) {
        const blocked = sql.includes('bloqueado = 1');
        const i = rows.findIndex(r => r.id === values[0] && Boolean(r.bloqueado) === blocked);
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
  assert.equal(validDate('2027-01-02', { today: new Date('2026-12-20T12:00:00') }), '2027-01-02');
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
    assert.equal((await call('/api/inscripciones', 'POST', { ...booking, fecha: '2026-11-01' })).status, 400);
    assert.equal((await call('/api/inscripciones?year=2026&month=11')).status, 400);
    const list = await (await call('/api/inscripciones?year=2026&month=10')).json();
    assert.deepEqual(list.map(r => r.nombre), ['Familia Flores', 'Familia Flores']);
    assert.equal((await call('/api/inscripciones/1', 'DELETE')).status, 404);
    assert.equal((await call('/api/admin/inscripciones', 'POST', booking)).status, 401);
    assert.equal((await call('/api/admin/inscripciones/1', 'PATCH', booking)).status, 401);
    assert.equal((await call('/api/admin/bloqueos', 'POST', { fecha: '2026-10-15' })).status, 401);
    assert.equal((await call('/api/admin/login', 'POST', { password: 'wrong' })).status, 401);
    const login = await call('/api/admin/login', 'POST', { password: 'test-password' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/admin/session', 'GET', null, cookie)).status, 200);
    assert.equal((await call('/api/admin/inscripciones', 'POST', { fecha: '2026-10-12', nombre: 'Familia Gómez' }, cookie)).status, 201);
    assert.equal((await call('/api/admin/inscripciones/3', 'PATCH', { fecha: '2026-10-08', nombre: 'Familia Gómez' }, cookie)).status, 409);
    assert.equal((await call('/api/admin/inscripciones/3', 'PATCH', { fecha: '2026-10-13', nombre: 'Familia Pérez' }, cookie)).status, 200);
    assert.equal((await call('/api/admin/inscripciones/3', 'DELETE', null, cookie)).status, 204);
    assert.equal((await call('/api/admin/bloqueos', 'POST', { fecha: '2026-09-01' }, cookie)).status, 400);
    assert.equal((await call('/api/admin/bloqueos', 'POST', { fecha: '2026-10-08' }, cookie)).status, 409);
    const block = await call('/api/admin/bloqueos', 'POST', { fecha: '2026-10-15' }, cookie);
    assert.equal(block.status, 201);
    const blocked = await block.json();
    assert.equal((await call('/api/inscripciones', 'POST', { ...booking, fecha: blocked.fecha })).status, 409);
    assert.equal((await call('/api/admin/inscripciones', 'POST', { ...booking, fecha: blocked.fecha }, cookie)).status, 409);
    assert.equal((await call('/api/admin/inscripciones/2', 'PATCH', { ...booking, fecha: blocked.fecha }, cookie)).status, 409);
    const visible = await (await call('/api/inscripciones?year=2026&month=10')).json();
    assert.equal(visible.find(row => row.fecha === blocked.fecha).bloqueado, 1);
    assert.equal(visible.find(row => row.fecha === blocked.fecha).nombre, null);
    assert.equal((await call('/api/admin/inscripciones', 'GET', null, cookie)).status, 200);
    assert.equal((await call('/api/admin/bloqueos', 'GET', null, cookie)).status, 200);
    assert.equal((await call(`/api/admin/inscripciones/${blocked.id}`, 'DELETE', null, cookie)).status, 404);
    assert.equal((await call(`/api/admin/bloqueos/${blocked.id}`, 'DELETE')).status, 401);
    assert.equal((await call(`/api/admin/bloqueos/${blocked.id}`, 'DELETE', null, cookie)).status, 204);
    assert.equal((await call('/api/inscripciones', 'POST', { ...booking, fecha: blocked.fecha })).status, 201);
    assert.equal(pool.rows.length, 3);
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

test('a block and a public booking cannot claim the same day', async () => {
  const pool = fakePool();
  const app = createApp({ pool, passwordHash: await bcrypt.hash('test-password', 4), sessionSecret: 'test-secret-with-more-than-32-characters', today: () => new Date('2026-09-22T12:00:00') });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const date = '2026-10-20';
    const results = await Promise.all([
      fetch(`${base}/api/admin/bloqueos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ fecha: date }) }),
      fetch(`${base}/api/inscripciones`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fecha: date, nombre: 'Familia Flores' }) }),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(pool.rows.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('only the published month is public; administrators can prepare and publish another year without losing data', async () => {
  const pool = fakePool();
  const options = { pool, passwordHash: await bcrypt.hash('test-password', 4), sessionSecret: 'test-secret-with-more-than-32-characters', today: () => new Date('2026-09-25T12:00:00') };
  const server = createApp(options).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = 'GET', body, cookie) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const initial = await (await call('/api/calendario')).json();
    assert.equal(initial.month, 10);
    const setting = { year: 2027, month: 1 };
    assert.equal((await call('/api/admin/mes-publico', 'PUT', setting)).status, 401);
    assert.equal((await call('/api/admin/calendario?year=2027&month=1')).status, 401);
    const login = await call('/api/admin/login', 'POST', { password: 'test-password' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/admin/mes-publico', 'PUT', { year: 2027, month: 13 }, cookie)).status, 400);
    const oldBooking = { fecha: '2026-10-20', nombre: 'Familia de octubre' };
    assert.equal((await call('/api/inscripciones', 'POST', oldBooking)).status, 201);
    assert.equal((await call('/api/admin/inscripciones', 'POST', { fecha: '2027-01-05', nombre: 'Familia de enero' }, cookie)).status, 201);
    assert.equal((await call('/api/admin/bloqueos', 'POST', { fecha: '2027-01-06' }, cookie)).status, 201);
    assert.equal((await call('/api/admin/calendario?year=2027&month=1', 'GET', null, cookie)).status, 200);
    assert.equal((await call('/api/inscripciones?year=2027&month=1')).status, 400);
    assert.equal((await call('/api/admin/mes-publico', 'PUT', setting, cookie)).status, 200);
    const current = await (await call('/api/calendario')).json();
    assert.equal(current.year, 2027);
    assert.equal(current.month, 1);
    assert.equal(current.inscripciones.length, 2);
    assert.equal(current.inscripciones.find(item => item.fecha === '2027-01-06').bloqueado, 1);
    assert.equal((await call('/api/inscripciones', 'POST', { ...oldBooking, fecha: '2026-10-21' })).status, 400);
    assert.equal((await call('/api/inscripciones', 'POST', { ...oldBooking, fecha: '2027-01-10' })).status, 201);
    // A new application instance reads the same saved setting.
    const restarted = createApp(options).listen(0);
    await new Promise(resolve => restarted.once('listening', resolve));
    try {
      const saved = await (await fetch(`http://127.0.0.1:${restarted.address().port}/api/calendario`)).json();
      assert.equal(saved.year, 2027); assert.equal(saved.month, 1);
    } finally { await new Promise(resolve => restarted.close(resolve)); }
    await call('/api/admin/mes-publico', 'PUT', { year: 2026, month: 10 }, cookie);
    assert.equal((await (await call('/api/calendario')).json()).inscripciones[0].nombre, oldBooking.nombre);
    assert.equal(pool.rows.length, 4);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
