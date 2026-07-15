import { NextResponse } from 'next/server';
import { db } from '../../../lib/supabase';
import { presetRange, rangeToUtc } from '../../../lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Métricas del AdsBoard. Todo se calcula sobre días de America/Bogota. */
export async function GET(req) {
  try {
    const p = new URL(req.url).searchParams;

    // Auth simple por contraseña
    if (p.get('key') !== (process.env.DASHBOARD_PASSWORD || 'cambiame')) {
      return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
    }

    const { from, to } = presetRange(p.get('preset') || 'today', p.get('from'), p.get('to'));
    const { fromUtc, toUtc } = rangeToUtc(from, to);

    const fCampaign = p.get('campaign') || '';
    const fAdset = p.get('adset') || '';
    const fAd = p.get('ad') || '';

    // --- Eventos del período ---
    let q = db.from('events')
      .select('event_name,utm_campaign,utm_content,utm_term,utm_source,value,currency,capi_status,capi_error,event_time,transaction_id,fbtrace_id,source')
      .gte('event_time', fromUtc).lte('event_time', toUtc)
      .order('event_time', { ascending: false })
      .limit(50000);
    if (fCampaign) q = q.eq('utm_campaign', fCampaign);
    if (fAdset) q = q.eq('utm_term', fAdset);
    if (fAd) q = q.eq('utm_content', fAd);
    const { data: events = [], error: e1 } = await q;
    if (e1) throw new Error(e1.message);

    // --- Compras del período (fuente de ingresos) ---
    let qp = db.from('purchases')
      .select('transaction_id,value,currency,status,utm_campaign,utm_content,utm_term,utm_source,buyer_name,buyer_email,buyer_country,product_name,purchase_date')
      .gte('purchase_date', fromUtc).lte('purchase_date', toUtc)
      .order('purchase_date', { ascending: false })
      .limit(20000);
    if (fCampaign) qp = qp.eq('utm_campaign', fCampaign);
    if (fAdset) qp = qp.eq('utm_term', fAdset);
    if (fAd) qp = qp.eq('utm_content', fAd);
    const { data: purchases = [], error: e2 } = await qp;
    if (e2) throw new Error(e2.message);

    const valid = purchases.filter((x) => !['CANCELED', 'REFUNDED', 'CHARGEBACK', 'PROTEST'].includes(String(x.status).toUpperCase()));

    // --- Funnel ---
    const visits = events.filter((e) => e.event_name === 'PageView').length;
    const checkouts = events.filter((e) => e.event_name === 'InitiateCheckout').length;
    const buys = valid.length;
    const revenue = valid.reduce((s, x) => s + Number(x.value || 0), 0);
    const currency = valid[0]?.currency || 'USD';

    const rate = (a, b) => (b > 0 ? +((a / b) * 100).toFixed(2) : 0);

    // --- Atribución por campaña / adset / anuncio ---
    const group = (rows, key) => {
      const m = {};
      rows.forEach((r) => {
        const k = r[key] || '(sin atribución)';
        m[k] = m[k] || { name: k, visits: 0, checkouts: 0, purchases: 0, revenue: 0 };
      });
      return m;
    };
    const byCampaign = { ...group(events, 'utm_campaign'), ...group(valid, 'utm_campaign') };
    events.forEach((e) => {
      const k = e.utm_campaign || '(sin atribución)';
      if (!byCampaign[k]) byCampaign[k] = { name: k, visits: 0, checkouts: 0, purchases: 0, revenue: 0 };
      if (e.event_name === 'PageView') byCampaign[k].visits++;
      if (e.event_name === 'InitiateCheckout') byCampaign[k].checkouts++;
    });
    valid.forEach((x) => {
      const k = x.utm_campaign || '(sin atribución)';
      if (!byCampaign[k]) byCampaign[k] = { name: k, visits: 0, checkouts: 0, purchases: 0, revenue: 0 };
      byCampaign[k].purchases++;
      byCampaign[k].revenue += Number(x.value || 0);
    });

    const byAd = {};
    events.forEach((e) => {
      const k = e.utm_content || '(sin anuncio)';
      byAd[k] = byAd[k] || { name: k, campaign: e.utm_campaign || '—', visits: 0, checkouts: 0, purchases: 0, revenue: 0 };
      if (e.event_name === 'PageView') byAd[k].visits++;
      if (e.event_name === 'InitiateCheckout') byAd[k].checkouts++;
    });
    valid.forEach((x) => {
      const k = x.utm_content || '(sin anuncio)';
      byAd[k] = byAd[k] || { name: k, campaign: x.utm_campaign || '—', visits: 0, checkouts: 0, purchases: 0, revenue: 0 };
      byAd[k].purchases++;
      byAd[k].revenue += Number(x.value || 0);
    });

    // --- Estado de envíos a Meta (debug) ---
    const capi = {
      success: events.filter((e) => e.capi_status === 'success').length,
      error: events.filter((e) => e.capi_status === 'error').length,
      pending: events.filter((e) => e.capi_status === 'pending').length,
    };
    const capiErrors = events.filter((e) => e.capi_status === 'error')
      .slice(0, 25)
      .map((e) => ({ event: e.event_name, time: e.event_time, error: e.capi_error }));

    // --- Opciones de filtro ---
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    const { data: allAttr = [] } = await db.from('events')
      .select('utm_campaign,utm_term,utm_content')
      .not('utm_campaign', 'is', null).limit(5000);

    return NextResponse.json({
      ok: true,
      range: { from, to, tz: 'America/Bogota' },
      funnel: {
        visits, checkouts, purchases: buys, revenue: +revenue.toFixed(2), currency,
        aov: buys ? +(revenue / buys).toFixed(2) : 0,
        rates: {
          visitToCheckout: rate(checkouts, visits),
          checkoutToPurchase: rate(buys, checkouts),
          visitToPurchase: rate(buys, visits),
        },
      },
      byCampaign: Object.values(byCampaign).sort((a, b) => b.revenue - a.revenue || b.visits - a.visits),
      byAd: Object.values(byAd).sort((a, b) => b.revenue - a.revenue || b.visits - a.visits),
      capi, capiErrors,
      recentPurchases: valid.slice(0, 25),
      filters: {
        campaigns: uniq(allAttr.map((r) => r.utm_campaign)),
        adsets: uniq(allAttr.map((r) => r.utm_term)),
        ads: uniq(allAttr.map((r) => r.utm_content)),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
