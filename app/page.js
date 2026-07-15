'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { fmtBogota, todayBogota } from '../lib/time';

/* ---------- estilos (paleta de la marca) ---------- */
const C = {
  navy: '#032048', teal: '#006D75', rose: '#C5325B', yellow: '#E8C660',
  cream: '#F1ECE6', paper: '#F8F4ED', line: 'rgba(3,32,72,.12)', ink: '#232733', soft: '#5b6270',
};
const font = "'Hanken Grotesk',system-ui,-apple-system,Segoe UI,sans-serif";

const PRESETS = [
  ['today', 'Hoy'], ['yesterday', 'Ayer'], ['last7', 'Últimos 7 días'],
  ['last30', 'Último mes'], ['custom', 'Personalizado'],
];

export default function AdsBoard() {
  const [key, setKey] = useState('');
  const [authed, setAuthed] = useState(false);
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState(todayBogota());
  const [to, setTo] = useState(todayBogota());
  const [campaign, setCampaign] = useState('');
  const [adset, setAdset] = useState('');
  const [ad, setAd] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [live, setLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const chan = useRef(null);

  /* ---------- carga de métricas ---------- */
  const load = useCallback(async (k = key) => {
    if (!k) return;
    setLoading(true); setErr('');
    try {
      const p = new URLSearchParams({ key: k, preset, from, to });
      if (campaign) p.set('campaign', campaign);
      if (adset) p.set('adset', adset);
      if (ad) p.set('ad', ad);
      const r = await fetch(`/api/metrics?${p}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Error');
      setData(j); setAuthed(true); setLastUpdate(new Date());
      try { localStorage.setItem('pc_key', k); } catch {}
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [key, preset, from, to, campaign, adset, ad]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pc_key');
      if (saved) { setKey(saved); load(saved); }
    } catch {}
  }, []); // eslint-disable-line

  useEffect(() => { if (authed) load(); }, [preset, from, to, campaign, adset, ad]); // eslint-disable-line

  /* ---------- TIEMPO REAL: suscripción en vivo a la base ---------- */
  useEffect(() => {
    if (!authed) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let poll;

    if (url && anon) {
      const sb = createClient(url, anon);
      const ch = sb.channel('adsboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => load())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' }, () => load())
        .subscribe((s) => setLive(s === 'SUBSCRIBED'));
      chan.current = { sb, ch };
    }
    // Respaldo: refresco automático cada 30s (y única vía si Realtime no está activo)
    poll = setInterval(() => load(), 30000);

    return () => {
      clearInterval(poll);
      if (chan.current) { chan.current.sb.removeChannel(chan.current.ch); chan.current = null; }
    };
  }, [authed, load]);

  const f = data?.funnel;
  const money = (v) => `${f?.currency === 'USD' ? '$' : ''}${Number(v || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /* ---------- login ---------- */
  if (!authed) {
    return (
      <div style={{ ...S.page, display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ ...S.card, width: 360, padding: 32 }}>
          <h1 style={{ ...S.h1, fontSize: 22, marginBottom: 6 }}>AdsBoard</h1>
          <p style={{ color: C.soft, fontSize: 14, marginBottom: 18 }}>Sistema Pro Cuidador · tracking en vivo</p>
          <input
            type="password" value={key} placeholder="Contraseña del panel"
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            style={S.input}
          />
          <button onClick={() => load()} style={{ ...S.btn, width: '100%', marginTop: 12 }}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
          {err && <p style={{ color: C.rose, fontSize: 13, marginTop: 10 }}>{err}</p>}
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* ---------- Encabezado ---------- */}
        <div style={S.headRow}>
          <div>
            <h1 style={S.h1}>AdsBoard</h1>
            <p style={{ color: C.soft, fontSize: 13, margin: '4px 0 0' }}>
              Sistema Pro Cuidador · zona horaria America/Bogotá (GMT-5)
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ ...S.dot, background: live ? '#16a34a' : C.yellow }} />
            <span style={{ fontSize: 12, color: C.soft }}>
              {live ? 'En vivo' : 'Auto 30s'}
              {lastUpdate && ` · ${fmtBogota(lastUpdate.toISOString())}`}
            </span>
            <button onClick={() => load()} style={S.btn} disabled={loading}>
              {loading ? 'Actualizando…' : '↻ Actualizar'}
            </button>
          </div>
        </div>

        {/* ---------- Filtros ---------- */}
        <div style={{ ...S.card, padding: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {PRESETS.map(([v, l]) => (
              <button key={v} onClick={() => setPreset(v)} style={preset === v ? S.chipOn : S.chip}>{l}</button>
            ))}
            {preset === 'custom' && (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={S.date} />
                <span style={{ color: C.soft }}>→</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={S.date} />
              </>
            )}
            <div style={{ flex: 1 }} />
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)} style={S.select}>
              <option value="">Todas las campañas</option>
              {data?.filters?.campaigns?.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={adset} onChange={(e) => setAdset(e.target.value)} style={S.select}>
              <option value="">Todos los adsets</option>
              {data?.filters?.adsets?.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={ad} onChange={(e) => setAd(e.target.value)} style={S.select}>
              <option value="">Todos los anuncios</option>
              {data?.filters?.ads?.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {data?.range && (
            <p style={{ fontSize: 12, color: C.soft, margin: '10px 0 0' }}>
              Mostrando {data.range.from} → {data.range.to}
            </p>
          )}
        </div>

        {err && <div style={{ ...S.card, padding: 14, marginBottom: 16, borderLeft: `4px solid ${C.rose}`, color: C.rose }}>{err}</div>}

        {/* ---------- KPIs ---------- */}
        <div style={S.kpis}>
          <Kpi label="Visitas" value={f?.visits ?? 0} color={C.navy} />
          <Kpi label="Checkouts" value={f?.checkouts ?? 0} color={C.teal} sub={`${f?.rates?.visitToCheckout ?? 0}% de visitas`} />
          <Kpi label="Compras" value={f?.purchases ?? 0} color={C.rose} sub={`${f?.rates?.checkoutToPurchase ?? 0}% de checkouts`} />
          <Kpi label="Ingresos" value={money(f?.revenue)} color="#15803d" sub={`Ticket medio ${money(f?.aov)}`} />
        </div>

        {/* ---------- Funnel ---------- */}
        <div style={{ ...S.card, padding: 22, marginBottom: 18 }}>
          <h2 style={S.h2}>Funnel de conversión</h2>
          <Funnel f={f} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, marginBottom: 18 }}>
          {/* ---------- Por campaña ---------- */}
          <div style={{ ...S.card, padding: 22 }}>
            <h2 style={S.h2}>Ingresos por campaña</h2>
            <Table
              cols={['Campaña', 'Visitas', 'Checkout', 'Compras', 'Ingresos']}
              rows={(data?.byCampaign || []).map((r) => [
                r.name, r.visits, r.checkouts, r.purchases, money(r.revenue),
              ])}
              empty="Aún no hay datos para este período."
            />
          </div>

          {/* ---------- Estado Meta CAPI ---------- */}
          <div style={{ ...S.card, padding: 22 }}>
            <h2 style={S.h2}>Eventos enviados a Meta</h2>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <Badge n={data?.capi?.success ?? 0} l="Éxito" c="#16a34a" />
              <Badge n={data?.capi?.error ?? 0} l="Error" c={C.rose} />
              <Badge n={data?.capi?.pending ?? 0} l="Pendiente" c={C.yellow} />
            </div>
            {data?.capiErrors?.length > 0 ? (
              <div style={{ maxHeight: 190, overflow: 'auto' }}>
                {data.capiErrors.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
                    <b style={{ color: C.navy }}>{e.event}</b>
                    <span style={{ color: C.soft }}> · {fmtBogota(e.time)}</span>
                    <div style={{ color: C.rose, marginTop: 2 }}>{e.error}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: C.soft, fontSize: 13 }}>Sin errores. Todo se está enviando correctamente. ✅</p>
            )}
          </div>
        </div>

        {/* ---------- Por anuncio ---------- */}
        <div style={{ ...S.card, padding: 22, marginBottom: 18 }}>
          <h2 style={S.h2}>Rendimiento por anuncio</h2>
          <Table
            cols={['Anuncio', 'Campaña', 'Visitas', 'Checkout', 'Compras', 'Ingresos']}
            rows={(data?.byAd || []).map((r) => [
              r.name, r.campaign, r.visits, r.checkouts, r.purchases, money(r.revenue),
            ])}
            empty="Aún no hay datos por anuncio."
          />
        </div>

        {/* ---------- Compras recientes ---------- */}
        <div style={{ ...S.card, padding: 22 }}>
          <h2 style={S.h2}>Compras recientes</h2>
          <Table
            cols={['Fecha', 'Comprador', 'País', 'Campaña', 'Valor', 'Estado']}
            rows={(data?.recentPurchases || []).map((p) => [
              fmtBogota(p.purchase_date),
              p.buyer_name || p.buyer_email || '—',
              p.buyer_country || '—',
              p.utm_campaign || '(directo)',
              money(p.value),
              p.status,
            ])}
            empty="Aún no hay compras en este período."
          />
        </div>
      </div>
    </div>
  );
}

/* ---------- componentes ---------- */
function Kpi({ label, value, color, sub }) {
  return (
    <div style={{ ...S.card, padding: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.soft }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 800, color, lineHeight: 1.1, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Badge({ n, l, c }) {
  return (
    <div style={{ flex: 1, background: `${c}14`, border: `1px solid ${c}33`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{n}</div>
      <div style={{ fontSize: 11, color: C.soft, fontWeight: 600 }}>{l}</div>
    </div>
  );
}

function Funnel({ f }) {
  const steps = [
    { l: 'Visitas', v: f?.visits ?? 0, c: C.navy },
    { l: 'Checkout iniciado', v: f?.checkouts ?? 0, c: C.teal },
    { l: 'Compras', v: f?.purchases ?? 0, c: C.rose },
  ];
  const max = Math.max(...steps.map((s) => s.v), 1);
  return (
    <div>
      {steps.map((s, i) => (
        <div key={s.l} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
            <b style={{ color: C.ink }}>{s.l}</b>
            <span style={{ color: C.soft }}>
              {s.v}
              {i > 0 && ` · ${steps[i - 1].v ? ((s.v / steps[i - 1].v) * 100).toFixed(1) : 0}% del paso anterior`}
            </span>
          </div>
          <div style={{ background: '#eceaf0', borderRadius: 8, height: 26, overflow: 'hidden' }}>
            <div style={{ width: `${(s.v / max) * 100}%`, background: s.c, height: '100%', borderRadius: 8, transition: 'width .5s ease' }} />
          </div>
        </div>
      ))}
      <p style={{ fontSize: 13, color: C.soft, marginTop: 12 }}>
        Conversión total visita → compra: <b style={{ color: C.navy }}>{f?.rates?.visitToPurchase ?? 0}%</b>
      </p>
    </div>
  );
}

function Table({ cols, rows, empty }) {
  if (!rows?.length) return <p style={{ color: C.soft, fontSize: 13 }}>{empty}</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>{cols.map((c) => (
            <th key={c} style={{ textAlign: 'left', padding: '8px 10px', color: C.soft, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `1px solid ${C.line}` }}>{c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ padding: '10px', borderBottom: `1px solid ${C.line}`, color: j === 0 ? C.navy : C.ink, fontWeight: j === 0 ? 600 : 400, whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- estilos ---------- */
const S = {
  page: { background: C.cream, minHeight: '100vh', fontFamily: font, color: C.ink },
  card: { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: '0 2px 10px rgba(3,32,72,.05)' },
  h1: { fontFamily: font, fontSize: 26, fontWeight: 800, color: C.navy, margin: 0, letterSpacing: '-.02em' },
  h2: { fontSize: 15, fontWeight: 700, color: C.navy, margin: '0 0 16px' },
  headRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14, marginBottom: 18 },
  btn: { background: C.navy, color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: font },
  chip: { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 100, padding: '7px 14px', fontSize: 13, fontWeight: 600, color: C.soft, cursor: 'pointer', fontFamily: font },
  chipOn: { background: C.navy, border: `1px solid ${C.navy}`, borderRadius: 100, padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: font },
  select: { border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, background: '#fff', color: C.ink, fontFamily: font, maxWidth: 190 },
  date: { border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, fontFamily: font },
  input: { width: '100%', border: `1px solid ${C.line}`, borderRadius: 8, padding: '11px 12px', fontSize: 14, fontFamily: font, boxSizing: 'border-box' },
  dot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' },
};
