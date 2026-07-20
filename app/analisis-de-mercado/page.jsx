'use client'
import { useState, useEffect, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
// Binance público soporta ~6000 weight/min (klines de 200 velas = 2 de weight, ≈3000
// req/min posibles) — estas pausas son mucho más chicas que las de CoinGecko anónimo,
// con margen de sobra.
const GAP_MS       = 1_500;
const RETRY_DELAYS = [15_000, 30_000, 60_000];

// Horario de la bolsa de Nueva York (9:30 a.m. – 4:00 p.m. hora del Este), en
// UTC. CDMX es siempre UTC-6, pero el Este de EE.UU. sí cambia de horario:
// EST (invierno, UTC-5) → sesión 8:30 a.m. – 3:00 p.m. Méx.
// EDT (verano,   UTC-4) → sesión 7:30 a.m. – 2:00 p.m. Méx (una hora antes).
const NY_SESSION_EST_UTC = { startH: 14, startM: 30, endH: 21, endM: 0 }; // 8:30–15:00 Méx
const NY_SESSION_EDT_UTC = { startH: 13, startM: 30, endH: 20, endM: 0 }; // 7:30–14:00 Méx

// Reglas vigentes desde 2007: DST empieza el 2º domingo de marzo (2 a.m. hora
// local EST) y termina el 1er domingo de noviembre (2 a.m. hora local EDT).
function nthSundayUTC(year, monthIndex, n) {
    const firstDow     = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const firstSunday  = firstDow === 0 ? 1 : (7 - firstDow + 1);
    return new Date(Date.UTC(year, monthIndex, firstSunday + (n - 1) * 7));
}
function isUsDaylightSaving(date) {
    const year     = date.getUTCFullYear();
    const dstStart = new Date(nthSundayUTC(year, 2, 2).getTime()  + 7 * 3_600_000); // 2 a.m. EST = 07:00 UTC
    const dstEnd   = new Date(nthSundayUTC(year, 10, 1).getTime() + 6 * 3_600_000); // 2 a.m. EDT = 06:00 UTC
    return date >= dstStart && date < dstEnd;
}

// Banda de proximidad al máximo/mínimo de la sesión que dispara una señal.
const PROXIMITY_MIN = 0; // %
const PROXIMITY_MAX = 1; // %

// Contratos disponibles en Bitunix Futures (snapshot estático en vez de fetch en vivo)
const BITUNIX_TICKERS = [
    "BNB", "XLM", "XMR", "CC", "LINK", "LAB", "HBAR", "AVAX", "SUI", "XAUT",
    "TAO", "PAXG", "ASTER", "OKB", "WLD", "ONDO", "MNT", "AAVE", "ICP", "MORPHO",
    "ETC", "DEXE", "QNT", "STABLE", "ATOM", "RENDER", "ALGO", "BEAT", "KAS", "JST",
    "ENA", "VELVET", "VVV", "APT", "INJ", "AERO", "CAKE", "LIT", "DASH", "JTO",
    "FET", "VET", "PENGU", "VIRTUAL", "TIA", "XRP", "GWEI", "SUN", "GRASS", "ETHFI",
    "STX", "SPX", "PYTH", "BSV", "XPL", "FRAX", "ZBCN", "MON", "2Z", "PIEVERSE",
    "JASMY", "UB", "PENDLE", "LDO", "ZRO", "STRK", "GRT", "FF", "DOGE", "CHZ",
    "WIF", "AXS", "EIGEN", "RAY", "ENS", "SYRUP", "IOTA", "COMP", "TWT", "KAITO",
    "SKYAI", "NEO", "DYDX", "THETA", "MANA", "BAT", "SAND", "BAS", "AR", "GALA",
    "BILL", "SFP", "TAC", "TAG", "AWE", "IMX", "CVX", "ZK", "A", "KMNO",
    "GLM", "1INCH", "SENT", "RE", "MET", "ATH", "BANANAS31", "ZEC", "FORM", "MAGMA",
    "RAVE", "SYN", "LPT", "WAL", "SNX", "EGLD", "ARKM", "GAS", "QTUM", "RSR",
    "USELESS", "ORCA", "RIVER", "HOME", "RIF", "MELANIA", "ALLO", "Q", "ZRX", "FLUID",
    "ORDI", "ZAMA", "RVN", "SIREN", "SAFE", "BIO", "SOON", "NMR", "PLUME", "IO",
    "YFI", "ALCH", "ICNT", "BERA", "ENJ", "ZIL", "JELLYJELLY", "KSM", "GMX", "HOT",
    "LINEA", "CYS", "ZETA", "BRETT", "SPK", "COAI", "APR", "MINA", "AXL", "POLYX",
    "IDOL", "ROSE", "DUSK", "0G", "KAVA", "CKB", "BARD", "FLOW", "POPCAT", "ASTR",
    "ZEREBRO", "XVS", "ESP", "BLUR", "BR", "CELO", "SUSHI", "DEEP", "RED", "MANTA",
    "GPS", "MOODENG", "TRB", "TRIA", "HUMA", "AZTEC", "SAHARA", "ROBO", "NOT", "KGEN",
    "PROVE", "XVG", "SQD", "VTHO", "CROSS", "NXPC", "MMT", "MOCA", "ANKR", "MANTRA",
    "FOGO", "ZEST", "UMA", "VANA", "FOLKS", "AT", "ZORA", "MEW", "TRUTH", "LTC",
    "RPL", "API3", "USTC", "POWR", "ACX", "AVNT", "SSV", "IRYS", "BOME", "HIVE",
    "OCEAN", "ICX", "BNT", "CATI", "NOW", "WAVES", "SKR", "REZ", "BAND", "PEOPLE",
    "ZBT", "OPG", "GIGGLE", "ACU", "COTI", "EUL", "IOST", "NAORIS", "EDU", "MERL",
    "ETHW", "XAN", "AUCTION", "GMT", "NEAR", "ILV", "STG", "CYBER", "STEEM", "ONG",
    "CARV", "FIDA", "PUNDIX", "B2", "MTL", "SKL", "ARK", "RLC", "XPIN", "BNX",
    "CTSI", "LSK", "PROM", "SIGN", "LISTA", "AIXBT", "AGIX", "KNC", "WAXP", "EWT",
    "BREV", "BCH", "SAPIEN", "LQTY", "YGG", "AEVO", "CTK", "SXT", "MYX", "USUAL",
    "CGPT", "CVC", "SPELL", "SLP", "LUMIA", "BLUAI", "NIL", "SOMI", "TRX", "CTR",
    "PIPPIN", "MAGIC", "CETUS", "INX", "YB", "AGLD", "MOVR", "ERA", "WET", "BLESS",
    "CHR", "BIGTIME", "LAYER", "BICO", "FLOCK", "AIOT", "TA", "HEI", "DOT", "ZKC",
    "TAIKO", "XNY", "C98", "DIA", "ENSO", "LA", "OG", "XAI", "BLEND", "DOLO",
    "PARTI", "TNSR", "KERNEL", "HMSTR", "DOOD", "ON", "FIL", "STORJ", "GUN", "RAD",
    "CELR", "PORTAL", "NEWT", "STO", "MUBARAK", "OGN", "RARE", "GRIFFAIN", "ELSA", "DRIFT",
    "TRUST", "MAV", "CHILLGUY", "DYM", "MITO", "AKE", "TUT", "4", "RESOLV", "RECALL",
    "WCT", "MAVIA", "ARPA", "LYN", "ASR", "HFT", "COOKIE", "GAL", "SWARMS", "VANRY",
    "TRADOOR", "ANTHROPIC", "TLM", "V", "GTC", "SHELL", "SAGA", "AVA", "AIA", "VIC",
    "BTR", "TAKE", "ESPORTS", "FHE", "XEM", "EVAA", "HEMI", "MU", "SOLV", "EPIC",
    "KOMA", "MLN", "TOWNS", "NFP", "BLZ", "ALPINE", "REN", "HAEDAL", "XPT", "COIN",
    "OPN", "ACT", "OPENAI", "ZKP", "MASK", "SNDK", "FRONT", "XTZ", "PTB", "IOTX",
    "PRL", "PUMP", "ONT", "DRAM", "KAT", "KITE", "BAN", "T", "PI", "ACE",
    "CORE", "ID", "FARTCOIN", "UP", "SLX", "UNFI", "PHB", "BABY", "SPACE", "EDEN",
    "JUP", "DIS", "BMT", "FIGHT", "SOPH", "BOND", "COST", "JOE", "HD", "M",
    "APEX", "DOGS", "KEY", "S", "ARIA", "TURTLE", "BASED", "ADA", "LOOM", "SPCX",
    "TURBO", "TST", "AIN", "COS", "XAU", "POL", "MEGA", "UAI", "SONIC", "SOL",
    "CLO", "HANA", "BTW", "PNUT", "NIGHT", "GUA", "GOAT", "BROCCOLI", "GENIUS", "STMX",
    "SUPER", "OP", "ZEN", "TREE", "ORCL", "BSB", "TOSHI", "IN", "NOM", "ME",
    "COMBO", "XPD", "LIGHT", "POWER", "G", "PIXEL", "HOLO", "PROMPT", "BTC", "H",
    "RUNE", "THE", "TEST", "F", "COW", "COPPER", "CFX", "B", "ANIME", "W",
    "TON", "OPEN", "MEME", "KAIA", "CLANKER", "C", "SKY", "MSTR", "US", "BANK",
    "ORBS", "BB", "ARB", "WLFI", "WOO", "TSLA", "DAR", "CHIP", "1000BONK", "ALT",
    "USAR", "AMD", "INTC", "ZM", "CRCL", "TRUMP", "1000SATS", "SEI", "O", "ARX",
    "HYPER", "ETH", "AAOI", "CBRS", "METIS", "BIRB", "NBIS", "CRO", "ACH", "HIGH",
    "STBL", "ALICE", "SMCI", "PLTR", "LITE", "BANANA", "QCOM", "NFLX", "NVDA", "AIO",
    "MRVL", "CRM", "CRWD", "GOOGL", "MSFT", "CRWV", "SPY", "AMZN", "1000CAT", "BABA",
    "ASTS", "KLAY", "FLNC", "APE", "AMAT", "HYPE", "AAPL", "GLW", "CRV", "META",
    "ORDER", "LLY", "COLLECT", "IREN", "EWY", "1MBABYDOGE", "1000SHIB", "RIVN", "MATIC", "JCT",
    "UNI", "1000RATS", "USO", "INIT", "AVGO", "CFG", "MOVE", "RKLB", "DOG", "BE",
    "ONE", "QQQ", "ASML", "MIRA", "DELL", "SCR", "1000CHEEMS", "TSM", "FTM",
];

// ─── Sesión de Nueva York (única condición de validación) ─────────────────────
// Encuentra la ventana [inicio, fin) de la sesión NY del día anterior (siempre
// la última sesión completa, nunca la de hoy en curso). NYSE no opera sábado
// ni domingo, así que si "hoy" es sábado, domingo o lunes — cuyo "ayer" sería
// domingo, sin sesión — la última sesión válida es la del viernes.
function buildSessionWindow(date) {
    const { startH, startM, endH, endM } = isUsDaylightSaving(date) ? NY_SESSION_EDT_UTC : NY_SESSION_EST_UTC;
    return {
        start: new Date(Date.UTC(
            date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), startH, startM, 0, 0
        )),
        end: new Date(Date.UTC(
            date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), endH, endM, 0, 0
        )),
    };
}

function getLatestSessionWindow(now = new Date()) {
    const dow = now.getUTCDay(); // 0=domingo … 6=sábado

    if (dow === 0) return buildSessionWindow(new Date(now.getTime() - 2 * 86_400_000)); // domingo → viernes
    if (dow === 6) return buildSessionWindow(new Date(now.getTime() - 1 * 86_400_000)); // sábado  → viernes
    if (dow === 1) return buildSessionWindow(new Date(now.getTime() - 3 * 86_400_000)); // lunes   → viernes ("ayer" sería domingo)

    // Martes a viernes: la sesión completa del día anterior.
    return buildSessionWindow(new Date(now.getTime() - 86_400_000));
}

// Único chequeo: ¿el precio actual está a 1%–2% del máximo o del mínimo
// alcanzado por las velas de 30 min dentro de la sesión NY (8:30–15:00 Méx)?
function detectSessionProximity(candles) {
    const { start, end } = getLatestSessionWindow();
    const sessionCandles = candles.filter(c => c.openTime >= start.getTime() && c.openTime < end.getTime());
    if (sessionCandles.length < 2) return null;

    const sessionHigh = Math.max(...sessionCandles.map(c => c.high));
    const sessionLow  = Math.min(...sessionCandles.map(c => c.low));
    const curPrice     = candles[candles.length - 1].close;
    if (!sessionHigh || !sessionLow) return null;

    // Positivo = todavía no llega a ese extremo; negativo o cero = ya lo tocó/rompió.
    const distToHighPct = ((sessionHigh - curPrice) / sessionHigh) * 100;
    const distToLowPct  = ((curPrice - sessionLow) / sessionLow) * 100;

    // El extremo relevante es el que está realmente más cerca del precio actual
    // (menor distancia absoluta) — antes se evaluaba cada lado por separado y, si
    // el precio ya había roto el mínimo (distancia negativa, fuera de la banda),
    // el código caía por error en "cerca del máximo" aunque el mínimo estuviera
    // muchísimo más cerca.
    const closerToHigh = Math.abs(distToHighPct) <= Math.abs(distToLowPct);
    const closestPct   = closerToHigh ? distToHighPct : distToLowPct;
    const direction     = closerToHigh ? 'high' : 'low';

    // Solo alerta si ese extremo más cercano está entre 1% y 2% de distancia
    // todavía por llegar (un valor negativo significa que ya lo rompió, y un
    // valor <1% significa que ya está prácticamente encima).
    if (closestPct < PROXIMITY_MIN || closestPct > PROXIMITY_MAX) return null;

    return {
        direction, // 'high' | 'low'
        curPrice, sessionHigh, sessionLow,
        distancePct: closestPct,
        sessionStart: start, sessionEnd: end,
    };
}

// Niveles de entrada/TP/SL para la ruptura del rango de la sesión: si el precio
// está cerca del máximo se plantea un breakout alcista sobre ese nivel (y
// viceversa para el mínimo), con el mismo esquema de medición que patrones-1h
// (TP2 = movimiento completo del rango, TP1 = 50%, TP3 = extensión 1.618).
function calcSessionLevels(result) {
    const { direction, sessionHigh, sessionLow } = result;
    const range = sessionHigh - sessionLow;
    if (!(range > 0)) return null;

    const isHigh = direction === 'high';
    const entry  = isHigh ? sessionHigh * 1.001 : sessionLow * 0.999;
    const sl     = isHigh ? sessionLow  * 0.999 : sessionHigh * 1.001;

    const fullMove = isHigh ? range : -range;
    const tp2 = entry + fullMove;
    const tp1 = entry + fullMove * 0.5;
    const tp3 = entry + fullMove * 1.618;

    const risk = Math.abs(entry - sl);
    const rrOf = tp => risk > 0 ? Math.abs(tp - entry) / risk : 0;

    return { entry, sl, tp1, tp2, tp3, rr1: rrOf(tp1), rr2: rrOf(tp2), rr3: rrOf(tp3) };
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function requestNotifPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted')  return true;
    if (Notification.permission === 'denied')   return false;
    return (await Notification.requestPermission()) === 'granted';
}

function sendSessionNotification(coin, result) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const sym    = coin.symbol.toUpperCase();
    const isHigh = result.direction === 'high';
    const label  = isHigh ? 'cerca del máximo' : 'cerca del mínimo';
    try {
        const n = new Notification(
            `${isHigh ? '▲' : '▼'} ${sym} ${label}`,
            {
                body:     `${fmt(result.distancePct)}% de distancia · sesión NY (30m)`,
                icon:     coin.image || '/favicon.ico',
                tag:      `session-${coin.id}-${result.direction}`,
                renotify: true,
            }
        );
        n.onerror = (e) => console.error('[SessionNotif] Error:', e);
    } catch (e) {
        console.error('[SessionNotif] Excepción:', e);
    }
}

async function sendSessionEmail(coin, result) {
    try {
        const res = await fetch('/api/session-alert-email', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coinName:    coin.name,
                symbol:      coin.symbol.toUpperCase(),
                image:       coin.image,
                bitunixUrl:  `https://www.bitunix.com/es-es/contract-trade/${coin.symbol.toUpperCase()}USDT`,
                direction:   result.direction,
                price:       result.curPrice,
                sessionHigh: result.sessionHigh,
                sessionLow:  result.sessionLow,
                distancePct: result.distancePct,
            }),
        });
        const json = await res.json();
        if (!res.ok) console.error('[SessionEmail] Error:', json);
        else         console.log('[SessionEmail] Enviado:', coin.symbol, result.direction);
    } catch (e) {
        console.error('[SessionEmail] Excepción:', e);
    }
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmt(n, dec = 2) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPrice(p) {
    if (p == null || isNaN(p)) return "—";
    return p < 1
        ? `$${Number(p).toFixed(5)}`
        : `$${Number(p).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSessionTime(d) {
    return d.toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: '2-digit', minute: '2-digit' });
}

// ─── Fetch velas de 30m con retry ──────────────────────────────────────────────
// Binance público: sin API key, límite ~6000 weight/min (klines de 200 velas = 2 de
// weight) — muchísimo más margen que CoinGecko anónimo. `symbol` es el par de Binance,
// ej. "BTCUSDT".
async function fetchSessionSignal(symbol, attempt = 0) {
    const res = await fetch(
        `/api/binance/api/v3/klines?symbol=${symbol}&interval=30m&limit=100`
    );
    if (res.status === 429 || res.status === 418) {
        // 418 = IP bloqueada temporalmente por exceso de weight (poco probable a este ritmo)
        if (attempt < RETRY_DELAYS.length) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
            return fetchSessionSignal(symbol, attempt + 1);
        }
        throw new Error("RATE_LIMIT");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    // Binance responde un objeto (no array) con {code, msg} para símbolos inexistentes
    if (!Array.isArray(raw) || raw.length < 5)
        throw new Error(`insufficient:${Array.isArray(raw) ? raw.length : 0}`);
    // Binance klines format: [openTime, open, high, low, close, volume, closeTime, ...]
    const candles = raw.map(([openTime, , high, low, close]) => ({
        openTime,
        high:  parseFloat(high),
        low:   parseFloat(low),
        close: parseFloat(close),
    }));
    return detectSessionProximity(candles);
}

async function cancellableWait(ms, abortRef) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (abortRef.current) return;
        await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
    }
}

// ─── SessionCard ────────────────────────────────────────────────────────────────
function SessionCard({ coin, result, updatedAt }) {
    const isHigh = result.direction === 'high';
    const color  = isHigh ? 'text-red-500 dark:text-red-400'   : 'text-green-600 dark:text-green-400';
    const bg     = isHigh ? 'bg-red-50 dark:bg-red-950'        : 'bg-green-50 dark:bg-green-950';
    const label  = isHigh ? 'Cerca del máximo'                 : 'Cerca del mínimo';
    const emoji  = isHigh ? '▲' : '▼';
    const bitunixUrl = `https://www.bitunix.com/es-es/contract-trade/${coin.symbol.toUpperCase()}USDT`;
    const lv = calcSessionLevels(result);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 p-5">
            {lv && (
                <div className={`flex items-center justify-between mb-3 rounded-xl px-3 py-2 ${
                    isHigh ? "bg-green-500 dark:bg-green-600" : "bg-red-500 dark:bg-red-600"
                }`}>
                    <span className="text-sm font-black text-white tracking-widest">
                        {isHigh ? "▲ LONG" : "▼ SHORT"}
                    </span>
                    <span className="text-[10px] font-semibold text-white/75">
                        {isHigh ? "Ruptura sobre el máximo" : "Ruptura bajo el mínimo"}
                    </span>
                </div>
            )}

            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800 dark:text-slate-100">{coin.symbol.toUpperCase()}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bg} ${color}`}>{emoji} {label}</span>
                </div>
                <span className={`text-xs font-mono font-semibold ${color}`}>{fmt(result.distancePct)}%</span>
            </div>

            <p className="text-2xl font-black text-gray-800 dark:text-slate-100 font-mono mb-4">{fmtPrice(result.curPrice)}</p>

            <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-[9px] uppercase text-gray-400 dark:text-slate-500 font-semibold">Máximo sesión</p>
                    <p className="text-sm font-bold text-red-500 dark:text-red-400 font-mono">{fmtPrice(result.sessionHigh)}</p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-[9px] uppercase text-gray-400 dark:text-slate-500 font-semibold">Mínimo sesión</p>
                    <p className="text-sm font-bold text-green-600 dark:text-green-400 font-mono">{fmtPrice(result.sessionLow)}</p>
                </div>
            </div>

            {lv && (
                <div className="mb-3 rounded-xl p-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-2">
                        Niveles de ruptura del rango
                    </p>
                    <div className="grid grid-cols-2 gap-2 mb-1.5">
                        <div className="rounded-lg p-2 text-center border bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800">
                            <p className="text-[9px] font-semibold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide mb-0.5">Entrada</p>
                            <p className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 font-mono">{fmtPrice(lv.entry)}</p>
                        </div>
                        <div className="rounded-lg p-2 text-center border bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800">
                            <p className="text-[9px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide mb-0.5">SL</p>
                            <p className="text-[11px] font-bold text-red-700 dark:text-red-300 font-mono">{fmtPrice(lv.sl)}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {[["TP1", lv.tp1, lv.rr1], ["TP2", lv.tp2, lv.rr2], ["TP3", lv.tp3, lv.rr3]].map(([tlabel, tpVal, rrVal]) => (
                            <div key={tlabel} className="rounded-lg p-2 text-center border bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800">
                                <p className="text-[9px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-0.5">{tlabel}</p>
                                <p className="text-[11px] font-bold text-green-700 dark:text-green-300 font-mono">{fmtPrice(tpVal)}</p>
                                <p className="text-[8px] font-semibold text-green-500 dark:text-green-400/80">1:{fmt(rrVal, 1)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-3">
                Sesión NY: {fmtSessionTime(result.sessionStart)} – {fmtSessionTime(result.sessionEnd)} (Méx)
            </p>

            <div className="flex items-center justify-between border-t border-gray-100 dark:border-slate-800 pt-3">
                <a href={bitunixUrl} target="_blank" rel="noopener noreferrer"
                   className="text-xs font-semibold text-indigo-500 hover:text-indigo-700">
                    Ver en Bitunix →
                </a>
                {updatedAt && (
                    <span className="text-[10px] text-gray-300 dark:text-slate-600">
                        {updatedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                )}
            </div>
        </div>
    );
}

// ─── AnalisisMercadoPage ────────────────────────────────────────────────────────
const FILTER_TABS = [
    { key: "all",  label: "Todos" },
    { key: "high", label: "Cerca del máximo" },
    { key: "low",  label: "Cerca del mínimo" },
];

// Binance no reporta market cap (eso es específico de CoinGecko) — el volumen 24h
// en USDT es el proxy de "tamaño/relevancia" disponible sin salir de Binance.
const SORT_OPTIONS = [
    { key: "proximity", label: "Proximidad" },
    { key: "volume",    label: "Volumen 24h" },
];

export default function AnalisisMercadoPage() {
    const [bitunixSymbols, setBitunixSymbols] = useState(null);
    const [bitunixCount,   setBitunixCount]   = useState(0);
    const [coins,          setCoins]          = useState([]);
    const [loadingCoins,   setLoadingCoins]   = useState(true);
    const [analysisCache,  setAnalysisCache]  = useState({});
    const [progress,       setProgress]       = useState({ done: 0, total: 0 });
    const [scanRunning,    setScanRunning]     = useState(false);
    const [lastScan,       setLastScan]        = useState(null);
    const [currentCoin,    setCurrentCoin]    = useState(null);
    const [activeFilter,   setActiveFilter]   = useState("all");
    const [sortBy,         setSortBy]         = useState("proximity");
    const [showCoverage,   setShowCoverage]   = useState(false);
    const notifiedRef = useRef(new Set());
    const [notifPerm, setNotifPerm] = useState('default');

    // Contador de generación: cada scan nuevo invalida al anterior de forma
    // permanente (a diferencia de un booleano compartido, no puede "revivir" si se resetea).
    const scanGenRef  = useRef(0);

    // Request notification permission on load
    useEffect(() => {
        requestNotifPermission().then(() => {
            if ('Notification' in window) setNotifPerm(Notification.permission);
        });
    }, []);

    // 1. Load Bitunix symbols (snapshot estático, ver BITUNIX_TICKERS arriba)
    useEffect(() => {
        const symbols = new Set();
        BITUNIX_TICKERS.forEach(sym => {
            const raw = sym.toUpperCase();
            if (!raw) return;
            symbols.add(raw);
            const stripped = raw.replace(/^1000/, '');
            if (stripped !== raw) symbols.add(stripped);
        });
        setBitunixCount(symbols.size);
        setBitunixSymbols(symbols.size > 0 ? symbols : new Set());
    }, []);

    // 2. Construir la lista de monedas directo desde los tickers de Bitunix, enriquecida
    // con precio/variación 24h de Binance (una sola petición bulk).
    useEffect(() => {
        if (bitunixSymbols === null) return;
        let cancelled = false;

        const fetchTickers = async (attempt = 0) => {
            const r = await fetch('/api/binance/api/v3/ticker/24hr');
            if (!r.ok) {
                if (attempt < 2) {
                    await new Promise(res => setTimeout(res, 5_000));
                    return fetchTickers(attempt + 1);
                }
                throw new Error(`HTTP ${r.status}`);
            }
            return r.json();
        };

        const load = async () => {
            setLoadingCoins(true);
            try {
                const tickers = await fetchTickers();
                if (cancelled) return;

                const bySymbol = {};
                if (Array.isArray(tickers)) tickers.forEach(t => { bySymbol[t.symbol] = t; });

                // Símbolo base (sin el prefijo "1000x"/"1Mx" que usa Bitunix para contratos
                // con multiplicador) — Binance usa siempre el ticker real.
                const baseSymbols = new Set();
                BITUNIX_TICKERS.forEach(raw => {
                    const base = raw.replace(/^1000/, '').replace(/^1M/, '');
                    if (base) baseSymbols.add(base);
                });

                const list = [...baseSymbols].map(sym => {
                    const t = bySymbol[`${sym}USDT`];
                    return {
                        id:                          sym.toLowerCase(),
                        symbol:                      sym.toLowerCase(),
                        name:                        sym,
                        image:                       null,
                        current_price:               t ? parseFloat(t.lastPrice) : null,
                        market_cap:                  null,
                        quote_volume_24h:            t ? parseFloat(t.quoteVolume) : null,
                        price_change_percentage_24h: t ? parseFloat(t.priceChangePercent) : null,
                    };
                });
                setCoins(list);
            } catch (err) {
                console.error("Binance ticker error:", err);
            } finally {
                if (!cancelled) setLoadingCoins(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [bitunixSymbols]);

    // Scan inicia solo con el botón "Actualizar ahora"

    // Cleanup: invalida cualquier scan en vuelo al desmontar
    useEffect(() => () => { scanGenRef.current++; }, []);

    const runScan = async (coinsList) => {
        const myGen = ++scanGenRef.current; // invalida cualquier scan anterior de inmediato
        const stale = () => scanGenRef.current !== myGen;
        const waitRef = { get current() { return stale(); } };

        notifiedRef.current.clear();
        setAnalysisCache({});
        setProgress({ done: 0, total: coinsList.length });
        setScanRunning(true);
        setCurrentCoin(null);

        for (let i = 0; i < coinsList.length; i++) {
            if (stale()) break;
            const coin = coinsList[i];
            setCurrentCoin(coin);
            setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: true } }));

            try {
                const data = await fetchSessionSignal(`${coin.symbol.toUpperCase()}USDT`);
                if (!stale()) {
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, data, updatedAt: new Date() } }));

                    if (data && !notifiedRef.current.has(coin.id)) {
                        notifiedRef.current.add(coin.id);
                        // sendSessionNotification(coin, data);
                        // sendSessionEmail(coin, data);
                    }
                }
            } catch (err) {
                if (!stale())
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, error: err.message } }));
            }

            if (!stale()) setProgress(prev => ({ ...prev, done: prev.done + 1 }));
            if (i < coinsList.length - 1 && !stale())
                await cancellableWait(GAP_MS, waitRef);
        }

        if (!stale()) {
            setCurrentCoin(null);
            setLastScan(new Date());
            setScanRunning(false);
        }
    };

    const restartScan = () => {
        scanGenRef.current++; // invalida de inmediato cualquier scan en curso
        setTimeout(() => { if (coins.length > 0) runScan(coins); }, 150);
    };

    // Scan inicia solo con el botón "Actualizar ahora" — sin auto-scan.

    // ─── Derive displayed signals ──────────────────────────────────────────────
    const allSignals = coins
        .filter(c => !!analysisCache[c.id]?.data)
        .sort((a, b) => sortBy === "volume"
            ? (b.quote_volume_24h ?? 0) - (a.quote_volume_24h ?? 0)
            : analysisCache[a.id].data.distancePct - analysisCache[b.id].data.distancePct);

    const filtered = activeFilter === "all"
        ? allSignals
        : allSignals.filter(c => analysisCache[c.id].data.direction === activeFilter);

    const countByTab = {
        all:  allSignals.length,
        high: allSignals.filter(c => analysisCache[c.id].data.direction === "high").length,
        low:  allSignals.filter(c => analysisCache[c.id].data.direction === "low").length,
    };

    const pctDone    = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
    const minsLeft   = progress.total > progress.done
        ? Math.ceil((progress.total - progress.done) * GAP_MS / 60_000) : 0;
    const initialLoad = bitunixSymbols === null || loadingCoins;

    // Cobertura Bitunix vs Binance: ¿tenemos precio en vivo de Binance para este ticker?
    const foundCoins    = coins.filter(c => c.current_price != null);
    const unmatchedSyms = coins.filter(c => c.current_price == null).map(c => c.symbol.toUpperCase()).sort();
    const sessionWindow = getLatestSessionWindow();

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-6">
            <div className="max-w-6xl mx-auto">

                {/* ─── Header ───────────────────────────────────────────────── */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Análisis de Mercado</h1>
                    <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">
                        Proximidad al máximo o mínimo de velas de 30 min dentro de la sesión de Nueva York analizada ({fmtSessionTime(sessionWindow.start)} – {fmtSessionTime(sessionWindow.end)} Méx) · señal entre 0% y 1% de distancia
                    </p>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {bitunixSymbols === null ? (
                            <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">Cargando Bitunix…</span>
                        ) : bitunixCount > 0 ? (
                            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-950 px-2.5 py-1 rounded-full">
                                ⚡ Bitunix · {bitunixCount} contratos
                            </span>
                        ) : (
                            <span className="text-xs text-orange-500 bg-orange-50 dark:bg-orange-950 px-2.5 py-1 rounded-full">
                                Bitunix no disponible
                            </span>
                        )}
                        {loadingCoins && bitunixSymbols !== null && (
                            <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                                Cargando precios de Binance…
                            </span>
                        )}
                        {!loadingCoins && coins.length > 0 && (
                            <span className="text-xs text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 px-2.5 py-1 rounded-full">
                                Binance · {foundCoins.length} de {coins.length} activos
                            </span>
                        )}
                        {lastScan && !scanRunning && (
                            <span className="text-xs text-gray-400 dark:text-slate-500">
                                Último: {lastScan.toLocaleTimeString("es-MX", { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                        <button
                            onClick={restartScan}
                            disabled={scanRunning}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full transition-colors
                                       bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700
                                       text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700
                                       disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <svg className={`w-3 h-3 ${scanRunning ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                            </svg>
                            {scanRunning ? "Escaneando…" : "Actualizar ahora"}
                        </button>
                    </div>
                </div>

                {/* ─── Loading ──────────────────────────────────────────────── */}
                {initialLoad && (
                    <div className="flex items-center justify-center h-40 text-gray-400 dark:text-slate-500 gap-3 text-sm">
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        Cargando lista de activos…
                    </div>
                )}

                {/* ─── Progress bar ─────────────────────────────────────────── */}
                {!initialLoad && progress.total > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 mb-6">
                        <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                                {scanRunning ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                        </svg>
                                        <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">Escaneando velas de 30m…</span>
                                        {currentCoin && (
                                            <span className="text-xs text-gray-400 dark:text-slate-500 font-mono">{currentCoin.symbol.toUpperCase()}</span>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">✓ Scan completado</span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-gray-500 dark:text-slate-400">
                                    {progress.done} / {progress.total}
                                </span>
                                {scanRunning && minsLeft > 0 && (
                                    <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-800 px-2 py-0.5 rounded-full">~{minsLeft} min</span>
                                )}
                                <button onClick={restartScan}
                                    className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold underline underline-offset-2">
                                    {scanRunning ? "Reiniciar" : "Volver a escanear"}
                                </button>
                            </div>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-1.5 mb-2">
                            <div className={`h-1.5 rounded-full transition-all duration-500 ${scanRunning ? "bg-indigo-500" : "bg-green-500"}`}
                                 style={{ width: `${pctDone}%` }} />
                        </div>
                        {allSignals.length > 0 && (
                            <p className="text-xs text-gray-400 dark:text-slate-500">
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{allSignals.length}</span> señales encontradas · {' '}
                                <span className="text-red-500 dark:text-red-400">{countByTab.high} cerca del máximo</span> · {' '}
                                <span className="text-green-600 dark:text-green-400">{countByTab.low} cerca del mínimo</span>
                            </p>
                        )}
                    </div>
                )}

                {/* ─── Cobertura Bitunix / Binance ────────────────────────────── */}
                {!initialLoad && bitunixSymbols && bitunixSymbols.size > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 mb-6 overflow-hidden">
                        <button
                            onClick={() => setShowCoverage(v => !v)}
                            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                                    Cobertura Bitunix / Binance
                                </span>
                                <span className="text-xs bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-semibold">
                                    ✓ {foundCoins.length} encontrados
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
                                <div className="p-4">
                                    <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2 uppercase tracking-wide">
                                        Encontrados en Binance ({foundCoins.length})
                                    </p>
                                    <div className="overflow-auto max-h-60 flex flex-wrap gap-1">
                                        {foundCoins.map(c => (
                                            <span key={c.id}
                                                  className="font-mono text-[10px] bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded border border-green-100 dark:border-green-900">
                                                {c.symbol.toUpperCase()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-4">
                                    <p className="text-xs font-semibold text-orange-500 dark:text-orange-400 mb-2 uppercase tracking-wide">
                                        No encontrados en Binance ({unmatchedSyms.length})
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

                {/* ─── Notificaciones ──────────────────────────────────────── */}
                {!initialLoad && (
                    <div className="flex items-center gap-2 mb-6 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${
                            notifPerm === 'granted'
                                ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400'
                                : notifPerm === 'denied'
                                ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
                                : 'bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400'
                        }`}>
                            {notifPerm === 'granted' ? '🔔' : notifPerm === 'denied' ? '🔕' : '⚠️'}
                            {notifPerm === 'granted' ? 'Notificaciones activas' : notifPerm === 'denied' ? 'Notificaciones bloqueadas' : 'Sin permiso'}
                        </span>
                        <button
                            onClick={async () => {
                                const granted = await requestNotifPermission();
                                setNotifPerm(granted ? 'granted' : Notification.permission);
                                const testResult = {
                                    direction: 'high', curPrice: 1.234, sessionHigh: 1.25, sessionLow: 1.18,
                                    distancePct: 1.5, sessionStart: getLatestSessionWindow().start, sessionEnd: getLatestSessionWindow().end,
                                };
                                if (granted) {
                                    sendSessionNotification({ name: 'Test', symbol: 'TEST', id: 'test', image: null }, testResult);
                                }
                                await sendSessionEmail({ name: 'Test', symbol: 'test', id: 'test', image: null }, testResult);
                            }}
                            className="text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 font-semibold px-3 py-1 rounded-full transition-colors"
                        >
                            🧪 Probar notificación y email
                        </button>
                    </div>
                )}

                {/* ─── Filter tabs + orden ─────────────────────────────────── */}
                {!initialLoad && allSignals.length > 0 && (
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
                        <div className="flex gap-2 flex-wrap">
                            {FILTER_TABS.map(tab => (
                                <button key={tab.key}
                                    onClick={() => setActiveFilter(tab.key)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                                        activeFilter === tab.key
                                            ? "bg-indigo-600 text-white"
                                            : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700"
                                    }`}>
                                    {tab.label}
                                    {countByTab[tab.key] > 0 && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                            activeFilter === tab.key ? "bg-white/20" : "bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400"
                                        }`}>
                                            {countByTab[tab.key]}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 dark:text-slate-500">Ordenar por:</span>
                            {SORT_OPTIONS.map(opt => (
                                <button key={opt.key}
                                    onClick={() => setSortBy(opt.key)}
                                    title={opt.key === "volume" ? "Binance no reporta market cap; se ordena por volumen 24h en USDT" : undefined}
                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                                        sortBy === opt.key
                                            ? "bg-indigo-600 text-white"
                                            : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700"
                                    }`}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── Scanning, no results yet ────────────────────────────── */}
                {!initialLoad && scanRunning && allSignals.length === 0 && (
                    <div className="text-center py-20 text-gray-400 dark:text-slate-500">
                        <div className="text-5xl mb-4">📊</div>
                        <p className="font-semibold text-gray-500 dark:text-slate-400 text-lg">Buscando señales de sesión…</p>
                        <p className="text-sm mt-2">Analizando {progress.done} de {progress.total} activos</p>
                    </div>
                )}

                {/* ─── Results grid ─────────────────────────────────────────── */}
                {filtered.length > 0 && (
                    <>
                        <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-4 flex items-center gap-2">
                            <span>⭐ Señales confirmadas · {filtered.length} activo{filtered.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                            {filtered.map(c => (
                                <SessionCard key={c.id} coin={c} result={analysisCache[c.id].data}
                                             updatedAt={analysisCache[c.id].updatedAt} />
                            ))}
                        </div>
                    </>
                )}

                {/* ─── Empty filtered ───────────────────────────────────────── */}
                {!initialLoad && !scanRunning && allSignals.length > 0 && filtered.length === 0 && (
                    <div className="text-center py-16 text-gray-400 dark:text-slate-500">
                        <p className="text-sm">No se encontraron señales de este tipo en el scan actual.</p>
                        <button onClick={() => setActiveFilter("all")}
                            className="mt-3 text-indigo-500 text-sm underline underline-offset-2">Ver todos</button>
                    </div>
                )}

                {/* ─── Scan complete, no signals ────────────────────────────── */}
                {!initialLoad && !scanRunning && lastScan && allSignals.length === 0 && (
                    <div className="text-center py-20">
                        <div className="text-5xl mb-4">🔍</div>
                        <p className="font-semibold text-gray-600 dark:text-slate-300 text-lg">Sin señales confirmadas</p>
                        <p className="text-sm text-gray-400 dark:text-slate-500 mt-2 max-w-sm mx-auto">
                            Ningún activo está a 1%–2% del máximo o mínimo de su sesión NY en este scan.
                            Intenta de nuevo más tarde.
                        </p>
                        <button onClick={restartScan}
                            className="mt-6 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
                            Volver a escanear
                        </button>
                    </div>
                )}

            </div>
        </div>
    );
}
