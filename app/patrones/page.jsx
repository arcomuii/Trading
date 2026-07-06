'use client'
import { useState, useEffect, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const GAP_MS       = 20_000;
const RETRY_DELAYS = [15_000, 30_000, 60_000];
const WATCH_GAP_MS = 5 * 60_000; // frecuencia de monitoreo post-scan de señales confirmadas
const WATCH_COIN_GAP_MS = 2_000; // pausa entre coins dentro de cada vuelta de monitoreo

// México (America/Mexico_City) dejó el horario de verano desde 2022 → siempre UTC-6.
// 06:00 México = 12:00 UTC todo el año.
const MEXICO_SCAN_UTC_HOUR = 12;

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

// Milisegundos hasta el próximo 06:00 a.m. hora de México (calculado en UTC para
// no depender de la zona horaria del navegador del usuario).
function msUntilNextMexicoScan() {
    const now = new Date();
    const target = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
        MEXICO_SCAN_UTC_HOUR, 0, 0, 0
    ));
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target - now;
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function requestNotifPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted')  return true;
    if (Notification.permission === 'denied')   return false;
    return (await Notification.requestPermission()) === 'granted';
}

function sendPatternNotification(coin, result, patternLabel, bias) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const sym  = coin.symbol.toUpperCase();
    const emoji = bias === 'bullish' ? '↑' : bias === 'bearish' ? '↓' : '→';
    const comprPct = Math.round(result.compression * 100);
    const apexTxt  = result.daysToApex != null ? ` · Ápice en ${result.daysToApex}d` : '';
    try {
        const n = new Notification(
            `📐 ${emoji} ${patternLabel} · ${sym}`,
            {
                body:     `${comprPct}% compresión${apexTxt}`,
                icon:     coin.image || '/favicon.ico',
                tag:      `pattern-${coin.id}-${result.type}`,
                renotify: true,
            }
        );
        n.onerror = (e) => console.error('[PatternNotif] Error:', e);
    } catch (e) {
        console.error('[PatternNotif] Excepción:', e);
    }
}

async function sendPatternEmail(coin, result, patternLabel, bias, condsMet) {
    try {
        const conds  = getEntryConditions(result);
        const levels = calcLevels(result);
        const res = await fetch('/api/pattern-email', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coinName:     coin.name,
                symbol:       coin.symbol.toUpperCase(),
                price:        result.curPrice,
                image:        coin.image,
                bitunixUrl:   `https://www.bitunix.com/es-es/contract-trade/${coin.symbol.toUpperCase()}USDT`,
                patternLabel,
                direction:    bias === 'bullish' ? 'LONG' : bias === 'bearish' ? 'SHORT' : 'NEUTRAL',
                bias,
                compression:  result.compression,
                daysToApex:   result.daysToApex,
                pricePos:     result.pricePos,
                quality:      result.quality,
                condsMet,
                condsTotal:   conds.length,
                conditions:   conds,
                entry:        levels?.entry ?? null,
                stopLoss:     levels?.sl ?? null,
                takeProfit1:  levels?.tp1 ?? null,
                takeProfit2:  levels?.tp2 ?? null,
                takeProfit3:  levels?.tp3 ?? null,
                riskReward1:  levels?.rr1 ?? null,
                riskReward2:  levels?.rr2 ?? null,
                riskReward3:  levels?.rr3 ?? null,
                extended:        levels?.extended ?? false,
                realRiskReward:  levels?.realRR ?? null,
                breakevenWinRate: levels?.breakevenWinRate ?? null,
                extendedScore:   levels?.extendedScore ?? null,
            }),
        });
        const json = await res.json();
        if (!res.ok) console.error('[PatternEmail] Error:', json);
        else         console.log('[PatternEmail] Enviado:', coin.symbol, result.type);
    } catch (e) {
        console.error('[PatternEmail] Excepción:', e);
    }
}

// Correo final del monitoreo post-scan: se dispara una sola vez por moneda, cuando
// el precio deja de estar "extendido" (ya no se está persiguiendo, es el momento
// óptimo para abrir la operativa).
async function sendEntryReadyEmail(coin, result, patternLabel, levels) {
    try {
        const res = await fetch('/api/entry-ready-email', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coinName:    coin.name,
                symbol:      coin.symbol.toUpperCase(),
                image:       coin.image,
                price:       result.curPrice,
                patternLabel,
                direction:   levels.isBull ? 'LONG' : 'SHORT',
                entry:       levels.entry,
                stopLoss:    levels.sl,
                takeProfit:  levels.tp,
                riskReward:  levels.rr,
            }),
        });
        const json = await res.json();
        if (!res.ok) console.error('[EntryReadyEmail] Error:', json);
        else         console.log('[EntryReadyEmail] Enviado:', coin.symbol);
    } catch (e) {
        console.error('[EntryReadyEmail] Excepción:', e);
    }
}

// ─── Formatters ───────────────────────────────────────────────────────────────
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

function fmtCountdown(ms) {
    if (ms <= 0) return "ahora";
    const totalMin = Math.ceil(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
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

// ─── Liquidity Sweep Detection ─────────────────────────────────────────────────
// Detects a "stop hunt": a local swing low/high whose wick gets pierced and then
// reclaimed on close within `lookback` candles. This is the classic smart-money
// signature of a liquidity grab that often precedes the real move — sweep the
// lows before rallying, or sweep the highs before dumping.
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

// ─── Pattern Detection ────────────────────────────────────────────────────────
// Analyzes daily OHLC data and returns the detected compression pattern or null.
// Uses last 25 candles for consolidation and 12 prior candles to detect the pole.
function detectPattern(candles) {
    // 4H candles: 60 candles ≈ 10 days consolidation, 20 candles ≈ 3.3 days pole
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

    // Normalize slopes as % per 4H candle relative to average price
    const normH = (hReg.slope / avgPrice) * 100;
    const normL = (lReg.slope / avgPrice) * 100;

    // Channel width at start and end of the window
    const hStart = hReg.predict(0),        hEnd = hReg.predict(CONSOL - 1);
    const lStart = lReg.predict(0),        lEnd = lReg.predict(CONSOL - 1);
    const bandStart = hStart - lStart;
    const bandEnd   = Math.max(hEnd - lEnd, 0);

    if (bandStart <= 0) return null;
    const compression = (bandStart - bandEnd) / bandStart;

    // Position of current price within the channel (0=at support, 1=at resistance)
    const curPrice    = closes[closes.length - 1];
    const bandWidth   = hEnd - lEnd;
    const pricePos    = bandWidth > 0 ? Math.max(0, Math.min(1, (curPrice - lEnd) / bandWidth)) : 0.5;

    // Average R² (fit quality of both trendlines)
    const quality = (hReg.r2 + lReg.r2) / 2;

    // Slope classification thresholds (%/4H candle) — daily values ÷ 6
    const FLAT  = 0.008;
    const SLOPE = 0.015;

    const hFlat = Math.abs(normH) <= FLAT;
    const hDown = normH < -SLOPE;
    const hUp   = normH > SLOPE;
    const lFlat = Math.abs(normL) <= FLAT;
    const lDown = normL < -SLOPE;
    const lUp   = normL > SLOPE;

    const isConverging = compression >= 0.15;

    // ─── Pole detection ───────────────────────────────────────────────────────
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

    // Days until trendlines converge — convert 4H candles to days (÷6)
    const candleConvergence = (normL - normH) * avgPrice / 100;  // $ per 4H candle
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

    // ─── Flags & Pennants (require prior pole) ────────────────────────────────
    if (hasPole) {
        // Pennant: small converging triangle right after impulse
        if (isConverging && Math.abs(normH) < 0.05 && Math.abs(normL) < 0.05) {
            return { ...base, type: bullishPole ? 'bullish_pennant' : 'bearish_pennant' };
        }
        // Flag: small parallel channel counter-trend to the pole
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

    // ─── Triangles & Wedges (converging without pole requirement) ─────────────
    if (isConverging) {
        if (hDown && lUp)                            return { ...base, type: 'symmetrical_triangle' };
        if (hFlat && lUp)                            return { ...base, type: 'ascending_triangle' };
        if (hDown && lFlat)                          return { ...base, type: 'descending_triangle' };
        if (hUp   && lUp   && normL > normH + 0.005) return { ...base, type: 'rising_wedge' };
        if (hDown && lDown && normH < normL - 0.005) return { ...base, type: 'falling_wedge' };
    }

    return null;
}

// ─── Cup and Handle Detection ─────────────────────────────────────────────────
function detectCupHandle(candles) {
    const CUP_LEN    = 90;  // ~15 days in 4H
    const HANDLE_LEN = 20;  // ~3.3 days in 4H
    const PRIOR_LEN  = 20;  // prior uptrend window
    if (candles.length < CUP_LEN + HANDLE_LEN + PRIOR_LEN) return null;

    const priorSlice  = candles.slice(-(CUP_LEN + HANDLE_LEN + PRIOR_LEN), -(CUP_LEN + HANDLE_LEN));
    const cupSlice    = candles.slice(-(CUP_LEN + HANDLE_LEN), -HANDLE_LEN);
    const handleSlice = candles.slice(-HANDLE_LEN);

    // 1. Prior bullish trend (at least 5% up)
    const priorFirst = priorSlice[0].close;
    const priorLast  = priorSlice[priorSlice.length - 1].close;
    if (priorLast <= priorFirst * 1.05) return null;
    const priorHigh    = Math.max(...priorSlice.map(c => c.high));
    const priorLow     = Math.min(...priorSlice.map(c => c.low));
    const priorMovePct = (priorHigh - priorLow) / priorLow * 100;

    // 2. Cup: find left rim, bottom, right rim in thirds
    const t = Math.floor(CUP_LEN / 3);
    const leftThird  = cupSlice.slice(0, t);
    const midThird   = cupSlice.slice(t, 2 * t);
    const rightThird = cupSlice.slice(2 * t);

    const leftRim   = Math.max(...leftThird.map(c => c.high));
    const cupBottom = Math.min(...midThird.map(c => c.low));
    const rightRim  = Math.max(...rightThird.map(c => c.high));

    // 3. Rim symmetry (within 18%)
    const rimAvg  = (leftRim + rightRim) / 2;
    const rimDiff = Math.abs(rightRim - leftRim) / rimAvg;
    if (rimDiff > 0.18) return null;

    // 4. Cup depth 18-62% of rim
    const cupHeight   = rimAvg - cupBottom;
    if (cupHeight <= 0) return null;
    const cupDepthPct = cupHeight / rimAvg;
    if (cupDepthPct < 0.18 || cupDepthPct > 0.62) return null;

    // 5. U-shape: bottom must be lower than both side thirds
    const leftMin  = Math.min(...leftThird.map(c => c.low));
    const rightMin = Math.min(...rightThird.map(c => c.low));
    if (cupBottom >= leftMin || cupBottom >= rightMin) return null;

    // 6. U-shape: several candles near the bottom (not a V)
    const bottomZone    = cupBottom + cupHeight * 0.25;
    const bottomCandles = midThird.filter(c => c.low <= bottomZone).length;
    if (bottomCandles < 3) return null;

    // 7. Handle: small pullback, must not exceed 45% of cup height, must stay above cup bottom
    const handleHigh  = Math.max(...handleSlice.map(c => c.high));
    const handleLow   = Math.min(...handleSlice.map(c => c.low));
    const handleDepth = rightRim - handleLow;
    if (handleDepth <= 0)                     return null;
    if (handleHigh > rightRim * 1.03)         return null;  // handle broke out already
    if (handleDepth > cupHeight * 0.45)       return null;  // handle too deep
    if (handleLow < cupBottom)                return null;  // handle below cup

    // 8. Breakout metrics (last 5 candles of handle)
    const recSlice      = handleSlice.slice(-5);
    const recCloses     = recSlice.map(c => c.close);
    const recLows       = recSlice.map(c => c.low);
    const aboveResCount = recCloses.filter(c => c > rightRim * 1.003).length;
    const retestBull    = recLows.some((l, i) => l <= rightRim * 1.025 && recCloses[i] > rightRim * 1.001);

    // 9. Metrics
    const curPrice   = candles[candles.length - 1].close;
    const handleRange = Math.max(rightRim - handleLow, 0.0001);
    const pricePos    = Math.max(0, Math.min(1.5, (curPrice - handleLow) / handleRange));
    const symScore    = 1 - rimDiff / 0.18;
    const depthScore  = cupDepthPct >= 0.28 && cupDepthPct <= 0.52 ? 1.0 : 0.65;
    const quality     = symScore * 0.5 + depthScore * 0.5;
    const compression = 1 - (handleDepth / cupHeight);  // higher = tighter handle

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

// ─── Pattern metadata ─────────────────────────────────────────────────────────
const PATTERN_META = {
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

// ─── Entry checklist ─────────────────────────────────────────────────────────
const PATTERN_COND_RISK = [15, 20, 30, 25, 30, 35];

function getEntryConditions(result) {
    const dec = result.hEnd < 1 ? 4 : 2;

    if (result.type === 'cup_handle') {
        return [
            {
                label: "Taza bien formada (simetría y profundidad 20-62%)",
                ok:    result.quality >= 0.55 && result.cupDepthPct >= 0.20,
            },
            {
                label: "Asa poco profunda (≤ 45% de la taza)",
                ok:    result.handleDepth <= result.cupHeight * 0.45,
            },
            {
                label: `Tendencia previa alcista (movimiento ≥10%)`,
                ok:    result.poleMovePct != null && result.poleMovePct >= 10,
            },
            {
                label: "Precio en zona del asa o resistencia",
                ok:    result.pricePos >= 0.55,
            },
            {
                label: `Ruptura sobre $${fmt(result.hEnd, dec)}`,
                ok:    result.curPrice > result.hEnd * 1.003,
            },
            {
                label: result.retestBull ? "Retest del nivel confirmado" : "Ruptura sostenida (≥2 cierres)",
                ok:    result.aboveResCount >= 2 || result.retestBull,
            },
            {
                label: result.sweptLow ? "Barrido de liquidez bajo mínimos previos (stop hunt)" : "Sin barrido de liquidez previo",
                ok:    !!result.sweptLow,
            },
        ];
    }

    const meta   = PATTERN_META[result.type] ?? {};
    const isBull = meta.bias === "bullish";
    const isBear = meta.bias === "bearish";
    return [
        {
            label: "Patrón bien formado",
            ok:    result.quality >= 0.40,
        },
        {
            label: "Compresión ≥28%",
            ok:    result.compression >= 0.28,
        },
        {
            label: isBull ? "Precio cerca de resistencia"
                 : isBear ? "Precio cerca de soporte"
                           : "Precio en extremo del canal",
            ok:   isBull ? result.pricePos >= 0.70
                : isBear ? result.pricePos <= 0.30
                         : Math.abs(result.pricePos - 0.5) >= 0.35,
        },
        {
            label: "Ápice en ≤10 días",
            ok:    result.daysToApex !== null && result.daysToApex <= 10,
        },
        {
            label: isBull ? `Quiebre sobre $${fmt(result.hEnd, dec)}`
                 : isBear ? `Quiebre bajo $${fmt(result.lEnd, dec)}`
                           : "Quiebre del canal confirmado",
            ok:   isBull ? result.curPrice > result.hEnd * 1.003
                : isBear ? result.curPrice < result.lEnd * 0.997
                         : result.curPrice > result.hEnd * 1.003 || result.curPrice < result.lEnd * 0.997,
        },
        {
            label: isBull ? (result.retestBull ? "Retest del nivel confirmado" : "Ruptura sostenida (≥2 cierres)")
                 : isBear ? (result.retestBear ? "Retest del nivel confirmado" : "Ruptura sostenida (≥2 cierres)")
                           : "Ruptura confirmada",
            ok:   isBull ? (result.aboveResCount >= 2 || result.retestBull)
                : isBear ? (result.belowSupCount >= 2 || result.retestBear)
                         : (result.aboveResCount >= 2 || result.retestBull ||
                            result.belowSupCount >= 2 || result.retestBear),
        },
        {
            label: isBull ? "Barrido de liquidez bajo el soporte"
                 : isBear ? "Barrido de liquidez sobre la resistencia"
                           : "Barrido de liquidez detectado",
            ok:   isBull ? !!result.sweptLow
                : isBear ? !!result.sweptHigh
                         : !!(result.sweptLow || result.sweptHigh),
        },
    ];
}

function calcLevels(result) {
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

    // TP2 es el objetivo "completo" (movimiento medido / pole), igual que antes.
    // TP1 es un objetivo conservador (50% del movimiento) y TP3 uno extendido (extensión 1.618).
    const fullMove = tp2 - entry; // con signo: positivo en alcista, negativo en bajista
    const tp1 = entry + fullMove * 0.5;
    const tp3 = entry + fullMove * 1.618;

    const risk = Math.abs(entry - sl);
    const rrOf = (tp) => risk > 0 ? Math.abs(tp - entry) / risk : 0;

    // ¿El precio ya se alejó del nivel de entrada? R:R real si se entra al precio
    // actual en vez del nivel teórico de ruptura (usando TP2 como objetivo de referencia).
    const curPrice  = result.curPrice;
    const extended  = curPrice != null && (isBull ? curPrice > entry * 1.01 : curPrice < entry * 0.99);
    const realRisk  = curPrice != null ? Math.abs(curPrice - sl) : 0;
    const realRR    = curPrice != null && realRisk > 0 ? Math.abs(tp2 - curPrice) / realRisk : null;

    // Win-rate de equilibrio implícito por el R:R real: matemático, no es una predicción.
    // Es el % de veces que necesitarías acertar solo para no perder dinero entrando ahora.
    const breakevenWinRate = realRR != null && realRR > 0 ? 100 / (1 + realRR) : null;

    // Score heurístico de confluencia (0-100) — NO es una probabilidad estadística real
    // (esta app no tiene backtesting histórico). Combina señales ya calculadas del patrón
    // y penaliza cuánto del movimiento hacia TP2 ya se "gastó" corriendo detrás del precio.
    let extendedScore = null;
    if (extended) {
        const retest = isBull ? result.retestBull : result.retestBear;
        const swept  = isBull ? result.sweptLow    : result.sweptHigh;
        let base = (result.quality ?? 0) * 0.4 + (Math.min(result.compression ?? 0, 0.6) / 0.6) * 0.2;
        base += swept  ? 0.2 : 0;
        base += retest ? 0.2 : 0;
        base = Math.min(1, base);

        const progressed = fullMove !== 0 ? (curPrice - entry) / fullMove : 0;
        const penalty     = Math.max(0, Math.min(0.7, progressed));
        extendedScore     = Math.round(Math.max(0.05, base * (1 - penalty)) * 100);
    }

    return {
        entry, sl, tp1, tp2, tp3,
        rr1: rrOf(tp1), rr2: rrOf(tp2), rr3: rrOf(tp3),
        tp: tp2, rr: rrOf(tp2), // alias de compatibilidad (comportamiento previo de un solo TP)
        isBull, extended, realRR, breakevenWinRate, extendedScore,
    };
}

function EntryChecklist({ result, showScore = false }) {
    const conds   = getEntryConditions(result);
    const met     = conds.filter(c => c.ok).length;
    const total   = conds.length;
    const pct     = Math.round((met / total) * 100);
    const missing = conds.filter(c => !c.ok);
    const allMet  = met === total;

    const scoreColor = allMet         ? "text-green-600 dark:text-green-400"
                     : pct >= 67      ? "text-amber-500 dark:text-amber-400"
                                      : "text-red-500 dark:text-red-400";
    const barColor   = (c) => c.ok
        ? "bg-green-400 dark:bg-green-500"
        : "bg-red-200 dark:bg-red-900";

    return (
        <div>
            {/* Score row */}
            <div className="flex items-center gap-2 mb-1.5">
                <div className="flex gap-0.5 flex-1">
                    {conds.map((c, i) => (
                        <span key={i} title={c.label}
                              className={`flex-1 h-1.5 rounded-full transition-colors ${barColor(c)}`}
                        />
                    ))}
                </div>
                <span className={`text-[11px] font-bold tabular-nums leading-none ${scoreColor}`}>
                    {met}/{total}
                </span>
                {showScore && (
                    <span className={`text-[10px] font-semibold tabular-nums leading-none ${scoreColor}`}>
                        {pct}%
                    </span>
                )}
            </div>
            {/* Condition chips */}
            {allMet ? (
                <p className="text-[10px] font-semibold text-green-600 dark:text-green-400">
                    ✓ Todas las condiciones cumplidas
                </p>
            ) : (
                <div className="flex flex-wrap gap-1">
                    {missing.map((c, i) => (
                        <span key={i}
                              className="text-[9px] bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 px-1.5 py-0.5 rounded-full leading-none">
                            ✗ {c.label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Pattern icons (inline SVG) ───────────────────────────────────────────────
function PatternIcon({ type }) {
    // Common SVG props
    const W = 64, H = 44;
    const ug = "#6366f1"; // indigo (neutral / upper line)
    const gr = "#22c55e"; // green  (bullish accent)
    const rd = "#ef4444"; // red    (bearish accent)
    const cy = "#06b6d4"; // cyan   (bullish breakout arrow)
    const rx = "#f87171"; // light red (bearish breakout arrow)
    const pr = "#94a3b8"; // price line

    const Arrow = ({ x1, y1, x2, y2, color }) => {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;
        const px = -uy, py = ux;
        const tip = [x2, y2];
        const b1  = [x2 - ux * 5 + px * 3, y2 - uy * 5 + py * 3];
        const b2  = [x2 - ux * 5 - px * 3, y2 - uy * 5 - py * 3];
        return (
            <>
                <line x1={x1} y1={y1} x2={x2 - ux * 2} y2={y2 - uy * 2} stroke={color} strokeWidth="2" strokeLinecap="round" />
                <polygon points={`${tip[0]},${tip[1]} ${b1[0]},${b1[1]} ${b2[0]},${b2[1]}`} fill={color} />
            </>
        );
    };

    const icons = {
        cup_handle: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                {/* Cup U-shape fill */}
                <path d="M4,8 C6,40 44,40 46,8 L46,8 L4,8" fill="rgba(34,197,94,0.08)" stroke="none" />
                {/* Cup U-shape outline */}
                <path d="M4,8 C6,40 44,40 46,8" fill="none" stroke={gr} strokeWidth="1.6" />
                {/* Horizontal rim reference */}
                <line x1="4" y1="8" x2="46" y2="8" stroke={gr} strokeWidth="1" strokeDasharray="2,2" opacity="0.4" />
                {/* Handle: small dip */}
                <polyline points="46,8 49,18 54,12" fill="none" stroke={gr} strokeWidth="1.4" strokeLinejoin="round" />
                {/* Breakout arrow */}
                <Arrow x1={54} y1={12} x2={62} y2={3} color={cy} />
            </svg>
        ),
        symmetrical_triangle: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="4" y1="7"  x2="44" y2="22" stroke={ug} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="4" y1="37" x2="44" y2="22" stroke={ug} strokeWidth="1.5" strokeDasharray="3,2" />
                <polyline points="4,35 14,9 24,29 36,16 44,22" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={44} y1={22} x2={60} y2={14} color={cy} />
            </svg>
        ),
        ascending_triangle: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="4" y1="9"  x2="44" y2="9"  stroke={gr} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="4" y1="35" x2="44" y2="9"  stroke={gr} strokeWidth="1.5" />
                <polyline points="4,33 14,9 22,27 32,9 44,9" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={44} y1={9} x2={60} y2={2} color={cy} />
            </svg>
        ),
        descending_triangle: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="4" y1="9"  x2="44" y2="35" stroke={rd} strokeWidth="1.5" />
                <line x1="4" y1="35" x2="44" y2="35" stroke={rd} strokeWidth="1.5" strokeDasharray="3,2" />
                <polyline points="4,11 14,35 24,19 36,35 44,35" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={44} y1={35} x2={60} y2={42} color={rx} />
            </svg>
        ),
        rising_wedge: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="4" y1="20" x2="44" y2="9"  stroke={rd} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="4" y1="33" x2="44" y2="13" stroke={rd} strokeWidth="1.5" />
                <polyline points="4,31 14,22 24,28 34,16 44,11" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={44} y1={11} x2={60} y2={28} color={rx} />
            </svg>
        ),
        falling_wedge: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="4" y1="9"  x2="44" y2="26" stroke={gr} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="4" y1="19" x2="44" y2="32" stroke={gr} strokeWidth="1.5" />
                <polyline points="4,11 14,23 24,17 34,29 44,29" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={44} y1={29} x2={60} y2={14} color={cy} />
            </svg>
        ),
        bullish_flag: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="14" y1="40" x2="14" y2="8"  stroke={gr} strokeWidth="2.5" strokeLinecap="round" />
                <line x1="14" y1="8"  x2="44" y2="13" stroke={gr} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="14" y1="15" x2="44" y2="20" stroke={gr} strokeWidth="1.5" />
                <polyline points="14,9 22,15 30,11 38,17 44,14" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={44} y1={14} x2={60} y2={4} color={cy} />
            </svg>
        ),
        bearish_flag: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="14" y1="4"  x2="14" y2="36" stroke={rd} strokeWidth="2.5" strokeLinecap="round" />
                <line x1="14" y1="28" x2="44" y2="22" stroke={rd} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="14" y1="36" x2="44" y2="30" stroke={rd} strokeWidth="1.5" />
                <polyline points="14,34 22,28 30,32 38,26 44,28" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={44} y1={28} x2={60} y2={40} color={rx} />
            </svg>
        ),
        bullish_pennant: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="12" y1="40" x2="12" y2="8"  stroke={gr} strokeWidth="2.5" strokeLinecap="round" />
                <line x1="12" y1="8"  x2="40" y2="20" stroke={gr} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="12" y1="16" x2="40" y2="20" stroke={gr} strokeWidth="1.5" />
                <polyline points="12,10 20,16 28,12 36,18 40,20" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={40} y1={20} x2={60} y2={6} color={cy} />
            </svg>
        ),
        bearish_pennant: (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                <line x1="12" y1="4"  x2="12" y2="36" stroke={rd} strokeWidth="2.5" strokeLinecap="round" />
                <line x1="12" y1="26" x2="40" y2="22" stroke={rd} strokeWidth="1.5" strokeDasharray="3,2" />
                <line x1="12" y1="36" x2="40" y2="22" stroke={rd} strokeWidth="1.5" />
                <polyline points="12,34 20,28 28,32 36,24 40,22" fill="none" stroke={pr} strokeWidth="1.2" strokeLinejoin="round" />
                <Arrow x1={40} y1={22} x2={60} y2={40} color={rx} />
            </svg>
        ),
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-1 border border-gray-100 dark:border-slate-700 flex-shrink-0">
            {icons[type] ?? <div className="w-16 h-11 bg-gray-100 dark:bg-slate-700 rounded" />}
        </div>
    );
}

// ─── Fetch 4H OHLC with retry ─────────────────────────────────────────────────
// CoinGecko OHLC: days=30 → 4H (~180 velas)
async function fetchPatterns(coinId, attempt = 0) {
    const res = await fetch(
        `/api/coingecko/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=30`
    );
    if (res.status === 429) {
        if (attempt < RETRY_DELAYS.length) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
            return fetchPatterns(coinId, attempt + 1);
        }
        throw new Error("RATE_LIMIT");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length < 80)
        throw new Error(`insufficient:${Array.isArray(raw) ? raw.length : 0}`);
    // CoinGecko OHLC format: [timestamp, open, high, low, close]
    const data = raw.map(([, , high, low, close]) => ({ high, low, close }));
    return detectCupHandle(data) ?? detectPattern(data);
}

async function cancellableWait(ms, abortRef) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (abortRef.current) return;
        await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
    }
}

// ─── PatternCard ──────────────────────────────────────────────────────────────
function PatternCard({ coin, result, updatedAt }) {
    const meta  = PATTERN_META[result.type] ?? {};
    const isBull = meta.bias === "bullish";
    const isBear = meta.bias === "bearish";
    const sym    = coin.symbol.toUpperCase();
    const pct    = coin.price_change_percentage_24h;
    const comprPct = Math.round(result.compression * 100);
    const qualPct  = Math.round(result.quality * 100);
    const nearBreakout = isBull
        ? result.pricePos >= 0.75
        : isBear
        ? result.pricePos <= 0.25
        : Math.abs(result.pricePos - 0.5) >= 0.35;
    const imminentApex = result.daysToApex !== null && result.daysToApex <= 8;
    const isNearBreakout = nearBreakout || imminentApex;

    const brokeOut = isBull
        ? result.curPrice > result.hEnd * 1.003
        : isBear
        ? result.curPrice < result.lEnd * 0.997
        : result.curPrice > result.hEnd * 1.003 || result.curPrice < result.lEnd * 0.997;
    const breakConfirmed = isBull
        ? (result.aboveResCount >= 2 || result.retestBull)
        : isBear
        ? (result.belowSupCount >= 2 || result.retestBear)
        : (result.aboveResCount >= 2 || result.retestBull || result.belowSupCount >= 2 || result.retestBear);

    const conds  = getEntryConditions(result);
    const allMet = conds.every(c => c.ok);

    const borderCls = allMet
        ? "border-amber-400 dark:border-amber-500 ring-2 ring-amber-200 dark:ring-amber-900"
        : isBull ? "border-green-200 dark:border-green-900"
        : isBear ? "border-red-200 dark:border-red-900"
                 : "border-indigo-200 dark:border-indigo-900";
    const bgCls = allMet
        ? isBull ? "bg-gradient-to-br from-green-50 dark:from-green-950/80 to-amber-50/60 dark:to-amber-950/20"
        : isBear ? "bg-gradient-to-br from-red-50 dark:from-red-950/80 to-amber-50/60 dark:to-amber-950/20"
                 : "bg-gradient-to-br from-indigo-50 dark:from-indigo-950/80 to-amber-50/60 dark:to-amber-950/20"
        : isBull ? "bg-gradient-to-br from-green-50 dark:from-green-950 to-white dark:to-slate-900"
        : isBear ? "bg-gradient-to-br from-red-50 dark:from-red-950 to-white dark:to-slate-900"
                 : "bg-gradient-to-br from-indigo-50 dark:from-indigo-950 to-white dark:to-slate-900";

    return (
        <div className={`rounded-2xl border-2 p-4 ${borderCls} ${bgCls}`}>
            {/* LONG / SHORT direction — prominent */}
            <div className={`flex items-center justify-between mb-3 rounded-xl px-3 py-2 ${
                isBull ? "bg-green-500 dark:bg-green-600"
              : isBear ? "bg-red-500 dark:bg-red-600"
                       : "bg-indigo-500 dark:bg-indigo-600"
            }`}>
                <div className="flex items-center gap-2">
                    <span className="text-base font-black text-white tracking-widest">
                        {isBull ? "▲ LONG" : isBear ? "▼ SHORT" : "→ NEUTRAL"}
                    </span>
                    <span className="text-[10px] font-semibold text-white/75">
                        {meta.label}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    {allMet && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-white">
                            ⭐ {conds.length}/{conds.length}
                        </span>
                    )}
                    {pct != null && (
                        <span className={`text-xs font-semibold ${pct >= 0 ? "text-green-200" : "text-red-200"}`}>
                            {pct >= 0 ? "+" : ""}{fmt(pct)}%
                        </span>
                    )}
                    {updatedAt && (
                        <span className="text-[9px] font-semibold text-white/70" title="Última actualización">
                            🕓 {updatedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
            </div>

            {/* Breakout status */}
            {(breakConfirmed || brokeOut || isNearBreakout) && (
                <div className="flex gap-1.5 mb-3 flex-wrap">
                    {breakConfirmed ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500 text-white">
                            ✓✓ Ruptura confirmada
                        </span>
                    ) : brokeOut ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500 text-white animate-pulse">
                            ✓ Ruptura detectada
                        </span>
                    ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-white animate-pulse">
                            ⚡ Cerca del quiebre
                        </span>
                    )}
                </div>
            )}

            {/* Coin + Icon */}
            <div className="flex items-center gap-3 mb-4">
                <PatternIcon type={result.type} />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    {coin.image && (
                        <img src={coin.image} alt={coin.name} className="w-8 h-8 rounded-full flex-shrink-0"
                             onError={e => e.target.style.display = "none"} />
                    )}
                    <div className="min-w-0">
                        <p className="font-bold text-gray-800 dark:text-slate-100 text-sm truncate leading-tight">{coin.name}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500 uppercase font-semibold">{sym}</p>
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p className="font-mono font-semibold text-gray-800 dark:text-slate-100 text-sm">
                        ${fmt(result.curPrice, result.curPrice < 1 ? 5 : 2)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{fmtBig(coin.market_cap)}</p>
                </div>
            </div>

            {/* Channel levels */}
            <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-white dark:bg-slate-800 rounded-xl p-2 text-center border border-gray-100 dark:border-slate-700">
                    <p className="text-[9px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">Compresión</p>
                    <p className={`text-sm font-bold ${comprPct >= 40 ? "text-indigo-600 dark:text-indigo-400" : comprPct >= 25 ? "text-amber-500 dark:text-amber-400" : "text-gray-600 dark:text-slate-300"}`}>
                        {comprPct}%
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-2 text-center border border-gray-100 dark:border-slate-700">
                    <p className="text-[9px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">Resistencia</p>
                    <p className="text-xs font-bold text-gray-700 dark:text-slate-200 font-mono">
                        ${fmt(result.hEnd, result.hEnd < 1 ? 4 : 2)}
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-2 text-center border border-gray-100 dark:border-slate-700">
                    <p className="text-[9px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">Soporte</p>
                    <p className="text-xs font-bold text-gray-700 dark:text-slate-200 font-mono">
                        ${fmt(result.lEnd, result.lEnd < 1 ? 4 : 2)}
                    </p>
                </div>
            </div>

            {/* Price position bar */}
            <div className="mb-3">
                <div className="flex justify-between text-[9px] text-gray-400 dark:text-slate-500 mb-1">
                    <span>Soporte</span>
                    <span>Posición del precio</span>
                    <span>Resistencia</span>
                </div>
                <div className="relative w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`absolute top-0 left-0 h-full rounded-full ${
                        isBull ? "bg-green-200 dark:bg-green-900" : isBear ? "bg-red-200 dark:bg-red-900" : "bg-indigo-200 dark:bg-indigo-900"
                    }`} style={{ width: "100%" }} />
                    <div className={`absolute top-0 h-full w-1.5 rounded-full -translate-x-1/2 ${
                        isBull ? "bg-green-500" : isBear ? "bg-red-500" : "bg-indigo-500"
                    }`} style={{ left: `${result.pricePos * 100}%` }} />
                </div>
            </div>

            {/* Meta row */}
            <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-slate-500 mb-3 flex-wrap gap-1">
                <span>Ajuste: <span className="font-semibold text-gray-600 dark:text-slate-300">{qualPct}%</span></span>
                {result.daysToApex !== null && (
                    <span className={`font-bold px-2 py-0.5 rounded-full ${
                        result.daysToApex <= 5  ? "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400" :
                        result.daysToApex <= 10 ? "bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400" :
                                                  "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
                    }`}>
                        ⏱ {result.daysToApex}d al ápice
                    </span>
                )}
                {result.poleMovePct != null && (
                    <span>Mástil: <span className="font-semibold text-gray-600 dark:text-slate-300">{fmt(result.poleMovePct, 1)}%</span></span>
                )}
            </div>

            {/* Entry checklist */}
            <div className="mb-3 px-1">
                <p className="text-[9px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">Confirmar entrada</p>
                <EntryChecklist result={result} showScore={true} />
            </div>

            {/* Entry / TP / SL — always shown; highlighted when all conditions met */}
            {(() => {
                const lv  = calcLevels(result);
                if (!lv) return null;
                const dec   = result.hEnd < 1 ? 5 : result.hEnd < 10 ? 4 : 2;
                const rrCls = lv.rr >= 2   ? "text-green-600 dark:text-green-400"
                            : lv.rr >= 1.2 ? "text-amber-500 dark:text-amber-400"
                                           : "text-red-500 dark:text-red-400";
                const containerCls = allMet
                    ? "mb-3 rounded-xl p-3 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700"
                    : "mb-3 rounded-xl p-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 opacity-70";
                return (
                    <div className={containerCls}>
                        <p className={`text-[9px] font-semibold uppercase tracking-wide mb-2 ${
                            allMet ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-slate-500"
                        }`}>
                            {allMet ? "✓ Niveles confirmados" : "Niveles estimados"}
                        </p>
                        <div className="grid grid-cols-2 gap-2 mb-1.5">
                            <div className={`rounded-lg p-2 text-center border ${
                                allMet ? "bg-indigo-100 dark:bg-indigo-900/50 border-indigo-300 dark:border-indigo-700"
                                       : "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800"}`}>
                                <p className="text-[9px] font-semibold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide mb-0.5">Entrada</p>
                                <p className={`font-bold font-mono leading-tight ${allMet ? "text-sm text-indigo-700 dark:text-indigo-200" : "text-[11px] text-indigo-700 dark:text-indigo-300"}`}>
                                    ${fmt(lv.entry, dec)}
                                </p>
                            </div>
                            <div className={`rounded-lg p-2 text-center border ${
                                allMet ? "bg-red-100 dark:bg-red-900/50 border-red-300 dark:border-red-700"
                                       : "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"}`}>
                                <p className="text-[9px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide mb-0.5">SL</p>
                                <p className={`font-bold font-mono leading-tight ${allMet ? "text-sm text-red-700 dark:text-red-200" : "text-[11px] text-red-700 dark:text-red-300"}`}>
                                    ${fmt(lv.sl, dec)}
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-1.5">
                            {[["TP1", lv.tp1, lv.rr1], ["TP2", lv.tp2, lv.rr2], ["TP3", lv.tp3, lv.rr3]].map(([label, tpVal, rrVal]) => (
                                <div key={label} className={`rounded-lg p-2 text-center border ${
                                    allMet ? "bg-green-100 dark:bg-green-900/50 border-green-300 dark:border-green-700"
                                           : "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800"}`}>
                                    <p className="text-[9px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-0.5">{label}</p>
                                    <p className={`font-bold font-mono leading-tight ${allMet ? "text-sm text-green-700 dark:text-green-200" : "text-[11px] text-green-700 dark:text-green-300"}`}>
                                        ${fmt(tpVal, dec)}
                                    </p>
                                    <p className="text-[8px] font-semibold text-green-500 dark:text-green-400/80">1:{fmt(rrVal, 1)}</p>
                                </div>
                            ))}
                        </div>
                        <p className={`text-[9px] font-bold text-center ${rrCls}`}>
                            R:R 1:{fmt(lv.rr, 1)} (TP2)
                            {lv.rr >= 2 ? " · Favorable" : lv.rr >= 1.2 ? " · Aceptable" : " · Bajo"}
                        </p>
                        {lv.extended && (
                            <div className="mt-1.5 pt-1.5 border-t border-amber-200 dark:border-amber-800">
                                <p className="text-[10px] font-bold text-center text-amber-600 dark:text-amber-400">
                                    ⚠ Entrada ya extendida (+{fmt(Math.abs((result.curPrice - lv.entry) / lv.entry * 100), 1)}%)
                                    {lv.realRR != null && <> · R:R real 1:{fmt(lv.realRR, 1)}</>}
                                </p>
                                <p className="text-[10px] text-center text-amber-500 dark:text-amber-500/80 mt-0.5">
                                    {lv.breakevenWinRate != null && <>Necesitas acertar ≥{fmt(lv.breakevenWinRate, 0)}% para no perder (equilibrio) · </>}
                                    {lv.extendedScore != null && <>Score de confluencia: {lv.extendedScore}%</>}
                                </p>
                                <p className="text-[10px] text-center text-amber-400 dark:text-amber-600 mt-0.5 italic">
                                    No son probabilidades estadísticas reales (sin backtesting) — solo referencia
                                </p>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Links */}
            <div className="flex gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
                <a href={`https://www.bitunix.com/es-es/contract-trade/${sym}USDT`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex-1 text-center text-[11px] font-semibold py-1.5 rounded-lg bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900 transition-colors">
                    Ver en Bitunix
                </a>
                <a href={`https://es.tradingview.com/chart/tXjDAvNO/?symbol=BITUNIX%3A${sym}USDT.P`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex-1 text-center text-[11px] font-semibold py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors">
                    Ver en TradingView
                </a>
            </div>
        </div>
    );
}

// ─── BreakoutCard — compact card for contracts near breakout ──────────────────
function BreakoutCard({ coin, result, updatedAt }) {
    const meta    = PATTERN_META[result.type] ?? {};
    const isBull  = meta.bias === "bullish";
    const isBear  = meta.bias === "bearish";
    const sym     = coin.symbol.toUpperCase();
    const urgency = result.daysToApex !== null && result.daysToApex <= 5 ? "high"
                  : result.daysToApex !== null && result.daysToApex <= 10 ? "med" : "low";

    return (
        <div className={`relative rounded-2xl border-2 p-4 overflow-hidden ${
            urgency === "high"
                ? "border-red-400 dark:border-red-700 bg-gradient-to-br from-red-50 dark:from-red-950/60 to-white dark:to-slate-900"
                : isBull
                ? "border-green-300 dark:border-green-800 bg-gradient-to-br from-green-50 dark:from-green-950/60 to-white dark:to-slate-900"
                : isBear
                ? "border-orange-300 dark:border-orange-800 bg-gradient-to-br from-orange-50 dark:from-orange-950/60 to-white dark:to-slate-900"
                : "border-amber-300 dark:border-amber-800 bg-gradient-to-br from-amber-50 dark:from-amber-950/60 to-white dark:to-slate-900"
        }`}>
            {/* Urgency glow strip */}
            <div className={`absolute top-0 left-0 right-0 h-1 ${
                urgency === "high" ? "bg-red-500 animate-pulse" :
                urgency === "med"  ? "bg-amber-400" : "bg-indigo-300"
            }`} />

            {/* LONG / SHORT — prominent strip */}
            <div className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 mb-2 mt-1 ${
                isBull ? "bg-green-500 dark:bg-green-600"
              : isBear ? "bg-red-500 dark:bg-red-600"
                       : "bg-indigo-500 dark:bg-indigo-600"
            }`}>
                <span className="text-sm font-black text-white tracking-widest">
                    {isBull ? "▲ LONG" : isBear ? "▼ SHORT" : "→ NEUTRAL"}
                </span>
                <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-semibold text-white/75">{meta.label}</span>
                    {updatedAt && (
                        <span className="text-[9px] font-semibold text-white/60" title="Última actualización">
                            🕓 {updatedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex items-start gap-3">
                <PatternIcon type={result.type} />

                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        {coin.image && (
                            <img src={coin.image} alt={sym} className="w-5 h-5 rounded-full"
                                 onError={e => e.target.style.display='none'} />
                        )}
                        <span className="font-bold text-gray-800 dark:text-slate-100 text-sm">{sym}</span>
                    </div>

                    {/* Price */}
                    <p className="font-mono text-xs text-gray-600 dark:text-slate-300 mb-2">
                        ${fmt(result.curPrice, result.curPrice < 1 ? 5 : 2)}
                        <span className="text-gray-400 dark:text-slate-500 font-sans ml-1">{fmtBig(coin.market_cap)}</span>
                    </p>

                    {/* Key metrics row */}
                    <div className="flex gap-2 flex-wrap">
                        {result.daysToApex !== null && (
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                                urgency === "high" ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400" :
                                urgency === "med"  ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400"
                                                  : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400"
                            }`}>
                                ⏱ {result.daysToApex}d al ápice
                            </span>
                        )}
                        <span className="text-[10px] px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-semibold">
                            {Math.round(result.compression * 100)}% compresión
                        </span>
                    </div>
                </div>

                {/* Channel minibar vertical */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                    <span className="text-[8px] text-gray-400 dark:text-slate-500 font-mono">${fmt(result.hEnd, result.hEnd < 1 ? 3 : 1)}</span>
                    <div className="relative w-2 h-14 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className={`absolute bottom-0 w-full rounded-full transition-all ${
                            isBull ? "bg-green-400" : isBear ? "bg-red-400" : "bg-indigo-400"
                        }`} style={{ height: `${result.pricePos * 100}%` }} />
                    </div>
                    <span className="text-[8px] text-gray-400 dark:text-slate-500 font-mono">${fmt(result.lEnd, result.lEnd < 1 ? 3 : 1)}</span>
                </div>
            </div>

            {/* Entry checklist */}
            <div className="mt-3 pt-2 border-t border-gray-100 dark:border-slate-700">
                <EntryChecklist result={result} showScore={true} />
            </div>

            {/* Entry / TP / SL for BreakoutCard */}
            {(() => {
                const lv    = calcLevels(result);
                const conds = getEntryConditions(result);
                const allMet = conds.every(c => c.ok);
                if (!lv) return null;
                const dec   = result.hEnd < 1 ? 5 : result.hEnd < 10 ? 4 : 2;
                const rrCls = lv.rr >= 2   ? "text-green-600 dark:text-green-400"
                            : lv.rr >= 1.2 ? "text-amber-500 dark:text-amber-400"
                                           : "text-red-500 dark:text-red-400";
                return (
                    <div className={`mt-2 rounded-xl p-2.5 border ${
                        allMet ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700"
                               : "bg-gray-50 dark:bg-slate-800/50 border-gray-200 dark:border-slate-700 opacity-70"
                    }`}>
                        <p className={`text-[9px] font-semibold uppercase tracking-wide mb-1.5 ${
                            allMet ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-slate-500"
                        }`}>
                            {allMet ? "✓ Niveles confirmados" : "Niveles estimados"}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5 mb-1">
                            <div className="rounded-lg p-1.5 text-center bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800">
                                <p className="text-[8px] font-semibold text-indigo-500 uppercase tracking-wide">Entrada</p>
                                <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 font-mono">${fmt(lv.entry, dec)}</p>
                            </div>
                            <div className="rounded-lg p-1.5 text-center bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
                                <p className="text-[8px] font-semibold text-red-500 uppercase tracking-wide">SL</p>
                                <p className="text-[10px] font-bold text-red-700 dark:text-red-300 font-mono">${fmt(lv.sl, dec)}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 mb-1">
                            {[["TP1", lv.tp1], ["TP2", lv.tp2], ["TP3", lv.tp3]].map(([label, tpVal]) => (
                                <div key={label} className="rounded-lg p-1.5 text-center bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800">
                                    <p className="text-[8px] font-semibold text-green-600 uppercase tracking-wide">{label}</p>
                                    <p className="text-[10px] font-bold text-green-700 dark:text-green-300 font-mono">${fmt(tpVal, dec)}</p>
                                </div>
                            ))}
                        </div>
                        <p className={`text-[8px] font-bold text-center ${rrCls}`}>
                            R:R 1:{fmt(lv.rr, 1)} (TP2)
                        </p>
                        {lv.extended && (
                            <p className="text-[8px] font-bold text-center text-amber-600 dark:text-amber-400 mt-0.5">
                                ⚠ Extendida{lv.realRR != null && <> · R:R real 1:{fmt(lv.realRR, 1)}</>}
                                {lv.breakevenWinRate != null && <> · eq. ≥{fmt(lv.breakevenWinRate, 0)}%</>}
                                {lv.extendedScore != null && <> · score {lv.extendedScore}%</>}
                            </p>
                        )}
                    </div>
                );
            })()}

            {/* Links */}
            <div className="flex gap-2 mt-2">
                <a href={`https://www.bitunix.com/es-es/contract-trade/${sym}USDT`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex-1 text-center text-[10px] font-semibold py-1 rounded-lg bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 hover:bg-green-100 transition-colors">
                    Bitunix
                </a>
                <a href={`https://es.tradingview.com/chart/tXjDAvNO/?symbol=BITUNIX%3A${sym}USDT.P`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex-1 text-center text-[10px] font-semibold py-1 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
                    TradingView
                </a>
            </div>
        </div>
    );
}

// ─── PatronesPage ─────────────────────────────────────────────────────────────
const FILTER_TABS = [
    { key: "all",      label: "Todos" },
    { key: "cup",      label: "Taza y Asa" },
    { key: "triangle", label: "Triángulos" },
    { key: "wedge",    label: "Cuñas" },
    { key: "flag",     label: "Banderas / Banderines" },
];

export default function PatronesPage() {
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
    const [showCoverage,   setShowCoverage]   = useState(false);
    const notifiedRef = useRef(new Set());
    const [notifPerm, setNotifPerm] = useState('default');

    // Contadores de generación: cada scan/monitoreo nuevo invalida al anterior de forma
    // permanente (a diferencia de un booleano compartido, no puede "revivir" si se resetea).
    const scanGenRef  = useRef(0);
    const watchGenRef = useRef(0);

    // Monitoreo post-scan: solo señales confirmadas (7/7), reevaluadas cada 5 min
    const [watchlist,   setWatchlist]   = useState([]); // [{ coin, result }]
    const entryNotifiedRef = useRef(new Set());

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

    // 2. Load CoinGecko markets filtered by Bitunix
    // Se pide por market cap (no por id adivinado del ticker) porque muchos símbolos
    // de Bitunix coinciden con varios tokens distintos en CoinGecko (ids ambiguos) —
    // tomar el de mayor market cap es la forma confiable de quedarnos con el real.
    useEffect(() => {
        if (bitunixSymbols === null) return;
        const load = async () => {
            setLoadingCoins(true);
            try {
                const mktBase = "/api/coingecko/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&price_change_percentage=24h&page=";
                const pages = [];
                for (const p of [1, 2, 3]) {
                    const r = await fetch(mktBase + p);
                    pages.push(await r.json());
                    if (p < 3) await new Promise(res => setTimeout(res, 20_000));
                }
                const top750  = pages.flat().filter(c => c?.id);
                const matched = bitunixSymbols.size > 0
                    ? top750.filter(c => bitunixSymbols.has(c.symbol.toUpperCase()))
                    : top750;
                setCoins(matched);
            } catch (err) {
                console.error("CoinGecko error:", err);
            } finally {
                setLoadingCoins(false);
            }
        };
        load();
    }, [bitunixSymbols]);

    // Scan inicia solo con el botón "Actualizar ahora"

    // Cleanup: invalida cualquier scan/monitoreo en vuelo al desmontar
    useEffect(() => () => { scanGenRef.current++; watchGenRef.current++; }, []);

    const runScan = async (coinsList) => {
        const myGen = ++scanGenRef.current; // invalida cualquier scan anterior de inmediato
        const stale = () => scanGenRef.current !== myGen;
        const waitRef = { get current() { return stale(); } };

        notifiedRef.current.clear();
        setAnalysisCache({});
        setProgress({ done: 0, total: coinsList.length });
        setScanRunning(true);
        setCurrentCoin(null);

        const confirmed = []; // señales que cumplieron las 7 condiciones durante este scan

        for (let i = 0; i < coinsList.length; i++) {
            if (stale()) break;
            const coin = coinsList[i];
            setCurrentCoin(coin);
            setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: true } }));

            try {
                const data = await fetchPatterns(coin.id);
                if (!stale()) {
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, data, updatedAt: new Date() } }));

                    if (data && !notifiedRef.current.has(coin.id)) {
                        const meta     = PATTERN_META[data.type] ?? {};
                        const bias     = meta.bias ?? 'neutral';
                        const conds    = getEntryConditions(data);
                        const condsMet = conds.filter(c => c.ok).length;

                        if (condsMet === conds.length) {
                            notifiedRef.current.add(coin.id);
                            sendPatternNotification(coin, data, meta.label, bias);
                            sendPatternEmail(coin, data, meta.label, bias, condsMet);
                            confirmed.push({ coin, result: data });
                        }
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
            startWatch(confirmed);
        }
    };

    const restartScan = () => {
        scanGenRef.current++;  // invalida de inmediato cualquier scan en curso
        watchGenRef.current++; // invalida de inmediato cualquier monitoreo en curso
        setTimeout(() => { if (coins.length > 0) runScan(coins); }, 150);
    };

    // Refs siempre actualizados — evitan que el efecto de scheduling tenga que
    // depender de runScan/coins/scanRunning (que cambian cada render) y se reprograme
    // de más; el timeout de larga duración se programa una sola vez.
    const runScanRef     = useRef(null);
    const coinsRef        = useRef([]);
    const scanRunningRef  = useRef(false);
    useEffect(() => {
        runScanRef.current    = runScan;
        coinsRef.current       = coins;
        scanRunningRef.current = scanRunning;
    });

    // ─── Scan automático diario a las 06:00 a.m. hora de México ───────────────
    useEffect(() => {
        let timeoutId;
        const scheduleNext = () => {
            timeoutId = setTimeout(() => {
                if (!scanRunningRef.current && coinsRef.current.length > 0) {
                    runScanRef.current?.(coinsRef.current);
                }
                scheduleNext(); // reprograma para el día siguiente
            }, msUntilNextMexicoScan());
        };
        scheduleNext();
        return () => clearTimeout(timeoutId);
    }, []);

    // ─── Monitoreo post-scan (cada 5 min, solo señales confirmadas) ────────────
    const startWatch = (confirmedList) => {
        const myGen = ++watchGenRef.current; // invalida cualquier monitoreo anterior de inmediato
        entryNotifiedRef.current.clear();
        setWatchlist(confirmedList);
        if (confirmedList.length > 0) runWatchLoop(confirmedList, myGen);
    };

    const runWatchLoop = async (initialList, myGen) => {
        const stale = () => watchGenRef.current !== myGen;
        const waitRef = { get current() { return stale(); } };

        let active = initialList;
        while (active.length > 0 && !stale()) {
            await cancellableWait(WATCH_GAP_MS, waitRef);
            if (stale()) break;

            const next = [];
            for (const item of active) {
                if (stale()) break;
                const { coin } = item;
                try {
                    const data = await fetchPatterns(coin.id);
                    if (stale()) break; // este monitoreo ya fue reemplazado — no escribir datos viejos
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, data, updatedAt: new Date() } }));
                    if (!data) continue; // el patrón desapareció por completo → se omite

                    const conds = getEntryConditions(data);
                    if (!conds.every(c => c.ok)) continue; // perdió una validación → se omite

                    const levels = calcLevels(data);
                    if (levels && !levels.extended && !entryNotifiedRef.current.has(coin.id)) {
                        entryNotifiedRef.current.add(coin.id);
                        const meta = PATTERN_META[data.type] ?? {};
                        sendEntryReadyEmail(coin, data, meta.label, levels);
                        continue; // ya se avisó → deja de monitorearse
                    }

                    next.push({ coin, result: data }); // sigue confirmado pero aún extendido
                } catch (err) {
                    next.push(item); // fetch falló, reintenta la próxima vuelta con el dato anterior
                }
                if (!stale()) await cancellableWait(WATCH_COIN_GAP_MS, waitRef);
            }

            if (stale()) break;
            active = next;
            setWatchlist(active);
        }
        if (!stale()) setWatchlist([]);
    };

    // ─── Derive displayed patterns ────────────────────────────────────────────
    const allPatterns = coins
        .filter(c => {
            if (!analysisCache[c.id]?.data) return false;
            const conds = getEntryConditions(analysisCache[c.id].data);
            return conds.every(x => x.ok);
        })
        .sort((a, b) => {
            const ca = getEntryConditions(analysisCache[a.id].data).filter(c => c.ok).length;
            const cb = getEntryConditions(analysisCache[b.id].data).filter(c => c.ok).length;
            if (cb !== ca) return cb - ca;
            const qa = analysisCache[a.id].data.compression * analysisCache[a.id].data.quality;
            const qb = analysisCache[b.id].data.compression * analysisCache[b.id].data.quality;
            return qb - qa;
        });

    const filtered = activeFilter === "all"
        ? allPatterns
        : allPatterns.filter(c => PATTERN_META[analysisCache[c.id].data.type]?.cat === activeFilter);

    // Suma del % de ganancia potencial (a TP2) de las señales confirmadas visibles.
    // No es P&L real (no hay tamaño de posición/capital) — es la suma de movimientos % teóricos.
    const pnlSummary = filtered.reduce((acc, c) => {
        const data = analysisCache[c.id]?.data;
        const lv   = data ? calcLevels(data) : null;
        if (!lv) return acc;
        const pct = Math.abs((lv.tp2 - lv.entry) / lv.entry) * 100;
        return { total: acc.total + pct, count: acc.count + 1 };
    }, { total: 0, count: 0 });

    const countByTab = {
        all:      allPatterns.length,
        cup:      allPatterns.filter(c => PATTERN_META[analysisCache[c.id].data.type]?.cat === "cup").length,
        triangle: allPatterns.filter(c => PATTERN_META[analysisCache[c.id].data.type]?.cat === "triangle").length,
        wedge:    allPatterns.filter(c => PATTERN_META[analysisCache[c.id].data.type]?.cat === "wedge").length,
        flag:     allPatterns.filter(c => PATTERN_META[analysisCache[c.id].data.type]?.cat === "flag").length,
    };

    const pctDone    = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
    const minsLeft   = progress.total > progress.done
        ? Math.ceil((progress.total - progress.done) * GAP_MS / 60_000) : 0;
    const initialLoad = bitunixSymbols === null || loadingCoins;

    // Cobertura Bitunix vs CoinGecko
    const matchedSymSet = new Set(coins.map(c => c.symbol.toUpperCase()));
    const unmatchedSyms = bitunixSymbols ? [...bitunixSymbols].filter(s => !matchedSymSet.has(s)).sort() : [];

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-6">
            <div className="max-w-6xl mx-auto">

                {/* ─── Header ───────────────────────────────────────────────── */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Patrones de Compresión</h1>
                    <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">
                        Detección automática en gráfico 4H · Taza y Asa · Triángulos · Cuñas · Banderas · Banderines
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
                                Bitunix no disponible · analizando top 750
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
                                Último: {lastScan.toLocaleTimeString("es-MX", { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                        {!scanRunning && (
                            <span className="text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2.5 py-1 rounded-full" title="Scan automático diario a las 06:00 hora de México">
                                ⏰ Próximo auto-scan: {new Date(Date.now() + msUntilNextMexicoScan()).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (Méx)
                            </span>
                        )}
                        {!scanRunning && watchlist.length > 0 && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2.5 py-1 rounded-full font-semibold animate-pulse">
                                🎯 Monitoreando {watchlist.length} señal{watchlist.length !== 1 ? 'es' : ''} confirmada{watchlist.length !== 1 ? 's' : ''} cada 5 min
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
                                        <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">Escaneando gráficos 4H…</span>
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
                        {allPatterns.length > 0 && (
                            <p className="text-xs text-gray-400 dark:text-slate-500">
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{allPatterns.length}</span> patrones encontrados · {' '}
                                <span className="text-green-600 dark:text-green-400">{countByTab.triangle} triángulos</span> · {' '}
                                <span className="text-amber-500 dark:text-amber-400">{countByTab.wedge} cuñas</span> · {' '}
                                <span className="text-blue-500 dark:text-blue-400">{countByTab.flag} banderas</span>
                            </p>
                        )}
                    </div>
                )}

                {/* ─── Cobertura Bitunix / CoinGecko ───────────────────────── */}
                {!initialLoad && bitunixSymbols && bitunixSymbols.size > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 mb-6 overflow-hidden">
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
                                if (granted) {
                                    sendPatternNotification(
                                        { name: 'Test', symbol: 'TEST', id: 'test', image: null },
                                        { compression: 0.42, daysToApex: 7, type: 'ascending_triangle' },
                                        'Triángulo Ascendente', 'bullish'
                                    );
                                }
                                await sendPatternEmail(
                                    { name: 'Test Patrón', symbol: 'test', id: 'test', current_price: 1.23, image: null },
                                    { compression: 0.42, daysToApex: 7, pricePos: 0.82, quality: 0.61, type: 'ascending_triangle' },
                                    'Triángulo Ascendente', 'bullish', 3
                                );
                            }}
                            className="text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 font-semibold px-3 py-1 rounded-full transition-colors"
                        >
                            🧪 Probar notificación y email
                        </button>
                    </div>
                )}

                {/* ─── Cerca del quiebre ───────────────────────────────────── */}
                {/* {(() => {
                    const nearBreakouts = allPatterns.filter(c => {
                        const r    = analysisCache[c.id].data;
                        const meta = PATTERN_META[r.type] ?? {};
                        const isBull = meta.bias === "bullish";
                        const isBear = meta.bias === "bearish";
                        const posBased = isBull ? r.pricePos >= 0.75
                                       : isBear ? r.pricePos <= 0.25
                                                : Math.abs(r.pricePos - 0.5) >= 0.35;
                        const apexBased = r.daysToApex !== null && r.daysToApex <= 10;
                        return posBased || apexBased;
                    }).sort((a, b) => {
                        const da = analysisCache[a.id].data.daysToApex ?? 99;
                        const db = analysisCache[b.id].data.daysToApex ?? 99;
                        return da - db;
                    });
                    if (nearBreakouts.length === 0) return null;
                    return (
                        <div className="mb-8">
                            <div className="flex items-center gap-3 mb-4">
                                <h2 className="text-lg font-bold text-gray-800 dark:text-slate-100">
                                    Cerca del quiebre
                                </h2>
                                <span className="bg-amber-400 text-white text-xs font-bold px-2.5 py-1 rounded-full animate-pulse">
                                    {nearBreakouts.length}
                                </span>
                                <span className="text-xs text-gray-400 dark:text-slate-500">
                                    · precio o ápice en menos de 10 días
                                </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {nearBreakouts.map(coin => (
                                    <BreakoutCard key={coin.id} coin={coin}
                                                  result={analysisCache[coin.id].data}
                                                  updatedAt={analysisCache[coin.id].updatedAt} />
                                ))}
                            </div>
                        </div>
                    );
                })()} */}

                {/* ─── Filter tabs ──────────────────────────────────────────── */}
                {!initialLoad && allPatterns.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-6">
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
                )}

                {/* ─── Pattern legend ───────────────────────────────────────── */}
                {!initialLoad && !scanRunning && allPatterns.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 mb-6">
                        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Guía de patrones detectados</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {Object.entries(PATTERN_META).map(([type, meta]) => (
                                <div key={type} className="flex items-center gap-2">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                        meta.bias === "bullish" ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400"
                                      : meta.bias === "bearish" ? "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400"
                                                                : "bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400"
                                    }`}>{meta.dir}</span>
                                    <span className="text-[11px] text-gray-600 dark:text-slate-400">{meta.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── Scanning, no results yet ────────────────────────────── */}
                {!initialLoad && scanRunning && allPatterns.length === 0 && (
                    <div className="text-center py-20 text-gray-400 dark:text-slate-500">
                        <div className="text-5xl mb-4">📐</div>
                        <p className="font-semibold text-gray-500 dark:text-slate-400 text-lg">Buscando patrones en 4H…</p>
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
                                <PatternCard key={c.id} coin={c} result={analysisCache[c.id].data}
                                             updatedAt={analysisCache[c.id].updatedAt} />
                            ))}
                        </div>
                    </>
                )}

                {/* ─── Empty filtered ───────────────────────────────────────── */}
                {!initialLoad && !scanRunning && allPatterns.length > 0 && filtered.length === 0 && (
                    <div className="text-center py-16 text-gray-400 dark:text-slate-500">
                        <p className="text-sm">No se encontraron patrones de este tipo en el scan actual.</p>
                        <button onClick={() => setActiveFilter("all")}
                            className="mt-3 text-indigo-500 text-sm underline underline-offset-2">Ver todos</button>
                    </div>
                )}

                {/* ─── Scan complete, no patterns ───────────────────────────── */}
                {!initialLoad && !scanRunning && lastScan && allPatterns.length === 0 && (
                    <div className="text-center py-20">
                        <div className="text-5xl mb-4">🔍</div>
                        <p className="font-semibold text-gray-600 dark:text-slate-300 text-lg">Sin señales confirmadas</p>
                        <p className="text-sm text-gray-400 dark:text-slate-500 mt-2 max-w-sm mx-auto">
                            Ningún activo cumplió con todas las condiciones de entrada en este scan.
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
