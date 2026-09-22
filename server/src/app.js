import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HttpError, validName, validActiveDate, validMonth } from './validation.js';
import { listMonth, createBooking, updateBooking, blockDay } from './db.js';

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const idOf = value => {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new HttpError(400, 'Identificador inválido.');
  return Number(value);
};

export function createApp({ pool, passwordHash, sessionSecret, production = false, today = () => new Date() }) {
  if (!passwordHash || !sessionSecret || sessionSecret.length < 32) throw new Error('Configurá ADMIN_PASSWORD_HASH y SESSION_SECRET (mínimo 32 caracteres).');
  const app = express();
  if (production) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  const cookie = { httpOnly: true, secure: production, sameSite: 'strict', path: '/api/admin', maxAge: 8 * 60 * 60 * 1000 };
  const limited = (max) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' } });
  const requireAdmin = (req, _res, next) => {
    try { jwt.verify(req.cookies.admin_session, sessionSecret, { algorithms: ['HS256'], issuer: 'calendario' }); next(); }
    catch { next(new HttpError(401, 'Iniciá sesión como administrador.')); }
  };
  // Browsers cannot send authenticated cross-origin writes; this is a second CSRF barrier beyond SameSite.
  const sameOrigin = (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return next(new HttpError(403, 'Origen no permitido.'));
    next();
  };

  app.get('/api/health', asyncRoute(async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }));
  app.get('/api/inscripciones', asyncRoute(async (req, res) => {
    const { year, month } = validMonth(req.query.year, req.query.month);
    const now = today();
    const current = now.getFullYear() * 12 + now.getMonth();
    const requested = year * 12 + month - 1;
    if (requested < current || requested > current + 1) throw new HttpError(400, 'Solo están disponibles el mes actual y el siguiente.');
    res.json(await listMonth(pool, year, month));
  }));
  app.post('/api/inscripciones', sameOrigin, limited(20), asyncRoute(async (req, res) => {
    const fecha = validActiveDate(req.body?.fecha, { today: today() });
    const nombre = validName(req.body?.nombre);
    res.status(201).json(await createBooking(pool, fecha, nombre));
  }));
  app.post('/api/admin/login', sameOrigin, limited(5), asyncRoute(async (req, res) => {
    const candidate = typeof req.body?.password === 'string' ? req.body.password : '';
    if (candidate.length > 1024 || !await bcrypt.compare(candidate, passwordHash)) throw new HttpError(401, 'Contraseña incorrecta.');
    res.cookie('admin_session', jwt.sign({ role: 'admin' }, sessionSecret, { algorithm: 'HS256', issuer: 'calendario', expiresIn: '8h' }), cookie);
    res.json({ authenticated: true });
  }));
  app.get('/api/admin/session', requireAdmin, (_req, res) => res.json({ authenticated: true }));
  app.post('/api/admin/logout', sameOrigin, requireAdmin, (_req, res) => { res.clearCookie('admin_session', cookie); res.json({ authenticated: false }); });
  app.use('/api/admin/inscripciones', sameOrigin, requireAdmin);
  app.get('/api/admin/inscripciones', asyncRoute(async (_req, res) => {
    const [rows] = await pool.execute('SELECT id, fecha, nombre, creado_en, actualizado_en FROM inscripciones WHERE bloqueado = 0 ORDER BY fecha DESC');
    res.json(rows);
  }));
  app.post('/api/admin/inscripciones', asyncRoute(async (req, res) => {
    res.status(201).json(await createBooking(pool, validActiveDate(req.body?.fecha, { today: today() }), validName(req.body?.nombre)));
  }));
  app.patch('/api/admin/inscripciones/:id', asyncRoute(async (req, res) => {
    const updated = await updateBooking(pool, idOf(req.params.id), validActiveDate(req.body?.fecha, { today: today() }), validName(req.body?.nombre));
    if (!updated) throw new HttpError(404, 'Inscripción no encontrada.');
    res.json(updated);
  }));
  app.delete('/api/admin/inscripciones/:id', asyncRoute(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM inscripciones WHERE id = ? AND bloqueado = 0', [idOf(req.params.id)]);
    if (!result.affectedRows) throw new HttpError(404, 'Inscripción no encontrada.');
    res.status(204).end();
  }));
  app.use('/api/admin/bloqueos', sameOrigin, requireAdmin);
  app.get('/api/admin/bloqueos', asyncRoute(async (_req, res) => {
    const [rows] = await pool.execute('SELECT id, fecha FROM inscripciones WHERE bloqueado = 1 ORDER BY fecha');
    res.json(rows);
  }));
  app.post('/api/admin/bloqueos', asyncRoute(async (req, res) => {
    res.status(201).json(await blockDay(pool, validActiveDate(req.body?.fecha, { today: today() })));
  }));
  app.delete('/api/admin/bloqueos/:id', asyncRoute(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM inscripciones WHERE id = ? AND bloqueado = 1', [idOf(req.params.id)]);
    if (!result.affectedRows) throw new HttpError(404, 'Bloqueo no encontrado.');
    res.status(204).end();
  }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  app.use((error, _req, res, _next) => {
    if (error.code === 'ER_DUP_ENTRY') error = new HttpError(409, 'Esa fecha ya está ocupada.');
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'Ocurrió un error. Intentá nuevamente.' : error.message });
  });
  return app;
}
