import { NextResponse } from 'next/server';
import { db } from '../../../lib/supabase';
import { sendToCapi } from '../../../lib/meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recibe PageView / ViewContent / InitiateCheckout desde track.js.
 * El servidor es el responsable principal del envío a Meta (CAPI);
 * el Pixel del navegador es solo respaldo y se deduplica con el mismo event_id.
 */

function cors(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const ok = allowed.includes('*') || (origin && allowed.includes(origin));
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : (allowed.includes('*') ? '*' : ''),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function OPTIONS(req) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

/** IP real del visitante detrás del proxy/CDN. */
function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || undefined;
}

export async function POST(req) {
  const headers = cors(req.headers.get('origin'));
  try {
    const b = await req.json();

    const allowed = ['PageView', 'ViewContent', 'InitiateCheckout', 'Lead'];
    if (!b.event_name || !allowed.includes(b.event_name)) {
      return NextResponse.json({ ok: false, error: 'event_name inválido' }, { status: 400, headers });
    }
    if (!b.event_id) {
      return NextResponse.json({ ok: false, error: 'falta event_id' }, { status: 400, headers });
    }

    const ip = clientIp(req);
    const ua = req.headers.get('user-agent') || undefined;
    const u = b.user || {};

    // 1) Guarda el evento (fuente de verdad del dashboard)
    const row = {
      event_id: String(b.event_id),
      event_name: b.event_name,
      event_time: b.event_time ? new Date(b.event_time).toISOString() : new Date().toISOString(),
      source: 'web',
      utm_source: b.utm?.utm_source ?? null,
      utm_medium: b.utm?.utm_medium ?? null,
      utm_campaign: b.utm?.utm_campaign ?? null,
      utm_content: b.utm?.utm_content ?? null,
      utm_term: b.utm?.utm_term ?? null,
      fbclid: b.utm?.fbclid ?? null,
      fbp: b.fbp ?? null,
      fbc: b.fbc ?? null,
      external_id: b.external_id ?? null,
      page_url: b.page_url ?? null,
      referrer: b.referrer ?? null,
      client_ip: ip ?? null,
      user_agent: ua ?? null,
      value: b.value ?? null,
      currency: b.currency ?? null,
      capi_status: 'pending',
      raw: b,
    };

    const { data: saved } = await db
      .from('events')
      .upsert(row, { onConflict: 'event_id,event_name', ignoreDuplicates: false })
      .select('id')
      .maybeSingle();

    // 2) Envía a Meta por CAPI con todo el Advanced Matching disponible
    const result = await sendToCapi({
      eventName: b.event_name,
      eventId: b.event_id,
      eventTime: row.event_time,
      eventSourceUrl: b.page_url,
      actionSource: 'website',
      user: {
        email: u.email, phone: u.phone, fullName: u.name,
        firstName: u.first_name, lastName: u.last_name,
        city: u.city, state: u.state, zip: u.zip,
        country: u.country, countryIso: u.country_iso,
        externalId: b.external_id,
        clientIp: ip, userAgent: ua,
        fbp: b.fbp, fbc: b.fbc,
      },
      customData: {
        ...(b.value != null ? { value: Number(b.value) } : {}),
        ...(b.currency ? { currency: b.currency } : {}),
        ...(b.content_name ? { content_name: b.content_name } : {}),
        ...(b.content_ids ? { content_ids: b.content_ids } : {}),
        ...(b.utm?.utm_campaign ? { campaign: b.utm.utm_campaign } : {}),
      },
    });

    // 3) Marca el resultado para el panel de debug
    if (saved?.id) {
      await db.from('events').update({
        capi_status: result.success ? 'success' : 'error',
        capi_error: result.success ? null : String(result.error ?? '').slice(0, 500),
        capi_attempts: result.attempts ?? 1,
        fbtrace_id: result.fbtraceId ?? null,
      }).eq('id', saved.id);
    }

    return NextResponse.json({ ok: true, capi: result.success, event_id: b.event_id }, { headers });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500, headers });
  }
}
