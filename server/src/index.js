import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPool, migrate } from './db.js';
import { createApp } from './app.js';

const pool = createPool(process.env.DATABASE_URL);
await migrate(pool);
const app = createApp({ pool, passwordHash: process.env.ADMIN_PASSWORD_HASH, sessionSecret: process.env.SESSION_SECRET, production: process.env.NODE_ENV === 'production' });
const dist = resolve(import.meta.dirname, '../../client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Listening on ${server.address().port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => pool.end().then(() => process.exit(0))));
