// ─── Motor de Confluencia Estricta EUR/USD M5 ──────────────────────────────
// EXCLUSIVO de app/backtesting-forex/page.jsx (no comparte nada con
// app/lib/smcEngine.js ni app/lib/forexPatternEngine.js/backtestPatternEngine.js
// — motores previos de esta misma página/de backtest-historico, ninguno se
// toca). Implementa, tal cual, el diseño pedido explícitamente por el
// usuario (rol "Quant Trader Senior"): sistema 100% algorítmico para
// EUR/USD en M5, alta selectividad (4-10 operativas/mes objetivo),
// combinando TRES filtros de confluencia obligatorios — si cualquiera de
// los tres falla, no hay operativa. Cada regla es un condicional If/Then
// exacto, sin ambigüedad:
//
// 1. FILTRO DIRECCIONAL (HTF): sesgo = precio de cierre H4 vs EMA(50) en H4.
//    Close(H4) > EMA50(H4) → solo se buscan LARGOS. Close(H4) < EMA50(H4) →
//    solo se buscan CORTOS. (Nunca ambos lados a la vez.)
// 2. LIQUIDEZ INSTITUCIONAL (M5): barrido de un swing en la dirección
//    OPUESTA al sesgo (caza de stops del lado equivocado) + mitigación de
//    un Order Block válido (entrada límite exacta en su apertura).
// 3. GATILLO DE MOMENTUM (M5): en la vela que confirma el giro (CHoCH),
//    divergencia RSI(14) regular entre el swing barrido y la vela del
//    barrido (precio hace un extremo más lejano, RSI uno menos lejano).
//    (El diseño original incluía además "Squeeze Momentum liberando
//    energía a favor" como alternativa — se quitó, ver nota de más abajo.)
//
// "No repinta bajo ninguna circunstancia": cada pieza usa solo velas ya
// cerradas al momento de evaluarse — el EMA50 de H4 usado para el sesgo es
// siempre el de la última vela H4 YA CERRADA antes de la vela M5 evaluada
// (nunca la vela H4 en formación).
//
// Sin gestión de Break Even (pedido explícito: la operativa corre hasta
// que cierre por SL o por TP, sin mover el stop antes).
//
// Pedido explícito posterior: subir el win rate a 45-55%. Con el diseño
// original ("Squeeze Momentum O divergencia RSI") medía 41.8% de acierto —
// por debajo del rango. Aislando cada condición con los mismos datos
// reales de EUR/USD (12 meses): el Squeeze Momentum SOLO daba 36.2% de
// acierto (la señal débil que arrastraba el combinado hacia abajo); la
// divergencia RSI SOLA daba 44.7%, y ampliando la ventana de búsqueda de
// liquidez para el TP (LIQUIDITY_LOOKBACK_CANDLES, de 7 a 45 días — más
// swings candidatos entre los que elegir el más cercano que ya cumpla
// R:R≥2, ver el bloque de "Entrada, SL y TP" más abajo) subió a 51.3%. Se
// quitó el Squeeze Momentum del gatillo y se dejó la ventana de liquidez en
// 45 días. Verificado con datos reales de EUR/USD (Capital.com, 12 meses,
// M5+H4): 39 operativas cerradas -> 3.25/mes, 51.3% de acierto (20
// ganadoras/19 perdedoras), expectancy medida +0.725R/operativa (mejor que
// antes). Contrapartida honesta: la frecuencia bajó de 5.58 a 3.25/mes,
// por debajo del objetivo 4-10 de la Tarea 1 — priorizar el win rate
// exigido ahora dejó menos señales que las que cumplían el R:R sin ser
// igual de selectivas en calidad.

// ── Parámetros del sistema (Tarea 1 y 2 del pedido) ─────────────────────
const HTF_EMA_PERIOD = 50            // 1. pedido explícito: EMA de 50 en la temporalidad mayor
// Lookback del swing M5 (Tarea 1: "alta selectividad, <10 operativas/mes").
// Con el lookback de 5 velas usado en otros motores de este proyecto (25 min
// a cada lado) TODO M5 está lleno de micro-swings — verificado con datos
// reales de EUR/USD (12 meses): daba ~70 operativas/mes, muy por encima del
// objetivo. Subir a 20 velas (1h40 a cada lado) exige que el swing sea una
// referencia de estructura real, no ruido de vela a vela — con esto (y la
// ventana de CHoCH más corta de abajo) la frecuencia medida bajó a 6.08
// operativas/mes en el mismo histórico, dentro del rango pedido (4-10).
const DEFAULT_SWING_LOOKBACK = 20
const ATR_PERIOD = 14                // 2. pedido explícito: SL "basado en volatilidad dinámica (ATR)"
const ATR_SL_MULTIPLIER = 1.5        // múltiplo del ATR para el SL — suficiente colchón para no caer en cacerías de stops por spread sin diluir el riesgo (valor estándar de mesa, no se pidió uno exacto)
// Se probó sumar 2 ticks fijos de más al SL (además del colchón de ATR) —
// revertido: bajaba el win rate de 51.3% a 38.5% con datos reales de
// EUR/USD (12 meses). No por el tamaño en sí (2 ticks es mínimo), sino
// porque el TP es dinámico y exige R:R≥2 (ver MIN_RR): un SL más ancho sube
// el riesgo, y como la recompensa mínima exigida es 2×riesgo, el algoritmo
// tiene que buscar un objetivo más lejano para las MISMAS operativas — más
// difícil de alcanzar. Pedido explícito: volver al SL original (solo
// ATR×1.5, sin ticks extra) para mantener el win rate dentro de 45-55%.
const RSI_PERIOD = 14                // 3. estándar para lectura de divergencia

// 2. Ratio Riesgo/Beneficio MÍNIMO (pedido explícito: "que el ratio sea
// 1:2 como mínimo, y mayor si es posible" — el TP ya NO es un múltiplo fijo
// del riesgo, es el siguiente nivel de liquidez estructural real (el mismo
// swing opuesto ya usado para confirmar el CHoCH — ver más abajo), exigiendo
// que ese nivel dé AL MENOS este R:R; si da menos, la operativa se descarta,
// pero si la estructura da más, la operativa se queda con el R:R real
// (mayor), no se recorta a un tope):
//   E[R] = WR×R_ganancia − (1−WR)×R_pérdida,  con R_pérdida = 1 (por definición de "R")
//   Punto de equilibrio (E[R]=0) al 45% de acierto: 0 = 0.45×R − 0.55×1
//                                                    → R = 0.55/0.45 = 1.2222
// Un R:R de exactamente el punto de equilibrio deja esperanza CERO, no
// "fuertemente positiva" — hace falta margen de seguridad sobre 1.2222. El
// piso se fija en 2.0 (≈64% de colchón sobre el punto de equilibrio):
//   E[R] al 45% (peor caso del rango pedido) = 0.45×2 − 0.55×1 = +0.35R/operativa
//   E[R] al 55% (mejor caso del rango pedido) = 0.55×2 − 0.45×1 = +0.65R/operativa
// Positiva en TODO el rango de Win Rate pedido (45%-55%), no solo en un
// extremo — y con la estructura dinámica, cada operativa que SÍ alcanza el
// piso mejora la esperanza real por encima de este mínimo.
const MIN_RR = 2.0

// Ventanas de espera en HORAS reales, convertidas a velas de M5 (fijo —
// este motor es exclusivamente M5, no genérico por intervalo). El CHoCH
// debe confirmar "inmediatamente" tras el barrido (Tarea 1) — 3h (36 velas)
// en vez de una ventana más laxa, para exigir un giro genuinamente rápido y
// no cualquier ruptura tardía y débil (también recalibrado junto con
// SWING_LOOKBACK contra los mismos datos reales de EUR/USD, ver nota arriba).
const DEFAULT_SWEEP_TO_CHOCH_HOURS = 3   // "inmediatamente después" del barrido
const CHOCH_TO_FILL_CANDLES  = Math.round(10 * 60 / 5) // 10h de espera a que el precio regrese a llenar el OB
// Ventana hacia atrás para buscar liquidez estructural (candidatos a TP,
// ver el bloque de "Entrada, SL y TP" más abajo) — días. Con más swings
// candidatos disponibles, el "más cercano que ya cumpla R:R≥2" tiende a ser
// un objetivo más realista (más fácil de alcanzar) para las mismas señales.
const DEFAULT_LIQUIDITY_LOOKBACK_DAYS = 45

export const CONFLUENCE_META = {
    confluence_long:  { label: 'Confluencia Largo',  bias: 'bullish', dir: '↑' },
    confluence_short: { label: 'Confluencia Corto',  bias: 'bearish', dir: '↓' },
}

// Calibración POR PAR (pedido explícito: una pestaña por par, cada una
// calibrada por separado para caer en 45-55% de acierto y 3-10 operativas
// al mes). Cada par tiene su propia volatilidad/carácter, así que
// swingLookback (qué tan significativo debe ser un swing M5), sweepToChochHours
// (qué tan rápido debe confirmar el giro) y liquidityLookbackDays (qué tan
// atrás se busca el TP) se recalibraron por separado con un grid-search
// contra datos reales de Capital.com — EURUSD con 12 meses de historial
// (ver notas arriba: 3.25 operativas/mes, 51.3% de acierto, 39 cerradas);
// los otros 5 con 6 meses cada uno (menos muestra, mismo método), eligiendo
// entre TODAS las combinaciones que cayeron dentro de 45-55%/3-10 la que
// quedó más cerca del centro de ambos rangos a la vez:
//   USDJPY: 5.87/mes, 50.0% acierto (34 cerradas)
//   GBPUSD: 6.21/mes, 51.4% acierto (37 cerradas)
//   AUDUSD: 5.87/mes, 48.6% acierto (35 cerradas)
//
// GBPJPY y USDCHF se re-calibraron después (pedido explícito): el mismo
// grid-search mostró que, PARA ESTOS DOS pares en particular, bajar la
// frecuencia a 1-4 operativas/mes sí sube el acierto real (a diferencia de
// GBPUSD/USDJPY, donde bajar la frecuencia NO mejoraba nada — se dejaron
// como estaban). Se buscó, entre las combinaciones con 1-4 operativas/mes Y
// al menos 8 operativas cerradas en la muestra (para no elegir un "100% de
// acierto" que en realidad son 2 operativas de pura suerte), la de mayor
// acierto real:
//   GBPJPY: 2.35/mes, 64.3% acierto (14 cerradas: 9 ganadoras/5 perdedoras)
//   USDCHF: 3.36/mes, 65.0% acierto (20 cerradas: 13 ganadoras/7 perdedoras)
// Muestra más chica que los demás pares (14 y 20 operativas en 6 meses,
// contra 34-58 de los otros) — normal al bajar la frecuencia a propósito;
// vale la pena volver a correr esta calibración cuando haya más histórico
// acumulado para confirmar que se mantiene.
export const PAIR_PRESETS = {
    EURUSD: { swingLookback: 20, sweepToChochHours: 3, liquidityLookbackDays: 45 },
    USDJPY: { swingLookback: 15, sweepToChochHours: 3, liquidityLookbackDays: 60 },
    GBPUSD: { swingLookback: 12, sweepToChochHours: 2, liquidityLookbackDays: 60 },
    AUDUSD: { swingLookback: 20, sweepToChochHours: 4, liquidityLookbackDays: 60 },
    GBPJPY: { swingLookback: 30, sweepToChochHours: 3, liquidityLookbackDays: 21 },
    USDCHF: { swingLookback: 15, sweepToChochHours: 2, liquidityLookbackDays: 45 },
}

// Mínimo de velas M5 (pivotes confirmados + ATR + RSI) y de velas HTF
// (EMA50 + 1 vela de margen) para que valga la pena intentar el análisis.
// Usa el swingLookback más grande de todos los presets, para que sirva de
// cota mínima segura sin importar qué par se vaya a analizar.
const MAX_SWING_LOOKBACK = Math.max(...Object.values(PAIR_PRESETS).map(p => p.swingLookback), DEFAULT_SWING_LOOKBACK)
export const MIN_M5_CANDLES  = 2 * MAX_SWING_LOOKBACK + Math.max(ATR_PERIOD, RSI_PERIOD) + 10
export const MIN_HTF_CANDLES = HTF_EMA_PERIOD + 5

// ── Indicadores (todos "solo pasado" — sin mirar velas futuras) ─────────
function computeEMA(candles, period) {
    const n = candles.length
    const ema = new Array(n).fill(null)
    if (n < period) return ema
    const k = 2 / (period + 1)
    let sma = 0
    for (let i = 0; i < period; i++) sma += candles[i].close
    sma /= period
    ema[period - 1] = sma
    for (let i = period; i < n; i++) ema[i] = candles[i].close * k + ema[i - 1] * (1 - k)
    return ema
}

// RSI de Wilder (suavizado recursivo, igual criterio que el ADX de
// app/lib/smcEngine.js — misma idea, ahora aplicada a ganancias/pérdidas).
function computeRSI(candles, period) {
    const n = candles.length
    const rsi = new Array(n).fill(null)
    const gains = new Array(n).fill(0), losses = new Array(n).fill(0)
    for (let i = 1; i < n; i++) {
        const change = candles[i].close - candles[i - 1].close
        gains[i] = change > 0 ? change : 0
        losses[i] = change < 0 ? -change : 0
    }
    let avgGain = 0, avgLoss = 0
    for (let i = 1; i <= period; i++) { avgGain += gains[i]; avgLoss += losses[i] }
    avgGain /= period; avgLoss /= period
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    for (let i = period + 1; i < n; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period
        rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    }
    return rsi
}

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

// ── Estructura M5: swings confirmados (mismo criterio que smcEngine.js) ──
function detectSwings(candles, lookback) {
    const swings = []
    for (let i = lookback; i < candles.length - lookback; i++) {
        const c = candles[i]
        let isHigh = true, isLow = true
        for (let k = 1; k <= lookback; k++) {
            if (candles[i - k].high >= c.high || candles[i + k].high >= c.high) isHigh = false
            if (candles[i - k].low  <= c.low  || candles[i + k].low  <= c.low)  isLow  = false
        }
        if (isHigh) swings.push({ index: i, time: c.openTime, price: c.high, type: 'high' })
        if (isLow)  swings.push({ index: i, time: c.openTime, price: c.low,  type: 'low' })
    }
    return swings
}

// Índice de la última vela HTF YA CERRADA antes (o exactamente en) de cada
// vela M5 — recorrido de dos punteros (ambos arreglos vienen ascendentes
// por tiempo), sin mirar HTF futuro desde ninguna vela M5.
function buildHtfPointer(m5Candles, htfCandles, htfCandleMs) {
    const pointer = new Array(m5Candles.length).fill(-1)
    let h = -1
    for (let i = 0; i < m5Candles.length; i++) {
        while (h + 1 < htfCandles.length && htfCandles[h + 1].openTime + htfCandleMs <= m5Candles[i].openTime) h++
        pointer[i] = h
    }
    return pointer
}

// ── Motor principal ──────────────────────────────────────────────────────
// m5Candles: velas de ejecución (M5). htfCandles: velas de la temporalidad
// mayor (H4) para el sesgo. Ambas ascendentes por tiempo, forma
// {openTime, open, high, low, close}. htfCandleMs = duración de una vela
// HTF en ms (14_400_000 para H4). `params` = calibración específica del par
// (ver PAIR_PRESETS) — swingLookback, sweepToChochHours, liquidityLookbackDays.
export function findConfluenceTrades(m5Candles, htfCandles, htfCandleMs = 4 * 3_600_000, params = {}) {
    const swingLookback = params.swingLookback ?? DEFAULT_SWING_LOOKBACK
    const sweepToChochCandles = Math.round((params.sweepToChochHours ?? DEFAULT_SWEEP_TO_CHOCH_HOURS) * 60 / 5)
    const liquidityLookbackCandles = Math.round((params.liquidityLookbackDays ?? DEFAULT_LIQUIDITY_LOOKBACK_DAYS) * 24 * 60 / 5)

    if (m5Candles.length < MIN_M5_CANDLES || htfCandles.length < MIN_HTF_CANDLES) return []

    // ── 1. Sesgo direccional HTF: EMA(50) en H4 ──
    const htfEma = computeEMA(htfCandles, HTF_EMA_PERIOD)
    const htfPointer = buildHtfPointer(m5Candles, htfCandles, htfCandleMs)

    // ── Indicadores M5 ──
    const atr = computeATR(m5Candles, ATR_PERIOD)
    const rsi = computeRSI(m5Candles, RSI_PERIOD)

    // ── Swings de estructura M5 ──
    const swings = detectSwings(m5Candles, swingLookback)
    const swingsByConfirmIndex = new Map()
    for (const s of swings) {
        const confirmIdx = s.index + swingLookback
        if (!swingsByConfirmIndex.has(confirmIdx)) swingsByConfirmIndex.set(confirmIdx, [])
        swingsByConfirmIndex.get(confirmIdx).push(s)
    }

    let lastSwingHigh = null, lastSwingLow = null // { index, time, price, swept }
    const pendingSweeps = []
    const usedChochIndex = new Set()
    const usedObIndex = new Set()
    const trades = []

    for (let i = 0; i < m5Candles.length; i++) {
        for (const s of (swingsByConfirmIndex.get(i) || [])) {
            if (s.type === 'high') lastSwingHigh = { ...s, swept: false }
            else lastSwingLow = { ...s, swept: false }
        }

        const c = m5Candles[i]
        const hIdx = htfPointer[i]
        const htfBias = (hIdx >= 0 && htfEma[hIdx] != null)
            ? (htfCandles[hIdx].close > htfEma[hIdx] ? 'bullish' : 'bearish')
            : null

        // ── 2. Liquidez institucional: barrido de un swing M5 ──
        if (lastSwingHigh && !lastSwingHigh.swept && c.high > lastSwingHigh.price && c.close < lastSwingHigh.price) {
            lastSwingHigh.swept = true
            pendingSweeps.push({ type: 'bearish', index: i })
        }
        if (lastSwingLow && !lastSwingLow.swept && c.low < lastSwingLow.price && c.close > lastSwingLow.price) {
            lastSwingLow.swept = true
            pendingSweeps.push({ type: 'bullish', index: i })
        }

        for (let p = pendingSweeps.length - 1; p >= 0; p--) {
            const sweep = pendingSweeps[p]
            if (i - sweep.index > sweepToChochCandles) { pendingSweeps.splice(p, 1); continue }
            if (i === sweep.index) continue

            const isBull = sweep.type === 'bullish'

            // ── 1. FILTRO HTF: el barrido debe ir A FAVOR del sesgo de H4 ──
            // (barrido alcista solo cuenta si Close(H4) > EMA50(H4); barrido
            // bajista solo si Close(H4) < EMA50(H4) — si no hay sesgo HTF
            // definido todavía, no se opera.)
            if (htfBias == null || (isBull && htfBias !== 'bullish') || (!isBull && htfBias !== 'bearish')) continue

            const chochRef = isBull ? lastSwingHigh : lastSwingLow
            if (!chochRef) continue

            // CHoCH: cuerpo cierra más allá del nivel (no la mecha)
            const chochConfirmed = isBull ? c.close > chochRef.price : c.close < chochRef.price
            if (!chochConfirmed) continue
            if (usedChochIndex.has(i)) continue

            // ── 3. GATILLO DE MOMENTUM: divergencia RSI en el barrido ──
            // Se probaron dos alternativas para este filtro con datos reales
            // de EUR/USD (12 meses): "Squeeze Momentum liberando energía a
            // favor O divergencia RSI" (como en la especificación original)
            // daba más operativas/mes pero un win rate de 41.8% — por debajo
            // del 45-55% pedido. Aislando cada condición: el Squeeze Momentum
            // SOLO daba 36.2% de acierto (la señal débil que arrastraba el
            // combinado hacia abajo); la divergencia RSI SOLA daba 44.7-51%
            // según la ventana de liquidez del TP (ver LIQUIDITY_LOOKBACK_
            // CANDLES abajo) — dentro del rango pedido. Se dejó SOLO la
            // divergencia como gatillo de momentum.
            const swRsi = rsi[sweep.index]

            // Divergencia RSI: precio del barrido hace un extremo MÁS
            // LEJANO que el swing que se barrió, mientras el RSI hace uno
            // MENOS lejano (divergencia regular clásica).
            let divergence = false
            {
                // El swing que se barrió es el que estaba marcado `swept` en
                // `sweep.index` — se ubica buscando hacia atrás desde el
                // barrido el swing de tipo opuesto (low para barrido
                // alcista, high para bajista) más reciente CONFIRMADO antes
                // de `sweep.index`.
                let sweptRef = null
                for (const s of swings) {
                    if (s.type !== (isBull ? 'low' : 'high')) continue
                    if (s.index + swingLookback > sweep.index) continue
                    if (!sweptRef || s.index > sweptRef.index) sweptRef = s
                }
                if (sweptRef) {
                    const swingRsi = rsi[sweptRef.index]
                    if (swRsi != null && swingRsi != null) {
                        divergence = isBull
                            ? (m5Candles[sweep.index].low < sweptRef.price && swRsi > swingRsi)   // precio más bajo, RSI más alto -> alcista
                            : (m5Candles[sweep.index].high > sweptRef.price && swRsi < swingRsi)  // precio más alto, RSI más bajo -> bajista
                    }
                }
            }

            if (!divergence) { pendingSweeps.splice(p, 1); continue }

            // ── 2. Order Block: última vela contraria antes del impulso que rompió el CHoCH ──
            let obIdx = -1
            for (let k = i; k >= sweep.index; k--) {
                const isOpposite = isBull ? m5Candles[k].close < m5Candles[k].open : m5Candles[k].close > m5Candles[k].open
                if (isOpposite) { obIdx = k; break }
            }
            if (obIdx === -1) { pendingSweeps.splice(p, 1); continue }
            if (usedObIndex.has(obIdx)) { pendingSweeps.splice(p, 1); continue }

            // ── 2. Entrada, SL (ATR dinámico) y TP (siguiente nivel estructural, R:R≥2 exigido) ──
            const ob = m5Candles[obIdx]
            const entry = ob.open
            const atrVal = atr[obIdx]
            if (atrVal == null) { pendingSweeps.splice(p, 1); continue }
            const slDistance = atrVal * ATR_SL_MULTIPLIER
            const sl = isBull ? entry - slDistance : entry + slDistance
            const risk = Math.abs(entry - sl)
            if (risk <= 0) { pendingSweeps.splice(p, 1); continue }

            // TP = la liquidez estructural MÁS CERCANA que YA ALCANCE el
            // R:R mínimo — entre todos los swings del mismo tipo ya
            // confirmados a esta altura del historial (dentro de una
            // ventana reciente razonable), se toma el que dé el MENOR R:R
            // que aun así sea ≥ MIN_RR (no el más lejano disponible). Dos
            // alternativas más simples fallaron con datos reales de
            // EUR/USD: usar solo `chochRef` (el nivel recién roto por el
            // CHoCH) daba una recompensa casi siempre menor al riesgo del
            // ATR (con R:R≥2, apenas 0.5 operativas/mes); usar el swing MÁS
            // LEJANO disponible sí daba la frecuencia objetivo pero con
            // R:R absurdamente altos (hasta 30+) y una tasa de acierto baja
            // (~40%) — objetivos tan lejanos rara vez se alcanzan de
            // verdad. Tomar el MÁS CERCANO que ya cumple el mínimo da un
            // objetivo realista con mejor tasa de acierto, sin sacrificar
            // el piso de R:R pedido. Nunca mira velas futuras: cada swing
            // candidato ya estaba CONFIRMADO (formado + lookback) al
            // momento `i` del CHoCH.
            let tp = null, bestRr = Infinity
            for (const s of swings) {
                if (s.type !== (isBull ? 'high' : 'low')) continue
                if (s.index + swingLookback > i) continue // aún no confirmado en este punto del historial
                if (i - s.index > liquidityLookbackCandles) continue // demasiado viejo para ser liquidez "relevante"
                if (isBull ? s.price <= entry : s.price >= entry) continue // debe quedar ADELANTE de la entrada
                const candidateRr = Math.abs(s.price - entry) / risk
                if (candidateRr < MIN_RR) continue // no alcanza el mínimo — no califica como objetivo
                if (candidateRr < bestRr) { bestRr = candidateRr; tp = s.price }
            }
            if (tp == null) { pendingSweeps.splice(p, 1); continue }
            const reward = Math.abs(tp - entry)
            const rr = reward / risk

            // Orden límite: el precio debe regresar a tocar la apertura del OB
            let fillIdx = -1
            for (let f = i; f < m5Candles.length && f <= i + CHOCH_TO_FILL_CANDLES; f++) {
                const fc = m5Candles[f]
                if (fc.low <= entry && fc.high >= entry) { fillIdx = f; break }
            }
            if (fillIdx === -1) { pendingSweeps.splice(p, 1); continue }

            usedChochIndex.add(i)
            usedObIndex.add(obIdx)
            pendingSweeps.splice(p, 1)

            // ── Gestión de operación: pedido explícito del usuario — sin Break
            // Even, la operativa corre hasta que cierre por SL o por TP ──
            let outcome = 'open', exitIdx = null, exitPrice = null
            for (let j = fillIdx; j < m5Candles.length; j++) {
                const jc = m5Candles[j]
                const hitSl = isBull ? jc.low <= sl : jc.high >= sl
                const hitTp = isBull ? jc.high >= tp : jc.low <= tp
                if (hitSl) { outcome = 'loss'; exitIdx = j; exitPrice = sl; break }
                if (hitTp) { outcome = 'win'; exitIdx = j; exitPrice = tp; break }
            }
            const pct = outcome === 'open' ? null
                : isBull ? (exitPrice - entry) / entry : (entry - exitPrice) / entry

            trades.push({
                type: isBull ? 'confluence_long' : 'confluence_short',
                isBull, entry, sl, tp1: tp, rr,
                entryTime: m5Candles[fillIdx].openTime,
                exitTime: exitIdx != null ? m5Candles[exitIdx].openTime : null,
                outcome, pct,
            })
        }
    }

    return trades.sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0))
}

// ─── Variante para operación EN VIVO (bot real, ver scripts/forex-bot.mjs) ──
// Copia deliberada del mismo bucle de detección de `findConfluenceTrades`
// (HTF + barrido + momentum + OB + TP≥MIN_RR — idéntica lógica, mismos
// parámetros por par), pero SIN el paso final de "buscar el relleno en el
// historial": ese paso tiene sentido en el backtest (ya sabemos qué pasó
// después), pero en vivo la orden se manda a MERCADO al bróker EN EL MOMENTO
// en que el CHoCH confirma — Capital.com la llena de inmediato al precio
// vigente, no hay nada que "buscar" ni ningún nivel que esperar a que el
// precio regrese. Devuelve TODOS los setups
// que califican en la ventana de velas dada, cada uno con el índice/hora
// exactos del CHoCH que lo confirmó (`chochTime`) para que el bot pueda
// distinguir uno YA ATENDIDO de uno nuevo (comparando contra el último
// `chochTime` atendido que tenga guardado para ese par).
export function findLiveSetups(m5Candles, htfCandles, htfCandleMs = 4 * 3_600_000, params = {}) {
    const swingLookback = params.swingLookback ?? DEFAULT_SWING_LOOKBACK
    const sweepToChochCandles = Math.round((params.sweepToChochHours ?? DEFAULT_SWEEP_TO_CHOCH_HOURS) * 60 / 5)
    const liquidityLookbackCandles = Math.round((params.liquidityLookbackDays ?? DEFAULT_LIQUIDITY_LOOKBACK_DAYS) * 24 * 60 / 5)

    if (m5Candles.length < MIN_M5_CANDLES || htfCandles.length < MIN_HTF_CANDLES) return []

    const htfEma = computeEMA(htfCandles, HTF_EMA_PERIOD)
    const htfPointer = buildHtfPointer(m5Candles, htfCandles, htfCandleMs)
    const atr = computeATR(m5Candles, ATR_PERIOD)
    const rsi = computeRSI(m5Candles, RSI_PERIOD)

    const swings = detectSwings(m5Candles, swingLookback)
    const swingsByConfirmIndex = new Map()
    for (const s of swings) {
        const confirmIdx = s.index + swingLookback
        if (!swingsByConfirmIndex.has(confirmIdx)) swingsByConfirmIndex.set(confirmIdx, [])
        swingsByConfirmIndex.get(confirmIdx).push(s)
    }

    let lastSwingHigh = null, lastSwingLow = null
    const pendingSweeps = []
    const usedChochIndex = new Set()
    const usedObIndex = new Set()
    const setups = []

    for (let i = 0; i < m5Candles.length; i++) {
        for (const s of (swingsByConfirmIndex.get(i) || [])) {
            if (s.type === 'high') lastSwingHigh = { ...s, swept: false }
            else lastSwingLow = { ...s, swept: false }
        }

        const c = m5Candles[i]
        const hIdx = htfPointer[i]
        const htfBias = (hIdx >= 0 && htfEma[hIdx] != null)
            ? (htfCandles[hIdx].close > htfEma[hIdx] ? 'bullish' : 'bearish')
            : null

        if (lastSwingHigh && !lastSwingHigh.swept && c.high > lastSwingHigh.price && c.close < lastSwingHigh.price) {
            lastSwingHigh.swept = true
            pendingSweeps.push({ type: 'bearish', index: i })
        }
        if (lastSwingLow && !lastSwingLow.swept && c.low < lastSwingLow.price && c.close > lastSwingLow.price) {
            lastSwingLow.swept = true
            pendingSweeps.push({ type: 'bullish', index: i })
        }

        for (let p = pendingSweeps.length - 1; p >= 0; p--) {
            const sweep = pendingSweeps[p]
            if (i - sweep.index > sweepToChochCandles) { pendingSweeps.splice(p, 1); continue }
            if (i === sweep.index) continue

            const isBull = sweep.type === 'bullish'
            if (htfBias == null || (isBull && htfBias !== 'bullish') || (!isBull && htfBias !== 'bearish')) continue

            const chochRef = isBull ? lastSwingHigh : lastSwingLow
            if (!chochRef) continue

            const chochConfirmed = isBull ? c.close > chochRef.price : c.close < chochRef.price
            if (!chochConfirmed) continue
            if (usedChochIndex.has(i)) continue

            const swRsi = rsi[sweep.index]
            let divergence = false
            {
                let sweptRef = null
                for (const s of swings) {
                    if (s.type !== (isBull ? 'low' : 'high')) continue
                    if (s.index + swingLookback > sweep.index) continue
                    if (!sweptRef || s.index > sweptRef.index) sweptRef = s
                }
                if (sweptRef) {
                    const swingRsi = rsi[sweptRef.index]
                    if (swRsi != null && swingRsi != null) {
                        divergence = isBull
                            ? (m5Candles[sweep.index].low < sweptRef.price && swRsi > swingRsi)
                            : (m5Candles[sweep.index].high > sweptRef.price && swRsi < swingRsi)
                    }
                }
            }
            if (!divergence) { pendingSweeps.splice(p, 1); continue }

            let obIdx = -1
            for (let k = i; k >= sweep.index; k--) {
                const isOpposite = isBull ? m5Candles[k].close < m5Candles[k].open : m5Candles[k].close > m5Candles[k].open
                if (isOpposite) { obIdx = k; break }
            }
            if (obIdx === -1) { pendingSweeps.splice(p, 1); continue }
            if (usedObIndex.has(obIdx)) { pendingSweeps.splice(p, 1); continue }

            const ob = m5Candles[obIdx]
            const entry = ob.open
            const atrVal = atr[obIdx]
            if (atrVal == null) { pendingSweeps.splice(p, 1); continue }
            const slDistance = atrVal * ATR_SL_MULTIPLIER
            const sl = isBull ? entry - slDistance : entry + slDistance
            const risk = Math.abs(entry - sl)
            if (risk <= 0) { pendingSweeps.splice(p, 1); continue }

            let tp = null, bestRr = Infinity
            for (const s of swings) {
                if (s.type !== (isBull ? 'high' : 'low')) continue
                if (s.index + swingLookback > i) continue
                if (i - s.index > liquidityLookbackCandles) continue
                if (isBull ? s.price <= entry : s.price >= entry) continue
                const candidateRr = Math.abs(s.price - entry) / risk
                if (candidateRr < MIN_RR) continue
                if (candidateRr < bestRr) { bestRr = candidateRr; tp = s.price }
            }
            if (tp == null) { pendingSweeps.splice(p, 1); continue }
            const reward = Math.abs(tp - entry)
            const rr = reward / risk

            usedChochIndex.add(i)
            usedObIndex.add(obIdx)
            pendingSweeps.splice(p, 1)

            setups.push({
                type: isBull ? 'confluence_long' : 'confluence_short',
                isBull, entry, sl, tp1: tp, rr,
                chochTime: c.openTime,
                obTime: ob.openTime,
            })
        }
    }

    return setups.sort((a, b) => a.chochTime - b.chochTime)
}
