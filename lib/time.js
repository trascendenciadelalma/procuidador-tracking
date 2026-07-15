/** Todo el dashboard opera en America/Bogota (GMT-5, sin horario de verano). */
export const TZ = 'America/Bogota';
const OFFSET = '-05:00';

/** Fecha "hoy" en Bogotá como YYYY-MM-DD, sin importar dónde corra el servidor. */
export function todayBogota(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // en-CA ya devuelve YYYY-MM-DD
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Convierte un rango de días de Bogotá a instantes UTC exactos para consultar la BD. */
export function rangeToUtc(fromYmd, toYmd) {
  return {
    fromUtc: new Date(`${fromYmd}T00:00:00.000${OFFSET}`).toISOString(),
    toUtc: new Date(`${toYmd}T23:59:59.999${OFFSET}`).toISOString(),
  };
}

/** Traduce un preset del dashboard a fechas de Bogotá. */
export function presetRange(preset, customFrom, customTo) {
  const today = todayBogota();
  switch (preset) {
    case 'today':     return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'last7':     return { from: addDays(today, -6), to: today };
    case 'last30':    return { from: addDays(today, -29), to: today };
    case 'custom':    return { from: customFrom || today, to: customTo || today };
    default:          return { from: today, to: today };
  }
}

/** Formatea un instante para mostrarlo en hora de Bogotá. */
export function fmtBogota(iso) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}
