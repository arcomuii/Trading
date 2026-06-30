'use client'
import { useState, useEffect, useRef } from "react";
import { ALLOWED_SYMBOLS } from "../../lib/allowedSymbols";

// ─── constants ────────────────────────────────────────────────────────────────
const GAP_MS       = 30_000;                  // 2 por minuto entre requests (4H candles)
const RETRY_DELAYS = [15_000, 30_000, 60_000]; // backoff en 429

// ─── Scheduler ────────────────────────────────────────────────────────────────
const SCAN_SLOTS = [2, 6, 10, 14, 18, 22]; // horas en punto
function msUntilNextSlot() {
    const now = new Date();
    for (const h of SCAN_SLOTS) {
        const d = new Date(now);
        d.setHours(h, 0, 0, 0);
        if (d > now) return d - now;
    }
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(SCAN_SLOTS[0], 0, 0, 0);
    return next - now;
}
function nextSlotTime() {
    const now = new Date();
    for (const h of SCAN_SLOTS) {
        const d = new Date(now);
        d.setHours(h, 0, 0, 0);
        if (d > now) return d;
    }
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(SCAN_SLOTS[0], 0, 0, 0);
    return next;
}

// ─── Firebase ─────────────────────────────────────────────────────────────────
const FB_CONFIG = {
    apiKey:            process.env.NEXT_PUBLIC_FB_API_KEY,
    authDomain:        process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
    projectId:         process.env.NEXT_PUBLIC_FB_PROJECT_ID,
    storageBucket:     process.env.NEXT_PUBLIC_FB_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FB_MESSAGING_SENDER_ID,
    appId:             process.env.NEXT_PUBLIC_FB_APP_ID,
};

// Solicita permiso de notificaciones al usuario
async function requestNotifPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted')  return true;
    if (Notification.permission === 'denied')   return false;
    return (await Notification.requestPermission()) === 'granted';
}

// Notificación del navegador — sin service worker, funciona siempre en primer plano
function sendSignalNotification(coin, direction) {
    if (typeof window === 'undefined' || !('Notification' in window)) {
        console.warn('[Notif] Notification API no disponible');
        return;
    }
    if (Notification.permission !== 'granted') {
        console.warn('[Notif] Permiso no concedido:', Notification.permission);
        return;
    }
    try {
        const n = new Notification(
            `${direction === 'LONG' ? '▲ LONG' : '▼ SHORT'} · ${coin.name}`,
            {
                body:     `${coin.symbol.toUpperCase()} — Señal confirmada de entrada en ${direction}`,
                icon:     coin.image || '/favicon.ico',
                tag:      `signal-${coin.id}`,
                renotify: true,
            }
        );
        console.log('[Notif] Enviada:', coin.symbol, direction);
        n.onerror = (e) => console.error('[Notif] Error:', e);
    } catch (e) {
        console.error('[Notif] Excepción:', e);
    }
}

// Envía email via API route (SMTP server-side)
async function sendSignalEmail(coin, direction, analysis) {
    try {
        const res = await fetch('/api/signal-email', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coinName:  coin.name,
                symbol:    coin.symbol.toUpperCase(),
                direction,
                price:     coin.current_price,
                adx:       analysis.adx,
                stochK:    analysis.stochK,
                stochZone: analysis.stochZone,
                trendDir:  analysis.trendDir,
                image:     coin.image,
            }),
        });
        const json = await res.json();
        if (!res.ok) console.error('[Email] Error del servidor:', json);
        else         console.log('[Email] Enviado:', coin.symbol, direction);
    } catch (e) {
        console.error('[Email] Excepción al llamar /api/signal-email:', e);
    }
}

// ─── formatters ───────────────────────────────────────────────────────────────
function fmt(n, dec = 2) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtBig(n) {
    if (!n) return "—";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
}

// ─── technical indicators ─────────────────────────────────────────────────────
function calcEMA(values, period) {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    let prev = values.slice(0, period).reduce((a, b) => a + b) / period;
    const result = new Array(period - 1).fill(null);
    result.push(prev);
    for (let i = period; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k);
        result.push(prev);
    }
    return result;
}

function calcBB(values, period = 20, mult = 2) {
    const result = [];
    for (let i = period - 1; i < values.length; i++) {
        const slice = values.slice(i - period + 1, i + 1);
        const mean  = slice.reduce((a, b) => a + b) / period;
        const sd    = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
        result.push({ upper: mean + mult * sd, lower: mean - mult * sd });
    }
    return result;
}

function calcATR(high, low, close, period = 14) {
    const tr = high.map((h, i) =>
        i === 0 ? h - low[i]
                : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))
    );
    let prev = tr.slice(0, period).reduce((a, b) => a + b) / period;
    const result = [prev];
    for (let i = period; i < tr.length; i++) {
        prev = (prev * (period - 1) + tr[i]) / period;
        result.push(prev);
    }
    return result;
}

function calcKC(high, low, close, maPeriod = 20, atrPeriod = 20, mult = 1.5) {
    const emaArr = calcEMA(close, maPeriod);
    const atrArr = calcATR(high, low, close, atrPeriod);
    const offset = Math.max(maPeriod, atrPeriod) - 1;
    const result = [];
    for (let i = offset; i < close.length; i++) {
        const e = emaArr[i];
        const a = atrArr[i - (atrPeriod - 1)];
        if (e == null || a == null) continue;
        result.push({ upper: e + mult * a, lower: e - mult * a });
    }
    return result;
}

function calcADX(high, low, close, period = 14) {
    const dmP = [], dmM = [], tr = [];
    for (let i = 1; i < high.length; i++) {
        const up = high[i] - high[i - 1];
        const dn = low[i - 1] - low[i];
        dmP.push(up > dn && up > 0 ? up : 0);
        dmM.push(dn > up && dn > 0 ? dn : 0);
        tr.push(Math.max(
            high[i] - low[i],
            Math.abs(high[i] - close[i - 1]),
            Math.abs(low[i] - close[i - 1])
        ));
    }
    const wilder = arr => {
        if (arr.length < period) return [];
        let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
        const res = [s];
        for (let i = period; i < arr.length; i++)
            res.push(res[res.length - 1] - res[res.length - 1] / period + arr[i]);
        return res;
    };
    const sTR = wilder(tr), sDMP = wilder(dmP), sDMM = wilder(dmM);
    const diP = sDMP.map((d, i) => sTR[i] ? d / sTR[i] * 100 : 0);
    const diM = sDMM.map((d, i) => sTR[i] ? d / sTR[i] * 100 : 0);
    const dx  = diP.map((d, i) => (d + diM[i]) ? Math.abs(d - diM[i]) / (d + diM[i]) * 100 : 0);
    return wilder(dx).map(v => parseFloat(v.toFixed(2)));
}

// Histograma del Squeeze Momentum (Lazybear):
//   val = linreg( close - avg( avg(highest(H,n), lowest(L,n)), sma(close,n) ), n, 0 )
//   Positivo = verde (impulso alcista), Negativo = rojo (impulso bajista)
function calcSqueezeMomentum(high, low, close, length = 20) {
    const n = close.length;

    // delta[i] = close[i] - avg( midpoint(i), sma(i) )
    const delta = new Array(n).fill(null);
    for (let i = length - 1; i < n; i++) {
        const hSlice   = high.slice(i - length + 1, i + 1);
        const lSlice   = low.slice(i - length + 1, i + 1);
        const cSlice   = close.slice(i - length + 1, i + 1);
        const highest  = Math.max(...hSlice);
        const lowest   = Math.min(...lSlice);
        const smaClose = cSlice.reduce((a, b) => a + b) / length;
        delta[i] = close[i] - ((highest + lowest) / 2 + smaClose) / 2;
    }

    // Necesitamos length bars de delta válidos → mínimo índice = 2*length-2
    if (n - 1 < 2 * length - 2) return null;

    const dSlice = delta.slice(n - length, n);
    if (dSlice.some(v => v === null)) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < length; j++) {
        sumX  += j;
        sumY  += dSlice[j];
        sumXY += j * dSlice[j];
        sumX2 += j * j;
    }
    const avgX  = sumX / length;
    const avgY  = sumY / length;
    const denom = sumX2 - length * avgX * avgX;
    if (denom === 0) return 0;
    const slope  = (sumXY - length * avgX * avgY) / denom;
    const interc = avgY - slope * avgX;
    return slope * (length - 1) + interc;
}

// Estocástico lento (14, 3, 3) — idéntico a TradingView:
//   Raw %K = (close - lowest_low(14)) / (highest_high(14) - lowest_low(14)) * 100
//   %K     = SMA(raw %K, 3)
//   %D     = SMA(%K, 3)
function calcStochastic(high, low, close, kPeriod = 14, kSmooth = 3, dSmooth = 3) {
    const rawK = [];
    for (let i = kPeriod - 1; i < close.length; i++) {
        const hSlice  = high.slice(i - kPeriod + 1, i + 1);
        const lSlice  = low.slice(i - kPeriod + 1, i + 1);
        const highest = Math.max(...hSlice);
        const lowest  = Math.min(...lSlice);
        rawK.push(highest === lowest ? 50 : (close[i] - lowest) / (highest - lowest) * 100);
    }
    const sma = (arr, len) => {
        const out = [];
        for (let i = len - 1; i < arr.length; i++)
            out.push(arr.slice(i - len + 1, i + 1).reduce((a, b) => a + b) / len);
        return out;
    };
    const stochK = sma(rawK, kSmooth);
    const stochD = sma(stochK, dSmooth);
    return {
        k: parseFloat((stochK[stochK.length - 1] ?? 50).toFixed(2)),
        d: parseFloat((stochD[stochD.length - 1] ?? 50).toFixed(2)),
    };
}

function analyzePosition(ohlcvData, ohlcvData1d = null) {
    if (ohlcvData.length < 50) return null;
    const close = ohlcvData.map(c => c.close);
    const high  = ohlcvData.map(c => c.high);
    const low   = ohlcvData.map(c => c.low);
    const n     = close.length;

    const emaPeriod = 50;
    const adxPeriod = n >= 28 ? 14 : n >= 20 ? 10 : 7;

    const emaArr  = calcEMA(close, emaPeriod);
    const bb      = calcBB(close, 20, 2);
    const kc      = calcKC(high, low, close, 20, 20, 1.5);
    const adxArr  = calcADX(high, low, close, adxPeriod);
    const stoch   = calcStochastic(high, low, close, 14, 3, 3);
    const momentum     = calcSqueezeMomentum(high, low, close, 20);
    // Barra anterior del momentum para detectar si el valle ya giró
    const momentumPrev = calcSqueezeMomentum(high.slice(0, n - 1), low.slice(0, n - 1), close.slice(0, n - 1), 20);

    const cur    = close[n - 1];
    const curEMA = emaArr[emaArr.length - 1];
    const curBB  = bb[bb.length - 1];
    const curKC  = kc[kc.length - 1];
    const curADX = adxArr[adxArr.length - 1];

    if (curEMA == null || curBB == null || curKC == null || curADX == null) return null;

    const ADX_LB    = 5;
    const adxPrev5  = adxArr.length > ADX_LB ? adxArr[adxArr.length - 1 - ADX_LB] : adxArr[0];
    const adxRising = curADX > adxPrev5 && (curADX - adxPrev5) >= 1.5;

    const isSqueezeOn   = curBB.upper <= curKC.upper && curBB.lower >= curKC.lower;
    const isTrendStrong = curADX > 25 && adxRising;
    const trendDir      = cur > curEMA ? "Alcista" : "Bajista";

    const stochZone = stoch.k >= 80 ? "Sobrecompra"
                    : stoch.k <= 20 ? "Sobrevendido"
                    : "Neutral";

    const sqzMomPos = momentum !== null && momentum > 0;
    const sqzMomNeg = momentum !== null && momentum < 0;

    // ─── Regla 1: Valle desarrollado del Squeeze Momentum ────────────────────
    // Valle rojo LONG: momentum negativo Y girando al alza (menos negativo que la barra previa)
    const redValleyDeveloped  = momentum !== null && momentumPrev !== null
                               && momentum < 0 && momentum > momentumPrev;
    // Valle verde SHORT: momentum positivo Y girando a la baja (menos positivo que la barra previa)
    const greenValleyDeveloped = momentum !== null && momentumPrev !== null
                                && momentum > 0 && momentum < momentumPrev;

    // ─── Regla 5: Cercanía al extremo de las últimas 50 velas ────────────────
    const recentHigh50 = Math.max(...high.slice(-50));
    const recentLow50  = Math.min(...low.slice(-50));
    const priceRange50 = recentHigh50 - recentLow50;
    // "Cerca" = precio dentro del 20% del rango desde el extremo
    const nearLow50  = priceRange50 > 0 && (cur - recentLow50)  / priceRange50 <= 0.20;
    const nearHigh50 = priceRange50 > 0 && (recentHigh50 - cur) / priceRange50 <= 0.20;

    // ─── Las 6 condiciones evaluadas independientemente por dirección ─────────
    const condConfirmLong  = stoch.k > stoch.d && adxRising; // K cruzó sobre D + ADX en ascenso
    const condConfirmShort = stoch.k < stoch.d && adxRising; // K cruzó bajo D + ADX en ascenso
    const longMet5 = [
        redValleyDeveloped,  // 1. Valle rojo desarrollado (momentum girando al alza)
        stoch.k <= 20,       // 2. Estocástico sobrevendido
        curADX > 25,         // 3. ADX fuerte
        cur > curEMA,        // 4. Precio sobre EMA50
        nearLow50,           // 5. Cerca del mínimo de las últimas 50 velas
        condConfirmLong,     // 6. Confirmación de entrada (K>D + ADX ascendente)
    ];
    const shortMet5 = [
        greenValleyDeveloped, // 1. Valle verde desarrollado (momentum girando a la baja)
        stoch.k >= 80,        // 2. Estocástico sobrecomprado
        curADX > 25,          // 3. ADX fuerte
        cur < curEMA,         // 4. Precio bajo EMA50
        nearHigh50,           // 5. Cerca del máximo de las últimas 50 velas
        condConfirmShort,     // 6. Confirmación de entrada (K<D + ADX ascendente)
    ];

    const longMet  = longMet5.filter(Boolean).length;
    const shortMet = shortMet5.filter(Boolean).length;

    const señalActiva = longMet === 6 || shortMet === 6;
    const nearSignal  = !señalActiva && (longMet >= 5 || shortMet >= 5);

    // Condiciones activas para la dirección dominante (EMA define LONG vs SHORT)
    const isLongDir = trendDir === "Alcista";
    const [condSqzMom, condStoch, condADX, condEMA, condExtreme, condConfirm] =
        isLongDir ? longMet5 : shortMet5;
    const condMet = isLongDir ? longMet : shortMet;

    // ── Estocástico 1D (informativo, no puntúa en la señal) ───────────────────
    let stoch1d = null;
    if (ohlcvData1d && ohlcvData1d.length >= 20) {
        const h1d = ohlcvData1d.map(c => c.high);
        const l1d = ohlcvData1d.map(c => c.low);
        const c1d = ohlcvData1d.map(c => c.close);
        stoch1d = calcStochastic(h1d, l1d, c1d, 14, 3, 3);
    }
    const stoch1DZone = stoch1d
        ? (stoch1d.k >= 80 ? "Sobrecompra" : stoch1d.k <= 20 ? "Sobrevendido" : "Neutral")
        : null;

    return {
        adx: curADX, adxRising, isSqueezeOn, isTrendStrong, trendDir, emaValue: curEMA,
        stochK: stoch.k, stochD: stoch.d, stochZone,
        stoch1DK: stoch1d?.k ?? null, stoch1DZone,
        momentum, momentumPrev, sqzMomPos, sqzMomNeg,
        redValleyDeveloped, greenValleyDeveloped,
        recentHigh50, recentLow50, nearLow50, nearHigh50,
        condSqzMom, condStoch, condADX, condEMA, condExtreme, condConfirm,
        condMet, longMet, shortMet,
        señalActiva, nearSignal,
        emaPeriod, adxPeriod, candles: n,
    };
}

// ─── fetch OHLC con reintentos ─────────────────────────────────────────────────
// CoinGecko OHLC: days=30 → 4H (~180 velas) · days=365 → 1D (~365 velas)
// Nota: con el tier gratuito, days<=90 sigue devolviendo velas 4H; days>=91 pasa a diarias.
async function fetchOHLC(coinId, attempt = 0) {
    const res4h = await fetch(
        `/api/coingecko/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=30`
    );
    if (res4h.status === 429) {
        if (attempt < RETRY_DELAYS.length) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
            return fetchOHLC(coinId, attempt + 1);
        }
        throw new Error("RATE_LIMIT");
    }
    if (!res4h.ok) throw new Error(`HTTP ${res4h.status}`);
    const raw4h = await res4h.json();
    if (!Array.isArray(raw4h) || raw4h.length < 50)
        throw new Error(`insufficient:${Array.isArray(raw4h) ? raw4h.length : 0}`);
    const data4h = raw4h.map(([, , high, low, close]) => ({ high, low, close }));

    // 1D candles — days=365 garantiza granularidad diaria en el tier gratuito
    // best-effort: si falla, condStochMultiTF queda false sin romper el scan
    let data1d = null;
    try {
        await new Promise(r => setTimeout(r, 1_200)); // pausa para evitar 429 consecutivo
        const res1d = await fetch(
            `/api/coingecko/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=365`
        );
        if (res1d.ok) {
            const raw1d = await res1d.json();
            if (Array.isArray(raw1d) && raw1d.length >= 20)
                data1d = raw1d.map(([, , high, low, close]) => ({ high, low, close }));
        }
    } catch { /* silencioso — condStochMultiTF quedará false */ }

    const result = analyzePosition(data4h, data1d);
    if (!result) throw new Error("indicators_failed");
    return result;
}

// Espera cancelable (respeta abortRef cada 100ms)
async function cancellableWait(ms, abortRef) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (abortRef.current) return;
        await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
    }
}

// ─── Entry / TP / SL para señales de momentum ────────────────────────────────
// Entry = precio actual (apertura de siguiente vela 4H)
// SL    = justo bajo/sobre el extremo de las últimas 50 velas
// TP    = extremo opuesto del rango de 50 velas
function calcProspectLevels(coin, analysis) {
    const price = coin.current_price;
    if (!price || !analysis.recentLow50 || !analysis.recentHigh50) return null;
    const isLong = analysis.trendDir === "Alcista";
    const range  = analysis.recentHigh50 - analysis.recentLow50;
    if (range <= 0) return null;

    let entry, sl, tp;
    if (isLong) {
        entry = price;
        sl    = analysis.recentLow50  * 0.985;
        tp    = analysis.recentHigh50;
    } else {
        entry = price;
        sl    = analysis.recentHigh50 * 1.015;
        tp    = analysis.recentLow50;
    }

    const risk   = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr     = risk > 0 ? reward / risk : 0;
    return { entry, sl, tp, rr, isLong };
}

// ─── SignalCard ────────────────────────────────────────────────────────────────
function SignalCard({ coin, analysis }) {
    const isLong = analysis.trendDir === "Alcista";
    const pct    = coin.price_change_percentage_24h;

    return (
        <div className={`rounded-2xl border-2 p-4 ring-2 ring-amber-200 dark:ring-amber-900 ${
            isLong
                ? "border-amber-400 dark:border-amber-500 bg-gradient-to-br from-green-50 dark:from-green-950/80 to-amber-50/60 dark:to-amber-950/20"
                : "border-amber-400 dark:border-amber-500 bg-gradient-to-br from-red-50 dark:from-red-950/80 to-amber-50/60 dark:to-amber-950/20"
        }`}>
            {/* Badge + % 24h */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold tracking-wide ${
                        isLong ? "bg-green-500 text-white" : "bg-red-500 text-white"
                    }`}>
                        {isLong ? "▲ LONG" : "▼ SHORT"}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-white">
                        ⭐ 6/6
                    </span>
                </div>
                {pct != null && (
                    <span className={`text-xs font-semibold ${pct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {pct >= 0 ? "+" : ""}{fmt(pct)}%
                    </span>
                )}
            </div>

            {/* Coin info */}
            <div className="flex items-center gap-3 mb-4">
                {coin.image && (
                    <img src={coin.image} alt={coin.name} className="w-9 h-9 rounded-full"
                         onError={e => e.target.style.display = "none"} />
                )}
                <div className="min-w-0">
                    <p className="font-bold text-gray-800 dark:text-slate-100 text-sm truncate leading-tight">{coin.name}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 uppercase font-semibold">{coin.symbol}</p>
                </div>
                <div className="ml-auto text-right shrink-0">
                    <p className="font-mono font-semibold text-gray-800 dark:text-slate-100 text-sm">
                        ${fmt(coin.current_price, coin.current_price < 1 ? 5 : 2)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{fmtBig(coin.market_cap)}</p>
                </div>
            </div>

            {/* Fuerza / ADX label */}
            <div className="flex items-center gap-1.5 mb-3">
                <span className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-semibold tracking-wide">Fuerza:</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    analysis.adx >= 35 ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300" :
                    analysis.adx >= 25 ? "bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300" :
                                         "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
                }`}>
                    ADX {fmt(analysis.adx, 1)} · {analysis.adx >= 35 ? "Muy fuerte ↑" : analysis.adx >= 25 ? "Fuerte ↑" : "Moderada"}
                </span>
            </div>

            {/* Indicators grid 2×3 — 5 condiciones */}
            <div className="grid grid-cols-2 gap-2">
                {/* ADX — Regla 3 */}
                <div className={`rounded-xl p-2.5 text-center border ${
                    analysis.condADX
                        ? "bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-800"
                        : "bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700"
                }`}>
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">ADX · Fuerza</p>
                    <p className={`text-sm font-bold ${analysis.condADX ? "text-indigo-600 dark:text-indigo-400" : analysis.adxRising ? "text-amber-500 dark:text-amber-400" : "text-gray-500 dark:text-slate-400"}`}>
                        {analysis.adx}
                    </p>
                    <p className="text-[9px] text-gray-400 dark:text-slate-500">
                        {analysis.condADX ? "↑ Fuerte >25" : analysis.adxRising ? "↑ Arrancando" : "Débil / Plano"}
                    </p>
                </div>
                {/* Valle Squeeze Momentum — Regla 1 */}
                <div className={`rounded-xl p-2.5 text-center border ${
                    analysis.condSqzMom
                        ? "bg-white dark:bg-slate-800 border-green-200 dark:border-green-800"
                        : "bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700"
                }`}>
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Valle SqzMom</p>
                    <p className={`text-sm font-bold ${
                        analysis.condSqzMom
                            ? (isLong ? "text-blue-600 dark:text-blue-400" : "text-orange-500 dark:text-orange-400")
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.condSqzMom
                            ? (isLong ? "▼→" : "▲→")
                            : (isLong ? (analysis.sqzMomNeg ? "▼" : "—") : (analysis.sqzMomPos ? "▲" : "—"))
                        }
                    </p>
                    <p className={`text-[9px] ${
                        analysis.condSqzMom
                            ? (isLong ? "text-blue-500 dark:text-blue-400" : "text-orange-500 dark:text-orange-400")
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.condSqzMom
                            ? (isLong ? "Valle rojo ✓" : "Valle verde ✓")
                            : (isLong
                                ? (analysis.sqzMomNeg ? "Rojo sin girar" : "Sin valle")
                                : (analysis.sqzMomPos ? "Verde sin girar" : "Sin valle"))
                        }
                    </p>
                </div>
                {/* EMA 50 — Regla 4 */}
                <div className="bg-white dark:bg-slate-800 rounded-xl p-2.5 text-center border border-gray-100 dark:border-slate-700">
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">
                        EMA {analysis.emaPeriod}
                    </p>
                    <p className={`text-sm font-bold ${isLong ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {isLong ? "▲" : "▼"} ${fmt(analysis.emaValue, analysis.emaValue != null && analysis.emaValue < 1 ? 5 : 2)}
                    </p>
                    <p className="text-[9px] text-gray-400 dark:text-slate-500">{isLong ? "Precio > EMA" : "Precio < EMA"}</p>
                </div>
                {/* Estocástico — Regla 2 */}
                <div className={`rounded-xl p-2.5 text-center border ${
                    analysis.condStoch
                        ? "bg-white dark:bg-slate-800 border-green-200 dark:border-green-800"
                        : "bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700"
                }`}>
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">
                        Estocástico
                    </p>
                    <p className={`text-sm font-bold ${
                        analysis.condStoch
                            ? (isLong ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400")
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {fmt(analysis.stochK, 1)}
                        {analysis.stoch1DK != null ? <span className="text-[9px] font-normal opacity-60"> / {fmt(analysis.stoch1DK, 1)}</span> : ""}
                    </p>
                    <p className={`text-[9px] ${
                        analysis.condStoch
                            ? (isLong ? "text-blue-500 dark:text-blue-400" : "text-orange-500 dark:text-orange-400")
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.stochZone}{analysis.stoch1DZone ? ` · ${analysis.stoch1DZone}` : ""}
                    </p>
                </div>
                {/* Extremo 50 velas — Regla 5 */}
                <div className={`rounded-xl p-2.5 text-center border ${
                    analysis.condExtreme
                        ? "bg-white dark:bg-slate-800 border-green-200 dark:border-green-800"
                        : "bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700"
                }`}>
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Extremo 50v</p>
                    <p className={`text-sm font-bold ${
                        analysis.condExtreme
                            ? (isLong ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400")
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.condExtreme ? "✓" : "✗"}
                    </p>
                    <p className={`text-[9px] ${
                        analysis.condExtreme
                            ? (isLong ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400")
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {isLong
                            ? `Mín $${fmt(analysis.recentLow50, analysis.recentLow50 < 1 ? 5 : 2)}`
                            : `Máx $${fmt(analysis.recentHigh50, analysis.recentHigh50 < 1 ? 5 : 2)}`
                        }
                    </p>
                </div>
                {/* Confirmación entrada — Regla 6 */}
                <div className={`rounded-xl p-2.5 text-center border ${
                    analysis.condConfirm
                        ? "bg-white dark:bg-slate-800 border-violet-200 dark:border-violet-800"
                        : "bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700"
                }`}>
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Confirmación</p>
                    <p className={`text-sm font-bold ${
                        analysis.condConfirm
                            ? "text-violet-600 dark:text-violet-400"
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.condConfirm ? (isLong ? "K>D ↑" : "K<D ↓") : "—"}
                    </p>
                    <p className={`text-[9px] ${
                        analysis.condConfirm
                            ? "text-violet-500 dark:text-violet-400"
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.condConfirm
                            ? "ADX ↑ ✓"
                            : (isLong ? "K<D o ADX plano" : "K>D o ADX plano")
                        }
                    </p>
                </div>
            </div>

            {/* Entry / TP / SL */}
            {(() => {
                const lv = calcProspectLevels(coin, analysis);
                if (!lv) return null;
                const dec = lv.entry < 1 ? 5 : lv.entry < 10 ? 4 : 2;
                const rrCls = lv.rr >= 2   ? "text-green-600 dark:text-green-400"
                            : lv.rr >= 1.2 ? "text-amber-500 dark:text-amber-400"
                                           : "text-red-500 dark:text-red-400";
                return (
                    <div className="mt-3">
                        <p className="text-[9px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">Niveles sugeridos</p>
                        <div className="grid grid-cols-3 gap-2 mb-1.5">
                            <div className="rounded-xl p-2 text-center border bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800">
                                <p className="text-[9px] font-semibold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide mb-0.5">Entrada</p>
                                <p className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 font-mono leading-tight">${fmt(lv.entry, dec)}</p>
                            </div>
                            <div className="rounded-xl p-2 text-center border bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800">
                                <p className="text-[9px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-0.5">TP</p>
                                <p className="text-[11px] font-bold text-green-700 dark:text-green-300 font-mono leading-tight">${fmt(lv.tp, dec)}</p>
                            </div>
                            <div className="rounded-xl p-2 text-center border bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800">
                                <p className="text-[9px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide mb-0.5">SL</p>
                                <p className="text-[11px] font-bold text-red-700 dark:text-red-300 font-mono leading-tight">${fmt(lv.sl, dec)}</p>
                            </div>
                        </div>
                        <p className={`text-[9px] font-bold text-center ${rrCls}`}>
                            R:R 1:{fmt(lv.rr, 1)}
                            {lv.rr >= 2 ? " · Favorable" : lv.rr >= 1.2 ? " · Aceptable" : " · Bajo"}
                        </p>
                    </div>
                );
            })()}

            {/* Confirmation strip */}
            <div className="mt-3">
                <div className="flex gap-1 mb-1.5">
                    {[0,1,2,3,4,5].map(i => (
                        <span key={i} className="flex-1 h-1 rounded-full bg-green-400 dark:bg-green-500" />
                    ))}
                </div>
                <p className={`text-[10px] font-semibold ${isLong ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                    ✓ Las 6 condiciones cumplidas — Entrar en apertura de vela 4H
                </p>
            </div>

            {/* Links */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
                <a href={`https://www.bitunix.com/es-es/contract-trade/${coin.symbol.toUpperCase()}USDT`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex-1 text-center text-[11px] font-semibold py-1.5 rounded-lg
                              bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400
                              hover:bg-green-100 dark:hover:bg-green-900 transition-colors">
                    Ver en Bitunix
                </a>
                <a href={`https://es.tradingview.com/chart/tXjDAvNO/?symbol=BITUNIX%3A${coin.symbol.toUpperCase()}USDT.P`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex-1 text-center text-[11px] font-semibold py-1.5 rounded-lg
                              bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400
                              hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors">
                    Ver en TradingView
                </a>
            </div>
        </div>
    );
}

// ─── NearCard ─────────────────────────────────────────────────────────────────
// Riesgo adicional estimado cuando falta cada condición
const COND_RISK = [
    { key: "condSqzMom",  pct: 40 }, // señal principal de momentum
    { key: "condEMA",     pct: 35 }, // filtro de tendencia
    { key: "condADX",     pct: 25 }, // fuerza de tendencia
    { key: "condConfirm", pct: 30 }, // confirmación K>D + ADX
    { key: "condStoch",   pct: 20 }, // timing de entrada
    { key: "condExtreme", pct: 15 }, // posición en el rango
];
const BASE_FAIL = 15; // tasa de fallo base con las 6 condiciones

function NearCard({ coin, analysis }) {
    const isLong = analysis.trendDir === "Alcista";
    const sym    = coin.symbol.toUpperCase();
    const conds  = [
        { label: isLong ? "Valle rojo desarrollado" : "Valle verde desarrollado", ok: analysis.condSqzMom,  key: "condSqzMom"  },
        { label: isLong ? "Estoc. sobrevendido <20" : "Estoc. sobrecomprado >80", ok: analysis.condStoch,   key: "condStoch"   },
        { label: "ADX fuerte (>25)",                                               ok: analysis.condADX,     key: "condADX"     },
        { label: isLong ? "Precio > EMA50" : "Precio < EMA50",                    ok: analysis.condEMA,     key: "condEMA"     },
        { label: isLong ? "Cerca mínimo 50v" : "Cerca máximo 50v",                ok: analysis.condExtreme, key: "condExtreme" },
        { label: isLong ? "K>D + ADX ascendente" : "K<D + ADX ascendente",        ok: analysis.condConfirm, key: "condConfirm" },
    ];
    const missing    = conds.filter(c => !c.ok);
    const failPct    = Math.min(95, BASE_FAIL + missing.reduce((acc, c) => {
        const r = COND_RISK.find(r => r.key === c.key);
        return acc + (r?.pct ?? 20);
    }, 0));
    const failColor  = failPct >= 60
        ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
        : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800";

    return (
        <div className="flex flex-col gap-2.5 bg-white dark:bg-slate-900 rounded-xl
                        border border-gray-100 dark:border-slate-800 p-3 hover:border-indigo-200
                        dark:hover:border-indigo-800 transition-colors">

            <div className="flex items-center justify-between gap-2">
                {/* Image + Name + direction */}
                <div className="flex items-center gap-2 min-w-0">
                    {coin.image
                        ? <img src={coin.image} alt={sym} className="w-7 h-7 rounded-full flex-shrink-0"
                            onError={e => e.target.style.display='none'} />
                        : <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-slate-700 flex-shrink-0" />
                    }
                    <span className="font-bold text-gray-800 dark:text-slate-100 text-xs truncate">{sym}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        isLong ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400"
                               : "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400"
                    }`}>
                        {isLong ? "▲ L" : "▼ S"}
                    </span>
                </div>

                {/* ADX + Links */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400">
                        {fmt(analysis.adx, 1)}
                    </span>
                    <a href={`https://www.bitunix.com/es-es/contract-trade/${sym}USDT`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-[9px] font-semibold px-1.5 py-0.5 rounded
                                  bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 hover:opacity-80">
                        BX
                    </a>
                    <a href={`https://es.tradingview.com/chart/tXjDAvNO/?symbol=BITUNIX%3A${sym}USDT.P`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-[9px] font-semibold px-1.5 py-0.5 rounded
                                  bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:opacity-80">
                        TV
                    </a>
                </div>
            </div>

            {/* Progress bar + missing condition */}
            <div>
                <div className="flex gap-1 mb-1">
                    {conds.map((c, i) => (
                        <span key={i} title={c.label}
                              className={`flex-1 h-1 rounded-full ${c.ok ? "bg-green-400 dark:bg-green-500" : "bg-amber-300 dark:bg-amber-600"}`}
                        />
                    ))}
                </div>
                {missing.length > 0 ? (
                    <>
                        <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-snug">
                            <span className="font-semibold">Falta: </span>
                            {missing.map(c => c.label).join(" · ")}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                            <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${failColor}`}>
                                ⚠ ~{failPct}% fallo
                            </span>
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                                ✓ ~{100 - failPct}% éxito
                            </span>
                        </div>
                    </>
                ) : (
                    <p className="text-[9px] font-semibold text-green-600 dark:text-green-400">
                        ✓ Listo para entrada
                    </p>
                )}
            </div>
        </div>
    );
}

// ─── ProspectosPage ───────────────────────────────────────────────────────────
export default function ProspectosPage() {
    const [bitunixSymbols, setBitunixSymbols] = useState(null);   // null = cargando
    const [bitunixCount,   setBitunixCount]   = useState(0);
    const [coins,          setCoins]          = useState([]);
    const [loadingCoins,   setLoadingCoins]   = useState(true);
    const [analysisCache,  setAnalysisCache]  = useState({});
    const [progress,       setProgress]       = useState({ done: 0, total: 0 });
    const [scanRunning,    setScanRunning]     = useState(false);
    const [lastScan,       setLastScan]        = useState(null);
    const [nextScanAt,     setNextScanAt]      = useState(null);
    const [currentCoin,    setCurrentCoin]    = useState(null);
    const abortRef    = useRef(false);
    const notifiedRef = useRef(new Set()); // IDs notificados en el ciclo actual
    const [notifPerm,     setNotifPerm]     = useState('default'); // 'granted' | 'denied' | 'default'
    const [showCoverage,  setShowCoverage]  = useState(false);

    // 0. Pedir permiso de notificaciones al cargar
    useEffect(() => {
        requestNotifPermission().then(() => {
            if ('Notification' in window) setNotifPerm(Notification.permission);
        });
    }, []);

    // 1. Cargar símbolos disponibles en Bitunix
    useEffect(() => {
        fetch("/api/bitunix/api/v1/futures/market/tickers")
            .then(r => r.json())
            .then(json => {
                const list = Array.isArray(json?.data)   ? json.data   :
                             Array.isArray(json?.result) ? json.result :
                             Array.isArray(json)         ? json        : [];
                const symbols = new Set();
                list.forEach(c => {
                    const raw = (c.baseCoin ?? c.symbol?.replace(/USDT$|USDC$|BUSD$|PERP$/i, '') ?? '').toUpperCase();
                    if (!raw) return;
                    if (!ALLOWED_SYMBOLS.has(raw)) return;
                    symbols.add(raw);
                    // Bitunix usa prefijos "1000X" para micro-cap (ej. 1000PEPE → PEPE)
                    const stripped = raw.replace(/^1000/, '');
                    if (stripped !== raw) symbols.add(stripped);
                });
                setBitunixCount(symbols.size); // símbolos únicos, no tickers brutos
                if (symbols.size === 0) throw new Error('empty');
                setBitunixSymbols(symbols);
            })
            .catch(() => setBitunixSymbols(new Set())); // error → no filtra
    }, []);

    // 2. Cargar mercados de CoinGecko, filtrar por Bitunix
    useEffect(() => {
        if (bitunixSymbols === null) return;

        const load = async () => {
            setLoadingCoins(true);
            try {
                const mktBase = "/api/coingecko/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&price_change_percentage=24h&page=";

                // ── Fase 1: top 750 por market cap ───────────────────────────
                const pages = await Promise.all(
                    [1, 2, 3].map(p => fetch(mktBase + p).then(r => r.json()))
                );
                const top750 = pages.flat().filter(c => c?.id);

                let matched       = bitunixSymbols.size > 0
                    ? top750.filter(c => bitunixSymbols.has(c.symbol.toUpperCase()))
                    : top750;
                const matchedSyms = new Set(matched.map(c => c.symbol.toUpperCase()));

                // ── Fase 2: /coins/list para los símbolos no encontrados ──────
                if (bitunixSymbols.size > 0) {
                    const missing = [...bitunixSymbols].filter(s => !matchedSyms.has(s));

                    if (missing.length > 0) {
                        const missingSet = new Set(missing);
                        const listRes    = await fetch('/api/coingecko/api/v3/coins/list');
                        const allCoins   = await listRes.json();

                        // Primera coincidencia por símbolo (la más reconocida en CoinGecko)
                        const idMap = {};
                        if (Array.isArray(allCoins)) {
                            allCoins.forEach(c => {
                                const sym = c.symbol.toUpperCase();
                                if (missingSet.has(sym) && !idMap[sym]) idMap[sym] = c.id;
                            });
                        }

                        const extraIds = Object.values(idMap);
                        if (extraIds.length > 0) {
                            // Lotes de 100 IDs para no superar el límite de URL
                            for (let i = 0; i < extraIds.length; i += 100) {
                                const ids = extraIds.slice(i, i + 100).join(',');
                                const r   = await fetch(
                                    `/api/coingecko/api/v3/coins/markets?vs_currency=usd&ids=${ids}&per_page=100&order=market_cap_desc&price_change_percentage=24h`
                                );
                                const data = await r.json();
                                if (Array.isArray(data)) {
                                    data.forEach(c => {
                                        const sym = c.symbol.toUpperCase();
                                        if (bitunixSymbols.has(sym) && !matchedSyms.has(sym)) {
                                            matched.push(c);
                                            matchedSyms.add(sym);
                                        }
                                    });
                                }
                                // Pausa entre lotes para respetar rate limit
                                if (i + 100 < extraIds.length) {
                                    await new Promise(r => setTimeout(r, 1_200));
                                }
                            }
                        }
                    }
                }

                setCoins(matched);
            } catch (err) {
                console.error("CoinGecko error:", err);
            } finally {
                setLoadingCoins(false);
            }
        };
        load();
    }, [bitunixSymbols]);

    // Programar scan en el próximo slot al cargar
    useEffect(() => {
        if (coins.length === 0 || loadingCoins) return;
        const slot = nextSlotTime();
        setNextScanAt(slot);
        const timer = setTimeout(() => {
            setNextScanAt(null);
            runScan(coins, bitunixCount);
        }, msUntilNextSlot());
        return () => clearTimeout(timer);
    }, [coins]); // eslint-disable-line

    // Limpieza al desmontar
    useEffect(() => () => { abortRef.current = true; }, []);

    const runScan = async (coinsList, totalCount) => {
        abortRef.current = false;
        notifiedRef.current.clear();
        setAnalysisCache({});
        setProgress({ done: 0, total: coinsList.length });
        setScanRunning(true);
        setCurrentCoin(null);
        setLastScan(null);

        for (let i = 0; i < coinsList.length; i++) {
            if (abortRef.current) break;

            const coin = coinsList[i];
            setCurrentCoin(coin);
            setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: true } }));

            const ohlcUrl = `/api/coingecko/api/v3/coins/${coin.id}/ohlc?vs_currency=usd&days=30`;
            try {
                const data = await fetchOHLC(coin.id);
                if (!abortRef.current) {
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, data } }));

                    const signal = data.señalActiva
                        ? (data.trendDir === 'Alcista' ? 'LONG' : 'SHORT')
                        : null;

                    if (signal && !notifiedRef.current.has(coin.id)) {
                        notifiedRef.current.add(coin.id);
                        sendSignalNotification(coin, signal);
                        sendSignalEmail(coin, signal, data);
                    }
                }
            } catch (err) {
                if (!abortRef.current) {
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, error: err.message } }));
                }
            }

            if (!abortRef.current) {
                setProgress(prev => ({ ...prev, done: prev.done + 1 }));
            }

            // Esperar antes del siguiente (cancelable)
            if (i < coinsList.length - 1 && !abortRef.current) {
                await cancellableWait(GAP_MS, abortRef);
            }
        }

        if (!abortRef.current) {
            setCurrentCoin(null);
            setLastScan(new Date());
            const slot = nextSlotTime();
            setNextScanAt(slot);
            await cancellableWait(msUntilNextSlot(), abortRef);
            if (!abortRef.current) {
                setNextScanAt(null);
                runScan(coinsList, totalCount);
            }
        } else {
            setScanRunning(false);
        }
    };

    const restartScan = () => {
        abortRef.current = true;
        setTimeout(() => { if (coins.length > 0) runScan(coins, bitunixCount); }, 150);
    };

    // ─── señales confirmadas ──────────────────────────────────────────────────
    const longSignals = coins
        .filter(c => analysisCache[c.id]?.data?.señalActiva &&
                     analysisCache[c.id]?.data?.trendDir === "Alcista")
        .sort((a, b) => (analysisCache[b.id].data.adx || 0) - (analysisCache[a.id].data.adx || 0));

    const shortSignals = coins
        .filter(c => analysisCache[c.id]?.data?.señalActiva &&
                     analysisCache[c.id]?.data?.trendDir === "Bajista")
        .sort((a, b) => (analysisCache[b.id].data.adx || 0) - (analysisCache[a.id].data.adx || 0));

    const totalSignals = longSignals.length + shortSignals.length;

    const nearSignals = coins
        .filter(c => analysisCache[c.id]?.data?.nearSignal)
        .sort((a, b) => (analysisCache[b.id].data.adx || 0) - (analysisCache[a.id].data.adx || 0));

    // Cobertura Bitunix vs CoinGecko
    const matchedSymSet   = new Set(coins.map(c => c.symbol.toUpperCase()));
    const unmatchedSyms   = bitunixSymbols ? [...bitunixSymbols].filter(s => !matchedSymSet.has(s)).sort() : [];

    const pctDone   = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
    const minsLeft  = coins.length > 0 && progress.done < coins.length
        ? Math.ceil((coins.length - progress.done) * GAP_MS / 60_000)
        : 0;
    const initialLoad = bitunixSymbols === null || loadingCoins;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-6">
            <div className="max-w-6xl mx-auto">

                {/* ─── Header ─────────────────────────────────────────────── */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Prospectos Bitunix</h1>
                    <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">
                        Análisis técnico automático · Velas 4H · EMA-50 · ADX · Squeeze Momentum
                    </p>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {bitunixSymbols === null ? (
                            <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                                Cargando Bitunix…
                            </span>
                        ) : bitunixCount > 0 ? (
                            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-950 px-2.5 py-1 rounded-full">
                                ⚡ Bitunix · {bitunixCount} contratos
                            </span>
                        ) : (
                            <span className="text-xs text-orange-500 bg-orange-50 dark:bg-orange-950 px-2.5 py-1 rounded-full">
                                Bitunix no disponible · analizando top 500
                            </span>
                        )}
                        {loadingCoins && bitunixSymbols !== null && (
                            <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                                Cargando activos en CoinGecko…
                            </span>
                        )}
                        {!loadingCoins && coins.length > 0 && (
                            <span className="text-xs text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 px-2.5 py-1 rounded-full">
                                CoinGecko · {coins.length} de {bitunixCount} activos
                            </span>
                        )}
                        {lastScan && !scanRunning && (
                            <span className="text-xs text-gray-400 dark:text-slate-500">
                                Último scan: {lastScan.toLocaleTimeString("es-MX")}
                            </span>
                        )}
                        <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 px-2.5 py-1 rounded-full">
                            Próximo scan: {nextSlotTime().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                            onClick={restartScan}
                            disabled={initialLoad}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full
                                       bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800
                                       text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {scanRunning
                                ? <><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Reiniciando…</>
                                : <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Actualizar ahora</>
                            }
                        </button>
                    </div>
                </div>


                {/* ─── Cobertura Bitunix vs CoinGecko ─────────────────────── */}
                {!initialLoad && bitunixSymbols && bitunixSymbols.size > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 mb-6 overflow-hidden">
                        {/* Header togglable */}
                        <button
                            onClick={() => setShowCoverage(v => !v)}
                            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                                    Cobertura Bitunix / CoinGecko
                                </span>
                                <span className="text-xs bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-semibold">
                                    ✓ {coins.length} encontrados
                                </span>
                                <span className="text-xs bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full font-semibold">
                                    ✕ {unmatchedSyms.length} no encontrados
                                </span>
                            </div>
                            <span className="text-gray-400 dark:text-slate-500 text-sm ml-3">
                                {showCoverage ? "▲" : "▼"}
                            </span>
                        </button>

                        {showCoverage && (
                            <div className="border-t border-gray-100 dark:border-slate-800 grid grid-cols-2 divide-x divide-gray-100 dark:divide-slate-800">
                                {/* Encontrados */}
                                <div className="p-4">
                                    <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2 uppercase tracking-wide">
                                        Encontrados en CoinGecko ({coins.length})
                                    </p>
                                    <div className="overflow-auto max-h-60 flex flex-wrap gap-1">
                                        {coins.map(c => (
                                            <span key={c.id}
                                                  className="font-mono text-[10px] bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded border border-green-100 dark:border-green-900">
                                                {c.symbol.toUpperCase()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                {/* No encontrados */}
                                <div className="p-4">
                                    <p className="text-xs font-semibold text-orange-500 dark:text-orange-400 mb-2 uppercase tracking-wide">
                                        No encontrados en CoinGecko ({unmatchedSyms.length})
                                    </p>
                                    <div className="overflow-auto max-h-60 flex flex-wrap gap-1">
                                        {unmatchedSyms.map(sym => (
                                            <span key={sym}
                                                  className="font-mono text-[10px] bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-slate-700">
                                                {sym}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── Cargando inicial ────────────────────────────────────── */}
                {initialLoad && (
                    <div className="flex items-center justify-center h-40 text-gray-400 dark:text-slate-500 gap-3 text-sm">
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        Cargando lista de activos…
                    </div>
                )}

                {/* ─── Barra de progreso ───────────────────────────────────── */}
                {!initialLoad && progress.total > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 mb-6">
                        <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                                {scanRunning ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24"
                                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                        </svg>
                                        <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                                            Escaneando activos…
                                        </span>
                                        {currentCoin && (
                                            <span className="text-xs text-gray-400 dark:text-slate-500 font-mono">
                                                {currentCoin.symbol.toUpperCase()}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                                        ✓ Scan completado
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-slate-400">
                                    {progress.done} / {coins.length}
                                </span>
                                {scanRunning && minsLeft > 0 && (
                                    <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                        ~{minsLeft} min
                                    </span>
                                )}
                                {nextScanAt && (
                                    <span className="text-xs text-indigo-400 dark:text-indigo-500 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded-full">
                                        Próximo: {nextScanAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                                <button onClick={restartScan}
                                    className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold underline underline-offset-2">
                                    {scanRunning ? "Reiniciar" : "Volver a escanear"}
                                </button>
                            </div>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-1.5 mb-2">
                            <div className={`h-1.5 rounded-full transition-all duration-500 ${
                                scanRunning ? "bg-indigo-500" : "bg-green-500"
                            }`} style={{ width: `${pctDone}%` }} />
                        </div>

                        {/* Señales encontradas */}
                        {totalSignals > 0 && (
                            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                                {longSignals.length > 0 && (
                                    <span className="text-green-600 dark:text-green-400 font-semibold mr-2">
                                        ▲ {longSignals.length} LONG
                                    </span>
                                )}
                                {shortSignals.length > 0 && (
                                    <span className="text-red-500 dark:text-red-400 font-semibold">
                                        ▼ {shortSignals.length} SHORT
                                    </span>
                                )}
                                {' '}confirmadas hasta ahora
                            </p>
                        )}

                        {/* Estado de notificaciones + botón de prueba */}
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-slate-800 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${
                                notifPerm === 'granted'
                                    ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400'
                                    : notifPerm === 'denied'
                                    ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
                                    : 'bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400'
                            }`}>
                                {notifPerm === 'granted' ? '🔔' : notifPerm === 'denied' ? '🔕' : '⚠️'}
                                Notificaciones: {notifPerm === 'granted' ? 'activadas' : notifPerm === 'denied' ? 'bloqueadas' : 'sin permiso'}
                            </span>
                            <button
                                onClick={async () => {
                                    const granted = await requestNotifPermission();
                                    setNotifPerm(granted ? 'granted' : Notification.permission);
                                    if (granted) {
                                        sendSignalNotification({ name: 'Test', symbol: 'TEST', id: 'test', image: null }, 'LONG');
                                    }
                                    await sendSignalEmail(
                                        { name: 'Test Signal', symbol: 'test', id: 'test', current_price: 1.23, image: null },
                                        'LONG',
                                        { adx: 28.5, stochK: 18.3, stochZone: 'Sobrevendido', trendDir: 'Alcista' }
                                    );
                                }}
                                className="text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 font-semibold px-3 py-1 rounded-full transition-colors"
                            >
                                🧪 Probar notificación y email
                            </button>
                        </div>
                    </div>
                )}


                {/* ─── Sin señales aún (escaneando) ────────────────────────── */}
                {!initialLoad && scanRunning && totalSignals === 0 && (
                    <div className="text-center py-20 text-gray-400 dark:text-slate-500">
                        <div className="text-5xl mb-4">🔍</div>
                        <p className="font-semibold text-gray-500 dark:text-slate-400 text-lg">Buscando señales…</p>
                        <p className="text-sm mt-2">
                            Analizando {progress.done} de {coins.length} activos · 3 por minuto
                        </p>
                    </div>
                )}

                {/* ─── Señales LONG ────────────────────────────────────────── */}
                {longSignals.length > 0 && (
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-4">
                            <h2 className="text-lg font-bold text-gray-800 dark:text-slate-100">Señales LONG</h2>
                            <span className="bg-green-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                                {longSignals.length}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-slate-500">
                                · squeeze liberado + tendencia alcista fuerte
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {longSignals.map(coin => (
                                <SignalCard key={coin.id} coin={coin}
                                            analysis={analysisCache[coin.id].data} />
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── Señales SHORT ───────────────────────────────────────── */}
                {shortSignals.length > 0 && (
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-4">
                            <h2 className="text-lg font-bold text-gray-800 dark:text-slate-100">Señales SHORT</h2>
                            <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                                {shortSignals.length}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-slate-500">
                                · squeeze liberado + tendencia bajista fuerte
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {shortSignals.map(coin => (
                                <SignalCard key={coin.id} coin={coin}
                                            analysis={analysisCache[coin.id].data} />
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── Cerca de señal ─────────────────────────────────────── */}
                {nearSignals.length > 0 && (
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-3">
                            <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">
                                Cerca de señal
                            </h2>
                            <span className="bg-amber-400 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                                {nearSignals.length}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-slate-500">
                                · 4 de 5 condiciones cumplidas
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {nearSignals.map(coin => (
                                <NearCard key={coin.id} coin={coin}
                                          analysis={analysisCache[coin.id].data} />
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── Scan completo sin señales ───────────────────────────── */}
                {!initialLoad && !scanRunning && lastScan && totalSignals === 0 && (
                    <div className="text-center py-20">
                        <div className="text-5xl mb-4">😴</div>
                        <p className="font-semibold text-gray-600 dark:text-slate-300 text-lg">Sin señales confirmadas</p>
                        <p className="text-sm text-gray-400 dark:text-slate-500 mt-2">
                            Ningún activo tiene tendencia fuerte con squeeze liberado en este momento
                        </p>
                        <button onClick={restartScan}
                            className="mt-6 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold
                                       hover:bg-indigo-700 transition-colors">
                            Volver a escanear
                        </button>
                    </div>
                )}

            </div>
        </div>
    );
}
