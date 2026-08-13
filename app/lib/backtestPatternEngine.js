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
// Incluye también, sin cambios de comportamiento, la rareza conocida de
// daysToApex: la conversión "/6" asume velas de 4H (24h/4h=6) pero este motor
// corre sobre velas de 1H — se deja igual a propósito para que "ápice a 10
// días" signifique exactamente lo mismo que en la página en vivo.

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
function detectPattern(candles) {
    const CONSOL = 60, POLE = 20;
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

    const recSlice      = consolSlice.slice(-5);
    const recCloses     = recSlice.map(c => c.close);
    const recLows       = recSlice.map(c => c.low);
    const recHighs      = recSlice.map(c => c.high);
    const aboveResCount = recCloses.filter(c => c > hEnd * 1.003).length;
    const belowSupCount = recCloses.filter(c => c < lEnd * 0.997).length;
    const retestBull    = recLows.some((l, i)  => l <= hEnd * 1.025 && recCloses[i] > hEnd * 1.001);
    const retestBear    = recHighs.some((h, i) => h >= lEnd * 0.975 && recCloses[i] < lEnd * 0.999);

    const { sweptLow, sweptHigh } = detectLiquiditySweep(consolSlice);

    const base = {
        compression, normH, normL, hR2: hReg.r2, lR2: lReg.r2,
        hEnd, lEnd, avgPrice, quality, pricePos,
        curPrice, poleMovePct: hasPole ? poleMovePct : null,
        daysToApex,
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
function detectCupHandle(candles) {
    const CUP_LEN    = 90;
    const HANDLE_LEN = 20;
    const PRIOR_LEN  = 20;
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

    const recSlice      = handleSlice.slice(-5);
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

    const { sweptLow, sweptHigh } = detectLiquiditySweep([...cupSlice, ...handleSlice]);

    return {
        type: 'cup_handle',
        leftRim, rightRim, cupBottom, handleLow,
        cupHeight, cupDepthPct, handleDepth,
        hEnd: rightRim,
        lEnd: handleLow,
        curPrice, pricePos, compression, quality,
        daysToApex: null,
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

// ─── Niveles de entrada/SL/TP (idéntico a patrones-1h/page.jsx) ───────────────
export function calcLevels(result) {
    const meta   = PATTERN_META[result.type] ?? {};
    const isBull = meta.bias === "bullish";
    const isBear = meta.bias === "bearish";
    if (!isBull && !isBear) return null;

    const channelH = result.hEnd - result.lEnd;
    if (channelH <= 0) return null;
    const patternH = channelH / Math.max(0.05, 1 - result.compression);

    let entry, sl, tp2;

    if (result.type === 'cup_handle') {
        entry = result.hEnd * 1.003;
        sl    = result.lEnd * 0.985;
        tp2   = result.hEnd + (result.leftRim - result.cupBottom);
    } else if (isBull) {
        entry = result.hEnd * 1.003;
        sl    = result.lEnd * 0.985;
        tp2   = result.poleMovePct != null
            ? entry * (1 + result.poleMovePct / 100)
            : entry + patternH;
    } else {
        entry = result.lEnd * 0.997;
        sl    = result.hEnd * 1.015;
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
// las velas ya descargadas). `candles` = últimas ventanas de hasta 200 velas 1H
// terminando en el punto que se quiere evaluar, con forma {high, low, close}.
export function evaluateWindow(candles) {
    if (!Array.isArray(candles) || candles.length < 80) return null;
    return detectCupHandle(candles) ?? detectPattern(candles);
}

// Mismo gate que runScan en patrones-1h/page.jsx: TODAS las condiciones del
// checklist cumplidas y el precio sin extenderse (>1%) respecto a la entrada.
export function passesAllConditions(result, levels) {
    if (!result || !levels) return false;
    const conds = getEntryConditionsOk(result);
    const allOk = conds.every(Boolean);
    return allOk && !levels.extended;
}

// Mismos umbrales que app/lib/autoTrade.js (BACKTEST_APEX_DAYS, isFavorableTp2)
// — se reproducen aquí en vez de importarlos porque autoTrade.js trae consigo
// funciones de auto-trade real (fetch a Bitunix) que no aplican al backtest.
const BACKTEST_APEX_DAYS_TARGET = 10;
const MIN_FAVORABLE_RR = 2;

const WINDOW = 200; // igual al `limit=200` que usa fetchPatterns en vivo

// Recorre el historial de un símbolo (velas 1H ascendentes por tiempo) igual
// que lo haría el scanner en vivo cada hora: ventana deslizante de las últimas
// 200 velas, mismo gate de "todas las condiciones" + ápice exactamente en 10
// días + TP2 favorable (R:R ≥ 2) — el mismo gate que dispara logBacktestEntry/
// tryAutoOpenPosition en patrones-1h/page.jsx.
//
// Simplificaciones deliberadas frente al mundo real:
// - La orden LIMIT se asume llenada exactamente en `entry`: la condición de
//   ruptura ya exige que el precio esté sobre/bajo ese nivel al momento de la
//   señal, así que en la práctica una orden LIMIT a ese precio se ejecuta de
//   inmediato (cruza el spread) — no se modela slippage.
// - Si una misma vela toca SL y TP1 a la vez, se cuenta como pérdida (empate
//   a favor del escenario conservador, no se puede saber cuál tocó primero
//   con datos OHLC de 1H).
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
export function simulateSymbolTrades(candles) {
    const trades = [];
    let i = WINDOW;

    while (i < candles.length) {
        const window = candles.slice(i - WINDOW, i);
        const result = evaluateWindow(window);
        const levels = result ? calcLevels(result) : null;

        const validSignal = passesAllConditions(result, levels)
            && result.daysToApex === BACKTEST_APEX_DAYS_TARGET
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
        } else if (trade.executed) {
            capitalInUse -= trade.assignedCapital;
            if (trade.pnlUsdt != null) capital += trade.pnlUsdt;
            trade.capitalAfter   = capital; // capital total justo después de cerrar esta operativa
            trade.availableAfter = capital - capitalInUse; // sube: se acaba de liberar el margen
        }
    }

    // Capital disponible AHORA (al final de todo el histórico procesado) =
    // equity total menos lo que sigue comprometido en operativas que nunca
    // cerraron dentro del rango descargado.
    const availableCapital = capital - capitalInUse;

    return { trades: enriched, finalCapital: capital, availableCapital };
}
