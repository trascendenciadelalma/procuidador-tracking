-- ==========================================================
--  SISTEMA PRO CUIDADOR — Esquema de base de datos
--  Pega TODO este archivo en: Supabase → SQL Editor → Run
-- ==========================================================

-- ---------- 1. EVENTOS (PageView, ViewContent, InitiateCheckout, Purchase) ----------
create table if not exists events (
  id            bigserial primary key,
  event_id      text not null,                 -- ID compartido Pixel <-> CAPI (deduplicación)
  event_name    text not null,                 -- PageView | ViewContent | InitiateCheckout | Purchase
  event_time    timestamptz not null default now(),
  source        text not null default 'web',   -- web | hotmart_webhook

  -- Atribución (UTMs)
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,   -- nombre del anuncio
  utm_term      text,   -- nombre del adset
  fbclid        text,

  -- Identificadores de Meta
  fbp           text,
  fbc           text,
  external_id   text,

  -- Contexto
  page_url      text,
  referrer      text,
  client_ip     text,
  user_agent    text,

  -- Valor (solo Purchase)
  value         numeric(12,2),
  currency      text,
  transaction_id text,

  -- Estado del envío a Meta CAPI
  capi_status   text default 'pending',        -- pending | success | error
  capi_error    text,
  capi_attempts int default 0,
  fbtrace_id    text,

  raw           jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_events_time      on events (event_time desc);
create index if not exists idx_events_name      on events (event_name);
create index if not exists idx_events_campaign  on events (utm_campaign);
create index if not exists idx_events_status    on events (capi_status);
-- Evita duplicar el mismo evento (p.ej. reintentos de webhook de Hotmart)
create unique index if not exists uq_events_eventid_name on events (event_id, event_name);

-- ---------- 2. COMPRAS (detalle de Hotmart) ----------
create table if not exists purchases (
  id              bigserial primary key,
  transaction_id  text unique not null,
  status          text not null,               -- APPROVED | COMPLETE | CANCELED | REFUNDED | CHARGEBACK
  event_type      text,                        -- PURCHASE_APPROVED | PURCHASE_COMPLETE | ...
  value           numeric(12,2),
  currency        text,
  product_name    text,
  offer_code      text,

  buyer_name      text,
  buyer_email     text,
  buyer_phone     text,
  buyer_country   text,
  buyer_city      text,
  buyer_state     text,
  buyer_zip       text,

  -- Atribución recuperada del sck de Hotmart
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  sck_raw         text,

  purchase_date   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_purchases_date     on purchases (purchase_date desc);
create index if not exists idx_purchases_campaign on purchases (utm_campaign);
create index if not exists idx_purchases_status   on purchases (status);

-- ---------- 3. LOG DE WEBHOOKS DE HOTMART ----------
create table if not exists webhook_logs (
  id           bigserial primary key,
  event_type   text,
  transaction_id text,
  hottok_valid boolean not null default false,
  processed    boolean not null default false,
  error        text,
  payload      jsonb,
  received_at  timestamptz not null default now()
);
create index if not exists idx_webhook_logs_time on webhook_logs (received_at desc);

-- ---------- 4. LOG DE ENVÍOS A META CAPI ----------
create table if not exists capi_logs (
  id           bigserial primary key,
  event_id     text,
  event_name   text,
  attempt      int default 1,
  success      boolean not null default false,
  http_status  int,
  fbtrace_id   text,
  events_received int,
  error        text,
  request_body jsonb,
  response_body jsonb,
  sent_at      timestamptz not null default now()
);
create index if not exists idx_capi_logs_time on capi_logs (sent_at desc);
create index if not exists idx_capi_logs_ok   on capi_logs (success);

-- ---------- 5. SEGURIDAD (RLS) ----------
-- Solo el backend (service_role) escribe/lee. El navegador nunca toca estas tablas.
alter table events       enable row level security;
alter table purchases    enable row level security;
alter table webhook_logs enable row level security;
alter table capi_logs    enable row level security;

-- ---------- 6. TIEMPO REAL ----------
-- Habilita que el dashboard reciba cambios en vivo.
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table purchases;

-- ---------- Listo ----------
