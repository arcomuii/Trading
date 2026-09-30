// ─── Tamaño de posición y margen — igual que Capital.com de verdad ────────
// EXCLUSIVO de app/backtesting-forex/page.jsx. Reemplaza a
// applyCapitalCompounding() de app/lib/backtestPatternEngine.js (que sigue
// intacta y la sigue usando app/backtest-historico).
//
// Pedido explícito del usuario: en vez de comprometer un PORCENTAJE del
// capital total (versión anterior de este archivo), cada operación usa un
// VOLUMEN FIJO en unidades — tal cual se captura en Capital.com al abrir una
// posición (por defecto 100 unidades, en múltiplos de 100 — mismo
// minDealSize/minSizeIncrement verificado contra la API real para los 6
// pares de esta página, ver app/lib/capitalMarket.js#fetchMarketDetails). El
// margen que ESE volumen compromete se deriva con el `marginFactor` real del
// instrumento, no al revés:
//
//   margen que se compromete en esta operación = tradeVolume × precio de entrada × marginFactor
//   P&L (en la divisa de cotización del par) = pct × tradeVolume × precio de entrada
//
// Mismo patrón de concurrencia/capital disponible que antes (recorre eventos
// open/close en orden cronológico real, no ejecuta una señal si no hay
// margen libre suficiente en ESE instante) — la única diferencia es que el
// margen ya no escala con el capital acumulado (sin compounding automático:
// el volumen se queda fijo en lo que el usuario configuró, ganancias o
// pérdidas no lo cambian).
//
// Simplificación asumida (igual que el resto de este backtest): el P&L de
// pares cotizados en JPY/CHF (USDJPY, GBPJPY, USDCHF) queda en esa divisa, no
// se convierte a USD — aproximación, no contabilidad multi-divisa real.
export function applyFixedVolume(allTrades, {
    initialTotalCapital = 100,
    tradeVolume = 100,
} = {}) {
    const events = []
    allTrades.forEach((trade, idx) => {
        events.push({ time: trade.entryTime, kind: 'open', idx })
        if (trade.exitTime != null) events.push({ time: trade.exitTime, kind: 'close', idx })
    })
    events.sort((a, b) => (a.time - b.time) || (a.kind === 'close' ? -1 : 1))

    const enriched = allTrades.map(t => ({
        ...t, executed: false, skipReason: null, assignedCapital: null, volume: null, pnlUsdt: null,
        wouldNeedCapital: null, availableAtTime: null, capitalAfter: null, availableAfter: null,
    }))
    let capital      = initialTotalCapital // equity total (solo se mueve al cerrar)
    let capitalInUse = 0                   // margen comprometido en operativas abiertas ahora
    let concurrentOpen  = 0
    let maxConcurrentOpen = 0

    for (const ev of events) {
        const trade = enriched[ev.idx]
        if (ev.kind === 'open') {
            const marginFactor = trade.marginFactor
            const requiredMargin = tradeVolume * trade.entry * marginFactor
            const available = capital - capitalInUse

            if (!Number.isFinite(marginFactor) || requiredMargin > available) {
                trade.skipReason      = !Number.isFinite(marginFactor) ? 'missing_margin_factor' : 'insufficient_capital'
                trade.wouldNeedCapital = requiredMargin
                trade.availableAtTime  = available
                continue
            }
            trade.executed        = true
            trade.volume           = tradeVolume
            trade.assignedCapital = requiredMargin
            trade.pnlUsdt          = trade.pct != null ? trade.pct * tradeVolume * trade.entry : null
            capitalInUse += requiredMargin
            trade.availableAfter = capital - capitalInUse
            concurrentOpen += 1
            if (concurrentOpen > maxConcurrentOpen) maxConcurrentOpen = concurrentOpen
        } else if (trade.executed) {
            capitalInUse -= trade.assignedCapital
            if (trade.pnlUsdt != null) capital += trade.pnlUsdt
            trade.capitalAfter   = capital
            trade.availableAfter = capital - capitalInUse
            concurrentOpen -= 1
        }
    }

    const availableCapital = capital - capitalInUse
    return { trades: enriched, finalCapital: capital, availableCapital, maxConcurrentOpen }
}
