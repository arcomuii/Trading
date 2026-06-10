'use client'
import { useState, useEffect } from "react";

const MIN_CHANGE = 1;
const MAX_CHANGE = 2;

// ─── formatters ──────────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function fmtBig(n) {
    if (!n) return "—";
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)         return `$${(n / 1_000).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
}

// ─── technical indicators (pure JS, no dependencies) ─────────────────────────

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
        i === 0
            ? h - low[i]
            : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))
    );
    let prev = tr.slice(0, period).reduce((a, b) => a + b) / period;
    const result = [prev];
    for (let i = period; i < tr.length; i++) {
        prev = (prev * (period - 1) + tr[i]) / period;
        result.push(prev);
    }
    return result; // length = tr.length - period + 1
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
    const wilder = (arr) => {
        if (arr.length < period) return [];
        let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
        const res = [s];
        for (let i = period; i < arr.length; i++)
            res.push(res[res.length - 1] - res[res.length - 1] / period + arr[i]);
        return res;
    };
    const sTR  = wilder(tr);
    const sDMP = wilder(dmP);
    const sDMM = wilder(dmM);
    const diP  = sDMP.map((d, i) => sTR[i] ? d / sTR[i] * 100 : 0);
    const diM  = sDMM.map((d, i) => sTR[i] ? d / sTR[i] * 100 : 0);
    const dx   = diP.map((d, i) => (d + diM[i]) ? Math.abs(d - diM[i]) / (d + diM[i]) * 100 : 0);
    return wilder(dx).map(v => parseFloat(v.toFixed(2)));
}

function analyzePosition(ohlcvData) {
    if (ohlcvData.length < 50) return null;
    const close = ohlcvData.map(c => c.close);
    const high  = ohlcvData.map(c => c.high);
    const low   = ohlcvData.map(c => c.low);
    const n     = close.length;

    // ADX necesita 2×periodo candles; BB/KC/EMA necesitan 50
    const emaPeriod = 50;
    const adxPeriod = n >= 28 ? 14 : n >= 20 ? 10 : 7;

    const emaArr = calcEMA(close, emaPeriod);
    const bb     = calcBB(close, 20, 2);
    const kc     = calcKC(high, low, close, 20, 20, 1.5);
    const adxArr = calcADX(high, low, close, adxPeriod);

    const cur    = close[n - 1];
    const curEMA = emaArr[emaArr.length - 1];
    const curBB  = bb[bb.length - 1];
    const curKC  = kc[kc.length - 1];
    const curADX = adxArr[adxArr.length - 1];

    if (curEMA == null || curBB == null || curKC == null || curADX == null) return null;

    const isSqueezeOn   = curBB.upper <= curKC.upper && curBB.lower >= curKC.lower;
    const isTrendStrong = curADX > 23;
    const trendDir      = cur > curEMA ? "Alcista" : "Bajista";

    return {
        adx: curADX,
        isSqueezeOn,
        isTrendStrong,
        trendDir,
        señalActiva: !isSqueezeOn && isTrendStrong,
        emaPeriod,
        adxPeriod,
        candles: n,
    };
}

// ─── rate-limit queue (1 request at a time, 3 s gap) ────────────────────────
const ohlcQueue = {
    pending: [],
    busy: false,
    add(fn) {
        return new Promise((resolve, reject) => {
            this.pending.push({ fn, resolve, reject });
            this.flush();
        });
    },
    flush() {
        if (this.busy || this.pending.length === 0) return;
        this.busy = true;
        const { fn, resolve, reject } = this.pending.shift();
        fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
                setTimeout(() => { this.busy = false; this.flush(); }, 3000);
            });
    },
};

// Backoff schedule (ms): 15s, 30s, 60s
const RETRY_DELAYS = [15_000, 30_000, 60_000];

async function doFetch(coinId, attempt = 0) {
    const res = await fetch(
        `/api/coingecko/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=14`
    );

    if (res.status === 429) {
        if (attempt < RETRY_DELAYS.length) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
            return doFetch(coinId, attempt + 1);
        }
        throw new Error("RATE_LIMIT");
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();

    if (!Array.isArray(raw) || raw.length < 50)
        throw new Error(`Datos insuficientes (${Array.isArray(raw) ? raw.length : 0} velas)`);

    const data   = raw.map(([, , high, low, close]) => ({ high, low, close }));
    const result = analyzePosition(data);
    if (!result) throw new Error("No se pudieron calcular los indicadores");
    return result;
}

function fetchAndAnalyze(coinId) {
    return ohlcQueue.add(() => doFetch(coinId));
}

// ─── AnalysisPanel ────────────────────────────────────────────────────────────

function AnalysisPanel({ entry, mode, onRetry }) {
    const isUp = mode === "up";

    if (entry.loading) {
        return (
            <div className="flex items-center gap-2 py-3 text-gray-400 text-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Calculando indicadores técnicos…
            </div>
        );
    }

    if (entry.error) {
        const isRateLimit    = entry.error === "RATE_LIMIT";
        const isInsufficient = entry.error.startsWith("Datos insuficientes");
        return (
            <div className="flex items-center gap-3 py-2">
                {isRateLimit ? (
                    <>
                        <span className="text-orange-500 text-sm">⏱ Límite de CoinGecko alcanzado</span>
                        <button onClick={onRetry}
                            className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 underline underline-offset-2">
                            Reintentar
                        </button>
                    </>
                ) : isInsufficient ? (
                    <span className="text-gray-400 text-xs">
                        Moneda reciente — historial insuficiente para análisis técnico (EMA-50 requiere ≥50 velas 4H)
                    </span>
                ) : (
                    <>
                        <span className="text-red-400 text-xs font-mono">Error: {entry.error}</span>
                        <button onClick={onRetry}
                            className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 underline underline-offset-2">
                            Reintentar
                        </button>
                    </>
                )}
            </div>
        );
    }

    const { adx, isSqueezeOn, isTrendStrong, trendDir, señalActiva, emaPeriod, adxPeriod, candles } = entry.data;

    const signalMatch = señalActiva && (
        (isUp  && trendDir === "Alcista") ||
        (!isUp && trendDir === "Bajista")
    );
    const signalContra = señalActiva && (
        (isUp  && trendDir === "Bajista") ||
        (!isUp && trendDir === "Alcista")
    );

    return (
        <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Análisis técnico · velas 4H · {candles} candles
            </p>

            {signalMatch && (
                <div className={`mb-3 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold ${
                    isUp ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                }`}>
                    <span>⚡</span>
                    Señal confirmada — posible entrada {trendDir === "Alcista" ? "long" : "short"}
                </div>
            )}
            {signalContra && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold bg-yellow-100 text-yellow-700">
                    <span>⚠️</span>
                    Señal activa pero en dirección contraria al movimiento del día
                </div>
            )}
            {!señalActiva && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-400 bg-gray-100">
                    <span>🕐</span>
                    Sin señal activa — esperando confirmación
                </div>
            )}

            <div className="flex flex-wrap gap-3">
                {/* Squeeze */}
                <div className="flex-1 min-w-[130px] bg-white border border-gray-100 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1.5">Squeeze</p>
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                        isSqueezeOn
                            ? "bg-red-100 text-red-600"
                            : "bg-green-100 text-green-600"
                    }`}>
                        {isSqueezeOn ? "🔴 Comprimiendo" : "🟢 Liberado"}
                    </span>
                </div>

                {/* ADX */}
                <div className="flex-1 min-w-[130px] bg-white border border-gray-100 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1.5">ADX ({adxPeriod})</p>
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                        isTrendStrong
                            ? "bg-indigo-100 text-indigo-600"
                            : "bg-gray-100 text-gray-500"
                    }`}>
                        {adx} · {isTrendStrong ? "Tendencia fuerte" : "Lateral / débil"}
                    </span>
                </div>

                {/* EMA adaptiva */}
                <div className="flex-1 min-w-[130px] bg-white border border-gray-100 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1.5">EMA {emaPeriod}</p>
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                        trendDir === "Alcista"
                            ? "bg-green-100 text-green-600"
                            : "bg-red-100 text-red-500"
                    }`}>
                        {trendDir === "Alcista" ? "▲" : "▼"} {trendDir}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ─── CoinTable ────────────────────────────────────────────────────────────────

function CoinTable({ rows, mode }) {
    const isUp = mode === "up";
    const [expanded,  setExpanded]  = useState(new Set());
    const [cache,     setCache]     = useState({});
    const [countdown, setCountdown] = useState({});

    const runAnalysis = async (id, delayMs = 0) => {
        if (delayMs > 0) {
            const until = Date.now() + delayMs;
            const tick = () => {
                const left = Math.ceil((until - Date.now()) / 1000);
                if (left <= 0) { setCountdown(p => { const n = { ...p }; delete n[id]; return n; }); return; }
                setCountdown(p => ({ ...p, [id]: left }));
                setTimeout(tick, 1000);
            };
            tick();
            await new Promise(r => setTimeout(r, delayMs));
        }
        setCache(prev => ({ ...prev, [id]: { loading: true } }));
        try {
            const data = await fetchAndAnalyze(id);
            setCache(prev => ({ ...prev, [id]: { loading: false, data } }));
        } catch (err) {
            setCache(prev => ({ ...prev, [id]: { loading: false, error: err.message } }));
        }
    };

    const toggleRow = async (coin) => {
        const id     = coin.id;
        const isOpen = expanded.has(id);

        setExpanded(prev => {
            const s = new Set(prev);
            isOpen ? s.delete(id) : s.add(id);
            return s;
        });

        if (isOpen || cache[id]) return;
        runAnalysis(id);
    };

    if (rows.length === 0) {
        return (
            <div className="text-center text-gray-400 py-20">
                Ninguna moneda en el rango en este momento.
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                            <th className="px-5 py-3.5 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                            <th className="px-5 py-3.5 text-left   text-xs font-semibold text-gray-500 uppercase tracking-wider">Moneda</th>
                            <th className="px-5 py-3.5 text-right  text-xs font-semibold text-gray-500 uppercase tracking-wider">Precio</th>
                            <th className="px-5 py-3.5 text-right  text-xs font-semibold text-gray-500 uppercase tracking-wider">24h %</th>
                            <th className="px-5 py-3.5 text-right  text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Cap. mercado</th>
                            <th className="px-5 py-3.5 text-right  text-xs font-semibold text-gray-500 uppercase tracking-wider">Volumen 24h</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((coin, i) => {
                            const chg    = coin.price_change_percentage_24h;
                            const isOpen = expanded.has(coin.id);
                            const entry  = cache[coin.id];

                            // Show signal dot if analysis is done and signal is active
                            const hasSignal = entry?.data?.señalActiva;

                            return (
                                <>
                                    <tr key={coin.id}
                                        onClick={() => toggleRow(coin)}
                                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                                            isOpen
                                                ? (isUp ? "bg-green-50/60" : "bg-red-50/60")
                                                : (isUp ? "hover:bg-green-50" : "hover:bg-red-50")
                                        }`}>
                                        <td className="px-5 py-3.5 text-gray-400 text-xs">
                                            <span className="mr-1 text-gray-300 text-[10px]">{isOpen ? "▼" : "▶"}</span>
                                            {coin.market_cap_rank ?? i + 1}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <img
                                                    src={coin.image} alt={coin.name}
                                                    className="w-7 h-7 rounded-full"
                                                    onError={e => e.target.style.display = "none"}
                                                />
                                                <div>
                                                    <p className="font-semibold text-gray-800 flex items-center gap-1.5">
                                                        {coin.name}
                                                        {hasSignal && (
                                                            <span title="Señal técnica activa"
                                                                className={`inline-block w-2 h-2 rounded-full ${isUp ? "bg-green-500" : "bg-red-500"}`} />
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-gray-400 uppercase">{coin.symbol}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 text-right font-mono text-gray-700">
                                            ${fmt(coin.current_price, coin.current_price < 1 ? 6 : 2)}
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            <span className={`font-semibold ${isUp ? "text-green-600" : "text-red-500"}`}>
                                                {isUp ? "▲" : "▼"} {fmt(Math.abs(chg))}%
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-right text-gray-500">{fmtBig(coin.market_cap)}</td>
                                        <td className="px-5 py-3.5 text-right text-gray-500">{fmtBig(coin.total_volume)}</td>
                                    </tr>

                                    {isOpen && (
                                        <tr key={`${coin.id}-analysis`}
                                            className={isUp ? "bg-green-50/40" : "bg-red-50/40"}>
                                            <td colSpan={6} className="px-6 py-4">
                                                {countdown[coin.id] ? (
                                                    <div className="flex items-center gap-2 py-2 text-orange-400 text-sm">
                                                        <span>⏱</span>
                                                        Esperando {countdown[coin.id]}s antes de reintentar…
                                                    </div>
                                                ) : entry ? (
                                                    <AnalysisPanel entry={entry} mode={mode}
                                                        onRetry={() => runAnalysis(coin.id, 15_000)} />
                                                ) : (
                                                    <div className="flex items-center gap-2 py-2 text-gray-400 text-sm">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                             stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                                                             strokeLinejoin="round" className="animate-spin">
                                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                                        </svg>
                                                        Iniciando análisis…
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400 flex items-center justify-between">
                <span>Fuente: CoinGecko · Filtro: {isUp ? `+${MIN_CHANGE}% a +${MAX_CHANGE}%` : `-${MIN_CHANGE}% a -${MAX_CHANGE}%`} en 24h</span>
                <span className="text-gray-300">Clic en una fila para ver análisis técnico</span>
            </div>
        </div>
    );
}

// ─── Prospectos ───────────────────────────────────────────────────────────────

export default function ProspectosPage() {
    const [coins,          setCoins]          = useState([]);
    const [loading,        setLoading]        = useState(true);
    const [error,          setError]          = useState(null);
    const [lastUpdate,     setLastUpdate]     = useState(null);
    const [search,         setSearch]         = useState("");
    const [tab,            setTab]            = useState("up");
    const [bitunixSymbols, setBitunixSymbols] = useState(null); // null = cargando

    // Cargar contratos disponibles en Bitunix (una sola vez)
    useEffect(() => {
        fetch("/api/bitunix/api/v1/futures/market/tickers")
            .then(r => r.json())
            .then(json => {
                const list = Array.isArray(json?.data)   ? json.data   :
                             Array.isArray(json?.result) ? json.result :
                             Array.isArray(json)         ? json        : [];
                const symbols = new Set(
                    list.map(c =>
                        (c.baseCoin ?? c.symbol?.replace(/USDT$|USDC$|BUSD$|PERP$/i, '') ?? '').toUpperCase()
                    ).filter(Boolean)
                );
                if (symbols.size === 0) throw new Error('empty');
                setBitunixSymbols(symbols);
            })
            .catch(() => setBitunixSymbols(new Set())); // si falla, no filtra
    }, []);

    useEffect(() => {
        const fetchCoins = async () => {
            try {
                setError(null);
                const [p1, p2] = await Promise.all([
                    fetch("/api/coingecko/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h"),
                    fetch("/api/coingecko/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2&price_change_percentage=24h"),
                ]);
                const [data1, data2] = await Promise.all([p1.json(), p2.json()]);
                setCoins([...(Array.isArray(data1) ? data1 : []), ...(Array.isArray(data2) ? data2 : [])]);
                setLastUpdate(new Date());
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchCoins();
        const id = setInterval(fetchCoins, 10 * 60_000);
        return () => clearInterval(id);
    }, []);

    const q         = search.toLowerCase();
    const match     = c => !q || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q);
    // Si bitunixSymbols es null (cargando) o vacío (error) → no filtra; si tiene datos → filtra
    const inBitunix = c => !bitunixSymbols?.size || bitunixSymbols.has(c.symbol.toUpperCase());

    const upCoins = coins
        .filter(c => {
            const chg = c.price_change_percentage_24h;
            return chg != null && chg >= MIN_CHANGE && chg <= MAX_CHANGE && match(c) && inBitunix(c);
        })
        .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);

    const downCoins = coins
        .filter(c => {
            const chg = c.price_change_percentage_24h;
            return chg != null && chg <= -MIN_CHANGE && chg >= -MAX_CHANGE && match(c) && inBitunix(c);
        })
        .sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h);

    const activeRows = tab === "up" ? upCoins : downCoins;

    return (
        <div className="min-h-screen bg-gray-50 py-10 px-6">
            <div className="max-w-6xl mx-auto">

                <div className="mb-6">
                    <h1 className="text-3xl font-bold text-gray-800">Prospectos</h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Rango ±{MIN_CHANGE}%–±{MAX_CHANGE}% en 24h · actualiza cada 10 min
                        {lastUpdate && <span> · {lastUpdate.toLocaleTimeString("es-MX")}</span>}
                    </p>
                    <p className="text-xs mt-1">
                        {bitunixSymbols === null && (
                            <span className="text-gray-400">Cargando contratos de Bitunix…</span>
                        )}
                        {bitunixSymbols !== null && bitunixSymbols.size > 0 && (
                            <span className="text-indigo-500 font-semibold">
                                Bitunix · {bitunixSymbols.size} contratos disponibles
                            </span>
                        )}
                        {bitunixSymbols !== null && bitunixSymbols.size === 0 && (
                            <span className="text-orange-400">No se pudo cargar la lista de Bitunix · mostrando todas</span>
                        )}
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-5">
                    <button
                        onClick={() => setTab("up")}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                            tab === "up"
                                ? "bg-green-500 text-white border-green-500"
                                : "bg-white text-gray-500 border-gray-200 hover:border-green-300 hover:text-green-600"
                        }`}
                    >
                        ▲ Subidas
                        {!loading && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                                tab === "up" ? "bg-green-400 text-white" : "bg-green-100 text-green-600"
                            }`}>
                                {upCoins.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setTab("down")}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                            tab === "down"
                                ? "bg-red-500 text-white border-red-500"
                                : "bg-white text-gray-500 border-gray-200 hover:border-red-300 hover:text-red-500"
                        }`}
                    >
                        ▼ Bajadas
                        {!loading && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                                tab === "down" ? "bg-red-400 text-white" : "bg-red-100 text-red-500"
                            }`}>
                                {downCoins.length}
                            </span>
                        )}
                    </button>
                </div>

                {loading && (
                    <div className="flex items-center justify-center h-64 text-gray-400 text-lg">
                        Cargando prospectos...
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700">
                        <p className="font-semibold mb-1">Error al obtener datos</p>
                        <p className="text-sm font-mono">{error}</p>
                    </div>
                )}

                {!loading && !error && (
                    <>
                        <div className="flex items-center gap-4 mb-5">
                            <input
                                type="text"
                                placeholder="Buscar por nombre o símbolo..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white shadow-sm w-72"
                            />
                            <span className="text-sm text-gray-400">
                                {activeRows.length} moneda{activeRows.length !== 1 ? "s" : ""}
                            </span>
                        </div>

                        <CoinTable rows={activeRows} mode={tab} />
                    </>
                )}

            </div>
        </div>
    );
}
