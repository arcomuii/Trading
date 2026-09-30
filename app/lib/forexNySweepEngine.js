// ─── Motor de Barrido de Liquidez NY 15m (Apertura NY) ─────────────────────
// EXCLUSIVO de app/backtesting-forex/page.jsx — implementa tal cual la
// "Estrategia de Barridos en 15 Minutos (Apertura NY)" pedida explícitamente
// por el usuario. No comparte lógica con forexPatternEngine.js (patrones
// geométricos) ni forexConfluenceEngine.js (HTF EMA50 + OB + divergencia RSI
// en M5) — es un motor aparte, seleccionable en la página con el intervalo
// "15m (Barrido NY)".
//
// Reglas pedidas, tal cual:
//   1. Niveles clave: máximo/mínimo de la sesión asiática/Londres (15m) +
//      máximo/mínimo de la pre-apertura (9:00-9:30 AM hora de Nueva York).
//   2. Barrido: en la ventana operativa (9:30-11:00 AM NY), una vela de 15m
//      rompe falsamente uno de esos niveles, con un salto brusco de volumen.
//   3. Confirmación: la vela de 15m cierra en dirección contraria al barrido
//      (rechazo claro) — ver nota "Paso 2+3" más abajo sobre por qué se
//      combinan en una sola vela en vez de dos pasos separados.
//   4. Entrada: venta si barrió un máximo previo (falso rompimiento alcista);
//      compra si barrió un mínimo previo (falso rompimiento bajista).
//   5. Riesgo: SL un colchón pequeño (fracción del ATR de 15m) más allá de la
//      mecha del barrido; TP al nivel opuesto del rango del día si eso ya da
//      R:R≥2, si no, R:R fijo 1:2 (el mínimo pedido explícitamente).
//
// Paso 2+3 combinados en una sola vela: la especificación pide "observa si
// el precio manipula y rompe falsamente" (paso 2, intra-vela) y luego
// "espera el cierre... busca un cierre en dirección contraria" (paso 3) — la
// forma natural de expresar ambos con velas de 15m ya cerradas (sin
// repintar) es una ÚNICA vela cuya MECHA rompe el nivel pero cuyo CUERPO
// cierra de vuelta del otro lado: esa vela ES el barrido Y su propia
// confirmación de rechazo al mismo tiempo (mismo patrón que ya usa
// forexConfluenceEngine.js para sus barridos en M5). La alternativa que
// menciona la especificación ("o quiebre de estructura en temporalidad
// menor de 1 o 5 minutos") no se implementó: exigiría descargar una
// temporalidad adicional por par solo para esos 90 minutos de cada día, y el
// cierre de 15m en contra ya es una condición suficiente y verificable sin
// repintado — se deja como posible mejora futura, no como parte de esta
// primera versión.
//
// Zona horaria: TODAS las horas de esta estrategia son hora de Nueva York
// (EST/EDT, horario de verano automático vía Intl con timeZone
// 'America/New_York' — nunca UTC fijo, que quedaría desfasado medio año).
//
// Simplificación de la sesión Asia/Londres: en vez de anclar la sesión
// asiática a la tarde/noche del día calendario ANTERIOR en NY (lo que
// obligaría a cruzar fechas al agrupar por día), se usa el rango 00:00-08:30
// hora NY del MISMO día calendario como "máximo/mínimo de sesión asiática o
// de Londres". Esa ventana cubre la cola de la sesión asiática (Tokio ya
// lleva varias horas abierto para la medianoche NY) y toda la apertura de
// Londres (~3:00 AM NY) hasta el arranque de la pre-apertura NY (8:30 AM) —
// cubre el espíritu de la regla ("el rango que ya se formó antes de que abra
// Nueva York") sin la complejidad de cruzar fechas.
//
// Ajuste pedido tras medir 34.7% de acierto con datos reales de EURUSD
// (apenas arriba del punto de equilibrio de 33.3% que exige un R:R mínimo
// 2:1 — casi sin margen real): colchón de SL ampliado de 0.15×ATR a 0.5×ATR
// (ver SL_BUFFER_ATR_MULT) — verificado que es NEUTRO (no cambia ni una sola
// operativa de la muestra) pero se deja así por ser más realista frente a
// spread/slippage.
//
// También se probó (y se descartó, pedido explícito del usuario tras ver los
// números) un filtro de sesgo de tendencia (Close vs EMA50) para solo operar
// a favor de la dirección "mayor". Verificado con datos reales (EURUSD, 60
// días, sin filtro = 37.5% de acierto en 32 operativas) en tres variantes:
//   - EMA50 en H4 (temporalidad separada, igual que Confluencia): 18.2% (11 operativas)
//   - EMA50 en H1 (temporalidad separada): 29.4% (17 operativas)
//   - EMA50 en M15 (mismas velas, autocontenido): 35.7% (14 operativas)
// Las tres bajaron el acierto frente a no filtrar — de las operativas que el
// filtro H4 descartó, las que iban A FAVOR de la tendencia mayor rindieron
// PEOR que las que iban en contra. Consistente con que esta es una
// estrategia de REVERSIÓN intradía (agotamiento en la apertura de NY), no de
// continuación como el motor de Confluencia: exigir que vaya a favor de una
// tendencia mayor descarta justo las reversiones genuinas. Se opera ambos
// lados de cada barrido, sin condicionarlo a ninguna dirección "mayor".
//
// Con una muestra más grande (6 pares, 180 días, 534 operativas) el acierto
// sin ningún filtro adicional ya sube a 41.9% (la cifra de 37.5%/34.7% era
// solo una ventana de tiempo/par menos favorable) — con R:R≥2 eso ya da
// expectativa positiva real (~+0.26R/operativa). Aun así, se probaron 3
// palancas más, aisladas contra ese mismo dataset de 534 operativas:
//   - Rechazo más fuerte (exigir que el cuerpo cierre en la mitad del rango
//     de la vela más allá del nivel, no cualquier cierre marginal de vuelta
//     adentro): 425 operativas, 43.3% (+1.4pp).
//   - Entrada más rápida (al close de la vela de rechazo en vez del open de
//     la siguiente): 534 operativas, 41.9% — SIN NINGÚN EFECTO. En una
//     ventana de 15 minutos el precio casi no se mueve entre el cierre de la
//     vela de rechazo y la apertura de la siguiente; no vale la pena la
//     complejidad de una entrada "look-ahead" más agresiva. Descartada.
//   - Volumen más estricto (2.0× en vez de 1.5×, ver VOLUME_SPIKE_MULT):
//     284 operativas, 44.7% (+2.8pp) — la palanca individual más fuerte.
// Combinando rechazo fuerte + volumen estricto (las dos palancas que sí
// funcionaron, se refuerzan en vez de ser redundantes): 221 operativas,
// 48.0% (+6.1pp sobre el baseline de 534) — casi duplica la expectativa por
// operativa (~+0.44R) a cambio de operar menos de la mitad de veces (~37 en
// vez de ~89 operativas/mes en los 6 pares). Es la combinación que quedó
// desplegada: REJECTION_STRENGTH = 0.5 y VOLUME_SPIKE_MULT = 2.0 abajo.

export const NY_SWEEP_META = {
    ny_sweep_long:  { label: 'Barrido NY (Compra)', bias: 'bullish', dir: '↑' },
    ny_sweep_short: { label: 'Barrido NY (Venta)',  bias: 'bearish', dir: '↓' },
}

// Horas en punto flotante, hora de Nueva York (ej. 9.5 = 9:30 AM).
const ASIAN_LONDON_START = 0     // 00:00 NY — ver nota de simplificación arriba
const ASIAN_LONDON_END   = 8.5   // 08:30 NY — arranca la ventana de pre-apertura
const PREMARKET_START    = 9     // 09:00 NY
const PREMARKET_END      = 9.5   // 09:30 NY
const WINDOW_START       = 9.5   // 09:30 NY — arranca la ventana operativa
const WINDOW_END         = 11    // 11:00 NY — termina la ventana operativa (última entrada posible)
const CUTOFF_HOUR        = 12    // 12:00 NY — cierre forzado pedido explícitamente ("evitar sesión vespertina")

const ATR_PERIOD = 14
// "unos pips o ticks por encima/debajo de la mecha" — sigue siendo una
// FRACCIÓN de ATR, no un múltiplo grande como el SL de
// forexConfluenceEngine.js (1.5×ATR, donde el ATR ES el riesgo completo).
// Subido de 0.15 a 0.5×ATR tras medir que 0.15 dejaba el stop pegado a la
// mecha (ver nota de "Ajustes pedidos" arriba) — sigue siendo un colchón,
// solo menos ajustado.
const SL_BUFFER_ATR_MULT = 0.5
const MIN_RR = 2 // "relación riesgo-beneficio 1:2 mínimo" — piso cuando el nivel opuesto del rango no alcanza a darlo
const VOLUME_LOOKBACK = 20    // velas de 15m previas para el promedio de volumen "normal"
const VOLUME_SPIKE_MULT = 2.0 // el volumen de la vela de barrido debe superar 2.0× ese promedio — subido de 1.5×, ver nota de calibración arriba
// Qué tan lejos debe cerrar el CUERPO de la vela más allá del nivel, como
// fracción de su propio rango (high-low): 0 = cualquier cierre de vuelta
// adentro cuenta (como al principio); 0.5 = el cierre debe quedar en la
// mitad del rango más alejada del nivel roto — un rechazo mucho más
// convincente que un simple "un pip de vuelta adentro". Ver nota de
// calibración arriba (+1.4pp aislado, +6.1pp combinado con volumen estricto).
const REJECTION_STRENGTH = 0.5

// Techo mínimo de velas de 15m para que valga la pena intentar el análisis
// (ATR + promedio de volumen + un margen de días reales).
export const MIN_NY_SWEEP_CANDLES = ATR_PERIOD + VOLUME_LOOKBACK + 20

const nyFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function nyParts(ms) {
    const parts = nyFormatter.formatToParts(ms)
    const get = t => parts.find(p => p.type === t)?.value
    return {
        dateStr: `${get('year')}-${get('month')}-${get('day')}`,
        hourFraction: Number(get('hour')) + Number(get('minute')) / 60,
    }
}

// (idéntico criterio que forexConfluenceEngine.js#computeATR)
function computeATR(candles, period) {
    const atr = new Array(candles.length).fill(null)
    const tr = new Array(candles.length).fill(0)
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i]
        if (i === 0) { tr[i] = c.high - c.low; continue }
        const prevClose = candles[i - 1].close
        tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
    }
    for (let i = period - 1; i < candles.length; i++) {
        let sum = 0
        for (let k = i - period + 1; k <= i; k++) sum += tr[k]
        atr[i] = sum / period
    }
    return atr
}

// true si el volumen de la vela `i` "aumenta bruscamente" contra el promedio
// de las VOLUME_LOOKBACK velas previas. Si no hay suficiente historial de
// volumen válido (ver nota sobre `lastTradedVolume` en capitalMarket.js —
// proxy por ticks, puede faltar), el filtro se omite en vez de bloquear la
// estrategia entera por un dato que el bróker no está dando.
function volumeSpikeOk(candles, i) {
    const cur = candles[i].volume
    if (!Number.isFinite(cur) || cur <= 0) return true
    let sum = 0, count = 0
    for (let k = i - VOLUME_LOOKBACK; k < i; k++) {
        if (k < 0) continue
        const v = candles[k].volume
        if (Number.isFinite(v) && v > 0) { sum += v; count++ }
    }
    if (count < VOLUME_LOOKBACK / 2) return true // muy poco historial de volumen para un promedio confiable
    const avg = sum / count
    return avg > 0 ? cur > avg * VOLUME_SPIKE_MULT : true
}

// Recorre hacia adelante desde `entryIdx` hasta que toque SL, TP, o llegue el
// cierre forzado de las 12:00 PM NY ("evitar sesión vespertina") — lo que
// pase primero. Si el corte de las 12:00 llega sin tocar ninguno de los dos,
// la operativa SÍ cierra (la estrategia manda cerrarla), al precio de cierre
// de la última vela evaluada — se clasifica win/loss por el signo del P&L
// resultante, no queda "abierta". Si en cambio se acaban las velas
// descargadas ANTES de llegar al corte de las 12:00, la operativa sigue
// realmente abierta (no fue un cierre de la estrategia, fue que no hay más
// datos) y se reporta como tal, igual que el resto de los motores de esta
// página.
function walkForward(candles, ny, dateStr, entryIdx, sl, tp, isBull) {
    let lastIdx = entryIdx - 1
    let cutoffReached = false
    for (let j = entryIdx; j < candles.length; j++) {
        if (ny[j].dateStr !== dateStr || ny[j].hourFraction >= CUTOFF_HOUR) { cutoffReached = true; break }
        lastIdx = j
        const c = candles[j]
        const hitSl = isBull ? c.low <= sl : c.high >= sl
        const hitTp = isBull ? c.high >= tp : c.low <= tp
        if (hitSl) return { outcome: 'loss', exitIdx: j, exitPrice: sl }
        if (hitTp) return { outcome: 'win', exitIdx: j, exitPrice: tp }
    }
    if (!cutoffReached || lastIdx < entryIdx) {
        return { outcome: 'open', exitIdx: null, exitPrice: null }
    }
    const entryPrice = candles[entryIdx].open
    const exitPrice = candles[lastIdx].close
    const pct = isBull ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice
    return { outcome: pct >= 0 ? 'win' : 'loss', exitIdx: lastIdx, exitPrice }
}

// candles: velas de 15m ascendentes por tiempo, forma
// {openTime, open, high, low, close, volume?} (ver capitalHistory.js).
// Filtros de calidad activos (ver nota de calibración arriba): rechazo
// fuerte (REJECTION_STRENGTH) + salto de volumen ≥2.0× (VOLUME_SPIKE_MULT).
export function findNySweepTrades(candles) {
    if (!candles || candles.length < MIN_NY_SWEEP_CANDLES) return []

    const atr = computeATR(candles, ATR_PERIOD)
    const ny = candles.map(c => nyParts(c.openTime))

    // Agrupa índices por día calendario NY — un solo recorrido.
    const dayIndices = new Map()
    for (let i = 0; i < candles.length; i++) {
        const d = ny[i].dateStr
        if (!dayIndices.has(d)) dayIndices.set(d, [])
        dayIndices.get(d).push(i)
    }

    const trades = []

    for (const [dateStr, idxs] of dayIndices) {
        // ── Paso 1: niveles clave del día ──
        let alHigh = -Infinity, alLow = Infinity
        let pmHigh = -Infinity, pmLow = Infinity
        for (const i of idxs) {
            const hf = ny[i].hourFraction
            if (hf >= ASIAN_LONDON_START && hf < ASIAN_LONDON_END) {
                alHigh = Math.max(alHigh, candles[i].high)
                alLow  = Math.min(alLow,  candles[i].low)
            }
            if (hf >= PREMARKET_START && hf < PREMARKET_END) {
                pmHigh = Math.max(pmHigh, candles[i].high)
                pmLow  = Math.min(pmLow,  candles[i].low)
            }
        }
        const highLevels = [
            { price: alHigh, label: 'Asia/Londres' },
            { price: pmHigh, label: 'Pre-apertura' },
        ].filter(l => Number.isFinite(l.price))
        const lowLevels = [
            { price: alLow, label: 'Asia/Londres' },
            { price: pmLow, label: 'Pre-apertura' },
        ].filter(l => Number.isFinite(l.price))
        if (highLevels.length === 0 && lowLevels.length === 0) continue // día sin ninguna de las dos ventanas de referencia

        const oppositeLowCandidates  = lowLevels.map(l => l.price)
        const oppositeHighCandidates = highLevels.map(l => l.price)
        const oppositeLow  = oppositeLowCandidates.length  ? Math.min(...oppositeLowCandidates)  : null
        const oppositeHigh = oppositeHighCandidates.length ? Math.max(...oppositeHighCandidates) : null

        let usedHigh = false, usedLow = false // una sola operativa por lado y por día

        // ── Pasos 2-5: ventana operativa 9:30-11:00 AM NY ──
        for (const i of idxs) {
            const hf = ny[i].hourFraction
            if (hf < WINDOW_START || hf >= WINDOW_END) continue
            const c = candles[i]
            const atrVal = atr[i]
            if (atrVal == null) continue
            if (!volumeSpikeOk(candles, i)) continue

            const range = c.high - c.low

            // ── Venta: barrido de un máximo previo (falso rompimiento alcista) ──
            if (!usedHigh && highLevels.length > 0) {
                const lvl = highLevels.find(l => c.high > l.price && c.close < l.price)
                // Fuerza del rechazo: qué tan abajo cerró dentro de su propio rango (ver REJECTION_STRENGTH).
                const closePos = range > 0 ? (c.high - c.close) / range : 1
                if (lvl && closePos >= REJECTION_STRENGTH) {
                    const entryIdx = i + 1
                    if (entryIdx < candles.length && ny[entryIdx].dateStr === dateStr) {
                        const entry = candles[entryIdx].open
                        const buffer = atrVal * SL_BUFFER_ATR_MULT
                        const sl = c.high + buffer
                        const risk = sl - entry
                        if (risk > 0) {
                            const tp = (oppositeLow != null && (entry - oppositeLow) / risk >= MIN_RR)
                                ? oppositeLow
                                : entry - risk * MIN_RR
                            const rr = (entry - tp) / risk
                            const { outcome, exitIdx, exitPrice } = walkForward(candles, ny, dateStr, entryIdx, sl, tp, false)
                            const pct = exitPrice != null ? (entry - exitPrice) / entry : null
                            trades.push({
                                type: 'ny_sweep_short', isBull: false,
                                entry, sl, tp1: tp, rr,
                                entryTime: candles[entryIdx].openTime,
                                exitTime: exitIdx != null ? candles[exitIdx].openTime : null,
                                outcome, pct, sweptLevel: lvl.label,
                            })
                            usedHigh = true
                        }
                    }
                }
            }

            // ── Compra: barrido de un mínimo previo (falso rompimiento bajista) ──
            if (!usedLow && lowLevels.length > 0) {
                const lvl = lowLevels.find(l => c.low < l.price && c.close > l.price)
                const closePos = range > 0 ? (c.close - c.low) / range : 1
                if (lvl && closePos >= REJECTION_STRENGTH) {
                    const entryIdx = i + 1
                    if (entryIdx < candles.length && ny[entryIdx].dateStr === dateStr) {
                        const entry = candles[entryIdx].open
                        const buffer = atrVal * SL_BUFFER_ATR_MULT
                        const sl = c.low - buffer
                        const risk = entry - sl
                        if (risk > 0) {
                            const tp = (oppositeHigh != null && (oppositeHigh - entry) / risk >= MIN_RR)
                                ? oppositeHigh
                                : entry + risk * MIN_RR
                            const rr = (tp - entry) / risk
                            const { outcome, exitIdx, exitPrice } = walkForward(candles, ny, dateStr, entryIdx, sl, tp, true)
                            const pct = exitPrice != null ? (exitPrice - entry) / entry : null
                            trades.push({
                                type: 'ny_sweep_long', isBull: true,
                                entry, sl, tp1: tp, rr,
                                entryTime: candles[entryIdx].openTime,
                                exitTime: exitIdx != null ? candles[exitIdx].openTime : null,
                                outcome, pct, sweptLevel: lvl.label,
                            })
                            usedLow = true
                        }
                    }
                }
            }
        }
    }

    return trades.sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0))
}

// ─── Variante para operación EN VIVO (bot real, ver scripts/forex-bot.mjs) ──
// Mismo criterio que forexConfluenceEngine.js#findLiveSetups: misma lógica de
// detección que el backtest, pero sin el paso de "buscar relleno histórico"
// (no aplica acá — el backtest tampoco lo usa, entra en la vela siguiente) ni
// el barrido de TODO el historial — en vivo solo importa si la ÚLTIMA vela
// del arreglo (la más reciente ya cerrada) es, ella misma, un barrido+rechazo
// válido AHORA. Entra al CLOSE de esa vela (precio de mercado vigente en el
// momento de la señal) en vez de esperar el open de la siguiente — verificado
// en el backtest que esto no cambia el resultado ni una sola operativa (ver
// nota de calibración de "entrada rápida" arriba), así que es la elección
// correcta para no perder 15 minutos extra en vivo sin ganar nada a cambio.
//
// candles: velas de 15m ascendentes por tiempo — la ÚLTIMA debe ser la más
// reciente ya cerrada. Devuelve un solo setup o null (a diferencia del
// backtest, que devuelve un arreglo completo del histórico).
//
// alreadyUsed: { usedHigh, usedLow } — replica el límite "una sola operativa
// por lado y por día" del backtest (ver usedHigh/usedLow en
// findNySweepTrades). Acá no hay forma de saberlo mirando solo esta vela: el
// LLAMADOR (scripts/forex-bot.mjs) debe pasar si YA se abrió una compra y/o
// una venta este mismo día calendario NY para este par (derivado de su
// propio historial de operativas) — sin esto, cada llamada evalúa la vela
// más reciente de forma aislada y podría disparar una SEGUNDA señal del
// mismo lado el mismo día si la primera ya cerró y volvió a haber cupo,
// cosa que el backtest verificado (48.0%) nunca contempló ni midió.
export function findLiveNySweepSetup(candles, alreadyUsed = {}) {
    if (!candles || candles.length < MIN_NY_SWEEP_CANDLES) return null
    const usedHigh = alreadyUsed.usedHigh ?? false
    const usedLow  = alreadyUsed.usedLow  ?? false
    if (usedHigh && usedLow) return null // ya se operaron los dos lados hoy — nada que evaluar

    const i = candles.length - 1
    const c = candles[i]
    const ny = nyParts(c.openTime)
    if (ny.hourFraction < WINDOW_START || ny.hourFraction >= WINDOW_END) return null

    const atr = computeATR(candles, ATR_PERIOD)
    const atrVal = atr[i]
    if (atrVal == null) return null
    if (!volumeSpikeOk(candles, i)) return null

    // Niveles del MISMO día calendario NY que la vela evaluada.
    let alHigh = -Infinity, alLow = Infinity, pmHigh = -Infinity, pmLow = Infinity
    for (let k = 0; k <= i; k++) {
        const kNy = nyParts(candles[k].openTime)
        if (kNy.dateStr !== ny.dateStr) continue
        if (kNy.hourFraction >= ASIAN_LONDON_START && kNy.hourFraction < ASIAN_LONDON_END) {
            alHigh = Math.max(alHigh, candles[k].high)
            alLow  = Math.min(alLow,  candles[k].low)
        }
        if (kNy.hourFraction >= PREMARKET_START && kNy.hourFraction < PREMARKET_END) {
            pmHigh = Math.max(pmHigh, candles[k].high)
            pmLow  = Math.min(pmLow,  candles[k].low)
        }
    }
    const highLevels = [
        { price: alHigh, label: 'Asia/Londres' },
        { price: pmHigh, label: 'Pre-apertura' },
    ].filter(l => Number.isFinite(l.price))
    const lowLevels = [
        { price: alLow, label: 'Asia/Londres' },
        { price: pmLow, label: 'Pre-apertura' },
    ].filter(l => Number.isFinite(l.price))
    if (highLevels.length === 0 && lowLevels.length === 0) return null

    const oppositeLow  = lowLevels.length  ? Math.min(...lowLevels.map(l => l.price))  : null
    const oppositeHigh = highLevels.length ? Math.max(...highLevels.map(l => l.price)) : null
    const range = c.high - c.low

    const highLvl = !usedHigh && highLevels.find(l => c.high > l.price && c.close < l.price)
    if (highLvl) {
        const closePos = range > 0 ? (c.high - c.close) / range : 1
        if (closePos >= REJECTION_STRENGTH) {
            const entry = c.close
            const buffer = atrVal * SL_BUFFER_ATR_MULT
            const sl = c.high + buffer
            const risk = sl - entry
            if (risk > 0) {
                const tp = (oppositeLow != null && (entry - oppositeLow) / risk >= MIN_RR) ? oppositeLow : entry - risk * MIN_RR
                const rr = (entry - tp) / risk
                return { type: 'ny_sweep_short', isBull: false, entry, sl, tp1: tp, rr, signalTime: c.openTime, sweptLevel: highLvl.label }
            }
        }
    }

    const lowLvl = !usedLow && lowLevels.find(l => c.low < l.price && c.close > l.price)
    if (lowLvl) {
        const closePos = range > 0 ? (c.close - c.low) / range : 1
        if (closePos >= REJECTION_STRENGTH) {
            const entry = c.close
            const buffer = atrVal * SL_BUFFER_ATR_MULT
            const sl = c.low - buffer
            const risk = entry - sl
            if (risk > 0) {
                const tp = (oppositeHigh != null && (oppositeHigh - entry) / risk >= MIN_RR) ? oppositeHigh : entry + risk * MIN_RR
                const rr = (tp - entry) / risk
                return { type: 'ny_sweep_long', isBull: true, entry, sl, tp1: tp, rr, signalTime: c.openTime, sweptLevel: lowLvl.label }
            }
        }
    }

    return null
}

// Hora NY (fracción, ej. 9.5 = 9:30 AM) de un timestamp — usado por el bot en
// vivo para saber cuándo forzar el cierre de una posición todavía abierta.
export function nyHourFraction(ms) { return nyParts(ms).hourFraction }
// Fecha calendario NY ('YYYY-MM-DD') de un timestamp — usado por el bot en
// vivo para derivar `alreadyUsed` (ver findLiveNySweepSetup) a partir de su
// propio historial de operativas de hoy.
export function nyDateStr(ms) { return nyParts(ms).dateStr }
// 12:00 PM NY — cierre forzado pedido explícitamente ("evitar sesión
// vespertina"). Exportado para que scripts/forex-bot.mjs no tenga que
// duplicar el número.
export const FORCED_CLOSE_HOUR = CUTOFF_HOUR
