# Sistema de Tracking y Atribución — Sistema Pro Cuidador

Meta Pixel + **Conversions API (servidor)** + Hotmart + AdsBoard en tiempo real.

- **Pixel ID ya configurado:** `954054883661119`
- **Graph API:** `v25.0` (versión vigente en julio 2026; v23.0 llegó a fin de vida el 9 de junio de 2026)
- **Zona horaria del dashboard:** `America/Bogota` (GMT-5)

---

## 🔴 Lo único que falta: 3 datos

| Dato | Dónde se consigue | Variable |
|---|---|---|
| **Access Token de la CAPI** | Events Manager → tu Pixel → Configuración → Conversions API → *Generar token de acceso* | `META_CAPI_ACCESS_TOKEN` |
| **Hottok de Hotmart** | Hotmart → Herramientas → Webhook (API y Notificaciones) | `HOTMART_HOTTOK` |
| **URL de tu landing + link de checkout** | Tú los tienes | ver paso 4 |

> ⚠️ **Nunca me pegues estos secretos en el chat.** Los pones tú directamente en Vercel. El token jamás llega al navegador: solo el backend lo usa.

---

## 📋 Instalación en 6 pasos (≈20 minutos)

### 1. Base de datos (Supabase)
1. Crea una cuenta gratis en [supabase.com](https://supabase.com) → **New project**.
2. Ve a **SQL Editor** → pega TODO el contenido de `supabase/schema.sql` → **Run**.
3. Ve a **Settings → API** y copia: `Project URL`, `anon public key` y `service_role key`.

### 2. Desplegar el backend (Vercel)
1. Sube esta carpeta a un repositorio de GitHub.
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo → **Deploy**.
3. Ve a **Settings → Environment Variables** y añade las variables de `.env.example`:

```
NEXT_PUBLIC_META_PIXEL_ID     = 954054883661119
META_CAPI_ACCESS_TOKEN        = (tu token de la CAPI)
META_GRAPH_VERSION            = v25.0
HOTMART_HOTTOK                = (tu hottok)
NEXT_PUBLIC_SUPABASE_URL      = (project URL)
NEXT_PUBLIC_SUPABASE_ANON_KEY = (anon key)
SUPABASE_SERVICE_ROLE_KEY     = (service_role key)
DASHBOARD_PASSWORD            = (invéntate una)
ALLOWED_ORIGINS               = https://tulanding.com
```
4. **Redeploy** para que tome las variables.

Tu dominio queda como: `https://procuidador-tracking.vercel.app`

### 3. 🔗 URL DEL WEBHOOK PARA HOTMART

```
https://TU-DOMINIO.vercel.app/api/webhook/hotmart
```

En **Hotmart → Herramientas → Webhook (API y Notificaciones) → Registrar webhook**:
- **URL:** la de arriba
- **Versión:** 2.0.0
- **Eventos a marcar:**
  - ✅ `PURCHASE_APPROVED` (dispara el Purchase)
  - ✅ `PURCHASE_COMPLETE`
  - ✅ `PURCHASE_CANCELED`
  - ✅ `PURCHASE_REFUNDED`
  - ✅ `PURCHASE_CHARGEBACK` (opcional)

Comprueba que responde abriendo la URL en el navegador: debe decir `{"ok":true,"status":"listening"}`.

### 4. Instalar el tracking en tu landing
Pega esto **justo antes de `</body>`** en tu página de venta:

```html
<script>
  window.PC_ENDPOINT = "https://TU-DOMINIO.vercel.app/api/collect";
  window.PC_VALUE = "7.99";
  window.PC_CURRENCY = "USD";
</script>
<script src="https://TU-DOMINIO.vercel.app/track.js"></script>
```

**Importante:** el botón de compra debe apuntar a tu link real de Hotmart. El script detecta solo cualquier `<a href="...hotmart...">` y le añade el `sck`. Si tu botón no es un enlace de Hotmart, ponle el atributo `data-checkout`.

### 5. UTMs en Meta Ads
Ve a **Meta Ads → tu anuncio → Seguimiento → Parámetros de URL** y pega EXACTAMENTE esto:

```
utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}
```

> Meta rellena solo los `{{...}}`. El script los guarda 90 días, los pasa a Hotmart en el `sck`, y el webhook los devuelve al dashboard: así cada compra queda atada a su anuncio.

### 6. Entrar al dashboard
```
https://TU-DOMINIO.vercel.app
```
Entra con tu `DASHBOARD_PASSWORD`.

---

## ✅ Cómo verificar que funciona

1. **Eventos de prueba:** pon `META_TEST_EVENT_CODE` (lo da Events Manager → Probar eventos), entra a tu landing y verás llegar PageView/ViewContent. **Bórralo en producción.**
2. **Deduplicación:** en Events Manager, los eventos deben aparecer marcados como *Deduplicado* — señal de que Pixel y CAPI comparten `event_id`.
3. **Compra real:** haz una compra de prueba en Hotmart. En el AdsBoard debe aparecer en segundos.
4. **Match Quality:** Events Manager → tu Pixel → *Calidad de coincidencia de eventos*. Purchase debería salir alto (envía email, teléfono, nombre, ciudad, estado, país, CP e IP).

---

## 🧠 Cómo funciona

```
Anuncio Meta (con UTMs)
   ↓
Landing → track.js
   ├─ guarda UTMs (localStorage + cookie, 90 días)
   ├─ lee _fbp / _fbc
   ├─ genera event_id único
   ├─ Pixel navegador  ─┐
   └─ POST /api/collect ┴→ mismo event_id → Meta deduplica
          ↓
      Servidor: hashea SHA-256 + añade IP y User-Agent → CAPI v25.0
          ↓
      Supabase (events)
   ↓
Clic en comprar → InitiateCheckout + link Hotmart con ?sck=UTMs
   ↓
Hotmart cobra → webhook → valida Hottok → Purchase a CAPI
   (event_id = transacción Hotmart · valor y moneda reales
    · nombre, email, teléfono, país del comprador hasheados)
   ↓
AdsBoard en tiempo real (Supabase Realtime + refresco 30s + botón manual)
```

### Decisiones de diseño
- **El servidor es la fuente principal.** El Pixel es respaldo. Si el navegador bloquea el Pixel (adblock, iOS), el evento igual llega por CAPI.
- **Purchase solo desde el webhook.** El pago ocurre dentro de Hotmart; el navegador no lo vería con fiabilidad.
- **Reintentos:** 3 intentos con backoff exponencial (1s, 2s, 4s). Los 4xx no se reintentan (son error de configuración, no de red). Si el webhook falla, devolvemos 500 a propósito para que **Hotmart reintente**.
- **Índice único** en `(event_id, event_name)`: si Hotmart reenvía el mismo webhook, la compra no se duplica.
- **Todo en Bogotá:** "Hoy" es el día en Bogotá, no en el servidor de Vercel (que corre en UTC).

---

## 📁 Estructura

```
├── public/track.js                  ← se pega en la landing
├── app/api/collect/route.js         ← PageView / ViewContent / InitiateCheckout → CAPI
├── app/api/webhook/hotmart/route.js ← webhook: Hottok + Purchase → CAPI
├── app/api/metrics/route.js         ← métricas del dashboard
├── app/page.js                      ← AdsBoard (tiempo real)
├── lib/hash.js                      ← normalización + SHA-256
├── lib/meta.js                      ← CAPI con reintentos y logs
├── lib/time.js                      ← zona horaria Bogotá
└── supabase/schema.sql              ← tablas + realtime + RLS
```

## 🔍 Debug
- **AdsBoard → "Eventos enviados a Meta"**: éxito / error / pendiente + el mensaje de error exacto.
- **Supabase → `webhook_logs`**: cada webhook recibido de Hotmart (con `hottok_valid`).
- **Supabase → `capi_logs`**: cada intento de envío a Meta, con `fbtrace_id` (el ID que pide el soporte de Meta).

### Problemas comunes
| Síntoma | Causa |
|---|---|
| Webhook devuelve 401 | El `HOTMART_HOTTOK` no coincide con el de Hotmart |
| Eventos en `error` | Falta el Access Token, o expiró |
| Compras sin campaña | El anuncio no lleva los UTMs, o el botón no es link de Hotmart |
| El dashboard no actualiza solo | Falta correr el `alter publication` del schema.sql (igual refresca cada 30s) |
