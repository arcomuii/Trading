'use client'
import { useState, useEffect, useRef } from "react";

// ─── constants ────────────────────────────────────────────────────────────────
const GAP_MS       = 20_000;                  // 3 por minuto entre requests (4H candles)
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
    apiKey:            "AIzaSyBGtZ5lkmcNN7YjVkPnSo4W0mCRpcabwu8",
    authDomain:        "trading-5c2a1.firebaseapp.com",
    projectId:         "trading-5c2a1",
    storageBucket:     "trading-5c2a1.firebasestorage.app",
    messagingSenderId: "747427365340",
    appId:             "1:747427365340:web:2f8141a8188ab0bb438f19",
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

function analyzePosition(ohlcvData) {
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
    const momentum = calcSqueezeMomentum(high, low, close, 20);

    const cur    = close[n - 1];
    const curEMA = emaArr[emaArr.length - 1];
    const curBB  = bb[bb.length - 1];
    const curKC  = kc[kc.length - 1];
    const curADX = adxArr[adxArr.length - 1];

    if (curEMA == null || curBB == null || curKC == null || curADX == null) return null;

    // ADX subiendo con fuerza: comparar contra hace 5 barras, mínimo +1.5 pts de subida
    const ADX_LB    = 5;
    const adxPrev5  = adxArr.length > ADX_LB ? adxArr[adxArr.length - 1 - ADX_LB] : adxArr[0];
    const adxRising = curADX > adxPrev5 && (curADX - adxPrev5) >= 1.5;

    const isSqueezeOn   = curBB.upper <= curKC.upper && curBB.lower >= curKC.lower;
    const isTrendStrong = curADX > 23 && adxRising;
    const trendDir      = cur > curEMA ? "Alcista" : "Bajista";

    // Zona del estocástico
    const stochZone = stoch.k >= 80 ? "Sobrecompra"
                    : stoch.k <= 20 ? "Sobrevendido"
                    : "Neutral";

    // Dirección del histograma Squeeze Momentum
    const sqzMomPos = momentum !== null && momentum > 0;  // barra verde (impulso alcista)
    const sqzMomNeg = momentum !== null && momentum < 0;  // barra roja  (impulso bajista)

    // Confirmación doble: estocástico en zona extrema + momentum coincide:
    //   LONG  → stoch ≤20 (sobrevendido)  + momentum negativo (valle rojo)
    //   SHORT → stoch ≥80 (sobrecomprado) + momentum positivo (pico verde)
    const stochConfirmsLong  = stoch.k <= 20 && sqzMomNeg;
    const stochConfirmsShort = stoch.k >= 80 && sqzMomPos;
    const stochConfirms      = trendDir === "Alcista" ? stochConfirmsLong : stochConfirmsShort;

    const condSqueeze = !isSqueezeOn;
    const condTrend   = isTrendStrong;
    const condStoch   = stochConfirms;
    const condMet     = (condSqueeze ? 1 : 0) + (condTrend ? 1 : 0) + (condStoch ? 1 : 0);
    const señalActiva = condMet === 3;
    const nearSignal  = condMet === 2;

    return {
        adx: curADX, adxRising, isSqueezeOn, isTrendStrong, trendDir, emaValue: curEMA,
        stochK: stoch.k, stochD: stoch.d, stochConfirms, stochZone,
        momentum, sqzMomPos, sqzMomNeg,
        condSqueeze, condTrend, condStoch, condMet,
        señalActiva, nearSignal,
        emaPeriod, adxPeriod, candles: n,
    };
}

// ─── fetch OHLC con reintentos ─────────────────────────────────────────────────
// CoinGecko OHLC: days=30 → velas de 4H exactamente (30×6=180 velas)
async function fetchOHLC(coinId, attempt = 0) {
    const res = await fetch(
        `/api/coingecko/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=30`
    );
    if (res.status === 429) {
        if (attempt < RETRY_DELAYS.length) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
            return fetchOHLC(coinId, attempt + 1);
        }
        throw new Error("RATE_LIMIT");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length < 50)
        throw new Error(`insufficient:${Array.isArray(raw) ? raw.length : 0}`);
    const data   = raw.map(([, , high, low, close]) => ({ high, low, close }));
    const result = analyzePosition(data);
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

// ─── SignalCard ────────────────────────────────────────────────────────────────
function SignalCard({ coin, analysis }) {
    const isLong = analysis.trendDir === "Alcista";
    const pct    = coin.price_change_percentage_24h;

    return (
        <div className={`rounded-2xl border-2 p-4 ${
            isLong
                ? "border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50 dark:from-green-950 to-white dark:to-slate-900"
                : "border-red-200 dark:border-red-900 bg-gradient-to-br from-red-50 dark:from-red-950 to-white dark:to-slate-900"
        }`}>
            {/* Badge + % 24h */}
            <div className="flex items-center justify-between mb-3">
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold tracking-wide ${
                    isLong ? "bg-green-500 text-white" : "bg-red-500 text-white"
                }`}>
                    {isLong ? "▲ LONG" : "▼ SHORT"}
                </span>
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

            {/* Indicators grid 2×2 */}
            <div className="grid grid-cols-2 gap-2">
                {/* ADX */}
                <div className="bg-white dark:bg-slate-800 rounded-xl p-2.5 text-center border border-gray-100 dark:border-slate-700">
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">ADX</p>
                    <p className={`text-sm font-bold ${analysis.isTrendStrong ? "text-indigo-600 dark:text-indigo-400" : analysis.adxRising ? "text-amber-500 dark:text-amber-400" : "text-gray-500 dark:text-slate-400"}`}>
                        {analysis.adx}
                    </p>
                    <p className="text-[9px] text-gray-400 dark:text-slate-500">
                        {analysis.isTrendStrong ? "↑ Subiendo" : analysis.adxRising ? "↑ Arrancando" : "Plano / Débil"}
                    </p>
                </div>
                {/* Squeeze + Momentum */}
                <div className="bg-white dark:bg-slate-800 rounded-xl p-2.5 text-center border border-gray-100 dark:border-slate-700">
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Squeeze</p>
                    <p className={`text-sm font-bold ${!analysis.isSqueezeOn ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {analysis.isSqueezeOn ? "🔴" : "🟢"}
                    </p>
                    <p className={`text-[9px] ${
                        analysis.isSqueezeOn  ? "text-gray-400 dark:text-slate-500" :
                        analysis.sqzMomNeg    ? "text-blue-500 dark:text-blue-400" :
                        analysis.sqzMomPos    ? "text-orange-500 dark:text-orange-400" : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.isSqueezeOn ? "Activo" :
                         analysis.sqzMomNeg   ? "▼ Valle rojo" :
                         analysis.sqzMomPos   ? "▲ Pico verde" : "Liberado"}
                    </p>
                </div>
                {/* EMA */}
                <div className="bg-white dark:bg-slate-800 rounded-xl p-2.5 text-center border border-gray-100 dark:border-slate-700">
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">
                        EMA {analysis.emaPeriod}
                    </p>
                    <p className={`text-sm font-bold ${isLong ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {isLong ? "▲" : "▼"} ${fmt(analysis.emaValue, analysis.emaValue != null && analysis.emaValue < 1 ? 5 : 2)}
                    </p>
                    <p className="text-[9px] text-gray-400 dark:text-slate-500">{analysis.trendDir}</p>
                </div>
                {/* Estocástico (14, 3, 3) */}
                <div className={`rounded-xl p-2.5 text-center border ${
                    analysis.stochConfirms
                        ? "bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700"
                        : "bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700"
                }`}>
                    <p className="text-[9px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">
                        Estoc. 14,3,3
                    </p>
                    <p className={`text-sm font-bold ${
                        analysis.stochConfirms
                            ? (isLong ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400")
                            : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {fmt(analysis.stochK, 1)}
                    </p>
                    <p className={`text-[9px] ${
                        analysis.stochZone === "Sobrecompra"  ? "text-orange-500 dark:text-orange-400" :
                        analysis.stochZone === "Sobrevendido" ? "text-blue-500 dark:text-blue-400" : "text-gray-400 dark:text-slate-500"
                    }`}>
                        {analysis.stochZone}
                    </p>
                </div>
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
function NearCard({ coin, analysis }) {
    const isLong = analysis.trendDir === "Alcista";
    const sym    = coin.symbol.toUpperCase();
    const conds  = [
        { label: "Squeeze libre",    ok: analysis.condSqueeze },
        { label: "ADX fuerte ↑",     ok: analysis.condTrend   },
        { label: isLong ? "Stoch sobrevendido + valle rojo" : "Stoch sobrecomprado + pico verde",
          ok: analysis.condStoch },
    ];
    const missing = conds.find(c => !c.ok);

    return (
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-xl
                        border border-gray-100 dark:border-slate-800 p-3 hover:border-indigo-200
                        dark:hover:border-indigo-800 transition-colors">
            {/* Image */}
            {coin.image
                ? <img src={coin.image} alt={sym} className="w-8 h-8 rounded-full flex-shrink-0"
                       onError={e => e.target.style.display='none'} />
                : <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 flex-shrink-0" />
            }

            {/* Name + direction */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="font-bold text-gray-800 dark:text-slate-100 text-xs truncate">{sym}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        isLong ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400"
                               : "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400"
                    }`}>
                        {isLong ? "▲ L" : "▼ S"}
                    </span>
                </div>
                {missing && (
                    <p className="text-[9px] text-amber-600 dark:text-amber-400 truncate mt-0.5">
                        Falta: {missing.label}
                    </p>
                )}
            </div>

            {/* Condition dots */}
            <div className="flex gap-1 flex-shrink-0">
                {conds.map((c, i) => (
                    <div key={i} title={c.label}
                         className={`w-2 h-2 rounded-full ${c.ok ? "bg-green-500" : "bg-gray-200 dark:bg-slate-600"}`} />
                ))}
            </div>

            {/* ADX */}
            <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 flex-shrink-0 w-10 text-right">
                {fmt(analysis.adx, 1)}
            </span>

            {/* Links */}
            <div className="flex gap-1 flex-shrink-0">
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
    const [scanLog,       setScanLog]       = useState([]);
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

    // 3. Iniciar scan una sola vez cuando la lista esté lista
    useEffect(() => {
        if (coins.length > 0 && !loadingCoins) {
            runScan(coins, bitunixCount);
        }
    }, [coins]); // eslint-disable-line

    // Limpieza al desmontar
    useEffect(() => () => { abortRef.current = true; }, []);

    const runScan = async (coinsList, totalCount) => {
        abortRef.current = false;
        notifiedRef.current.clear();
        setAnalysisCache({});
        setScanLog([]);
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
                    setScanLog(prev => [...prev, {
                        id: coin.id, symbol: coin.symbol.toUpperCase(),
                        name: coin.name, signal, status: 200, ok: true,
                    }]);
                }
            } catch (err) {
                if (!abortRef.current) {
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, error: err.message } }));
                    if (err.message?.startsWith('HTTP')) {
                        const status = parseInt(err.message.replace('HTTP ', '')) || 0;
                        setScanLog(prev => [...prev, {
                            id: coin.id, symbol: coin.symbol.toUpperCase(),
                            name: coin.name, status, ok: false, url: ohlcUrl,
                        }]);
                    }
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

                {/* ─── Log de escaneo ─────────────────────────────────────── */}
                {scanLog.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 mb-6">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Log de escaneo</p>
                                <span className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-mono">
                                    {scanLog.length} procesados
                                </span>
                                {(() => {
                                    const signals = scanLog.filter(e => e.ok && e.signal);
                                    const errors  = scanLog.filter(e => !e.ok);
                                    return (
                                        <>
                                            {signals.length > 0 && (
                                                <span className="text-xs bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-semibold">
                                                    ⚡ {signals.length} señales
                                                </span>
                                            )}
                                            {errors.length > 0 && (
                                                <span className="text-xs bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full font-semibold">
                                                    ✕ {errors.length} errores
                                                </span>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                            {scanRunning && (
                                <span className="text-xs text-gray-400 dark:text-slate-500">en curso…</span>
                            )}
                        </div>
                        <div className="overflow-auto max-h-56 space-y-0 font-mono text-xs">
                            {[...scanLog].reverse().map(entry => (
                                <div key={entry.id}
                                     className="flex items-center gap-2 py-1.5 border-b border-gray-50 dark:border-slate-800 last:border-0">
                                    {/* dot */}
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                        !entry.ok            ? "bg-red-400 dark:bg-red-500" :
                                        entry.signal         ? "bg-green-500" :
                                                               "bg-gray-300 dark:bg-slate-600"
                                    }`} />
                                    {/* symbol */}
                                    <span className="w-20 flex-shrink-0 font-semibold text-gray-700 dark:text-slate-300 truncate">
                                        {entry.symbol}
                                    </span>
                                    {/* name */}
                                    <span className="flex-1 text-gray-400 dark:text-slate-500 truncate">
                                        {entry.name}
                                    </span>
                                    {/* status badge */}
                                    <span className={`flex-shrink-0 font-bold px-2 py-0.5 rounded text-[10px] ${
                                        !entry.ok
                                            ? "bg-red-50 dark:bg-red-950 text-red-500 dark:text-red-400"
                                            : "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
                                    }`}>
                                        {entry.status}
                                    </span>
                                    {/* signal badge (si aplica) */}
                                    {entry.signal && (
                                        <span className={`flex-shrink-0 font-bold px-2 py-0.5 rounded text-[10px] ${
                                            entry.signal === "LONG"
                                                ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400"
                                                : "bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400"
                                        }`}>
                                            {entry.signal === "LONG" ? "▲ LONG" : "▼ SHORT"}
                                        </span>
                                    )}
                                    {/* URL en errores */}
                                    {!entry.ok && entry.url && (
                                        <p className="text-[9px] text-gray-400 dark:text-slate-500 truncate max-w-[180px]" title={entry.url}>
                                            {entry.url}
                                        </p>
                                    )}
                                </div>
                            ))}
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
                                · 2 de 3 condiciones cumplidas
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
