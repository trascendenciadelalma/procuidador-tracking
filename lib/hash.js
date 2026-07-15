import crypto from 'crypto';

/**
 * Meta exige que los datos personales se normalicen ANTES de hashear:
 * minúsculas, sin espacios sobrantes, sin acentos donde aplica.
 * Si no se normaliza igual que Meta, el Event Match Quality baja.
 */

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const clean = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase();

// Quita tildes/acentos (José -> jose)
const deaccent = (v) =>
  clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Hashea un valor ya normalizado. Devuelve undefined si viene vacío. */
const h = (v) => {
  const c = clean(v);
  return c ? sha256(c) : undefined;
};

export const hashEmail = (email) => {
  const c = clean(email);
  if (!c || !c.includes('@')) return undefined;
  return sha256(c);
};

/** Teléfono: solo dígitos, con código de país, sin + ni espacios. */
export const hashPhone = (phone, countryIso) => {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return undefined;
  // Si no trae código de país y sabemos el país, lo anteponemos.
  const codes = { CO: '57', MX: '52', US: '1', ES: '34', AR: '54', PE: '51', CL: '56', EC: '593', VE: '58' };
  const cc = codes[String(countryIso ?? '').toUpperCase()];
  if (cc && !d.startsWith(cc) && d.length <= 10) d = cc + d;
  return sha256(d);
};

/** Nombre / apellido: sin acentos, minúsculas. */
export const hashName = (name) => {
  const c = deaccent(name);
  return c ? sha256(c) : undefined;
};

/** Ciudad / estado: sin espacios, sin acentos (Bogotá -> bogota). */
export const hashCity = (city) => {
  const c = deaccent(city).replace(/\s+/g, '');
  return c ? sha256(c) : undefined;
};

/** País: código ISO de 2 letras en minúscula (co, us...). */
export const hashCountry = (country) => {
  let c = deaccent(country).replace(/\s+/g, '');
  const map = {
    colombia: 'co', mexico: 'mx', 'estadosunidos': 'us', 'unitedstates': 'us',
    espana: 'es', spain: 'es', argentina: 'ar', peru: 'pe', chile: 'cl',
    ecuador: 'ec', venezuela: 've', brasil: 'br', brazil: 'br',
  };
  if (map[c]) c = map[c];
  if (c.length !== 2) return undefined;
  return sha256(c);
};

export const hashZip = (zip) => {
  const c = clean(zip).replace(/\s+/g, '').split('-')[0];
  return c ? sha256(c) : undefined;
};

/** Divide "Gloria Galíndez Pérez" en {first:"gloria", last:"galindez perez"} */
export const splitName = (full) => {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: undefined, last: undefined };
  if (parts.length === 1) return { first: parts[0], last: undefined };
  return { first: parts[0], last: parts.slice(1).join(' ') };
};

export { sha256, h };
