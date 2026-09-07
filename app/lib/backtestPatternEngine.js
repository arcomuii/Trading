// ─── Motor de detección de patrones para el backtest histórico ────────────────
// Copia deliberada (NO import compartido) de la lógica pura de detección y
// validación de app/patrones-1h/page.jsx (detectPattern, detectCupHandle,
// getEntryConditions, calcLevels, PATTERN_META, linReg, detectLiquiditySweep).
//
// Es una copia a propósito, no un refactor a módulo común: patrones-1h/page.jsx
// dispara operativas reales (auto-trade contra Bitunix con dinero real) y no se
// quiso tocar ese archivo para este backtest. Si en el futuro se ajusta la
// lógica de detección/validación en patrones-1h, hay que replicar el cambio
// aquí a mano para que el backtest siga siendo representativo.
//
// Este motor corría originalmente sobre velas de 1H (después, brevemente, sobre
// 5 minutos; ahora soporta 1H, 4H y 1D — ver app/lib/bitunixHistory.js y el
// selector de intervalo en app/backtest-historico/page.jsx). Todas las
// funciones reciben `scale` = cuántas "velas de 1H" cubre una vela de este
// intervalo (1 para 1H, la línea base original; 4 para 4H; 24 para 1D). Las
// ventanas expresadas en NÚMERO DE VELAS (CONSOL, POLE, lookback de sweep,
// recSlice, CUP_LEN, HANDLE_LEN, PRIOR_LEN, WINDOW) se dividen ÷windowScale(scale)
// — normalmente igual a `scale` — para seguir cubriendo el mismo lapso real de
// tiempo sin importar el intervalo elegido. Donde la división no da un número
// entero de velas (recSlice, CUP_LEN) se redondea. Con scale=1 todas estas
// ventanas dan exactamente los valores originales del motor 1H (60, 20, 8, 5,
// 90, 200...).
//
// EXCEPCIÓN para 1D (scale=24): dividir ÷24 deja CONSOL=2.5, POLE≈0.83 —
// menos de una vela, la regresión lineal sobre 2-3 puntos no significa nada.
// windowScale() hace una excepción explícita: para scale=24 el DIVISOR de
// ventanas es 1, no 24 — se usan los mismos conteos base que 1H (60/20/200/
// 8/5/90...) pero interpretados en DÍAS en vez de horas (consolidación ~2
// meses, pole ~3 semanas, ventana deslizante ~6.6 meses). Validado
// empíricamente con datos reales de Binance (BTC/ETH/SOL/DOGE/ADA, 5 años):
// escalando ÷24 dio CERO señales (checklist completo + R:R≥2) en los 5
// símbolos; sin escalar (÷1) dio 24 señales repartidas de forma razonable
// entre ápices 0-10. `scale` en sí (para daysToApex y BACKTEST_APEX_DAYS_
// TARGET_BY_SCALE) NO usa windowScale — sigue siendo el valor real (24).
//
// Sin cambios, y ya sin sentido literal como "días" en ningún intervalo: la
// conversión "/6" de daysToApex asumía velas de 4H (24h/4h=6) — se deja fija
// en /6 sin importar `scale` (igual que patrones-1h/page.jsx en vivo, que
// también corre sobre velas de 1H con este mismo "/6" sin ajustar) para que
// el filtro "ápice a N días" siga siendo el MISMO valor numérico que usa el
// gate en vivo. Los umbrales de pendiente FLAT/SLOPE tampoco se reescalan:
// son porcentajes de movimiento por vela calibrados a ojo sobre velas de 1H
// (verificado empíricamente que sigue produciendo señales razonables en 1D
// con las ventanas sin escalar — no se tocaron).
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
// Volatilidad reciente real del símbolo (no un % fijo) — usada por calcLevels
// para el margen del SL más allá del canal (ver ATR_SL_MULT). Cambio SOLO de
// este backtest (ver nota al inicio del archivo: es una copia deliberada, no
// afecta a patrones-1h/page.jsx en vivo).
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

// ─── Pattern Detection (idéntico a patrones-1h/page.jsx) ──────────────────────
function detectPattern(candles, scale = 4) {
    const ws = windowScale(scale);
    const CONSOL = 60 / ws, POLE = 20 / ws; // ÷windowScale: línea base 60/20 velas de 1H
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

// ─── Cup and Handle Detection (idéntico a patrones-1h/page.jsx) ───────────────
function detectCupHandle(candles, scale = 4) {
    const ws = windowScale(scale);
    const CUP_LEN    = Math.round(90 / ws); // línea base 90/20/20 velas de 1H
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

// ─── Pattern metadata (idéntico a patrones-1h/page.jsx) ───────────────────────
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

// ─── Entry checklist (idéntico a patrones-1h/page.jsx, sin las etiquetas de UI) ─
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
// Entry/TP1/TP2/TP3 son idénticos a patrones-1h/page.jsx. El margen del SL
// más allá del canal NO lo es — experimento SOLO de este backtest (ver nota
// al inicio del archivo: es una copia deliberada, esto no toca la versión en
// vivo): en vez de un 1.5% fijo, el margen se ensancha con el ATR real del
// símbolo (ATR_SL_MULT × ATR), para ver si reduce los "stops de ruido" que
// igual habrían llegado a TP1 — hipótesis detrás del win rate de 46.5% a 4H.
// Math.max contra el 1.5% de siempre: el SL nunca queda MÁS angosto que
// antes, solo igual o más ancho — así se aísla el efecto de ensanchar, sin
// mezclarlo con también achicar el SL en símbolos de baja volatilidad.
//
// ATR_SL_CAP_PCT: tope duro adicional. El ATR como % del precio crece con el
// tamaño de vela (verificado con datos reales de Bitunix — BTC/SOL/DOGE: en
// 4H el margen ATR queda en ~1.75%-3.2%, pero en 1D sube a ~3.6%-6.1%, hasta
// 4x el 1.5% original). Sin este tope, en 1D el riesgo por operación se
// dispara mucho más que en 4H/1H mientras TP2 no cambia, hundiendo el R:R y
// dejando pasar el filtro MIN_FAVORABLE_RR solo a las señales más extremas —
// causa muy probable de que el win rate a 1D (34%) haya quedado peor que a
// 4H. El tope aplica parejo a cualquier intervalo (no depende de `scale`).
const ATR_SL_MULT = 1.5;
const ATR_SL_CAP_PCT = 0.035;

export function calcLevels(result) {
    const meta   = PATTERN_META[result.type] ?? {};
    const isBull = meta.bias === "bullish";
    const isBear = meta.bias === "bearish";
    if (!isBull && !isBear) return null;

    const channelH = result.hEnd - result.lEnd;
    if (channelH <= 0) return null;
    const patternH = channelH / Math.max(0.05, 1 - result.compression);

    const atr = result.atr ?? 0;
    const slBuffer = base => Math.min(Math.max(atr * ATR_SL_MULT, base * 0.015), base * ATR_SL_CAP_PCT);

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

// Réplica pura de `fetchPatterns` de patrones-1h/page.jsx (sin el fetch — recibe
// las velas ya descargadas). `candles` = últimas ventanas de hasta WINDOW velas
// del intervalo elegido (200 velas de 1H equivalentes, ver windowSize) terminando
// en el punto que se quiere evaluar, con forma {high, low, close}.
export function evaluateWindow(candles, scale = 4) {
    if (!Array.isArray(candles) || candles.length < 80 / windowScale(scale)) return null;
    return detectCupHandle(candles, scale) ?? detectPattern(candles, scale);
}

// Mismo gate que runScan en patrones-1h/page.jsx: TODAS las condiciones del
// checklist cumplidas y el precio sin extenderse (>1%) respecto a la entrada.
export function passesAllConditions(result, levels) {
    if (!result || !levels) return false;
    const conds = getEntryConditionsOk(result);
    const allOk = conds.every(Boolean);
    return allOk && !levels.extended;
}

// BACKTEST_APEX_DAYS_TARGET replicaba, sin cambios, el mismo umbral que
// app/lib/autoTrade.js (BACKTEST_APEX_DAYS=[10]) mientras este motor corrió
// sobre velas de 1H (scale=1) — ahí sí tiene sentido usar el 10 literal, es
// justo la línea base original. Corriendo sobre velas de 4H (scale=4), con
// CONSOL/POLE escalados ÷4 daysToApex nunca supera ~6 en la práctica
// (verificado con datos reales de Binance — BTC/ETH/SOL/DOGE/ADA a 4H nunca
// superan 6), así que el 10 nunca se alcanza: se recalibró a mano a 2 (no
// 10/4=2.5 redondeado, que daría 3) porque en esa prueba fue el valor que dio
// más señales con RR≥2 en los 5 símbolos (25 vs 12 con target=3). Por eso es
// un mapa explícito por escala y no una fórmula — a diferencia de las demás
// ventanas (CONSOL, POLE, WINDOW...), este valor se ajustó empíricamente, no
// solo matemáticamente. Si se agrega soporte a otro intervalo, hay que
// correr esa misma prueba para ese scale en vez de asumir round(10/scale).
//
// scale=24 (1D) se calibró con la misma prueba: datos reales de Binance
// (BTC/ETH/SOL/DOGE/ADA, 5 años, velas 1D, ventanas SIN escalar — ver
// windowScale). daysToApex salió repartido de forma razonable entre 0 y 10
// (24 señales con checklist completo + R:R≥2 en total); el valor con más
// señales individualmente fue 5 (5 de 24), por encima de 2/4/9 (3 cada uno) —
// se eligió 5 por ser el máximo, mismo criterio que 4H, aunque con una
// muestra chica (24 señales en 5 años) la diferencia contra 2/4/9 no es
// gigante; si en el futuro se junta más historial vale la pena re-correr
// esta prueba con más señales para confirmar o ajustar.
const BACKTEST_APEX_DAYS_TARGET_BY_SCALE = { 1: 10, 4: 2, 24: 5 };
const MIN_FAVORABLE_RR = 2;

// Exportado solo para mostrarlo en la UI (app/backtest-historico/page.jsx) —
// la lógica real de simulateSymbolTrades ya lo resuelve por su cuenta.
export function apexDaysTarget(scale = 4) {
    return BACKTEST_APEX_DAYS_TARGET_BY_SCALE[scale] ?? Math.round(10 / scale);
}

// Cuántas velas cubre la ventana deslizante — línea base 200 velas de 1H,
// dividido ÷scale para cubrir el mismo lapso real con cualquier intervalo.
// Exportado para que backtest-historico/page.jsx pueda calcular cuántas
// velas mínimas necesita descargar por símbolo antes de poder evaluar nada.
export function windowSize(scale = 4) {
    return 200 / windowScale(scale);
}

// Recorre el historial de un símbolo (velas ascendentes por tiempo, en el
// intervalo elegido) igual que lo haría el scanner en vivo cada hora: ventana
// deslizante que cubre el mismo lapso real sin importar el intervalo (las
// últimas 200 velas de 1H equivalentes, ver windowSize), mismo gate de "todas
// las condiciones" + ápice exactamente en el target de esta escala + TP2
// favorable (R:R ≥ 2) — el mismo gate que dispara logBacktestEntry/
// tryAutoOpenPosition en patrones-1h/page.jsx.
//
// Simplificaciones deliberadas frente al mundo real:
// - La orden LIMIT se asume llenada exactamente en `entry`: la condición de
//   ruptura ya exige que el precio esté sobre/bajo ese nivel al momento de la
//   señal, así que en la práctica una orden LIMIT a ese precio se ejecuta de
//   inmediato (cruza el spread) — no se modela slippage.
// - Si una misma vela toca SL y TP1 a la vez, se cuenta como pérdida (empate
//   a favor del escenario conservador, no se puede saber cuál tocó primero
//   con datos OHLC de 4H).
// - Mientras una operativa está "abierta" en el backtest, no se buscan nuevas
//   señales en ese símbolo (igual que tryAutoOpenPosition, que no abre una
//   segunda posición si ya hay una activa en el mismo símbolo).
// - Si una operativa no toca ni SL ni TP1 antes de que se acabe el historial
//   descargado, queda con outcome 'open' (no cuenta como ganadora ni perdedora).
//
// No calcula USDT aquí — devuelve `pct` (movimiento fraccional) sin capital ni
// apalancamiento aplicados. El capital por operación es creciente (ver
// applyCapitalCompounding) y depende del orden cronológico GLOBAL de todas las
// operativas de todos los símbolos, así que ese cálculo se hace aparte, una
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

        // Salta todo el período "en posición" antes de seguir buscando la
        // siguiente señal en este mismo símbolo.
        i = outcome === 'open' ? candles.length : exitIndex + 1;
    }

    return trades;
}

// ─── Capital creciente + apalancamiento ────────────────────────────────────────
// El capital por operación arranca en `initialPerTradeCapital` y sube
// `perTradeStep` cada vez que el capital TOTAL (la cuenta completa, no una
// operación) sube `capitalStep` respecto al capital total inicial. El capital
// asignado a una operativa se fija al ABRIRSE (con el capital total que hay en
// ese momento) y el P&L se aplica al capital total al CERRARSE — así una
// operativa larga en un símbolo no "ve" las ganancias de operativas que
// abrieron después de ella.
//
// Además se respeta el capital DISPONIBLE: si al momento de abrir una señal ya
// hay operativas concurrentes (en otros símbolos) que tienen comprometido tanto
// margen que no queda suficiente capital libre para el monto que le tocaría a
// esta operativa, la señal NO se ejecuta (executed=false, skipReason=
// 'insufficient_capital') — se reporta igual (con el resultado que hubiera
// tenido, para referencia) pero no afecta el capital ni cuenta como
// ganadora/perdedora.
//
// Esto obliga a procesar TODAS las operativas de TODOS los símbolos juntas, en
// orden cronológico real (no por símbolo por separado), porque tanto el nivel
// de capital como el capital disponible dependen de qué más está pasando en
// cualquier símbolo al mismo tiempo.
//
// Simplificación: la detección por símbolo (simulateSymbolTrades) ya decidió
// de antemano cuándo busca la siguiente señal en ese símbolo asumiendo que la
// operativa anterior SÍ se tomó (salta su duración completa). Si en realidad
// se saltó por falta de capital, en teoría el símbolo habría seguido buscando
// otras señales durante ese período — eso no se re-simula aquí.
export function applyCapitalCompounding(allTrades, {
    leverage = 2,
    initialTotalCapital = 100,
    initialPerTradeCapital = 2,
    capitalStep = 20,
    perTradeStep = 1,
} = {}) {
    const perTradeCapitalFor = totalCapital => {
        const tiers = Math.max(0, Math.floor((totalCapital - initialTotalCapital) / capitalStep));
        return initialPerTradeCapital + tiers * perTradeStep;
    };

    // Un evento "open" y, si ya cerró, uno "close" por operativa — se procesan
    // en orden cronológico. Empate mismo timestamp: cierres antes que aperturas
    // (conservador: libera capital antes de exigirlo para una operativa nueva
    // que arranca en el mismo instante).
    const events = [];
    allTrades.forEach((trade, idx) => {
        events.push({ time: trade.entryTime, kind: 'open', idx });
        if (trade.exitTime != null) events.push({ time: trade.exitTime, kind: 'close', idx });
    });
    events.sort((a, b) => (a.time - b.time) || (a.kind === 'close' ? -1 : 1));

    const enriched = allTrades.map(t => ({
        ...t, executed: false, skipReason: null, assignedCapital: null, pnlUsdt: null,
        wouldNeedCapital: null, availableAtTime: null, capitalAfter: null, availableAfter: null,
    }));
    let capital      = initialTotalCapital; // equity total (solo se mueve al cerrar)
    let capitalInUse = 0;                   // margen comprometido en operativas abiertas ahora
    let concurrentOpen  = 0;                // operativas EJECUTADAS abiertas en este instante (no cuenta las saltadas por falta de capital)
    let maxConcurrentOpen = 0;              // el máximo visto en todo el recorrido

    for (const ev of events) {
        const trade = enriched[ev.idx];
        if (ev.kind === 'open') {
            const candidateCapital = perTradeCapitalFor(capital);
            const available = capital - capitalInUse;
            if (candidateCapital > available) {
                // Informativo aunque no se ejecute: cuánto le hubiera tocado y
                // cuánto había disponible realmente en ese momento.
                trade.skipReason      = 'insufficient_capital';
                trade.wouldNeedCapital = candidateCapital;
                trade.availableAtTime  = available;
                continue; // no se ejecuta: no compromete capital, no genera P&L
            }
            trade.executed       = true;
            trade.assignedCapital = candidateCapital;
            trade.pnlUsdt         = trade.pct != null ? trade.pct * candidateCapital * leverage : null;
            capitalInUse += candidateCapital;
            trade.availableAfter = capital - capitalInUse; // baja: se acaba de comprometer margen
            concurrentOpen += 1;
            if (concurrentOpen > maxConcurrentOpen) maxConcurrentOpen = concurrentOpen;
        } else if (trade.executed) {
            capitalInUse -= trade.assignedCapital;
            if (trade.pnlUsdt != null) capital += trade.pnlUsdt;
            trade.capitalAfter   = capital; // capital total justo después de cerrar esta operativa
            trade.availableAfter = capital - capitalInUse; // sube: se acaba de liberar el margen
            concurrentOpen -= 1;
        }
    }

    // Capital disponible AHORA (al final de todo el histórico procesado) =
    // equity total menos lo que sigue comprometido en operativas que nunca
    // cerraron dentro del rango descargado.
    const availableCapital = capital - capitalInUse;

    return { trades: enriched, finalCapital: capital, availableCapital, maxConcurrentOpen };
}
