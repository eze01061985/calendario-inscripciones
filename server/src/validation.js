export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function validName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Ingresá un nombre o familia.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, 'El nombre debe tener entre 2 y 100 caracteres.');
  }
  return name;
}

export function validDate(value, { allowPast = false, today = new Date() } = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'Ingresá una fecha válida.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, 'Ingresá una fecha válida.');
  }
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (!allowPast && value < localToday) throw new HttpError(400, 'No se puede reservar una fecha pasada.');
  return value;
}

export function validActiveDate(value, { today = new Date() } = {}) {
  const date = validDate(value, { today });
  const firstMonth = today.getFullYear() * 12 + today.getMonth();
  const [year, month] = date.split('-').map(Number);
  if (year * 12 + month - 1 > firstMonth + 1) {
    throw new HttpError(400, 'Solo se puede elegir una fecha del mes actual o del siguiente.');
  }
  return date;
}

export function validMonth(year, month) {
  const y = Number(year), m = Number(month);
  if (!/^\d{4}$/.test(String(year)) || !/^\d{1,2}$/.test(String(month)) || y < 1900 || y > 2100 || m < 1 || m > 12) {
    throw new HttpError(400, 'Mes inválido.');
  }
  return { year: y, month: m };
}
