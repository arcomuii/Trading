// ─── Motor de detección Smart Money Concepts (SMC) ─────────────────────────
// EXCLUSIVO de app/backtesting-forex/page.jsx — deliberadamente NO comparte
// nada con app/lib/backtestPatternEngine.js (motor de patrones clásicos de
// app/backtest-historico y app/patrones-1h). Ese motor no se toca.
//
// Reescrito para seguir el algoritmo exacto pedido (barrido de liquidez →
// CHoCH con confirmación de momentum → Order Block + FVG → entrada/SL/TP →
// filtro de Killzones), en UNA sola temporalidad (la que el usuario elija en
// la página: 5m/15m/1H) — a
// diferencia de la versión anterior, aquí ya no hay una temporalidad alta
// separada dando el sesgo: el barrido de liquidez hace ese trabajo (asume
// reversión después de cazar los stops del lado equivocado).
//
// "No repinta bajo ninguna circunstancia": cada pieza (swing, barrido, CHoCH,
// OB, FVG, entrada, SL) se calcula usando SOLO velas ya cerradas hasta ese
// punto — nunca información del futuro. La ÚNICA diferencia frente a la
// versión anterior de este motor es el TAKE PROFIT: antes se calculaba
// mirando hacia adelante en el historial (el extremo que el tramo
// alcanzaba después) — eso es, en espíritu, repintado (el nivel solo se
// conoce en retrospectiva). Ahora el TP es "el siguiente Swing High/Low
// relevante" tomado del swing YA CONOCIDO en el momento del CHoCH, nunca de
// uno posterior.

// ── Parámetros del algoritmo (los que el usuario fijó van comentados como
// tal; los demás son valores razonables por defecto, ajustables) ──
const SWING_LOOKBACK = 5        // 1. pedido explícito: 5 velas a cada lado
const SL_BUFFER_PIPS = 4        // 4. pedido explícito: colchón de 4 pips/ticks
const ATR_PERIOD = 14           // 4. pedido explícito: ATR de 14 periodos
const ATR_SL_MULTIPLIER = 0.5   // 4. multiplicador del ATR para el colchón — no se dio un valor exacto ("considera usar"), 0.5× es un punto de partida razonable (colchón adicional sin duplicar el riesgo)
const MIN_RR = 3                // 4. pedido explícito: ratio mínimo 1:3
const CDMX_UTC_OFFSET_HOURS = 6  // CDMX no observa horario de verano desde 2022 — offset fijo UTC-6, sin ajuste estacional

// Ventana de mercado abierto, en hora CDMX: domingo 15:00 a viernes 14:30 —
// fuera de ahí el mercado forex está cerrado (fin de semana), sea lo que
// digan las Killzones de abajo.
const WEEK_OPEN_DOW_CDMX     = 0        // domingo
const WEEK_OPEN_MINUTES_CDMX = 15 * 60  // 15:00
const WEEK_CLOSE_DOW_CDMX     = 5             // viernes
const WEEK_CLOSE_MINUTES_CDMX = 14 * 60 + 30  // 14:30

// 5. Killzones (pedido explícito): solo se opera dentro del inicio de
// Londres y la intersección Londres-Nueva York, en hora del Este de EE.UU.
// (ET) — hay que convertir a CDMX evaluando el instante exacto, porque a
// diferencia de CDMX, ET SÍ observa horario de verano (EDT, UTC-4) e
// invierno (EST, UTC-5) — el offset entre ET y CDMX cambia entre 1 y 2 horas
// según la época del año (ver `isUsEasternDst`/`etMinutesOfDay` abajo).
const LONDON_KZ_START_ET = 2 * 60       // 02:00 ET — apertura de Londres
const LONDON_KZ_END_ET   = 5 * 60       // 05:00 ET
const NYLDN_KZ_START_ET  = 8 * 60       // 08:00 ET — solape Londres/Nueva York
const NYLDN_KZ_END_ET    = 11 * 60      // 11:00 ET

// 2. Confirmación de momentum para validar el CHoCH (pedido explícito): ADX
// por encima de 25, O el Squeeze Momentum liberando energía a favor del
// rompimiento. Sin uno de los dos, el CHoCH se anula.
const ADX_PERIOD = 14           // periodo estándar del ADX
const ADX_THRESHOLD = 25        // pedido explícito
const SQZ_BB_LENGTH = 20        // Squeeze Momentum de LazyBear — parámetros estándar
const SQZ_BB_MULT = 2
const SQZ_KC_LENGTH = 20
const SQZ_KC_MULT = 1.5

// Ventanas de espera (no especificadas por el usuario) — igual que en la
// versión anterior, en HORAS reales y convertidas a velas según el intervalo
// activo, para que 5m/15m/1H esperen lo mismo en tiempo real.
const SWEEP_TO_CHOCH_HOURS = 12 // "inmediatamente después" del barrido — ventana para que aparezca el CHoCH de confirmación
const CHOCH_TO_FILL_HOURS  = 10 // desde el CHoCH, cuánto se espera a que el precio regrese a llenar la orden límite en el OB

export const SMC_META = {
    bullish_ob: { label: 'Order Block Alcista', bias: 'bullish', dir: '↑' },
    bearish_ob: { label: 'Order Block Bajista',  bias: 'bearish', dir: '↓' },
}

// Mínimo de velas para que valga la pena intentar el análisis: necesita
// margen para pivotes confirmados (2×lookback), ATR completo, y el
// indicador más exigente de todos (el Squeeze Momentum necesita 2×kcLength
// para que el propio momentum deje de ser `null`).
export const MIN_CANDLES = Math.max(2 * SWING_LOOKBACK, ATR_PERIOD, 2 * ADX_PERIOD, 2 * SQZ_KC_LENGTH, SQZ_BB_LENGTH) + 10

// ── Utilidades de tiempo/precio ──────────────────────────────────────────
function inferMinutesPerCandle(candles) {
    if (candles.length < 3) return 5
    const deltas = []
    for (let i = 1; i < candles.length; i++) deltas.push(candles[i].openTime - candles[i - 1].openTime)
    deltas.sort((a, b) => a - b)
    return deltas[Math.floor(deltas.length / 2)] / 60000
}

// Tamaño de pip por precio: los pares cotizados en JPY (USDJPY, GBPJPY...)
// cotizan en el rango ~100-250 y su pip es 0.01; el resto de pares mayores
// cotiza <20 y su pip es 0.0001. Heurística simple por precio — no hay una
// bandera explícita de "es par JPY" en las velas que llegan a este motor.
function pipSize(price) {
    return price >= 20 ? 0.01 : 0.0001
}

// Día de la semana (0=domingo..6=sábado) y minutos desde la medianoche, en
// hora CDMX, de un timestamp UTC en ms — restar el offset ANTES de leer los
// campos `getUTC*` es lo que traduce el instante a "reloj de pared CDMX"
// (offset fijo, sin horario de verano desde 2022).
function cdmxDayAndMinutes(openTimeMs) {
    const shifted = new Date(openTimeMs - CDMX_UTC_OFFSET_HOURS * 3_600_000)
    return { dow: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() }
}

// 5. Filtro de ventana de mercado: solo se generan señales cuando el
// mercado forex está abierto — domingo 15:00 CDMX a viernes 14:30 CDMX.
// Fuera de ahí (viernes después del cierre, todo el sábado, domingo antes
// de la apertura) el mercado está cerrado por el fin de semana.
function inTradingWeek(openTimeMs) {
    const { dow, minutes } = cdmxDayAndMinutes(openTimeMs)
    if (dow === WEEK_CLOSE_DOW_CDMX && minutes >= WEEK_CLOSE_MINUTES_CDMX) return false // viernes, después del cierre
    if (dow === WEEK_CLOSE_DOW_CDMX + 1) return false // sábado, cerrado todo el día
    if (dow === WEEK_OPEN_DOW_CDMX && minutes < WEEK_OPEN_MINUTES_CDMX) return false // domingo, antes de la apertura
    return true
}

// Fecha (UTC, a medianoche) del n-ésimo domingo de un mes — usado para
// ubicar el 2do domingo de marzo y el 1er domingo de noviembre, los días en
// que EE.UU. cambia de horario.
function nthSundayUtcDay(year, monthIndex0, n) {
    const firstDow = new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay() // 0=domingo
    const firstSunday = 1 + ((7 - firstDow) % 7)
    return firstSunday + (n - 1) * 7
}

// ¿El horario de EE.UU. (hora del Este, ET) está en horario de verano
// (EDT, UTC-4) en este instante UTC, o en horario de invierno (EST, UTC-5)?
// Regla vigente desde 2007: EDT empieza el 2do domingo de marzo a las 2:00
// a.m. hora ESTÁNDAR (=07:00 UTC) y termina el 1er domingo de noviembre a
// las 2:00 a.m. hora DE VERANO (=06:00 UTC). CDMX no observa horario de
// verano desde 2022, así que el offset ET↔CDMX cambia de 1h (invierno) a 2h
// (verano) — por eso las Killzones de abajo se evalúan directo en ET, no
// convirtiendo primero a un offset CDMX fijo que sería incorrecto medio año.
function isUsEasternDst(utcMs) {
    const year = new Date(utcMs).getUTCFullYear()
    const dstStartUtc = Date.UTC(year, 2, nthSundayUtcDay(year, 2, 2), 7, 0, 0)  // 2do domingo de marzo, 07:00 UTC
    const dstEndUtc   = Date.UTC(year, 10, nthSundayUtcDay(year, 10, 1), 6, 0, 0) // 1er domingo de noviembre, 06:00 UTC
    return utcMs >= dstStartUtc && utcMs < dstEndUtc
}

// Minutos desde la medianoche en hora del Este de EE.UU. (ET), ya resuelto
// el horario de verano/invierno para ESTE instante puntual.
function etMinutesOfDay(openTimeMs) {
    const offsetHours = isUsEasternDst(openTimeMs) ? -4 : -5
    const shifted = new Date(openTimeMs + offsetHours * 3_600_000)
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

// 5. Killzones: apertura de Londres (02:00-05:00 ET) o solape
// Londres/Nueva York (08:00-11:00 ET). Fuera de estas dos ventanas, el
// bot ignora cualquier otra condición — pedido explícito del usuario.
function inKillzone(openTimeMs) {
    const et = etMinutesOfDay(openTimeMs)
    const inLondon = et >= LONDON_KZ_START_ET && et < LONDON_KZ_END_ET
    const inOverlap = et >= NYLDN_KZ_START_ET && et < NYLDN_KZ_END_ET
    return inLondon || inOverlap
}

// ATR(14) simple (media móvil del rango verdadero, sin el suavizado de
// Wilder — aproximación suficiente para este colchón de SL). atr[i] es
// `null` mientras no haya al menos `period` velas previas — nunca usa velas
// futuras, así que no repinta.
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

// ── 1. Identificación de estructura (Swing Highs/Lows) ──────────────────
// Un swing high en `i` es el high más alto entre [i-lookback, i+lookback]; un
// swing low es el low más bajo en esa misma ventana. Solo se conoce
// `lookback` velas después de formado (cuando ya existen las velas a su
// derecha) — nunca se usa por adelantado.
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

// ADX de Wilder — mide la FUERZA de la tendencia (no la dirección). Usa el
// suavizado recursivo de Wilder (no una media simple) para +DM/-DM/TR y para
// el propio DX, igual que cualquier plataforma de trading. Solo usa velas
// hasta `i` — no repinta.
function computeADX(candles, period) {
    const n = candles.length
    const plusDM = new Array(n).fill(0)
    const minusDM = new Array(n).fill(0)
    const tr = new Array(n).fill(0)
    for (let i = 1; i < n; i++) {
        const upMove = candles[i].high - candles[i - 1].high
        const downMove = candles[i - 1].low - candles[i].low
        plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0
        minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0
        tr[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close))
    }

    // Suavizado de Wilder: primer valor = suma simple de los primeros
    // `period`, luego cada paso resta 1/period del acumulado y suma el nuevo.
    const wilderSmooth = arr => {
        const out = new Array(n).fill(null)
        let sum = 0
        for (let i = 1; i <= period; i++) sum += arr[i] || 0
        out[period] = sum
        for (let i = period + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i]
        return out
    }
    const smPlusDM = wilderSmooth(plusDM)
    const smMinusDM = wilderSmooth(minusDM)
    const smTR = wilderSmooth(tr)

    const dx = new Array(n).fill(null)
    for (let i = period; i < n; i++) {
        if (!smTR[i]) continue
        const plusDI = 100 * smPlusDM[i] / smTR[i]
        const minusDI = 100 * smMinusDM[i] / smTR[i]
        const sum = plusDI + minusDI
        dx[i] = sum === 0 ? 0 : 100 * Math.abs(plusDI - minusDI) / sum
    }

    // ADX = DX suavizado a la Wilder sobre `period` — arranca cuando ya hay
    // `period` valores de DX disponibles (2×period velas desde el inicio).
    const adx = new Array(n).fill(null)
    let firstIdx = -1, sum = 0, count = 0
    for (let i = period; i < n && firstIdx === -1; i++) {
        if (dx[i] == null) continue
        count++; sum += dx[i]
        if (count === period) { firstIdx = i; adx[i] = sum / period }
    }
    if (firstIdx !== -1) {
        for (let i = firstIdx + 1; i < n; i++) adx[i] = dx[i] == null ? adx[i - 1] : (adx[i - 1] * (period - 1) + dx[i]) / period
    }
    return adx
}

// Helpers de ventana móvil (solo con datos hasta `i`, nunca futuros).
function rollingSma(values, length, i) {
    if (i < length - 1) return null
    let sum = 0
    for (let k = i - length + 1; k <= i; k++) sum += values[k]
    return sum / length
}
function rollingStdev(values, length, i) {
    const mean = rollingSma(values, length, i)
    if (mean == null) return null
    let sumSq = 0
    for (let k = i - length + 1; k <= i; k++) sumSq += (values[k] - mean) ** 2
    return Math.sqrt(sumSq / length)
}
function rollingExtreme(values, length, i, better) {
    if (i < length - 1) return null
    let best = values[i - length + 1]
    for (let k = i - length + 2; k <= i; k++) if (better(values[k], best)) best = values[k]
    return best
}
// Regresión lineal (mínimos cuadrados) de `values[i-length+1..i]`, evaluada
// en el ÚLTIMO punto de la ventana (offset 0, igual que `linreg` de Pine).
function linregEndpoint(values, length, i) {
    if (i < length - 1) return null
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
    for (let j = 0; j < length; j++) {
        const y = values[i - length + 1 + j]
        if (y == null) return null
        sumX += j; sumY += y; sumXY += j * y; sumXX += j * j
    }
    const denom = length * sumXX - sumX * sumX
    if (denom === 0) return null
    const slope = (length * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slope * sumX) / length
    return intercept + slope * (length - 1)
}

// Squeeze Momentum (LazyBear) — Bandas de Bollinger dentro de un Canal de
// Keltner = "squeeze" (compresión, poca volatilidad); BB por FUERA del
// Keltner = squeeze liberado (expansión de volatilidad). El momentum es la
// regresión lineal de (close - promedio de [rango medio de Keltner, SMA del
// cierre]) — su signo/pendiente indica si la energía liberada empuja a
// favor o en contra del rompimiento. Solo usa datos hasta `i` — no repinta.
function computeSqueezeMomentum(candles, { bbLength, bbMult, kcLength, kcMult }) {
    const n = candles.length
    const closes = candles.map(c => c.close)
    const highs = candles.map(c => c.high)
    const lows = candles.map(c => c.low)
    const tr = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
        tr[i] = i === 0 ? candles[i].high - candles[i].low
            : Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close))
    }

    const sqzOn = new Array(n).fill(false)
    const sqzOff = new Array(n).fill(false)
    const src = new Array(n).fill(null) // fuente para la regresión lineal del momentum
    for (let i = 0; i < n; i++) {
        const basis = rollingSma(closes, bbLength, i)
        const dev = rollingStdev(closes, bbLength, i)
        const maKc = rollingSma(closes, kcLength, i)
        const rangeMa = rollingSma(tr, kcLength, i)
        const hh = rollingExtreme(highs, kcLength, i, (a, b) => a > b)
        const ll = rollingExtreme(lows, kcLength, i, (a, b) => a < b)
        if (basis == null || dev == null || maKc == null || rangeMa == null || hh == null || ll == null) continue

        const upperBB = basis + bbMult * dev, lowerBB = basis - bbMult * dev
        const upperKC = maKc + rangeMa * kcMult, lowerKC = maKc - rangeMa * kcMult
        sqzOn[i] = lowerBB > lowerKC && upperBB < upperKC
        sqzOff[i] = lowerBB < lowerKC && upperBB > upperKC
        src[i] = closes[i] - ((hh + ll) / 2 + maKc) / 2
    }

    const momentum = new Array(n).fill(null)
    for (let i = 0; i < n; i++) momentum[i] = linregEndpoint(src, kcLength, i)

    return { sqzOn, sqzOff, momentum }
}

// 2. ¿Hay confirmación de momentum en la vela de ruptura (la del CHoCH)?
// ADX > 25 (fuerza de tendencia), O el Squeeze Momentum liberando energía A
// FAVOR del rompimiento (squeeze recién liberado + momentum del lado
// correcto y creciendo en esa dirección). Sin ninguna de las dos, el CHoCH
// se anula — pedido explícito del usuario.
function hasMomentumConfirmation(i, isBull, adx, sqz) {
    if (adx[i] != null && adx[i] > ADX_THRESHOLD) return true
    if (i < 1 || !sqz.sqzOff[i]) return false
    const m = sqz.momentum[i], mPrev = sqz.momentum[i - 1]
    if (m == null || mPrev == null) return false
    return isBull ? (m > 0 && m > mPrev) : (m < 0 && m < mPrev)
}

// 3. ¿Hay un Fair Value Gap (hueco de 3 velas) en [fromIdx, toIdx]? Se
// compara la MECHA (high/low) de la vela 1 contra la de la vela 3 — si no se
// cruzan, hay un hueco de ineficiencia sin llenar. Alcista: high de la vela 1
// queda por debajo del low de la vela 3. Bajista: espejo.
function hasFvgInRange(candles, fromIdx, toIdx, isBull) {
    for (let k = fromIdx; k + 2 <= toIdx; k++) {
        const a = candles[k], c = candles[k + 2]
        if (isBull && a.high < c.low) return true
        if (!isBull && a.low > c.high) return true
    }
    return false
}

// ── Motor principal ──────────────────────────────────────────────────────
// candles: velas de la temporalidad elegida (5m/15m/1H). Devuelve
// operativas SIN symbol/capital — misma forma que antes (entryTime,
// exitTime, pct, outcome...) para que applyVolumeCompounding() las procese
// igual.
export function findSmcTrades(candles) {
    if (candles.length < MIN_CANDLES) return []

    const minutesPerCandle = inferMinutesPerCandle(candles)
    const sweepToChochCandles = Math.max(3, Math.round(SWEEP_TO_CHOCH_HOURS * 60 / minutesPerCandle))
    const chochToFillCandles  = Math.max(3, Math.round(CHOCH_TO_FILL_HOURS  * 60 / minutesPerCandle))

    // ── 1. Swings de estructura ──
    const swings = detectSwings(candles, SWING_LOOKBACK)
    const swingsByConfirmIndex = new Map()
    for (const s of swings) {
        const confirmIdx = s.index + SWING_LOOKBACK
        if (!swingsByConfirmIndex.has(confirmIdx)) swingsByConfirmIndex.set(confirmIdx, [])
        swingsByConfirmIndex.get(confirmIdx).push(s)
    }

    const atr = computeATR(candles, ATR_PERIOD)
    const adx = computeADX(candles, ADX_PERIOD)
    const sqz = computeSqueezeMomentum(candles, { bbLength: SQZ_BB_LENGTH, bbMult: SQZ_BB_MULT, kcLength: SQZ_KC_LENGTH, kcMult: SQZ_KC_MULT })

    let lastSwingHigh = null // { index, time, price, swept }
    let lastSwingLow  = null
    const pendingSweeps = [] // { type: 'bullish'|'bearish', index }, en espera de su CHoCH
    const usedChochIndex = new Set()
    const usedObIndex = new Set() // evita operar el MISMO Order Block dos veces (ver bloque 3 más abajo)
    const trades = []

    for (let i = 0; i < candles.length; i++) {
        // ingerir swings recién confirmados en este índice
        for (const s of (swingsByConfirmIndex.get(i) || [])) {
            if (s.type === 'high') lastSwingHigh = { ...s, swept: false }
            else lastSwingLow = { ...s, swept: false }
        }

        const c = candles[i]

        // ── 1. Barrido de liquidez (Sweep) ──
        // La vela CRUZA el nivel del swing (mecha lo sobrepasa) pero CIERRA
        // del lado de adentro (deja solo una mecha larga) — eso es cazar los
        // stops de ese lado sin que la estructura realmente se rompa.
        if (lastSwingHigh && !lastSwingHigh.swept && c.high > lastSwingHigh.price && c.close < lastSwingHigh.price) {
            lastSwingHigh.swept = true
            pendingSweeps.push({ type: 'bearish', index: i }) // barre altos -> se espera reversión a la baja
        }
        if (lastSwingLow && !lastSwingLow.swept && c.low < lastSwingLow.price && c.close > lastSwingLow.price) {
            lastSwingLow.swept = true
            pendingSweeps.push({ type: 'bullish', index: i }) // barre bajos -> se espera reversión al alza
        }

        // ── 2. CHoCH inmediatamente después del barrido ──
        for (let p = pendingSweeps.length - 1; p >= 0; p--) {
            const sweep = pendingSweeps[p]
            if (i - sweep.index > sweepToChochCandles) { pendingSweeps.splice(p, 1); continue } // se agotó la ventana de espera
            if (i === sweep.index) continue // el CHoCH no puede ser la misma vela del barrido

            const isBull = sweep.type === 'bullish' // barrido de bajos -> CHoCH alcista esperado (dirección OPUESTA al barrido)
            const chochRef = isBull ? lastSwingHigh : lastSwingLow // último alto/bajo de la microestructura, en dirección opuesta al barrido
            if (!chochRef) continue

            // CHoCH válido solo si el CUERPO cierra más allá del nivel (no la mecha)
            const chochConfirmed = isBull ? c.close > chochRef.price : c.close < chochRef.price
            if (!chochConfirmed) continue
            if (usedChochIndex.has(i)) continue

            // ── 2. Confirmación de momentum: sin ADX>25 ni Squeeze Momentum a favor, el CHoCH se anula ──
            if (!hasMomentumConfirmation(i, isBull, adx, sqz)) { pendingSweeps.splice(p, 1); continue }

            // ── 5. Filtro de Killzones + ventana de mercado: fuera de esto, se ignora cualquier configuración ──
            if (!inTradingWeek(c.openTime) || !inKillzone(c.openTime)) { pendingSweeps.splice(p, 1); continue }

            // ── 3. Order Block: última vela contraria antes del impulso que provocó el CHoCH ──
            let obIdx = -1
            for (let k = i; k >= sweep.index; k--) {
                const isOpposite = isBull ? candles[k].close < candles[k].open : candles[k].close > candles[k].open
                if (isOpposite) { obIdx = k; break }
            }
            if (obIdx === -1) { pendingSweeps.splice(p, 1); continue }

            // Dos barridos distintos (de dos swings distintos) pueden confirmar
            // su CHoCH en velas diferentes pero apuntar al MISMO Order Block
            // (la última vela contraria más cercana es la misma para ambos) —
            // sin este control se generaba la misma señal duplicada. Un OB ya
            // usado (o ya descartado por esta vía) no se vuelve a operar.
            if (usedObIndex.has(obIdx)) { pendingSweeps.splice(p, 1); continue }

            // ── 3. FVG obligatorio: sin inbalance de 3 velas, se anula la configuración ──
            if (!hasFvgInRange(candles, obIdx, i, isBull)) { pendingSweeps.splice(p, 1); continue }

            // ── 4. Entrada, Stop Loss y Take Profit ──
            const ob = candles[obIdx]
            const entry = ob.open // orden límite exactamente en la apertura del OB
            const pip = pipSize(entry)
            const atrBuffer = (atr[obIdx] ?? 0) * ATR_SL_MULTIPLIER
            const buffer = Math.max(SL_BUFFER_PIPS * pip, atrBuffer) // 4 pips o el colchón de ATR, el que dé más respiro
            const sl = isBull ? ob.low - buffer : ob.high + buffer

            // TP = siguiente Swing High/Low relevante (liquidez opuesta) YA
            // CONOCIDO al momento del CHoCH — no se mira hacia adelante en el
            // historial (eso sería repintar). Si ese nivel ya quedó atrás del
            // precio (no hay liquidez opuesta pendiente todavía), se descarta.
            const targetRef = isBull ? lastSwingHigh : lastSwingLow
            const targetAhead = targetRef && (isBull ? targetRef.price > entry : targetRef.price < entry)
            if (!targetAhead) { pendingSweeps.splice(p, 1); continue }
            const tp = targetRef.price

            const risk = Math.abs(entry - sl)
            const reward = Math.abs(tp - entry)
            if (risk <= 0) { pendingSweeps.splice(p, 1); continue }
            const rr = reward / risk
            if (rr < MIN_RR) { pendingSweeps.splice(p, 1); continue } // ratio mínimo 1:3

            // Orden límite: el precio debe REGRESAR a tocar la apertura del OB
            // después del CHoCH (ya se movió lejos para romper estructura) —
            // si nunca regresa dentro de la ventana de espera, no se ejecuta.
            let fillIdx = -1
            for (let f = i; f < candles.length && f <= i + chochToFillCandles; f++) {
                const fc = candles[f]
                if (fc.low <= entry && fc.high >= entry) { fillIdx = f; break }
            }
            if (fillIdx === -1) { pendingSweeps.splice(p, 1); continue }

            usedChochIndex.add(i)
            usedObIndex.add(obIdx)
            pendingSweeps.splice(p, 1) // consumido, ya generó (o se descartó) una señal

            let outcome = 'open', exitIdx = null, exitPrice = null
            for (let j = fillIdx; j < candles.length; j++) {
                const jc = candles[j]
                const hitSl = isBull ? jc.low <= sl   : jc.high >= sl
                const hitTp = isBull ? jc.high >= tp  : jc.low <= tp
                if (hitSl) { outcome = 'loss'; exitIdx = j; exitPrice = sl; break }
                if (hitTp) { outcome = 'win';  exitIdx = j; exitPrice = tp; break }
            }
            const pct = outcome === 'open' ? null
                : isBull ? (exitPrice - entry) / entry : (entry - exitPrice) / entry

            trades.push({
                type: isBull ? 'bullish_ob' : 'bearish_ob',
                isBull, entry, sl, tp1: tp, rr,
                entryTime: candles[fillIdx].openTime,
                exitTime: exitIdx != null ? candles[exitIdx].openTime : null,
                outcome, pct,
            })
        }
    }

    return trades.sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0))
}
