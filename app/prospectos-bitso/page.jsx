'use client'
import { useState, useEffect, useRef } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const PAIRS = [
    'uni_usd','ton_usd','ada_usd','dydx_usd','ondo_usd','crv_usd','yfi_usd',
    'trx_usd','xlm_usd','btc_usd','snx_usd','ldo_usd','paxg_usd','s_usd',
    'omg_usd','popcat_usd','psg_usd','pepe_usd','bar_usd','avax_usd','eth_usd',
    'sushi_usd','bonk_usd','axs_usd','hbar_usd','bat_usd','wif_usd','comp_usd',
    'render_usd','floki_usd','bch_usd','fet_usd','dot_usd','near_usd','grt_usd',
    'sand_usd','ltc_usd','bal_usd','chz_usd','shib_usd','sol_usd','atom_usd',
    'enj_usd','hype_usd','lrc_usd','aave_usd','sky_usd','gala_usd','xrp_usd',
    'doge_usd','virtual_usd','ape_usd','arb_usd','pol_usd','qnt_usd','mana_usd',
    'algo_usd','neiro_usd','link_usd',
];

// ─── Scheduler ────────────────────────────────────────────────────────────────
const SCAN_SLOTS = [2, 6, 10, 14, 18, 22];
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

const COIN_INFO = {
    uni:     { name: 'Uniswap',        color: '#ff007a' },
    ton:     { name: 'Toncoin',        color: '#0098ea' },
    ada:     { name: 'Cardano',        color: '#3b82f6' },
    dydx:    { name: 'dYdX',           color: '#6b21a8' },
    ondo:    { name: 'Ondo',           color: '#0ea5e9' },
    crv:     { name: 'Curve',          color: '#ef4444' },
    yfi:     { name: 'Yearn Finance',  color: '#0654f5' },
    trx:     { name: 'TRON',           color: '#ef4444' },
    xlm:     { name: 'Stellar',        color: '#000000' },
    btc:     { name: 'Bitcoin',        color: '#f59e0b' },
    snx:     { name: 'Synthetix',      color: '#1e3a5f' },
    ldo:     { name: 'Lido DAO',       color: '#17a1e0' },
    paxg:    { name: 'PAX Gold',       color: '#d4af37' },
    s:       { name: 'Sonic',          color: '#6366f1' },
    omg:     { name: 'OMG Network',    color: '#1a1a1a' },
    popcat:  { name: 'Popcat',         color: '#f97316' },
    psg:     { name: 'Paris SG Fan',   color: '#004170' },
    pepe:    { name: 'Pepe',           color: '#22c55e' },
    bar:     { name: 'FC Barcelona',   color: '#a50044' },
    avax:    { name: 'Avalanche',       color: '#e84142' },
    eth:     { name: 'Ethereum',       color: '#6366f1' },
    sushi:   { name: 'SushiSwap',      color: '#fa52a0' },
    bonk:    { name: 'Bonk',           color: '#f59e0b' },
    axs:     { name: 'Axie Infinity',  color: '#0055d4' },
    hbar:    { name: 'Hedera',         color: '#222222' },
    bat:     { name: 'Basic Attention',color: '#ff5000' },
    wif:     { name: 'dogwifhat',      color: '#a855f7' },
    comp:    { name: 'Compound',       color: '#00d395' },
    render:  { name: 'Render',         color: '#e11d48' },
    floki:   { name: 'Floki',          color: '#f59e0b' },
    bch:     { name: 'Bitcoin Cash',   color: '#8dc351' },
    fet:     { name: 'Fetch.ai',       color: '#1a1a2e' },
    dot:     { name: 'Polkadot',       color: '#e6007a' },
    near:    { name: 'NEAR Protocol',  color: '#000000' },
    grt:     { name: 'The Graph',      color: '#6747ed' },
    sand:    { name: 'The Sandbox',    color: '#00adef' },
    ltc:     { name: 'Litecoin',       color: '#a0a0a0' },
    bal:     { name: 'Balancer',       color: '#1e1e1e' },
    chz:     { name: 'Chiliz',         color: '#cd0124' },
    shib:    { name: 'Shiba Inu',      color: '#ff9a00' },
    sol:     { name: 'Solana',         color: '#9945ff' },
    atom:    { name: 'Cosmos',         color: '#2e3148' },
    enj:     { name: 'Enjin Coin',     color: '#7866d5' },
    hype:    { name: 'Hyperliquid',    color: '#00e5ff' },
    lrc:     { name: 'Loopring',       color: '#2ab8e6' },
    aave:    { name: 'Aave',           color: '#b6509e' },
    sky:     { name: 'Sky',            color: '#f59e0b' },
    gala:    { name: 'Gala',           color: '#222222' },
    xrp:     { name: 'XRP',            color: '#00aae4' },
    doge:    { name: 'Dogecoin',       color: '#c2a633' },
    virtual: { name: 'Virtuals',       color: '#7c3aed' },
    ape:     { name: 'ApeCoin',        color: '#0153fc' },
    arb:     { name: 'Arbitrum',       color: '#213147' },
    pol:     { name: 'Polygon',        color: '#8247e5' },
    qnt:     { name: 'Quant',          color: '#1a1a2e' },
    mana:    { name: 'Decentraland',   color: '#ff2d55' },
    algo:    { name: 'Algorand',       color: '#000000' },
    neiro:   { name: 'Neiro',          color: '#f97316' },
    link:    { name: 'Chainlink',      color: '#375bd2' },
};

function pairMeta(book) {
    const sym  = book.replace(/_usd$|_mxn$/, '').toLowerCase();
    const info = COIN_INFO[sym] ?? { name: sym.toUpperCase(), color: '#6b7280' };
    return { symbol: sym.toUpperCase(), name: info.name, color: info.color };
}

const CONFIG = {
    adxPeriod:     14,
    stochPeriod:   14,
    stochSignal:   3,
    bbPeriod:      20,
    bbStdDev:      2,
    kcPeriod:      20,
    kcMultiplier:  2.0,
    minTarget:     0.08,
    maxTarget:     0.15,
};

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmt(n, dec = 2) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtUSD(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1000)  return "$" + fmt(n, 0);
    if (n >= 1)     return "$" + fmt(n, 2);
    if (n >= 0.01)  return "$" + fmt(n, 4);
    return "$" + n.toFixed(8);
}

// ─── Indicadores técnicos (pure JS) ───────────────────────────────────────────

function calcSMA(values, period) {
    const result = [];
    for (let i = period - 1; i < values.length; i++) {
        const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
    }
    return result;
}

function calcATR(high, low, close, period) {
    const tr = [];
    for (let i = 1; i < high.length; i++) {
        tr.push(Math.max(
            high[i] - low[i],
            Math.abs(high[i] - close[i - 1]),
            Math.abs(low[i]  - close[i - 1])
        ));
    }
    if (tr.length < period) return [];
    let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [prev];
    for (let i = period; i < tr.length; i++) {
        prev = (prev * (period - 1) + tr[i]) / period;
        result.push(prev);
    }
    return result;
}

function calcBB(values, period, stdDev) {
    const result = [];
    for (let i = period - 1; i < values.length; i++) {
        const slice  = values.slice(i - period + 1, i + 1);
        const mean   = slice.reduce((a, b) => a + b, 0) / period;
        const std    = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
        result.push({ upper: mean + stdDev * std, lower: mean - stdDev * std, mid: mean });
    }
    return result;
}

function calcADXFull(high, low, close, period) {
    const n = high.length;
    const dmP = [], dmM = [], tr = [];
    for (let i = 1; i < n; i++) {
        const up   = high[i]  - high[i - 1];
        const down = low[i-1] - low[i];
        dmP.push(up > down && up > 0 ? up : 0);
        dmM.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(
            high[i] - low[i],
            Math.abs(high[i] - close[i - 1]),
            Math.abs(low[i]  - close[i - 1])
        ));
    }

    function wilder(arr, p) {
        if (arr.length < p) return [];
        let sum = arr.slice(0, p).reduce((a, b) => a + b, 0);
        const res = [sum];
        for (let i = p; i < arr.length; i++) {
            sum = sum - sum / p + arr[i];
            res.push(sum);
        }
        return res;
    }

    const aTR  = wilder(tr, period);
    const aDmP = wilder(dmP, period);
    const aDmM = wilder(dmM, period);

    const diArr = aTR.map((t, i) => ({
        pdi: t > 0 ? (aDmP[i] / t) * 100 : 0,
        mdi: t > 0 ? (aDmM[i] / t) * 100 : 0,
    }));

    const dxArr = diArr.map(({ pdi, mdi }) =>
        pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0
    );

    const adxSmooth = wilder(dxArr, period);
    const offset    = diArr.length - adxSmooth.length;

    return adxSmooth.map((adx, i) => ({
        adx,
        pdi: diArr[offset + i].pdi,
        mdi: diArr[offset + i].mdi,
    }));
}

function calcStochastic(high, low, close, period, smoothK, smoothD) {
    const rawK = [];
    for (let i = period - 1; i < close.length; i++) {
        const sliceH = high.slice(i - period + 1, i + 1);
        const sliceL = low.slice(i - period + 1, i + 1);
        const hh = Math.max(...sliceH);
        const ll = Math.min(...sliceL);
        rawK.push(hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100);
    }
    const kSmoothed = calcSMA(rawK, smoothK);
    const dSmoothed = calcSMA(kSmoothed, smoothD);
    const last = { k: kSmoothed[kSmoothed.length - 1], d: dSmoothed[dSmoothed.length - 1] };
    return last;
}

// ─── Análisis Swing ────────────────────────────────────────────────────────────
function analyzeSwing(data) {
    // Filtrar velas con valores inválidos (Bitso puede tener gaps con NaN)
    const clean = data.filter(d =>
        d.high > 0 && d.low > 0 && d.close > 0 &&
        !isNaN(d.high) && !isNaN(d.low) && !isNaN(d.close)
    );
    if (clean.length < 28) return null;

    const high  = clean.map(d => d.high);
    const low   = clean.map(d => d.low);
    const close = clean.map(d => d.close);
    const price = close[close.length - 1];

    const adxArr   = calcADXFull(high, low, close, CONFIG.adxPeriod);
    const stoch    = calcStochastic(high, low, close, CONFIG.stochPeriod, CONFIG.stochSignal, CONFIG.stochSignal);
    const bbArr    = calcBB(close, CONFIG.bbPeriod, CONFIG.bbStdDev);
    const atrArr   = calcATR(high, low, close, CONFIG.kcPeriod);
    const smaArr   = calcSMA(close, CONFIG.kcPeriod);

    if (adxArr.length < 2 || bbArr.length === 0 || atrArr.length === 0 || smaArr.length === 0) return null;

    const curADX  = adxArr[adxArr.length - 1];
    const prevADX = adxArr[adxArr.length - 2];
    const curBB   = bbArr[bbArr.length - 1];
    const curATR  = atrArr[atrArr.length - 1];
    const curSMA  = smaArr[smaArr.length - 1];

if (!curADX || isNaN(curADX.adx)) return null;
    if (!curBB  || isNaN(curBB.upper)) return null;
    if (curATR  == null || isNaN(curATR) || curATR === 0) return null;
    if (curSMA  == null || isNaN(curSMA) || curSMA === 0) return null;

    const kcUpper = curSMA + curATR * CONFIG.kcMultiplier;
    const kcLower = curSMA - curATR * CONFIG.kcMultiplier;
    const isSqueezeOn = curBB.upper <= kcUpper && curBB.lower >= kcLower;

    // Condiciones del script original
    const isStochBullish  = stoch && stoch.k > stoch.d && stoch.k < 50;
    const isTrendStarting = curADX.pdi > curADX.mdi && curADX.adx > 20;
    const isAdxRising     = curADX.adx > prevADX.adx;

    // Gestión de riesgo
    const stopLoss      = price - curATR * 2;
    const riskPct       = (price - stopLoss) / price;
    const tpMin         = price * (1 + CONFIG.minTarget);
    const tpMax         = price * (1 + CONFIG.maxTarget);
    const riskReward    = CONFIG.minTarget / riskPct;

    // Señal
    let signal = 'ESPERA';
    const reasoning = [];

    if (isStochBullish)  reasoning.push('Estocástico saliendo de zona baja (giro alcista)');
    if (isTrendStarting) reasoning.push('Tendencia alcista confirmada (+DI > -DI, ADX > 20)');
    if (isAdxRising)     reasoning.push('ADX ganando fuerza (impulso alcista)');
    if (isSqueezeOn)     reasoning.push('Squeeze ACTIVO: acumulación de varios días');

    const condMet = (isTrendStarting ? 1 : 0) + (isStochBullish ? 1 : 0) + (isAdxRising ? 1 : 0);

    if (isTrendStarting && isStochBullish && isAdxRising) {
        signal = riskPct <= 0.06 ? 'SWING_LONG_TRIGGER' : 'SWING_LONG_ALTO_RIESGO';
    }

    return {
        signal,
        condMet,
        price,
        stopLoss,
        riskPct,
        tpMin,
        tpMax,
        riskReward,
        adx:          curADX.adx,
        pdi:          curADX.pdi,
        mdi:          curADX.mdi,
        stochK:       stoch.k,
        stochD:       stoch.d,
        isSqueezeOn,
        isTrendStarting,
        isStochBullish,
        isAdxRising,
        reasoning,
    };
}

// ─── Fetch velas 4H de Bitso ──────────────────────────────────────────────────
async function fetchCandles(book) {
    const res = await fetch(
        `/api/bitso/api/v3/ohlc/?book=${book}&time_bucket=86400`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message ?? `API error: success=false`);
    if (!Array.isArray(json.payload)) throw new Error(`payload no es array: ${JSON.stringify(json).slice(0, 120)}`);
    if (json.payload.length === 0) throw new Error('Sin velas (payload vacío)');
    const candles = json.payload.map(c => ({
        open:  parseFloat(c.first_rate),
        high:  parseFloat(c.max_rate),
        low:   parseFloat(c.min_rate),
        close: parseFloat(c.last_rate),
    }));
    return candles;
}

// ─── Componentes ──────────────────────────────────────────────────────────────
function SignalBadge({ signal }) {
    if (signal === 'SWING_LONG_TRIGGER') return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold
                         bg-green-500 text-white">
            ▲ SWING LONG
        </span>
    );
    if (signal === 'SWING_LONG_ALTO_RIESGO') return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold
                         bg-orange-500 text-white">
            ⚠ SWING LONG · Alto riesgo
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                         bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400">
            — Espera
        </span>
    );
}

function Chip({ label, value, color }) {
    const colors = {
        green:  "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900",
        red:    "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900",
        blue:   "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900",
        gray:   "bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-100 dark:border-slate-700",
        orange: "bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-900",
        indigo: "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900",
    };
    return (
        <div className={`rounded-xl p-2.5 text-center border ${colors[color] ?? colors.gray}`}>
            <p className="text-[9px] font-semibold uppercase tracking-wide opacity-70 mb-0.5">{label}</p>
            <p className="text-sm font-bold leading-tight">{value}</p>
        </div>
    );
}

function AssetCard({ pair, result, error, loading }) {
    const meta = pairMeta(pair);

    return (
        <div className={`rounded-2xl border-2 p-5 transition-all ${
            loading ? "border-gray-100 dark:border-slate-800 animate-pulse" :
            error   ? "border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/20" :
            result?.signal === 'SWING_LONG_TRIGGER'
                ? "border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50 dark:from-green-950/40 to-white dark:to-slate-900"
                : result?.signal === 'SWING_LONG_ALTO_RIESGO'
                ? "border-orange-200 dark:border-orange-900 bg-gradient-to-br from-orange-50 dark:from-orange-950/40 to-white dark:to-slate-900"
                : result?.condMet === 2
                ? "border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50/50 dark:from-amber-950/20 to-white dark:to-slate-900"
                : "border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900"
        }`}>

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                         style={{ backgroundColor: meta.color }}>
                        {meta.symbol.slice(0, 2)}
                    </div>
                    <div>
                        <p className="font-bold text-gray-800 dark:text-slate-100 text-sm leading-tight">{meta.name}</p>
                        <p className="text-[10px] text-gray-400 dark:text-slate-500 font-semibold uppercase">
                            {meta.symbol}/USD
                        </p>
                    </div>
                </div>
                {loading ? (
                    <div className="w-24 h-6 bg-gray-100 dark:bg-slate-800 rounded-full" />
                ) : error ? (
                    <span className="text-xs text-red-500 dark:text-red-400 font-mono bg-red-50 dark:bg-red-950 px-2 py-0.5 rounded">
                        {error}
                    </span>
                ) : result && (
                    <SignalBadge signal={result.signal} />
                )}
            </div>

            {loading && (
                <div className="space-y-2 mt-4">
                    <div className="h-3 bg-gray-100 dark:bg-slate-800 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 dark:bg-slate-800 rounded w-1/2" />
                </div>
            )}

            {!loading && error && (
                <p className="text-xs text-red-500 dark:text-red-400 font-mono mt-2 break-all">
                    {error}
                </p>
            )}

            {!loading && result && (
                <>
                    {/* Precio */}
                    <div className="flex items-baseline gap-2 mb-4">
                        <p className="text-2xl font-black text-gray-800 dark:text-slate-100 font-mono">
                            {fmtUSD(result.price)}
                        </p>
                        <span className="text-xs text-gray-400 dark:text-slate-500">USD · 1D</span>
                    </div>

                    {/* Indicadores 2×3 */}
                    <div className="grid grid-cols-3 gap-1.5 mb-3">
                        <Chip label="ADX" value={fmt(result.adx, 1)}
                              color={result.isTrendStarting ? "indigo" : "gray"} />
                        <Chip label="+DI / −DI"
                              value={`${fmt(result.pdi, 1)} / ${fmt(result.mdi, 1)}`}
                              color={result.pdi > result.mdi ? "green" : "red"} />
                        <Chip label="Stoch K/D"
                              value={`${fmt(result.stochK, 1)} / ${fmt(result.stochD, 1)}`}
                              color={result.isStochBullish ? "green" : "gray"} />
                        <Chip label="Squeeze"
                              value={result.isSqueezeOn ? "ON 🔴" : "OFF 🟢"}
                              color={result.isSqueezeOn ? "orange" : "green"} />
                        <Chip label="Riesgo ATR"
                              value={`${(result.riskPct * 100).toFixed(1)}%`}
                              color={result.riskPct <= 0.04 ? "green" : result.riskPct <= 0.06 ? "orange" : "red"} />
                        <Chip label="R/R (8%)"
                              value={`${fmt(result.riskReward, 2)}x`}
                              color={result.riskReward >= 2 ? "green" : result.riskReward >= 1 ? "blue" : "red"} />
                    </div>

                    {/* Niveles */}
                    <div className="rounded-xl border border-gray-100 dark:border-slate-700 overflow-hidden mb-3">
                        <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-slate-700">
                            <div className="p-2 text-center">
                                <p className="text-[9px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide mb-0.5">Stop Loss</p>
                                <p className="text-xs font-bold text-red-600 dark:text-red-400 font-mono">
                                    {fmtUSD(result.stopLoss)}
                                </p>
                            </div>
                            <div className="p-2 text-center bg-green-50/50 dark:bg-green-950/20">
                                <p className="text-[9px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-0.5">TP +8%</p>
                                <p className="text-xs font-bold text-green-700 dark:text-green-400 font-mono">
                                    {fmtUSD(result.tpMin)}
                                </p>
                            </div>
                            <div className="p-2 text-center bg-green-50/50 dark:bg-green-950/20">
                                <p className="text-[9px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-0.5">TP +15%</p>
                                <p className="text-xs font-bold text-green-700 dark:text-green-400 font-mono">
                                    {fmtUSD(result.tpMax)}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Links */}
                    <div className="flex gap-2 mt-3">
                        <a href={`https://www.bitunix.com/es-es/contract-trade/${meta.symbol}USDT`}
                           target="_blank" rel="noopener noreferrer"
                           className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors border border-indigo-100 dark:border-indigo-900">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            Bitunix
                        </a>
                        <a href={`https://es.tradingview.com/chart/tXjDAvNO/?symbol=BITUNIX%3A${meta.symbol}USDT.P`}
                           target="_blank" rel="noopener noreferrer"
                           className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors border border-blue-100 dark:border-blue-900">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            TradingView
                        </a>
                    </div>

                    {/* Condiciones para confirmar */}
                    {result.signal === 'ESPERA' && (() => {
                        const conds = [
                            { ok: result.isTrendStarting, label: '+DI > −DI y ADX > 20',         desc: 'Tendencia alcista' },
                            { ok: result.isStochBullish,  label: 'Stoch K > D y K < 50',          desc: 'Estocástico alcista' },
                            { ok: result.isAdxRising,     label: 'ADX subiendo',                   desc: 'Impulso creciente' },
                        ];
                        const met    = conds.filter(c => c.ok).length;
                        const border = met === 2 ? 'border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20'
                                                 : 'border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30';
                        return (
                            <div className={`rounded-xl border p-3 mt-3 ${border}`}>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-2">
                                    {met}/3 condiciones · {met === 2 ? '⚡ Cerca de señal' : 'Falta para confirmar'}
                                </p>
                                <div className="space-y-1.5">
                                    {conds.map((c, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                                                c.ok ? 'bg-green-500 text-white' : 'bg-red-100 dark:bg-red-950 text-red-500 dark:text-red-400'
                                            }`}>
                                                {c.ok ? '✓' : '✕'}
                                            </span>
                                            <span className={`text-[10px] font-semibold ${c.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                                {c.desc}
                                            </span>
                                            <span className="text-[9px] text-gray-400 dark:text-slate-500 font-mono ml-auto">
                                                {c.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Reasoning (solo señales confirmadas) */}
                    {result.signal !== 'ESPERA' && result.reasoning.length > 0 && (
                        <ul className="space-y-1">
                            {result.reasoning.map((r, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-[10px] text-gray-500 dark:text-slate-400">
                                    <span className="text-green-500 mt-0.5">✓</span>
                                    {r}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
}

// ─── Email de señal swing ──────────────────────────────────────────────────────
async function sendSwingEmail(pair, analysis) {
    const meta = pairMeta(pair);
    try {
        await fetch('/api/signal-email-bitso', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name:        meta.name,
                symbol:      meta.symbol,
                signal:      analysis.signal,
                price:       analysis.price,
                stopLoss:    analysis.stopLoss,
                tpMin:       analysis.tpMin,
                tpMax:       analysis.tpMax,
                riskReward:  analysis.riskReward,
                riskPct:     analysis.riskPct,
                adx:         analysis.adx,
                pdi:         analysis.pdi,
                mdi:         analysis.mdi,
                stochK:      analysis.stochK,
                stochD:      analysis.stochD,
                isSqueezeOn: analysis.isSqueezeOn,
                reasoning:   analysis.reasoning,
            }),
        });
    } catch (e) {
        console.error('[SwingEmail]', e);
    }
}

const SIGNAL_RANK = { SWING_LONG_TRIGGER: 0, SWING_LONG_ALTO_RIESGO: 1, ESPERA: 2 };

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProspectosBitsoPage() {
    const [results,    setResults]    = useState({});
    const [lastUpdate,  setLastUpdate]  = useState(null);
    const [nextScanAt,  setNextScanAt]  = useState(null);
    const intervalRef  = useRef(null);
    const notifiedRef  = useRef(new Set());

    const loadAll = async () => {
        notifiedRef.current.clear();
        setResults(prev => {
            const next = { ...prev };
            PAIRS.forEach(p => { next[p] = { loading: true, data: null, error: null }; });
            return next;
        });

        await Promise.all(PAIRS.map(async pair => {
            try {
                const candles  = await fetchCandles(pair);
                const analysis = analyzeSwing(candles);

                if (analysis?.signal !== 'ESPERA' && analysis?.signal &&
                    !notifiedRef.current.has(pair)) {
                    notifiedRef.current.add(pair);
                    sendSwingEmail(pair, analysis);
                }

                setResults(prev => ({
                    ...prev,
                    [pair]: {
                        loading: false,
                        data:    analysis,
                        error:   analysis ? null
                            : `Análisis fallido — ${candles.length} velas`,
                    },
                }));
            } catch (err) {
                setResults(prev => ({
                    ...prev,
                    [pair]: { loading: false, data: null, error: err.message },
                }));
            }
        }));

        setLastUpdate(new Date());
    };

    useEffect(() => {
        const scheduleNext = () => {
            const slot = nextSlotTime();
            setNextScanAt(slot);
            intervalRef.current = setTimeout(() => {
                setNextScanAt(null);
                loadAll();
                scheduleNext();
            }, msUntilNextSlot());
        };
        scheduleNext();
        return () => clearTimeout(intervalRef.current);
    }, []); // eslint-disable-line

    const signals = PAIRS.filter(p =>
        results[p]?.data?.signal === 'SWING_LONG_TRIGGER' ||
        results[p]?.data?.signal === 'SWING_LONG_ALTO_RIESGO'
    );

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-6">
            <div className="max-w-6xl mx-auto">

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-1">
                        <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Prospectos Bitso</h1>
                        <span className="text-xs font-bold bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400
                                         px-2.5 py-1 rounded-full">
                            Swing Trading
                        </span>
                    </div>
                    <p className="text-gray-400 dark:text-slate-500 text-sm">
                        Análisis swing en velas 1D · ADX · Squeeze Momentum · Objetivos 8–15%
                    </p>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {lastUpdate && (
                            <span className="text-xs text-gray-400 dark:text-slate-500">
                                Actualizado: {lastUpdate.toLocaleTimeString('es-MX')}
                            </span>
                        )}
                        <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 px-2.5 py-1 rounded-full">
                            Próximo scan: {nextSlotTime().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {signals.length > 0 && (
                            <span className="text-xs font-semibold bg-green-50 dark:bg-green-950
                                             text-green-700 dark:text-green-400 px-2.5 py-1 rounded-full">
                                ⚡ {signals.length} señal{signals.length > 1 ? 'es' : ''} activa{signals.length > 1 ? 's' : ''}
                            </span>
                        )}
                        <button
                            onClick={loadAll}
                            className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300
                                       font-semibold underline underline-offset-2 transition-colors">
                            Actualizar ahora
                        </button>
                    </div>
                </div>

                {/* Leyenda de señales */}
                <div className="flex flex-wrap gap-3 mb-6 text-xs text-gray-500 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        <strong className="text-green-700 dark:text-green-400">SWING LONG</strong>
                        — Tendencia + estocástico + ADX subiendo, riesgo ≤6%
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
                        <strong className="text-orange-600 dark:text-orange-400">Alto riesgo</strong>
                        — Mismas condiciones pero ATR indica volatilidad &gt;6%
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-slate-600 inline-block" />
                        Espera — Condiciones no confirmadas
                    </div>
                </div>

                {/* Grid de cards — ordenado: SWING LONG → Alto Riesgo → Cerca (2/3) → Espera */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {[...PAIRS]
                        .sort((a, b) => {
                            const ra = SIGNAL_RANK[results[a]?.data?.signal ?? 'ESPERA'] ?? 2;
                            const rb = SIGNAL_RANK[results[b]?.data?.signal ?? 'ESPERA'] ?? 2;
                            if (ra !== rb) return ra - rb;
                            // Dentro de ESPERA: más condiciones cumplidas primero
                            const ca = results[a]?.data?.condMet ?? 0;
                            const cb = results[b]?.data?.condMet ?? 0;
                            return cb - ca;
                        })
                        .map(pair => {
                            const entry = results[pair] ?? { loading: true, data: null, error: null };
                            return (
                                <AssetCard
                                    key={pair}
                                    pair={pair}
                                    loading={entry.loading}
                                    result={entry.data}
                                    error={entry.error}
                                />
                            );
                        })}
                </div>

            </div>
        </div>
    );
}
