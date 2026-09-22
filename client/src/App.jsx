import React, { useCallback, useEffect, useState } from 'react';

const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const longDate = value => new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const isoDate = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const localToday = () => { const d = new Date(); return isoDate(d.getFullYear(), d.getMonth(), d.getDate()); };
const activeRange = () => { const now = new Date(); return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 2, 0) }; };
const monthTitle = d => { const label = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(d); return label.charAt(0).toUpperCase() + label.slice(1); };
const api = async (path, options = {}) => {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'No se pudo completar la operación.'); error.status = response.status; throw error; }
  return data;
};

function Calendar({ month, bookings, onSelect, onOccupied, onBlocked, admin }) {
  const year = month.getFullYear(), index = month.getMonth();
  const first = (new Date(year, index, 1).getDay() + 6) % 7;
  const days = new Date(year, index + 1, 0).getDate();
  const cells = Array.from({ length: first + days }, (_, i) => i < first ? null : i - first + 1);
  const byDate = new Map(bookings.map(item => [item.fecha, item]));
  return <div className="calendar" role="grid" aria-label={`Calendario de ${monthTitle(month)}`}>
    {weekdays.map(day => <div className="weekday" role="columnheader" key={day}>{day}</div>)}
    {cells.map((day, i) => {
      if (!day) return <div className="blank" key={`blank-${i}`} aria-hidden="true"/>;
      const date = isoDate(year, index, day), booking = byDate.get(date), blocked = Boolean(booking?.bloqueado), past = date < localToday();
      return <button key={date} type="button" role="gridcell" className={`day ${booking && !blocked ? 'occupied' : ''} ${blocked ? 'blocked' : ''} ${past ? 'past' : ''}`} disabled={past || (blocked && !admin) || (booking && !blocked && !admin)} onClick={() => blocked ? onBlocked?.(booking) : booking ? onOccupied?.(booking) : onSelect(date)} aria-label={`${longDate(date)}: ${past ? 'fecha pasada' : blocked ? 'día bloqueado' : booking ? `anotado ${booking.nombre}` : 'disponible, tocar para anotarse'}`}>
        <span className="day-number">{day}</span>{booking && !blocked && <span className="day-name">{booking.nombre}</span>}{blocked && admin && <span className="day-name">Bloqueado</span>}
      </button>;
    })}
  </div>;
}

function MonthNavigation({ month, setMonth }) {
  const move = n => setMonth(d => new Date(d.getFullYear(), d.getMonth() + n, 1));
  const now = new Date();
  const { start } = activeRange();
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return <div className="month-nav"><button type="button" className="nav-arrow" disabled={month <= start} onClick={() => move(-1)} aria-label="Mes anterior">‹</button><div className="month-heading"><h1 style={{ textTransform: 'none' }}>{monthTitle(month)}</h1>{month > start && <button type="button" className="today-link" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>Volver a hoy</button>}</div><button type="button" className="nav-arrow" disabled={month >= next} onClick={() => move(1)} aria-label="Mes siguiente">›</button></div>;
}

function Dialog({ title, children, onClose }) {
  const escape = useCallback(e => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => { document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [escape]);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><button className="close" type="button" onClick={onClose} aria-label="Cerrar">×</button><h2>{title}</h2>{children}</section></div>;
}

function PublicPage() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [bookings, setBookings] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState(null), [name, setName] = useState(''), [submitting, setSubmitting] = useState(false), [notice, setNotice] = useState('');
  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try { setBookings(await api(`/api/inscripciones?year=${month.getFullYear()}&month=${month.getMonth() + 1}`)); setError(''); }
    catch (e) { setError(e.message); }
    finally { if (showLoading) setLoading(false); }
  }, [month]);
  useEffect(() => { refresh(true); const timer = setInterval(() => refresh(), 60000); return () => clearInterval(timer); }, [refresh]);
  const submit = async e => {
    e.preventDefault(); setSubmitting(true); setError('');
    try {
      const current = await api(`/api/inscripciones?year=${month.getFullYear()}&month=${month.getMonth() + 1}`);
      setBookings(current);
      if (current.some(item => item.fecha === selected)) throw Object.assign(new Error('Ese día acaba de quedar ocupado o bloqueado. Elegí otro día disponible.'), { status: 409 });
      const booking = await api('/api/inscripciones', { method: 'POST', body: JSON.stringify({ fecha: selected, nombre: name }) });
      setBookings(items => [...items, booking]); setNotice(`✓ Listo. ${booking.nombre} quedó anotado/a para el ${longDate(selected)}.`); setSelected(null); setName('');
    } catch (e) { setError(e.message); if (e.status === 409) { setSelected(null); await refresh(); } }
    finally { setSubmitting(false); }
  };
  return <main className="shell"><header className="topline"><div className="brand"><span className="brand-mark" aria-hidden="true">▦</span> Calendario compartido</div></header><MonthNavigation month={month} setMonth={setMonth}/>
    {notice && <div className="notice success" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Cerrar aviso">×</button></div>}
    {error && !selected && <div className="notice error" role="alert">{error} <button type="button" onClick={() => { setError(''); refresh(true); }}>Reintentar</button></div>}
    {loading ? <p className="loading" role="status">Cargando calendario…</p> : <Calendar month={month} bookings={bookings} onSelect={date => { setSelected(date); setError(''); setNotice(''); }} />}
    <p className="instruction">Para anotarte, tocá un casillero blanco.<br/>Si necesitás modificar o cancelar una fecha, comunicate con el administrador.</p>
    {selected && <Dialog title={`Anotarse para el ${longDate(selected)}`} onClose={() => { setSelected(null); setError(''); }}><form onSubmit={submit}><label htmlFor="booking-name">Nombre o familia</label><input id="booking-name" autoFocus required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)}/>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={submitting || name.trim().length < 2}>{submitting ? 'Anotando…' : 'Anotarme'}</button></form></Dialog>}
  </main>;
}

function AdminPage() {
  const [authenticated, setAuthenticated] = useState(null), [password, setPassword] = useState(''), [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [bookings, setBookings] = useState([]), [all, setAll] = useState([]), [blocks, setBlocks] = useState([]), [editing, setEditing] = useState(null), [blocking, setBlocking] = useState(false), [name, setName] = useState(''), [date, setDate] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [monthData, allData, blockedData] = await Promise.all([api(`/api/inscripciones?year=${month.getFullYear()}&month=${month.getMonth() + 1}`), api('/api/admin/inscripciones'), api('/api/admin/bloqueos')]);
      setBookings(monthData); setAll(allData); setBlocks(blockedData); setError('');
    } catch (e) { setError(e.message); if (e.status === 401) setAuthenticated(false); }
  }, [month]);
  useEffect(() => { api('/api/admin/session').then(() => setAuthenticated(true)).catch(() => setAuthenticated(false)); }, []);
  useEffect(() => { if (authenticated) refresh(); }, [authenticated, refresh]);
  const login = async e => { e.preventDefault(); setBusy(true); try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); setError(''); setAuthenticated(true); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const logout = async () => { await api('/api/admin/logout', { method: 'POST' }); setAuthenticated(false); setAll([]); };
  const open = (item, chosenDate) => { setEditing(item || { id: null }); setDate(chosenDate || item?.fecha || localToday()); setName(item?.nombre || ''); setError(''); setNotice(''); };
  const openBlock = () => { setDate(localToday()); setBlocking(true); setError(''); setNotice(''); };
  const save = async e => {
    e.preventDefault(); setBusy(true);
    try { await api(editing.id ? `/api/admin/inscripciones/${editing.id}` : '/api/admin/inscripciones', { method: editing.id ? 'PATCH' : 'POST', body: JSON.stringify({ fecha: date, nombre: name }) }); setEditing(null); setNotice('Inscripción guardada.'); await refresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async item => {
    if (!window.confirm(`¿Eliminar la inscripción de ${item.nombre} del ${longDate(item.fecha)}?`)) return;
    try { await api(`/api/admin/inscripciones/${item.id}`, { method: 'DELETE' }); setNotice('Inscripción eliminada.'); await refresh(); }
    catch (e) { setError(e.message); }
  };
  const saveBlock = async e => {
    e.preventDefault(); setBusy(true);
    try { await api('/api/admin/bloqueos', { method: 'POST', body: JSON.stringify({ fecha: date }) }); setBlocking(false); setNotice('Día bloqueado. Nadie podrá anotarse en esa fecha.'); await refresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const unblock = async item => {
    if (!window.confirm(`¿Volver a habilitar el ${longDate(item.fecha)} para inscripciones?`)) return;
    try { await api(`/api/admin/bloqueos/${item.id}`, { method: 'DELETE' }); setNotice('Día habilitado nuevamente.'); await refresh(); }
    catch (e) { setError(e.message); }
  };
  if (authenticated === null) return <main className="shell"><p className="loading">Cargando…</p></main>;
  if (!authenticated) return <main className="shell"><header className="topline"><a href="/">← Calendario</a></header><section className="login-card"><h1>Administración</h1><p>Ingresá tu contraseña para gestionar las inscripciones.</p><form onSubmit={login}><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>Ingresar</button></form></section></main>;
  const { end } = activeRange();
  return <main className="shell"><header className="topline"><a href="/">← Calendario público</a><button className="text-button" onClick={logout}>Cerrar sesión</button></header><div className="admin-heading"><span className="eyebrow">Administración</span><div className="admin-actions"><button className="secondary small" onClick={openBlock}>Bloquear día</button><button className="primary small" onClick={() => open(null)}>+ Agregar</button></div></div><MonthNavigation month={month} setMonth={setMonth}/>
    {notice && <div className="notice success" role="status">{notice}</div>}{error && !editing && !blocking && <div className="notice error" role="alert">{error}</div>}
    <Calendar month={month} bookings={bookings} admin onSelect={d => open(null, d)} onOccupied={open} onBlocked={unblock}/>
    <section className="entries"><h2>Todas las inscripciones <span>{all.length}</span></h2>{all.length === 0 ? <p>Aún no hay inscripciones.</p> : <ul>{all.map(item => <li key={item.id}><div><strong>{item.nombre}</strong><small>{longDate(item.fecha)}</small></div><div className="entry-actions"><button onClick={() => open(item)}>Editar / mover</button><button className="danger" onClick={() => remove(item)}>Eliminar</button></div></li>)}</ul>}</section>
    <section className="entries blocked-list"><h2>Días bloqueados <span>{blocks.length}</span></h2>{blocks.length === 0 ? <p>No hay días bloqueados.</p> : <ul>{blocks.map(item => <li key={item.id}><div><strong>{longDate(item.fecha)}</strong></div><div className="entry-actions"><button onClick={() => unblock(item)}>Habilitar</button></div></li>)}</ul>}</section>
    {editing && <Dialog title={editing.id ? 'Editar inscripción' : 'Agregar inscripción'} onClose={() => { setEditing(null); setError(''); }}><form onSubmit={save}><label htmlFor="admin-date">Fecha</label><input id="admin-date" type="date" required min={localToday()} max={isoDate(end.getFullYear(), end.getMonth(), end.getDate())} value={date} onChange={e => setDate(e.target.value)}/><label htmlFor="admin-name">Nombre o familia</label><input id="admin-name" autoFocus required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)}/>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></form></Dialog>}
    {blocking && <Dialog title="Bloquear día" onClose={() => { setBlocking(false); setError(''); }}><form onSubmit={saveBlock}><label htmlFor="block-date">Fecha</label><input id="block-date" type="date" autoFocus required min={localToday()} max={isoDate(end.getFullYear(), end.getMonth(), end.getDate())} value={date} onChange={e => setDate(e.target.value)}/><p className="form-hint">El casillero quedará gris y nadie podrá anotarse hasta que lo habilites nuevamente.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Bloqueando…' : 'Bloquear día'}</button></form></Dialog>}
  </main>;
}

export default function App() { return location.pathname.startsWith('/admin') ? <AdminPage/> : <PublicPage/>; }
