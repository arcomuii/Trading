// ─── Datos de mercado de Capital.com (velas históricas de forex) ───────────
// Fuente de precios para app/backtesting-forex — misma idea que
// app/lib/bitunixMarket.js pero contra la API de Capital.com (ver
// app/api/capital/[...path]/route.js para el manejo de sesión/credenciales).
//
// Verificado contra la API real (cuenta LIVE, epic EURUSD): la documentación
// pública (open-api.capital.com) decía GET /api/v1/history/prices?epic=... y
// eso daba 404 — el endpoint real es GET /api/v1/prices/{epic} (epic en el
// PATH, no en query).
//   GET /api/v1/prices/{epic}?resolution=&from=&to=&max=
//   resolution: MINUTE, MINUTE_5, MINUTE_15, MINUTE_30, HOUR, HOUR_4, DAY, WEEK
//   from/to: 'YYYY-MM-DDTHH:MM:SS' (sin zona horaria)
//   max: hasta 10000 velas por request
//   Respuesta real: { prices: [ { snapshotTime, snapshotTimeUTC,
//     openPrice: {bid,ask}, closePrice: {bid,ask}, highPrice: {bid,ask},
//     lowPrice: {bid,ask}, lastTradedVolume } ], instrumentType, tickSize,
//     pipPosition } — cada precio viene como {bid, ask}, se usa el punto
//     medio (bid+ask)/2 como precio único (igual de simplificado que un solo
//     `close` de spot).

const RESOLUTION_BY_INTERVAL = { '5m': 'MINUTE_5', '15m': 'MINUTE_15', '1h': 'HOUR', '4h': 'HOUR_4', '1d': 'DAY' }

// Velas por día de cada resolución — usado para calcular un tamaño de chunk
// seguro por debajo del tope de velas/request (ver fetchKlinesRange).
const CANDLES_PER_DAY = { MINUTE_5: 288, MINUTE_15: 96, HOUR: 24, HOUR_4: 6, DAY: 1 }

// La documentación pública dice "hasta 10000" — verificado contra la API
// real que el tope real es 1000 (probado en binario: 2000 da
// {"errorCode":"error.invalid.max"}, 1000 y 1001 confirman el corte exacto).
const MAX_CANDLES_PER_REQUEST = 1000
const SAFETY_MARGIN = 0.9 // no pedir justo al límite verificado

function toCapitalDateStr(ms) {
    // 'YYYY-MM-DDTHH:MM:SS' en UTC, sin milisegundos ni zona horaria (formato
    // exacto que pide la documentación de Capital.com).
    return new Date(ms).toISOString().slice(0, 19)
}

function midPrice(p) {
    if (p == null) return null
    const bid = parseFloat(p.bid)
    const ask = parseFloat(p.ask)
    if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2
    if (Number.isFinite(bid)) return bid
    if (Number.isFinite(ask)) return ask
    const n = parseFloat(p)
    return Number.isFinite(n) ? n : null
}

// `snapshotTimeUTC` llega SIN sufijo de zona (ej. "2026-07-31T13:20:00"),
// pese a su nombre — `new Date(...)` sin 'Z' la interpreta como hora LOCAL
// del entorno que ejecuta el código (el navegador del usuario, o Node en un
// script de diagnóstico), NO como UTC. Verificado contra la API real:
// `snapshotTime` de ESE MISMO registro daba "2026-07-31T08:20:00" (otra zona
// distinta, no UTC tampoco) — la única forma correcta de obtener el instante
// UTC real es tomar `snapshotTimeUTC` y forzar el sufijo 'Z' antes de
// parsear. Sin este fix, cada vela quedaba etiquetada con un `openTime`
// desfasado por el offset LOCAL del navegador (en este entorno, 6 horas) —
// la entrada/SL/TP de una operativa (calculados correctamente por POSICIÓN
// en el arreglo de velas) terminaban con una hora reportada que no
// correspondía a la vela real que los contenía, y el filtro de sesión NY
// (que sí depende de la hora) evaluaba velas equivocadas.
function parseSnapshotUtcMs(r) {
    if (r.snapshotTimeUTC) return new Date(r.snapshotTimeUTC + 'Z').getTime()
    return new Date(r.snapshotTime).getTime() // respaldo sin garantía de zona — solo si faltara snapshotTimeUTC
}

// Una página de velas (hasta `max`), normalizadas y en orden ascendente.
export async function fetchKlines(epic, resolution, { from, to, max = MAX_CANDLES_PER_REQUEST } = {}) {
    const params = new URLSearchParams({ resolution, max: String(max) })
    if (from != null) params.set('from', toCapitalDateStr(from))
    if (to   != null) params.set('to',   toCapitalDateStr(to))

    // Confirmado contra la API real: el epic va en el PATH, no en query
    // (/api/v1/prices/{epic}), a diferencia de lo que decía la documentación
    // pública (/api/v1/history/prices?epic=), que devolvía 404.
    const res  = await fetch(`/api/capital/api/v1/prices/${encodeURIComponent(epic)}?${params}`)
    const json = await res.json()
    if (!res.ok) throw new Error(json?.errorCode || json?.error || `HTTP ${res.status}`)

    const rows = Array.isArray(json?.prices) ? json.prices : []
    return rows.map(r => ({
        openTime: parseSnapshotUtcMs(r),
        open:  midPrice(r.openPrice),
        high:  midPrice(r.highPrice),
        low:   midPrice(r.lowPrice),
        close: midPrice(r.closePrice),
    })).filter(c => Number.isFinite(c.openTime) && c.close != null)
        .sort((a, b) => a.openTime - b.openTime)
}

// Detalles del instrumento en Capital.com — usado por app/backtesting-forex
// para el tamaño de posición (ver app/lib/forexCapital.js): margen real por
// instrumento (marginFactor, en % del nocional — verificado contra la API
// real: 3.333333% = apalancamiento 30:1 para la mayoría de los pares
// mayores, pero AUDUSD da 5% = 20:1, así que SÍ varía por par y hay que
// consultarlo, no asumirlo) y el tamaño mínimo/incremento de operación
// (dealingRules.minDealSize/minSizeIncrement, ambos 100 unidades para los 6
// pares verificados).
export async function fetchMarketDetails(epic) {
    const res  = await fetch(`/api/capital/api/v1/markets/${encodeURIComponent(epic)}`)
    const json = await res.json()
    if (!res.ok) throw new Error(json?.errorCode || json?.error || `HTTP ${res.status}`)
    const marginFactorPct = json?.instrument?.marginFactor
    return {
        marginFactor: Number.isFinite(marginFactorPct) ? marginFactorPct / 100 : null, // % -> fracción
        lotSize: json?.instrument?.lotSize ?? 1,
        currency: json?.instrument?.currency ?? null,
        minDealSize: json?.dealingRules?.minDealSize?.value ?? null,
        minSizeIncrement: json?.dealingRules?.minSizeIncrement?.value ?? null,
    }
}

// Descarga TODAS las velas del `interval` ('1h'|'4h'|'1d') entre startMs y
// endMs (epoch ms) para un epic de Capital.com (ej. "EURUSD"), partiendo el
// rango en chunks consecutivos hacia ADELANTE (a diferencia de Bitunix, aquí
// se pide from/to explícitos por chunk en vez de depender de en qué extremo
// ancla la API cuando el rango pedido excede el máximo de velas). `onBatch`
// se llama tras cada chunk para reportar progreso.
export async function fetchKlinesRange(epic, interval, startMs, endMs, { onBatch } = {}) {
    const resolution = RESOLUTION_BY_INTERVAL[interval]
    if (!resolution) throw new Error(`Intervalo no soportado: ${interval}`)

    const perDay = CANDLES_PER_DAY[resolution]
    const chunkDays = Math.max(1, Math.floor((MAX_CANDLES_PER_REQUEST * SAFETY_MARGIN) / perDay))
    const chunkMs = chunkDays * 24 * 3_600_000

    const candles = []
    let cursorStart = startMs
    while (cursorStart < endMs) {
        const cursorEnd = Math.min(cursorStart + chunkMs, endMs)
        const rows = await fetchKlines(epic, resolution, { from: cursorStart, to: cursorEnd, max: MAX_CANDLES_PER_REQUEST })
        candles.push(...rows)
        onBatch?.(candles.length)
        cursorStart = cursorEnd
    }

    candles.sort((a, b) => a.openTime - b.openTime)
    return candles
}
