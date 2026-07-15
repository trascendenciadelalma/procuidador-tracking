import { db } from './supabase';
import {
  hashEmail, hashPhone, hashName, hashCity, hashCountry, hashZip, splitName, sha256,
} from './hash';

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '954054883661119';
const TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const TEST_CODE = process.env.META_TEST_EVENT_CODE || '';

/**
 * Construye el bloque user_data con el MÁXIMO de Advanced Matching posible.
 * Todo lo personal va hasheado en SHA-256; IP, user agent, fbp y fbc van en claro
 * (Meta lo exige así).
 */
export function buildUserData(u = {}) {
  const { first, last } = u.fullName ? splitName(u.fullName) : { first: u.firstName, last: u.lastName };

  const ud = {
    em: hashEmail(u.email),
    ph: hashPhone(u.phone, u.countryIso || u.country),
    fn: hashName(first),
    ln: hashName(last),
    ct: hashCity(u.city),
    st: hashCity(u.state),
    zp: hashZip(u.zip),
    country: hashCountry(u.countryIso || u.country),
    external_id: u.externalId ? sha256(String(u.externalId).trim().toLowerCase()) : undefined,
    client_ip_address: u.clientIp || undefined,   // sin hashear
    client_user_agent: u.userAgent || undefined,  // sin hashear
    fbp: u.fbp || undefined,                      // sin hashear
    fbc: u.fbc || undefined,                      // sin hashear
  };

  // Elimina los campos vacíos: Meta penaliza los nulos.
  Object.keys(ud).forEach((k) => ud[k] === undefined && delete ud[k]);
  return ud;
}

/**
 * Envía un evento a la Conversions API con reintentos y backoff exponencial.
 * Registra cada intento en capi_logs.
 */
export async function sendToCapi({
  eventName,
  eventId,
  eventTime,
  eventSourceUrl,
  actionSource = 'website',
  user = {},
  customData = {},
  maxAttempts = 3,
}) {
  if (!TOKEN) {
    const error = 'Falta META_CAPI_ACCESS_TOKEN en las variables de entorno';
    await logCapi({ eventId, eventName, attempt: 0, success: false, error });
    return { success: false, error };
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor((eventTime ? new Date(eventTime).getTime() : Date.now()) / 1000),
        event_id: String(eventId),           // 🔑 misma ID que el Pixel → Meta deduplica
        event_source_url: eventSourceUrl || undefined,
        action_source: actionSource,
        user_data: buildUserData(user),
        custom_data: Object.keys(customData).length ? customData : undefined,
      },
    ],
  };
  if (TEST_CODE) payload.test_event_code = TEST_CODE;

  const url = `https://graph.facebook.com/${VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;

  let lastError = null;
  let lastStatus = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      lastStatus = res.status;

      if (res.ok) {
        await logCapi({
          eventId, eventName, attempt, success: true,
          httpStatus: res.status, fbtraceId: body.fbtrace_id,
          eventsReceived: body.events_received, requestBody: payload, responseBody: body,
        });
        return { success: true, fbtraceId: body.fbtrace_id, eventsReceived: body.events_received, attempts: attempt };
      }

      lastError = body?.error?.message || `HTTP ${res.status}`;
      await logCapi({
        eventId, eventName, attempt, success: false,
        httpStatus: res.status, error: lastError, requestBody: payload, responseBody: body,
      });

      // 4xx (salvo 429) = error nuestro; reintentar no sirve.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { success: false, error: lastError, attempts: attempt };
      }
    } catch (err) {
      lastError = err.message;
      await logCapi({ eventId, eventName, attempt, success: false, error: lastError, requestBody: payload });
    }

    // Backoff exponencial: 1s, 2s, 4s...
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }

  return { success: false, error: lastError, httpStatus: lastStatus, attempts: maxAttempts };
}

async function logCapi(l) {
  try {
    await db.from('capi_logs').insert({
      event_id: l.eventId ? String(l.eventId) : null,
      event_name: l.eventName,
      attempt: l.attempt,
      success: !!l.success,
      http_status: l.httpStatus ?? null,
      fbtrace_id: l.fbtraceId ?? null,
      events_received: l.eventsReceived ?? null,
      error: l.error ?? null,
      request_body: l.requestBody ? redact(l.requestBody) : null,
      response_body: l.responseBody ?? null,
    });
  } catch (_) { /* el log nunca debe tumbar el envío */ }
}

/** Nunca guardamos el token en los logs. */
function redact(o) {
  const c = JSON.parse(JSON.stringify(o));
  if (c.access_token) c.access_token = '***';
  return c;
}
