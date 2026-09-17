// ─── Tamaño de posición y margen — igual que Capital.com de verdad ────────
// EXCLUSIVO de app/backtesting-forex/page.jsx. Reemplaza a
// applyCapitalCompounding() de app/lib/backtestPatternEngine.js (que sigue
// intacta y la sigue usando app/backtest-historico).
//
// Pedido explícito del usuario: cada operación compromete un PORCENTAJE FIJO
// del capital TOTAL disponible en ese momento (por defecto 10%) — no un
// volumen fijo en unidades ni un monto fijo en dólares. El margen se
// recalcula en cada apertura con el capital ACTUAL (compounding natural: si
// el capital crece, el 10% de una operación futura es mayor en dólares; si
// baja, es menor), y el volumen real que hay que operar en Capital.com para
// comprometer exactamente ese margen se deriva con el `marginFactor` real
// del instrumento (consultado a la API — ver
// app/lib/capitalMarket.js#fetchMarketDetails):
//
//   margen que se compromete en esta operación = capitalPercent% × capital TOTAL en ese instante
//   volumen necesario para ESE margen = margen / (precio de entrada × marginFactor)
//   P&L (en la divisa de cotización del par) = pct × volumen × precio de entrada
//                                            = pct × margen / marginFactor
//
// Mismo patrón de concurrencia/capital disponible que antes (recorre
// eventos open/close en orden cronológico real, no ejecuta una señal si no
// hay margen libre suficiente en ESE instante).
//
// Simplificación asumida (igual que el resto de este backtest): el P&L de
// pares cotizados en JPY/CHF (USDJPY, GBPJPY, USDCHF) queda en esa divisa, no
// se convierte a USD — aproximación, no contabilidad multi-divisa real.
export function applyVolumeCompounding(allTrades, {
    initialTotalCapital = 100,
    capitalPercent = 10,
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
            const requiredMargin = (capitalPercent / 100) * capital // % del capital TOTAL actual, no del disponible
            const available = capital - capitalInUse

            if (!Number.isFinite(marginFactor) || requiredMargin > available) {
                trade.skipReason      = !Number.isFinite(marginFactor) ? 'missing_margin_factor' : 'insufficient_capital'
                trade.wouldNeedCapital = requiredMargin
                trade.availableAtTime  = available
                continue
            }
            const volume = requiredMargin / (trade.entry * marginFactor)
            trade.executed        = true
            trade.volume           = volume
            trade.assignedCapital = requiredMargin
            trade.pnlUsdt          = trade.pct != null ? trade.pct * volume * trade.entry : null
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
