// ─── Historial REAL de posiciones (Capital.com) para /forex ───────────────
// A diferencia de state.trades (lo que el bot mismo cree que abrió/cerró —
// ver forexBotState.js), esto lee directo de la cuenta real vía
// GET /api/v1/history/activity, así que incluye CUALQUIER posición
// (manual o del bot) y no depende de que reconcile() la haya reconocido
// correctamente. Verificado hoy que reconcile() puede perder el rastro de
// una posición real (queda en blanco en state.trades) aunque en la cuenta sí
// exista y cierre bien — este endpoint es la fuente de verdad para revisar
// "qué pasó de verdad" sin ese punto ciego.
//
// Capital.com limita /history/activity a ~24h por request (from/to que pasan
// de un día dan error.invalid.daterange, verificado hoy) — así que para
// cubrir N días hay que pedir un día calendario a la vez y juntar resultados.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_DAYS = 90 // techo de seguridad — 90 requests secuenciales ya es bastante lento

function dayStr(d) { return d.toISOString().slice(0, 10) }

async function fetchDayActivities(origin, dateStr) {
    const params = new URLSearchParams({ from: `${dateStr}T00:00:00`, to: `${dateStr}T23:59:59`, detailed: 'true' })
    const res = await fetch(`${origin}/api/capital/api/v1/history/activity?${params}`, { cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (!res.ok) return [] // día sin actividad, o el rango falló — no aborta el resto de los días
    return Array.isArray(json?.activities) ? json.activities : []
}

// Precio medio (bid/ask) ACTUAL de un epic — usado solo como tasa de
// conversión a USD para pares donde ni la base ni la cotización ya son USD
// (ver convertToUsd). Es una APROXIMACIÓN: usa la tasa de AHORA, no la de
// cuando cada operación cerró (Capital.com no expone fácilmente una tasa
// cruzada histórica exacta por este camino) — para el resto de los pares
// (los 5 de los 6 que sí tienen USD en un lado) la conversión es exacta.
async function fetchCurrentBid(origin, epic) {
    try {
        const res = await fetch(`${origin}/api/capital/api/v1/markets/${epic}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok) return null
        const bid = parseFloat(json?.snapshot?.bid)
        const offer = parseFloat(json?.snapshot?.offer ?? json?.snapshot?.ask)
        if (Number.isFinite(bid) && Number.isFinite(offer)) return (bid + offer) / 2
        return Number.isFinite(bid) ? bid : null
    } catch {
        return null
    }
}

// pnl (en pnlCcy) -> USD. Tres casos:
//   1. pnlCcy === 'USD' (EURUSD/GBPUSD/AUDUSD): ya está en USD, tal cual.
//   2. baseCcy === 'USD' (USDJPY/USDCHF): el propio precio de salida YA ES
//      la tasa "pnlCcy por USD" de ESE momento exacto — conversión EXACTA,
//      sin necesidad de pedir nada más.
//   3. Ninguno de los dos es USD (ej. GBPJPY): hace falta una tasa
//      "pnlCcy por USD" — se resuelve con el precio ACTUAL de USD+pnlCcy
//      (ej. USDJPY para convertir JPY), no el de la fecha de cierre — ver
//      nota de fetchCurrentBid. `rateCache` evita pedir la misma tasa dos
//      veces en la misma respuesta.
async function convertToUsd(origin, pnl, pnlCcy, baseCcy, exitPrice, rateCache) {
    if (pnl == null) return null
    if (pnlCcy === 'USD') return pnl
    if (baseCcy === 'USD') return exitPrice ? pnl / exitPrice : null
    if (!rateCache.has(pnlCcy)) {
        rateCache.set(pnlCcy, await fetchCurrentBid(origin, `USD${pnlCcy}`))
    }
    const rate = rateCache.get(pnlCcy)
    return rate ? pnl / rate : null
}

// Agrupa eventos POSITION por dealId en apertura/cierre. NO se puede asumir
// "el primer evento cronológico es la apertura": si la apertura real quedó
// FUERA del rango de días pedido pero el cierre SÍ cae adentro (posición que
// abrió antes de la ventana y cerró dentro de ella), en los eventos que
// devuelve la API para ese rango solo aparece el cierre — tomarlo como si
// fuera la apertura mostraría una posición YA CERRADA (y hasta ganadora)
// como si siguiera abierta, con la dirección al revés. Bug real encontrado
// hoy con una operativa de AUDUSD que abrió un día antes del rango de "7
// días" pedido.
//
// La forma confiable de distinguir un evento de cierre de uno de apertura
// (verificado contra la API real): el de CIERRE siempre trae
// `details.openPrice` (el precio al que se abrió, de referencia) — el de
// APERTURA nunca lo trae. Con eso alcanza sin importar el orden ni cuántos
// eventos se vean.
function buildPositions(activities) {
    const positionEvents = activities.filter(a => a.type === 'POSITION').sort((a, b) => a.dateUTC.localeCompare(b.dateUTC))
    const byDeal = new Map()
    for (const e of positionEvents) {
        if (!byDeal.has(e.dealId)) byDeal.set(e.dealId, [])
        byDeal.get(e.dealId).push(e)
    }

    const positions = []
    for (const [dealId, events] of byDeal) {
        const openEvent  = events.find(e => (e.details?.openPrice ?? null) == null) ?? null
        const closeEvent = events.find(e => (e.details?.openPrice ?? null) != null) ?? null
        if (!openEvent && !closeEvent) continue // no debería pasar, pero por seguridad no revienta

        const od = openEvent?.details ?? {}
        const cd = closeEvent?.details ?? {}
        const epic = (openEvent ?? closeEvent).epic

        // Si no hay openEvent, la apertura quedó fuera del rango pedido —
        // se reconstruye con lo que trae el cierre (openPrice = entrada) y
        // se marca `openedBeforeRange` para que la UI lo deje claro. La
        // dirección del cierre es la CONTRARIA a la de la apertura original.
        const entry = openEvent ? (od.level ?? null) : (cd.openPrice ?? null)
        const size = od.size ?? cd.size ?? null
        const isBull = openEvent ? od.direction === 'BUY' : cd.direction !== 'BUY'
        const exit = closeEvent ? (cd.level ?? null) : null

        let outcome = null, pnl = null
        if (entry != null && exit != null) {
            const diff = isBull ? exit - entry : entry - exit
            outcome = diff >= 0 ? 'win' : 'loss'
            // P&L en la divisa de COTIZACIÓN del par (últimas 3 letras del
            // epic) — convertido a USD aparte en convertToUsd(), ver abajo.
            if (size != null) pnl = diff * size
        }

        positions.push({
            dealId,
            epic,
            isBull,
            size,
            entry,
            exit,
            stopLevel: od.stopLevel ?? cd.stopLevel ?? null,
            profitLevel: od.profitLevel ?? cd.profitLevel ?? null,
            openedAt: openEvent?.dateUTC ?? null, // null = la apertura quedó fuera del rango pedido (ver openedBeforeRange)
            openedBeforeRange: !openEvent && !!closeEvent,
            closedAt: closeEvent?.dateUTC ?? null,
            closedBy: closeEvent?.source ?? null, // 'SL' | 'TP' | 'USER' (cierre manual o del bot, incl. el forzado de las 12PM NY) | null = sigue abierta de verdad
            outcome, // 'win' | 'loss' | null (sigue abierta de verdad)
            pnl,
            pnlCcy: epic ? epic.slice(3) : null, // divisa de cotización
            baseCcy: epic ? epic.slice(0, 3) : null,
        })
    }
    // Ordena por el timestamp más reciente que se tenga (cierre si existe, si no apertura).
    return positions.sort((a, b) => (b.closedAt ?? b.openedAt ?? '').localeCompare(a.closedAt ?? a.openedAt ?? ''))
}

export async function GET(request) {
    const daysParam = parseInt(request.nextUrl.searchParams.get('days'), 10)
    const days = Number.isInteger(daysParam) ? Math.min(Math.max(daysParam, 1), MAX_DAYS) : 30

    const origin = request.nextUrl.origin
    const today = new Date()
    const allActivities = []
    try {
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today.getTime() - i * 86_400_000)
            const acts = await fetchDayActivities(origin, dayStr(d))
            allActivities.push(...acts)
        }
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 502 })
    }

    const positions = buildPositions(allActivities)
    const closed = positions.filter(p => p.outcome != null)
    const wins = closed.filter(p => p.outcome === 'win').length

    // Suma de P&L por divisa de cotización — NO se suman entre sí (serían
    // peras con manzanas sin convertir, ver nota en buildPositions).
    const pnlByCcy = {}
    for (const p of closed) {
        if (p.pnl == null || !p.pnlCcy) continue
        pnlByCcy[p.pnlCcy] = (pnlByCcy[p.pnlCcy] ?? 0) + p.pnl
    }

    // pnlUsd por posición — ver convertToUsd. rateCache comparte la tasa
    // USD+pnlCcy entre todas las posiciones del mismo par "cruzado" (ej.
    // varias de GBPJPY) para no pedirla repetida.
    const rateCache = new Map()
    for (const p of positions) {
        p.pnlUsd = await convertToUsd(origin, p.pnl, p.pnlCcy, p.baseCcy, p.exit, rateCache)
    }
    const totalPnlUsd = closed.reduce((sum, p) => sum + (p.pnlUsd ?? 0), 0)
    const missingUsd = closed.some(p => p.pnl != null && p.pnlUsd == null)

    return NextResponse.json({
        days,
        positions,
        summary: {
            total: positions.length, closed: closed.length, wins, losses: closed.length - wins,
            pnlByCcy, totalPnlUsd, missingUsd, // missingUsd: true si alguna operativa cerrada no se pudo convertir (p.ej. no se consiguió la tasa) — el total quedaría incompleto
        },
    })
}
