import { NextResponse } from 'next/server';
import { db } from '../../../../lib/supabase';
import { sendToCapi } from '../../../../lib/meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * WEBHOOK DE HOTMART
 * URL a pegar en Hotmart → Herramientas → Webhook:
 *    https://TU-DOMINIO/api/webhook/hotmart
 *
 * Escucha: PURCHASE_APPROVED, PURCHASE_COMPLETE, PURCHASE_CANCELED, PURCHASE_REFUNDED, PURCHASE_CHARGEBACK
 * Valida el Hottok ANTES de procesar nada.
 * Al aprobarse un pago, dispara Purchase a Meta CAPI usando la transacción como event_id.
 */

const APPROVE = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'];
const CANCEL = ['PURCHASE_CANCELED', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_PROTEST'];

export async function GET() {
  // Ping de salud para comprobar que la URL responde.
  return NextResponse.json({ ok: true, endpoint: 'hotmart-webhook', status: 'listening' });
}

export async function POST(req) {
  let payload = {};
  let hottokValid = false;

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  // ---------- 1. VALIDAR HOTTOK (antes de procesar nada) ----------
  const expected = process.env.HOTMART_HOTTOK;
  const received =
    req.headers.get('x-hotmart-hottok') ||
    req.headers.get('X-HOTMART-HOTTOK') ||
    payload?.hottok ||
    payload?.data?.hottok;

  hottokValid = !!expected && !!received && String(received) === String(expected);

  const eventType = payload?.event || payload?.data?.event || null;
  const purchase = payload?.data?.purchase || {};
  const buyer = payload?.data?.buyer || {};
  const product = payload?.data?.product || {};
  const transactionId = purchase?.transaction || payload?.data?.transaction || null;

  if (!hottokValid) {
    await db.from('webhook_logs').insert({
      event_type: eventType, transaction_id: transactionId,
      hottok_valid: false, processed: false,
      error: 'Hottok inválido o ausente', payload,
    });
    return NextResponse.json({ ok: false, error: 'Hottok inválido' }, { status: 401 });
  }

  const { data: log } = await db.from('webhook_logs').insert({
    event_type: eventType, transaction_id: transactionId,
    hottok_valid: true, processed: false, payload,
  }).select('id').maybeSingle();

  try {
    // ---------- 2. CANCELACIONES / REEMBOLSOS ----------
    if (CANCEL.includes(eventType)) {
      if (transactionId) {
        await db.from('purchases').update({
          status: purchase?.status || eventType.replace('PURCHASE_', ''),
          event_type: eventType,
          updated_at: new Date().toISOString(),
        }).eq('transaction_id', transactionId);
      }
      await db.from('webhook_logs').update({ processed: true }).eq('id', log?.id);
      return NextResponse.json({ ok: true, handled: eventType });
    }

    // ---------- 3. SOLO PROCESAMOS PAGOS APROBADOS ----------
    if (!APPROVE.includes(eventType)) {
      await db.from('webhook_logs').update({ processed: true, error: 'Evento ignorado' }).eq('id', log?.id);
      return NextResponse.json({ ok: true, ignored: eventType });
    }

    // ---------- 4. DATOS DE LA COMPRA ----------
    const value = Number(purchase?.price?.value ?? purchase?.full_price?.value ?? 0);
    const currency = purchase?.price?.currency_value || purchase?.full_price?.currency_value || 'USD';
    const addr = buyer?.address || {};

    // ---------- 5. ATRIBUCIÓN: recuperar UTMs desde el sck ----------
    const sck = purchase?.tracking?.source_sck || purchase?.tracking?.source || null;
    const utm = parseSck(sck);

    // ---------- 6. GUARDAR LA COMPRA ----------
    await db.from('purchases').upsert({
      transaction_id: transactionId,
      status: purchase?.status || 'APPROVED',
      event_type: eventType,
      value, currency,
      product_name: product?.name ?? null,
      offer_code: purchase?.offer?.code ?? null,
      buyer_name: buyer?.name ?? null,
      buyer_email: buyer?.email ?? null,
      buyer_phone: buyer?.checkout_phone ?? buyer?.phone ?? null,
      buyer_country: addr?.country_iso || addr?.country || purchase?.checkout_country?.iso || null,
      buyer_city: addr?.city ?? null,
      buyer_state: addr?.state ?? null,
      buyer_zip: addr?.zipcode ?? null,
      utm_source: utm.utm_source, utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign, utm_content: utm.utm_content, utm_term: utm.utm_term,
      sck_raw: sck,
      purchase_date: purchase?.approved_date ? new Date(purchase.approved_date).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'transaction_id' });

    // ---------- 7. EVENTO PURCHASE ----------
    // event_id = ID de transacción de Hotmart (deduplicación garantizada)
    const eventId = String(transactionId);

    const { data: evt } = await db.from('events').upsert({
      event_id: eventId,
      event_name: 'Purchase',
      event_time: new Date().toISOString(),
      source: 'hotmart_webhook',
      utm_source: utm.utm_source, utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign, utm_content: utm.utm_content, utm_term: utm.utm_term,
      value, currency, transaction_id: transactionId,
      capi_status: 'pending',
      raw: { event: eventType, sck },
    }, { onConflict: 'event_id,event_name' }).select('id').maybeSingle();

    // ---------- 8. ENVIAR A META CAPI CON TODOS LOS DATOS DEL COMPRADOR ----------
    const result = await sendToCapi({
      eventName: 'Purchase',
      eventId,
      eventTime: purchase?.approved_date ? new Date(purchase.approved_date) : new Date(),
      actionSource: 'website',
      eventSourceUrl: process.env.CHECKOUT_SOURCE_URL || undefined,
      user: {
        email: buyer?.email,
        phone: buyer?.checkout_phone ?? buyer?.phone,
        fullName: buyer?.name,
        city: addr?.city,
        state: addr?.state,
        zip: addr?.zipcode,
        country: addr?.country,
        countryIso: addr?.country_iso || purchase?.checkout_country?.iso,
        externalId: buyer?.email,
      },
      customData: {
        value,
        currency,
        content_name: product?.name || 'Sistema Pro Cuidador',
        content_type: 'product',
        content_ids: [String(product?.id ?? purchase?.offer?.code ?? 'procuidador')],
        order_id: String(transactionId),
        ...(utm.utm_campaign ? { campaign: utm.utm_campaign } : {}),
      },
    });

    if (evt?.id) {
      await db.from('events').update({
        capi_status: result.success ? 'success' : 'error',
        capi_error: result.success ? null : String(result.error ?? '').slice(0, 500),
        capi_attempts: result.attempts ?? 1,
        fbtrace_id: result.fbtraceId ?? null,
      }).eq('id', evt.id);
    }

    await db.from('webhook_logs').update({
      processed: true,
      error: result.success ? null : `CAPI: ${result.error}`,
    }).eq('id', log?.id);

    // Hotmart necesita un 200 o reintentará el envío.
    return NextResponse.json({ ok: true, transaction: transactionId, capi: result.success });
  } catch (err) {
    await db.from('webhook_logs').update({ processed: false, error: err.message }).eq('id', log?.id);
    // Devolvemos 500 a propósito: así Hotmart reintenta el envío.
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

/** Lee los UTMs que viajaron en el sck: "fb|campaña|anuncio|adset" */
function parseSck(sck) {
  const out = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null };
  if (!sck) return out;
  try {
    const raw = decodeURIComponent(String(sck));
    if (raw.includes('=')) {
      // Formato clave=valor
      raw.split(/[&;|]/).forEach((p) => {
        const [k, v] = p.split('=');
        if (k && v && k.trim() in out) out[k.trim()] = decodeURIComponent(v);
      });
      return out;
    }
    // Formato compacto: source|campaign|content|term
    const [s, c, ct, t] = raw.split('|');
    out.utm_source = s || null;
    out.utm_campaign = c || null;
    out.utm_content = ct || null;
    out.utm_term = t || null;
    out.utm_medium = s ? 'paid' : null;
  } catch { /* sck ilegible: la compra igual se registra */ }
  return out;
}
