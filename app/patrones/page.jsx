'use client'
import { useState, useEffect, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const GAP_MS       = 30_000;
const RETRY_DELAYS = [15_000, 30_000, 60_000];
const SCAN_SLOTS   = [2, 6, 10, 14, 18, 22]; // horas en punto

function msUntilNextSlot() {
    const now = new Date();
    for (const h of SCAN_SLOTS) {
        const d = new Date(now); d.setHours(h, 0, 0, 0);
        if (d > now) return d - now;
    }
    const next = new Date(now);
    next.setDate(next.getDate() + 1); next.setHours(SCAN_SLOTS[0], 0, 0, 0);
    return next - now;
}
function nextSlotTime() {
    const now = new Date();
    for (const h of SCAN_SLOTS) {
        const d = new Date(now); d.setHours(h, 0, 0, 0);
        if (d > now) return d;
    }
    const next = new Date(now);
    next.setDate(next.getDate() + 1); next.setHours(SCAN_SLOTS[0], 0, 0, 0);
    return next;
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
        const meta = { bullish: 'bullish', bearish: 'bearish', neutral: 'neutral' };
        const res = await fetch('/api/pattern-email', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coinName:     coin.name,
                symbol:       coin.symbol.toUpperCase(),
                price:        coin.current_price,
                image:        coin.image,
                patternLabel,
                direction:    bias === 'bullish' ? 'LONG' : bias === 'bearish' ? 'SHORT' : 'NEUTRAL',
                bias,
                compression:  result.compression,
                daysToApex:   result.daysToApex,
                pricePos:     result.pricePos,
                quality:      result.quality,
                condsMet,
                condsTotal:   5,
            }),
        });
        const json = await res.json();
        if (!res.ok) console.error('[PatternEmail] Error:', json);
        else         console.log('[PatternEmail] Enviado:', coin.symbol, result.type);
    } catch (e) {
        console.error('[PatternEmail] Excepción:', e);
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

    const base = {
        compression, normH, normL, hR2: hReg.r2, lR2: lReg.r2,
        hEnd, lEnd, avgPrice, quality, pricePos,
        curPrice, poleMovePct: hasPole ? poleMovePct : null,
        daysToApex,
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

// ─── Pattern metadata ─────────────────────────────────────────────────────────
const PATTERN_META = {
    symmetrical_triangle: { label: "Triángulo Simétrico",   cat: "triangle", bias: "neutral",  dir: "→" },
    ascending_triangle:   { label: "Triángulo Ascendente",  cat: "triangle", bias: "bullish",  dir: "↑" },
    descending_triangle:  { label: "Triángulo Descendente", cat: "triangle", bias: "bearish",  dir: "↓" },
    rising_wedge:         { label: "Cuña Ascendente",       cat: "wedge",    bias: "bearish",  dir: "↓" },
    falling_wedge:        { label: "Cuña Descendente",      cat: "wedge",    bias: "bullish",  dir: "↑" },
    bullish_flag:         { label: "Bandera Alcista",       cat: "flag",     bias: "bullish",  dir: "↑" },
    bearish_flag:         { label: "Bandera Bajista",       cat: "flag",     bias: "bearish",  dir: "↓" },
    bullish_pennant:      { label: "Banderín Alcista",      cat: "flag",     bias: "bullish",  dir: "↑" },
    bearish_pennant:      { label: "Banderín Bajista",      cat: "flag",     bias: "bearish",  dir: "↓" },
};

// ─── Entry checklist ─────────────────────────────────────────────────────────
function getEntryConditions(result) {
    const meta   = PATTERN_META[result.type] ?? {};
    const isBull = meta.bias === "bullish";
    const isBear = meta.bias === "bearish";
    const dec    = result.hEnd < 1 ? 4 : 2;
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
    ];
}

function EntryChecklist({ result }) {
    const conds   = getEntryConditions(result);
    const missing = conds.filter(c => !c.ok);
    return (
        <div>
            {/* 5-segment progress bar */}
            <div className="flex gap-1 mb-1.5">
                {conds.map((c, i) => (
                    <span key={i} title={c.label}
                          className={`flex-1 h-1 rounded-full transition-colors ${
                              c.ok ? "bg-green-400 dark:bg-green-500"
                                   : "bg-gray-200 dark:bg-slate-600"
                          }`}
                    />
                ))}
            </div>
            {missing.length === 0 ? (
                <p className="text-[10px] font-semibold text-green-600 dark:text-green-400">
                    ✓ Listo para entrada
                </p>
            ) : (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
                    <span className="font-semibold">Falta: </span>
                    {missing.map(c => c.label).join(" · ")}
                </p>
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
    return detectPattern(data);  // may return null = no pattern
}

async function cancellableWait(ms, abortRef) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (abortRef.current) return;
        await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
    }
}

// ─── PatternCard ──────────────────────────────────────────────────────────────
function PatternCard({ coin, result }) {
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

    return (
        <div className={`rounded-2xl border-2 p-4 ${
            isBull ? "border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50 dark:from-green-950 to-white dark:to-slate-900"
          : isBear ? "border-red-200 dark:border-red-900 bg-gradient-to-br from-red-50 dark:from-red-950 to-white dark:to-slate-900"
                   : "border-indigo-200 dark:border-indigo-900 bg-gradient-to-br from-indigo-50 dark:from-indigo-950 to-white dark:to-slate-900"
        }`}>
            {/* Badge row */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        isBull ? "bg-green-500 text-white"
                      : isBear ? "bg-red-500 text-white"
                               : "bg-indigo-500 text-white"
                    }`}>
                        {meta.dir} {meta.label}
                    </span>
                    {isNearBreakout && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-white animate-pulse">
                            ⚡ Cerca del quiebre
                        </span>
                    )}
                </div>
                {pct != null && (
                    <span className={`text-xs font-semibold shrink-0 ${pct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {pct >= 0 ? "+" : ""}{fmt(pct)}%
                    </span>
                )}
            </div>

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
                        ${fmt(coin.current_price, coin.current_price < 1 ? 5 : 2)}
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
                <EntryChecklist result={result} />
            </div>

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
function BreakoutCard({ coin, result }) {
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

            <div className="flex items-start gap-3 mt-1">
                <PatternIcon type={result.type} />

                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        {coin.image && (
                            <img src={coin.image} alt={sym} className="w-5 h-5 rounded-full"
                                 onError={e => e.target.style.display='none'} />
                        )}
                        <span className="font-bold text-gray-800 dark:text-slate-100 text-sm">{sym}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isBull ? "bg-green-500 text-white" : isBear ? "bg-red-500 text-white" : "bg-indigo-500 text-white"
                        }`}>
                            {meta.dir} {meta.label}
                        </span>
                    </div>

                    {/* Price */}
                    <p className="font-mono text-xs text-gray-600 dark:text-slate-300 mb-2">
                        ${fmt(coin.current_price, coin.current_price < 1 ? 5 : 2)}
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
                        <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                            isBull ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
                          : isBear ? "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400"
                                   : "bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400"
                        }`}>
                            {isBull ? "↑ Alcista" : isBear ? "↓ Bajista" : "→ Neutral"}
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
                <EntryChecklist result={result} />
            </div>

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
    const [nextScanAt,     setNextScanAt]      = useState(null);
    const [currentCoin,    setCurrentCoin]    = useState(null);
    const [activeFilter,   setActiveFilter]   = useState("all");
    const [showCoverage,   setShowCoverage]   = useState(false);
    const abortRef    = useRef(false);
    const notifiedRef = useRef(new Set());
    const [notifPerm, setNotifPerm] = useState('default');

    // Request notification permission on load
    useEffect(() => {
        requestNotifPermission().then(() => {
            if ('Notification' in window) setNotifPerm(Notification.permission);
        });
    }, []);

    // Live countdown to next scheduled scan
    const [countdown, setCountdown] = useState(() => fmtCountdown(msUntilNextSlot()));
    useEffect(() => {
        const id = setInterval(() => setCountdown(fmtCountdown(msUntilNextSlot())), 30_000);
        return () => clearInterval(id);
    }, []);

    // 1. Load Bitunix symbols
    useEffect(() => {
        fetch("/api/bitunix/api/v1/futures/market/tickers")
            .then(r => r.json())
            .then(json => {
                const list = Array.isArray(json?.data)   ? json.data
                           : Array.isArray(json?.result) ? json.result
                           : Array.isArray(json)         ? json : [];
                const symbols = new Set();
                list.forEach(c => {
                    const raw = (c.baseCoin ?? c.symbol?.replace(/USDT$|USDC$|BUSD$|PERP$/i, '') ?? '').toUpperCase();
                    if (!raw) return;
                    symbols.add(raw);
                    const stripped = raw.replace(/^1000/, '');
                    if (stripped !== raw) symbols.add(stripped);
                });
                setBitunixCount(symbols.size);
                setBitunixSymbols(symbols.size > 0 ? symbols : new Set());
            })
            .catch(() => setBitunixSymbols(new Set()));
    }, []);

    // 2. Load CoinGecko markets filtered by Bitunix
    useEffect(() => {
        if (bitunixSymbols === null) return;
        const load = async () => {
            setLoadingCoins(true);
            try {
                const mktBase = "/api/coingecko/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&price_change_percentage=24h&page=";
                const pages   = await Promise.all([1, 2, 3].map(p => fetch(mktBase + p).then(r => r.json())));
                const top750  = pages.flat().filter(c => c?.id);
                let matched   = bitunixSymbols.size > 0
                    ? top750.filter(c => bitunixSymbols.has(c.symbol.toUpperCase()))
                    : top750;
                const matchedSyms = new Set(matched.map(c => c.symbol.toUpperCase()));

                if (bitunixSymbols.size > 0) {
                    const missing    = [...bitunixSymbols].filter(s => !matchedSyms.has(s));
                    if (missing.length > 0) {
                        const missingSet = new Set(missing);
                        const listRes    = await fetch('/api/coingecko/api/v3/coins/list');
                        const allCoins   = await listRes.json();
                        const idMap = {};
                        if (Array.isArray(allCoins)) {
                            allCoins.forEach(c => {
                                const sym = c.symbol.toUpperCase();
                                if (missingSet.has(sym) && !idMap[sym]) idMap[sym] = c.id;
                            });
                        }
                        const extraIds = Object.values(idMap);
                        for (let i = 0; i < extraIds.length; i += 100) {
                            const ids = extraIds.slice(i, i + 100).join(',');
                            const r   = await fetch(`/api/coingecko/api/v3/coins/markets?vs_currency=usd&ids=${ids}&per_page=100&order=market_cap_desc&price_change_percentage=24h`);
                            const data = await r.json();
                            if (Array.isArray(data)) {
                                data.forEach(c => {
                                    const sym = c.symbol.toUpperCase();
                                    if (bitunixSymbols.has(sym) && !matchedSyms.has(sym)) {
                                        matched.push(c); matchedSyms.add(sym);
                                    }
                                });
                            }
                            if (i + 100 < extraIds.length) await new Promise(r => setTimeout(r, 1_200));
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

    // 3. Auto-start scan when coins are loaded
    useEffect(() => {
        if (coins.length === 0 || loadingCoins) return;
        runScan(coins);
    }, [coins]); // eslint-disable-line

    // Cleanup
    useEffect(() => () => { abortRef.current = true; }, []);

    const runScan = async (coinsList) => {
        abortRef.current = false;
        notifiedRef.current.clear();
        setAnalysisCache({});
        setProgress({ done: 0, total: coinsList.length });
        setScanRunning(true);
        setCurrentCoin(null);

        for (let i = 0; i < coinsList.length; i++) {
            if (abortRef.current) break;
            const coin = coinsList[i];
            setCurrentCoin(coin);
            setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: true } }));

            try {
                const data = await fetchPatterns(coin.id);
                if (!abortRef.current) {
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, data } }));

                    if (data && !notifiedRef.current.has(coin.id)) {
                        const meta     = PATTERN_META[data.type] ?? {};
                        const bias     = meta.bias ?? 'neutral';
                        const conds    = getEntryConditions(data);
                        const condsMet = conds.filter(c => c.ok).length;

                        if (condsMet === conds.length) {
                            notifiedRef.current.add(coin.id);
                            sendPatternNotification(coin, data, meta.label, bias);
                            sendPatternEmail(coin, data, meta.label, bias, condsMet);
                        }
                    }
                }
            } catch (err) {
                if (!abortRef.current)
                    setAnalysisCache(prev => ({ ...prev, [coin.id]: { loading: false, error: err.message } }));
            }

            if (!abortRef.current) setProgress(prev => ({ ...prev, done: prev.done + 1 }));
            if (i < coinsList.length - 1 && !abortRef.current)
                await cancellableWait(GAP_MS, abortRef);
        }

        if (!abortRef.current) {
            setCurrentCoin(null);
            setLastScan(new Date());
            const slot = nextSlotTime();
            setNextScanAt(slot);
            setScanRunning(false);
            // Wait until next scheduled slot then re-scan automatically
            await cancellableWait(msUntilNextSlot(), abortRef);
            if (!abortRef.current) {
                setNextScanAt(null);
                runScan(coinsList);
            }
        } else {
            setScanRunning(false);
        }
    };

    const restartScan = () => {
        abortRef.current = true;
        setTimeout(() => { if (coins.length > 0) runScan(coins); }, 150);
    };

    // ─── Derive displayed patterns ────────────────────────────────────────────
    const allPatterns = coins
        .filter(c => analysisCache[c.id]?.data != null)
        .sort((a, b) => {
            const qa = analysisCache[a.id].data.compression * analysisCache[a.id].data.quality;
            const qb = analysisCache[b.id].data.compression * analysisCache[b.id].data.quality;
            return qb - qa;
        });

    const filtered = activeFilter === "all"
        ? allPatterns
        : allPatterns.filter(c => PATTERN_META[analysisCache[c.id].data.type]?.cat === activeFilter);

    const countByTab = {
        all:      allPatterns.length,
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
                        Detección automática en gráfico 4H · Triángulos · Cuñas · Banderas · Banderines
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
                        <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                            </svg>
                            {scanRunning ? "Actualizando…" : (
                                <>
                                    {nextSlotTime().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                    <span className="text-indigo-400 dark:text-indigo-500">·</span>
                                    en {countdown}
                                </>
                            )}
                        </span>
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
                {(() => {
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
                                                  result={analysisCache[coin.id].data} />
                                ))}
                            </div>
                        </div>
                    );
                })()}

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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
                        {filtered.map(coin => (
                            <PatternCard key={coin.id} coin={coin} result={analysisCache[coin.id].data} />
                        ))}
                    </div>
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
                        <div className="text-5xl mb-4">📊</div>
                        <p className="font-semibold text-gray-600 dark:text-slate-300 text-lg">Sin patrones detectados</p>
                        <p className="text-sm text-gray-400 dark:text-slate-500 mt-2">
                            Ningún activo muestra compresión significativa en 1D en este momento
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
