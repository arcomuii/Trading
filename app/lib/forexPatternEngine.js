// ─── Motor de detección de patrones para backtesting-forex ────────────────
// Copia deliberada de app/lib/backtestPatternEngine.js (que a su vez es
// copia de la lógica pura de app/patrones-1h/page.jsx) — NO un refactor a
// módulo común. backtestPatternEngine.js es compartido por
// app/backtest-historico y no se toca; esta es la versión EXCLUSIVA de
// app/backtesting-forex, con la ÚNICA diferencia real frente a esa copia:
// el colchón de Stop Loss (ver `calcLevels` más abajo) está recalibrado
// para la volatilidad real de forex en vez de la de cripto (Binance), que
// es con la que se calibró originalmente backtestPatternEngine.js.
//
// Por qué hacía falta recalibrar (pedido del usuario tras probar la
// estrategia sin cambios: "esta estrategia no está funcionando"):
// verificado con datos reales de Capital.com (6 pares mayores de forex, 1H/
// 4H/1D, hasta 5 años) que con el colchón de SL original (piso de 1.5% del
// precio, techo de 3.5%) la estrategia NUNCA genera señales en 1H/4H y solo
// 1 de 6 pares en 1D — el patrón sí se detecta (miles de ventanas con
// patrón en 1H/4H), pero la recompensa proyectada (alto del canal del
// patrón) en forex es casi siempre MÁS ANGOSTA que ese piso de 1.5%
// calibrado para los movimientos porcentuales mucho más amplios de cripto,
// así que el riesgo (dominado por el piso) siempre superaba la recompensa —
// ni relajando el R:R mínimo a 1:1 se rescataba ninguna señal en 1H/4H.
// Bajar el piso/techo del colchón a algo acorde al ATR real de forex
// (~0.25%-0.4% en 1H, ~0.3%-0.9% en 4H, ~0.6%-1.4% en 1D, percentiles
// 10-90 medidos sobre esos mismos 6 pares/5 años) deja que el ATR real
// domine el cálculo (la intención original del ATR-adaptativo, que el piso
// fijo de cripto anulaba en la práctica para forex) sin cambiar NADA de la
// detección de patrones ni del resto del checklist de entrada.
//
// El resto de la calibración (FLAT/SLOPE, compression≥0.28, quality≥0.40,
// daysToApex objetivo por escala, R:R mínimo 2) se deja IGUAL que
// backtestPatternEngine.js — verificado con los mismos datos reales que SÍ
// deja pasar señales razonables en 1D (6 de 1092 ventanas con patrón, en
// los 6 pares/5 años, con daysToApex agrupado alrededor de 5 — coincide con
// el target ya calibrado para escala 24, así que no hizo falta tocarlo).
//
// Ver notas de escala/ventanas en backtestPatternEngine.js — aplican igual
// aquí, sin cambios (`scale` = cuántas velas de 1H cubre una vela de este
// intervalo; 1/4/24 para 1H/4H/1D, las únicas escalas calibradas/validadas).
function windowScale(scale) {
    return scale === 24 ? 1 : scale;
}

// ─── Linear Regression ────────────────────────────────────────────────────────
function linReg(values) {
    const n = values.length;
    if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0, predict: () => values[0] ?? 0 };
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sx2 += i * i; }
    const ax = sx / n, ay = sy / n;
    const d  = sx2 - n * ax * ax;
    if (!d) return { slope: 0, intercept: ay, r2: 0, predict: () => ay };
    const slope = (sxy - n * ax * ay) / d;
    const intc  = ay - slope * ax;
    const ssTot = values.reduce((a, v) => a + (v - ay) ** 2, 0);
    const ssRes = values.reduce((a, v, i) => a + (v - (slope * i + intc)) ** 2, 0);
    const r2    = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
    return { slope, intercept: intc, r2, predict: x => slope * x + intc };
}

// ─── Average True Range ─────────────────────────────────────────────────────
function computeATR(candles) {
    if (candles.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < candles.length; i++) {
        const c = candles[i], p = candles[i - 1];
        const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        sum += tr;
    }
    return sum / (candles.length - 1);
}

// ─── Liquidity Sweep Detection ─────────────────────────────────────────────────
function detectLiquiditySweep(candles, lookback = 8, wickMargin = 0.0015) {
    let sweptLow = false, sweptHigh = false;
    for (let i = 1; i < candles.length - 1; i++) {
        const c = candles[i];
        const isSwingLow  = c.low  < candles[i - 1].low  && c.low  < candles[i + 1].low;
        const isSwingHigh = c.high > candles[i - 1].high && c.high > candles[i + 1].high;
        if (!isSwingLow && !isSwingHigh) continue;

        const future = candles.slice(i + 1, i + 1 + lookback);
        if (isSwingLow && !sweptLow) {
            sweptLow = future.some(f => f.low < c.low * (1 - wickMargin) && f.close > c.low);
        }
        if (isSwingHigh && !sweptHigh) {
            sweptHigh = future.some(f => f.high > c.high * (1 + wickMargin) && f.close < c.high);
        }
    }
    return { sweptLow, sweptHigh };
}

// ─── Pattern Detection (idéntico a backtestPatternEngine.js) ──────────────────
function detectPattern(candles, scale = 4) {
    const ws = windowScale(scale);
    const CONSOL = 60 / ws, POLE = 20 / ws;
    if (candles.length < CONSOL + POLE) return null;

    const consolSlice = candles.slice(-CONSOL);
    const poleSlice   = candles.slice(-(CONSOL + POLE), -CONSOL);

    const highs  = consolSlice.map(c => c.high);
    const lows   = consolSlice.map(c => c.low);
    const closes = consolSlice.map(c => c.close);

    const hReg = linReg(highs);
    const lReg = linReg(lows);

    const avgPrice = closes.reduce((a, b) => a + b) / CONSOL;
    if (!avgPrice) return null;

    const normH = (hReg.slope / avgPrice) * 100;
    const normL = (lReg.slope / avgPrice) * 100;

    const hStart = hReg.predict(0),        hEnd = hReg.predict(CONSOL - 1);
    const lStart = lReg.predict(0),        lEnd = lReg.predict(CONSOL - 1);
    const bandStart = hStart - lStart;
    const bandEnd   = Math.max(hEnd - lEnd, 0);

    if (bandStart <= 0) return null;
    const compression = (bandStart - bandEnd) / bandStart;

    const curPrice    = closes[closes.length - 1];
    const bandWidth   = hEnd - lEnd;
    const pricePos    = bandWidth > 0 ? Math.max(0, Math.min(1, (curPrice - lEnd) / bandWidth)) : 0.5;

    const quality = (hReg.r2 + lReg.r2) / 2;

    const FLAT  = 0.008;
    const SLOPE = 0.015;

    const hFlat = Math.abs(normH) <= FLAT;
    const hDown = normH < -SLOPE;
    const hUp   = normH > SLOPE;
    const lFlat = Math.abs(normL) <= FLAT;
    const lDown = normL < -SLOPE;
    const lUp   = normL > SLOPE;

    const isConverging = compression >= 0.15;

    let hasPole = false, bullishPole = false, poleMovePct = 0;
    if (poleSlice.length >= 5) {
        const pH = Math.max(...poleSlice.map(c => c.high));
        const pL = Math.min(...poleSlice.map(c => c.low));
        poleMovePct = (pH - pL) / pL * 100;
        const pFirst = poleSlice[0].close;
        const pLast  = poleSlice[poleSlice.length - 1].close;
        hasPole     = poleMovePct > 6;
        bullishPole = pLast > pFirst;
    }

    const candleConvergence = (normL - normH) * avgPrice / 100;
    const daysToApex = isConverging && candleConvergence > 0 && bandEnd > 0
        ? Math.round(bandEnd / candleConvergence / 6)
        : null;

    const recSlice      = consolSlice.slice(-Math.max(1, Math.round(5 / ws)));
    const recCloses     = recSlice.map(c => c.close);
    const recLows       = recSlice.map(c => c.low);
    const recHighs      = recSlice.map(c => c.high);
    const aboveResCount = recCloses.filter(c => c > hEnd * 1.003).length;
    const belowSupCount = recCloses.filter(c => c < lEnd * 0.997).length;
    const retestBull    = recLows.some((l, i)  => l <= hEnd * 1.025 && recCloses[i] > hEnd * 1.001);
    const retestBear    = recHighs.some((h, i) => h >= lEnd * 0.975 && recCloses[i] < lEnd * 0.999);

    const { sweptLow, sweptHigh } = detectLiquiditySweep(consolSlice, 8 / ws);
    const atr = computeATR(consolSlice);

    const base = {
        compression, normH, normL, hR2: hReg.r2, lR2: lReg.r2,
        hEnd, lEnd, avgPrice, quality, pricePos,
        curPrice, poleMovePct: hasPole ? poleMovePct : null,
        daysToApex, atr,
        aboveResCount, belowSupCount, retestBull, retestBear,
        sweptLow, sweptHigh,
    };

    if (hasPole) {
        if (isConverging && Math.abs(normH) < 0.05 && Math.abs(normL) < 0.05) {
            return { ...base, type: bullishPole ? 'bullish_pennant' : 'bearish_pennant' };
        }
        const slopeDiff   = Math.abs(normH - normL);
        const sameDir     = (normH > 0) === (normL > 0);
        const smallSlopes = Math.abs(normH) < 0.04 && Math.abs(normL) < 0.04;
        if (slopeDiff < 0.025 && sameDir && smallSlopes) {
            const counterTrend = bullishPole ? (normH < 0 && normL < 0) : (normH > 0 && normL > 0);
            if (counterTrend) {
                return { ...base, type: bullishPole ? 'bullish_flag' : 'bearish_flag' };
            }
        }
    }

    if (isConverging) {
        if (hDown && lUp)                            return { ...base, type: 'symmetrical_triangle' };
        if (hFlat && lUp)                            return { ...base, type: 'ascending_triangle' };
        if (hDown && lFlat)                          return { ...base, type: 'descending_triangle' };
        if (hUp   && lUp   && normL > normH + 0.005) return { ...base, type: 'rising_wedge' };
        if (hDown && lDown && normH < normL - 0.005) return { ...base, type: 'falling_wedge' };
    }

    return null;
}

// ─── Cup and Handle Detection (idéntico a backtestPatternEngine.js) ───────────
function detectCupHandle(candles, scale = 4) {
    const ws = windowScale(scale);
    const CUP_LEN    = Math.round(90 / ws);
    const HANDLE_LEN = 20 / ws;
    const PRIOR_LEN  = 20 / ws;
    if (candles.length < CUP_LEN + HANDLE_LEN + PRIOR_LEN) return null;

    const priorSlice  = candles.slice(-(CUP_LEN + HANDLE_LEN + PRIOR_LEN), -(CUP_LEN + HANDLE_LEN));
    const cupSlice    = candles.slice(-(CUP_LEN + HANDLE_LEN), -HANDLE_LEN);
    const handleSlice = candles.slice(-HANDLE_LEN);

    const priorFirst = priorSlice[0].close;
    const priorLast  = priorSlice[priorSlice.length - 1].close;
    if (priorLast <= priorFirst * 1.05) return null;
    const priorHigh    = Math.max(...priorSlice.map(c => c.high));
    const priorLow     = Math.min(...priorSlice.map(c => c.low));
    const priorMovePct = (priorHigh - priorLow) / priorLow * 100;

    const t = Math.floor(CUP_LEN / 3);
    const leftThird  = cupSlice.slice(0, t);
    const midThird   = cupSlice.slice(t, 2 * t);
    const rightThird = cupSlice.slice(2 * t);

    const leftRim   = Math.max(...leftThird.map(c => c.high));
    const cupBottom = Math.min(...midThird.map(c => c.low));
    const rightRim  = Math.max(...rightThird.map(c => c.high));

    const rimAvg  = (leftRim + rightRim) / 2;
    const rimDiff = Math.abs(rightRim - leftRim) / rimAvg;
    if (rimDiff > 0.18) return null;

    const cupHeight   = rimAvg - cupBottom;
    if (cupHeight <= 0) return null;
    const cupDepthPct = cupHeight / rimAvg;
    if (cupDepthPct < 0.18 || cupDepthPct > 0.62) return null;

    const leftMin  = Math.min(...leftThird.map(c => c.low));
    const rightMin = Math.min(...rightThird.map(c => c.low));
    if (cupBottom >= leftMin || cupBottom >= rightMin) return null;

    const bottomZone    = cupBottom + cupHeight * 0.25;
    const bottomCandles = midThird.filter(c => c.low <= bottomZone).length;
    if (bottomCandles < 3) return null;

    const handleHigh  = Math.max(...handleSlice.map(c => c.high));
    const handleLow   = Math.min(...handleSlice.map(c => c.low));
    const handleDepth = rightRim - handleLow;
    if (handleDepth <= 0)                     return null;
    if (handleHigh > rightRim * 1.03)         return null;
    if (handleDepth > cupHeight * 0.45)       return null;
    if (handleLow < cupBottom)                return null;

    const recSlice      = handleSlice.slice(-Math.max(1, Math.round(5 / ws)));
    const recCloses     = recSlice.map(c => c.close);
    const recLows       = recSlice.map(c => c.low);
    const aboveResCount = recCloses.filter(c => c > rightRim * 1.003).length;
    const retestBull    = recLows.some((l, i) => l <= rightRim * 1.025 && recCloses[i] > rightRim * 1.001);

    const curPrice   = candles[candles.length - 1].close;
    const handleRange = Math.max(rightRim - handleLow, 0.0001);
    const pricePos    = Math.max(0, Math.min(1.5, (curPrice - handleLow) / handleRange));
    const symScore    = 1 - rimDiff / 0.18;
    const depthScore  = cupDepthPct >= 0.28 && cupDepthPct <= 0.52 ? 1.0 : 0.65;
    const quality     = symScore * 0.5 + depthScore * 0.5;
    const compression = 1 - (handleDepth / cupHeight);

    const { sweptLow, sweptHigh } = detectLiquiditySweep([...cupSlice, ...handleSlice], 8 / ws);
    const atr = computeATR([...cupSlice, ...handleSlice]);

    return {
        type: 'cup_handle',
        leftRim, rightRim, cupBottom, handleLow,
        cupHeight, cupDepthPct, handleDepth,
        hEnd: rightRim,
        lEnd: handleLow,
        curPrice, pricePos, compression, quality,
        daysToApex: null, atr,
        poleMovePct: priorMovePct,
        aboveResCount, belowSupCount: 0, retestBull, retestBear: false,
        normH: 0, normL: 0, hR2: quality, lR2: quality, avgPrice: rimAvg,
        sweptLow, sweptHigh,
    };
}

// ─── Pattern metadata (idéntico a backtestPatternEngine.js) ───────────────────
export const PATTERN_META = {
    cup_handle:           { label: "Taza y Asa",             cat: "cup",      bias: "bullish",  dir: "↑" },
    symmetrical_triangle: { label: "Triángulo Simétrico",    cat: "triangle", bias: "neutral",  dir: "→" },
    ascending_triangle:   { label: "Triángulo Ascendente",   cat: "triangle", bias: "bullish",  dir: "↑" },
    descending_triangle:  { label: "Triángulo Descendente",  cat: "triangle", bias: "bearish",  dir: "↓" },
    rising_wedge:         { label: "Cuña Ascendente",        cat: "wedge",    bias: "bearish",  dir: "↓" },
    falling_wedge:        { label: "Cuña Descendente",       cat: "wedge",    bias: "bullish",  dir: "↑" },
    bullish_flag:         { label: "Bandera Alcista",        cat: "flag",     bias: "bullish",  dir: "↑" },
    bearish_flag:         { label: "Bandera Bajista",        cat: "flag",     bias: "bearish",  dir: "↓" },
    bullish_pennant:      { label: "Banderín Alcista",       cat: "flag",     bias: "bullish",  dir: "↑" },
    bearish_pennant:      { label: "Banderín Bajista",       cat: "flag",     bias: "bearish",  dir: "↓" },
};

// ─── Entry checklist (idéntico a backtestPatternEngine.js) ─────────────────
export function getEntryConditionsOk(result) {
    if (result.type === 'cup_handle') {
        return [
            result.quality >= 0.55 && result.cupDepthPct >= 0.20,
            result.handleDepth <= result.cupHeight * 0.45,
            result.poleMovePct != null && result.poleMovePct >= 10,
            result.pricePos >= 0.55,
            result.curPrice > result.hEnd * 1.003,
            result.aboveResCount >= 2 || result.retestBull,
            !!result.sweptLow,
        ];
    }

    const meta   = PATTERN_META[result.type] ?? {};
    const isBull = meta.bias === "bullish";
    const isBear = meta.bias === "bearish";
    return [
        result.quality >= 0.40,
        result.compression >= 0.28,
        isBull ? result.pricePos >= 0.70
            : isBear ? result.pricePos <= 0.30
                     : Math.abs(result.pricePos - 0.5) >= 0.35,
        result.daysToApex !== null && result.daysToApex <= 10,
        isBull ? result.curPrice > result.hEnd * 1.003
            : isBear ? result.curPrice < result.lEnd * 0.997
                     : result.curPrice > result.hEnd * 1.003 || result.curPrice < result.lEnd * 0.997,
        isBull ? (result.aboveResCount >= 2 || result.retestBull)
            : isBear ? (result.belowSupCount >= 2 || result.retestBear)
                     : (result.aboveResCount >= 2 || result.retestBull ||
                        result.belowSupCount >= 2 || result.retestBear),
        isBull ? !!result.sweptLow
            : isBear ? !!result.sweptHigh
                     : !!(result.sweptLow || result.sweptHigh),
    ];
}

// ─── Niveles de entrada/SL/TP ───────────────────────────────────────────────
// Entry/TP1/TP2/TP3 son idénticos a backtestPatternEngine.js. El margen del
// SL más allá del canal es lo ÚNICO que cambia frente a esa copia (ver nota
// larga al inicio del archivo): en vez de un piso de 1.5% del precio / techo
// de 3.5% (calibrados con la volatilidad de cripto), forex usa un piso de
// 0.1% / techo de 1.5% — verificado contra datos reales de Capital.com (6
// pares mayores, 1H/4H/1D, hasta 5 años): con el piso de cripto, el margen
// de SL SIEMPRE dominaba sobre la recompensa proyectada (alto del canal) en
// forex, dejando el R:R por debajo de 1:1 en el 100% de los casos en 1H/4H;
// con este piso/techo más chico, el ATR real (mult. 1.5×, igual que antes)
// pasa a dominar el cálculo casi siempre — la intención original del
// colchón ATR-adaptativo, que el piso de cripto anulaba en la práctica aquí.
const ATR_SL_MULT = 1.5;
const SL_FLOOR_PCT = 0.001;  // 0.1% del precio — piso, evita colchón cero en calma extrema
const SL_CAP_PCT   = 0.015;  // 1.5% del precio — techo, evita colchón desproporcionado en un salto brusco de ATR

export function calcLevels(result) {
    const meta   = PATTERN_META[result.type] ?? {};
    const isBull = meta.bias === "bullish";
    const isBear = meta.bias === "bearish";
    if (!isBull && !isBear) return null;

    const channelH = result.hEnd - result.lEnd;
    if (channelH <= 0) return null;
    const patternH = channelH / Math.max(0.05, 1 - result.compression);

    const atr = result.atr ?? 0;
    const slBuffer = base => Math.min(Math.max(atr * ATR_SL_MULT, base * SL_FLOOR_PCT), base * SL_CAP_PCT);

    let entry, sl, tp2;

    if (result.type === 'cup_handle') {
        entry = result.hEnd * 1.003;
        sl    = result.lEnd - slBuffer(result.lEnd);
        tp2   = result.hEnd + (result.leftRim - result.cupBottom);
    } else if (isBull) {
        entry = result.hEnd * 1.003;
        sl    = result.lEnd - slBuffer(result.lEnd);
        tp2   = result.poleMovePct != null
            ? entry * (1 + result.poleMovePct / 100)
            : entry + patternH;
    } else {
        entry = result.lEnd * 0.997;
        sl    = result.hEnd + slBuffer(result.hEnd);
        tp2   = result.poleMovePct != null
            ? entry * (1 - result.poleMovePct / 100)
            : entry - patternH;
    }

    const fullMove = tp2 - entry;
    const tp1 = entry + fullMove * 0.5;
    const tp3 = entry + fullMove * 1.618;

    const risk = Math.abs(entry - sl);
    const rrOf = (tp) => risk > 0 ? Math.abs(tp - entry) / risk : 0;

    const curPrice  = result.curPrice;
    const extended  = curPrice != null && (isBull ? curPrice > entry * 1.01 : curPrice < entry * 0.99);

    return {
        entry, sl, tp1, tp2, tp3,
        rr1: rrOf(tp1), rr2: rrOf(tp2), rr3: rrOf(tp3),
        tp: tp2, rr: rrOf(tp2),
        isBull, extended,
    };
}

// Réplica de `evaluateWindow` de backtestPatternEngine.js (sin el fetch —
// recibe las velas ya descargadas).
export function evaluateWindow(candles, scale = 4) {
    if (!Array.isArray(candles) || candles.length < 80 / windowScale(scale)) return null;
    return detectCupHandle(candles, scale) ?? detectPattern(candles, scale);
}

// Mismo gate que backtestPatternEngine.js: TODAS las condiciones del
// checklist cumplidas y el precio sin extenderse (>1%) respecto a la entrada.
export function passesAllConditions(result, levels) {
    if (!result || !levels) return false;
    const conds = getEntryConditionsOk(result);
    const allOk = conds.every(Boolean);
    return allOk && !levels.extended;
}

// BACKTEST_APEX_DAYS_TARGET_BY_SCALE: se deja IGUAL que
// backtestPatternEngine.js — verificado con datos reales de forex (6 pares,
// 1D, 5 años) que las señales que sí pasan el checklist completo + R:R≥2 en
// forex tienen daysToApex agrupado alrededor de 5 (la moda, con 2 de 6
// señales), coincidiendo con el target ya calibrado para escala 24 — no
// hizo falta re-ajustarlo. 1H/4H (targets 10/2) en la práctica casi nunca
// llegan a generar una señal en forex de todos modos (el cuello de botella
// real es el R:R, no el ápice — ver nota de SL_FLOOR_PCT/SL_CAP_PCT arriba),
// así que se dejan en su valor original de backtestPatternEngine.js.
const BACKTEST_APEX_DAYS_TARGET_BY_SCALE = { 1: 10, 4: 2, 24: 5 };
const MIN_FAVORABLE_RR = 2; // verificado con datos reales de forex en 1D — R:R≥2 sí se alcanza (6 señales en 6 pares/5 años); 1H/4H casi nunca lo alcanzan, ver nota arriba.

// Exportado solo para mostrarlo en la UI.
export function apexDaysTarget(scale = 4) {
    return BACKTEST_APEX_DAYS_TARGET_BY_SCALE[scale] ?? Math.round(10 / scale);
}

// Cuántas velas cubre la ventana deslizante — línea base 200 velas de 1H,
// dividido ÷scale para cubrir el mismo lapso real con cualquier intervalo.
export function windowSize(scale = 4) {
    return 200 / windowScale(scale);
}

// Recorre el historial de un símbolo (velas ascendentes por tiempo, en el
// intervalo elegido) — mismo gate y simplificaciones que
// backtestPatternEngine.js#simulateSymbolTrades (ver ese archivo para el
// detalle completo de cada simplificación asumida). No calcula USDT aquí —
// devuelve `pct` (movimiento fraccional) sin capital ni apalancamiento
// aplicados; eso lo hace app/lib/forexCapital.js#applyVolumeCompounding una
// vez que se juntaron las operativas de todos los símbolos.
export function simulateSymbolTrades(candles, scale = 4) {
    const trades = [];
    const WINDOW = windowSize(scale);
    const apexTarget = apexDaysTarget(scale);
    let i = WINDOW;

    while (i < candles.length) {
        const window = candles.slice(i - WINDOW, i);
        const result = evaluateWindow(window, scale);
        const levels = result ? calcLevels(result) : null;

        const validSignal = passesAllConditions(result, levels)
            && result.daysToApex === apexTarget
            && levels.rr >= MIN_FAVORABLE_RR;

        if (!validSignal) { i += 1; continue; }

        const { isBull, entry, sl, tp1 } = levels;
        let outcome = 'open', exitIndex = null, exitPrice = null;

        for (let j = i; j < candles.length; j++) {
            const c = candles[j];
            const hitSl = isBull ? c.low <= sl   : c.high >= sl;
            const hitTp = isBull ? c.high >= tp1 : c.low <= tp1;
            if (hitSl) { outcome = 'loss'; exitIndex = j; exitPrice = sl;  break; }
            if (hitTp) { outcome = 'win';  exitIndex = j; exitPrice = tp1; break; }
        }

        const pct = outcome === 'open' ? null
            : isBull ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;

        trades.push({
            type: result.type,
            isBull,
            entry, sl, tp1,
            rr: levels.rr,
            daysToApex: result.daysToApex,
            entryTime: candles[i]?.openTime ?? null,
            exitTime:  exitIndex != null ? candles[exitIndex].openTime : null,
            outcome,
            pct,
        });

        i = outcome === 'open' ? candles.length : exitIndex + 1;
    }

    return trades;
}
