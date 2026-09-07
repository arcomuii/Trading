// ─── Auto-trading: apertura automática de posiciones cuando el ápice está a ────
// 8, 9 o 10 días. Compartido entre app/patrones/page.jsx (4H) y
// app/patrones-1h/page.jsx (1H). Sólo corre mientras la pestaña del navegador
// está abierta (no hay cron/servidor en este proyecto) — se invoca desde el
// mismo runScan que ya dispara las notificaciones/correos de patrón.

export const DISPLAY_APEX_DAYS     = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // qué se muestra en los resultados de las páginas de patrones
export const BACKTEST_APEX_DAYS    = [10]; // registro en el log de backtesting
export const AUTO_MAX_LEVERAGE     = 20; // tope al que se escala si Bitunix rechaza la orden (no configurable)
export const DEFAULT_TRADE_AMOUNT_USDT = 20;
export const DEFAULT_AUTO_TRADE_APEX_DAYS = 10; // mismo valor que el TARGET_APEX_DAYS fijo anterior
export const MIN_AUTO_TRADE_APEX_DAYS = 1;
export const MAX_AUTO_TRADE_APEX_DAYS = 20;
export const DEFAULT_AUTO_TRADE_LEVERAGE = 2;
export const MIN_AUTO_TRADE_LEVERAGE = 1;
export const MAX_AUTO_TRADE_LEVERAGE = AUTO_MAX_LEVERAGE; // no tiene sentido arrancar más arriba del tope de escalada

const TRADE_AMOUNT_LS_KEY   = 'trading_auto_trade_amount_usdt';
const AUTO_TRADE_ENABLED_LS_KEY = 'trading_auto_trade_enabled';
const AUTO_TRADE_APEX_DAYS_LS_KEY = 'trading_auto_trade_apex_days';
const AUTO_TRADE_LEVERAGE_LS_KEY = 'trading_auto_trade_leverage';

// ─── Precisión de cantidad por símbolo ──────────────────────────────────────
// Antes la cantidad se formateaba con un heurístico genérico
// (qty.toFixed(qty<1?6:qty<100?4:2)) que asume la precisión sin consultarla.
// Bitunix expone la precisión real por contrato (basePrecision, decimales
// permitidos — puede ser 0, es decir solo enteros) y el mínimo operable
// (minTradeVolume) vía /market/trading_pairs. Para activos de precio muy bajo
// (ej. MANTRA: basePrecision=0) el heurístico manda una cantidad con
// decimales que Bitunix no acepta — la orden se rechaza en cada intento de
// apalancamiento (mismo motivo, mismo rechazo) y la posición nunca se abre,
// aunque el hallazgo ya haya quedado registrado en el log de backtesting
// (que es independiente de si la orden real se colocó o no).
const qtyPrecisionCache = new Map(); // symbolPair -> { precision, minQty, pricePrecision }

async function getQtyPrecision(symbolPair) {
    if (qtyPrecisionCache.has(symbolPair)) return qtyPrecisionCache.get(symbolPair);

    let info = { precision: 4, minQty: 0, pricePrecision: 6 }; // fallback conservador si falla la consulta
    try {
        const res  = await fetch(`/api/bitunix/api/v1/futures/market/trading_pairs?symbols=${symbolPair}`);
        const json = await res.json();
        const pair = json?.data?.[0];
        if (pair) {
            info = {
                precision: Number.isFinite(Number(pair.basePrecision)) ? Number(pair.basePrecision) : 4,
                minQty:    parseFloat(pair.minTradeVolume ?? 0) || 0,
                // Precisión del PRECIO (tpPrice/slPrice) — distinta de basePrecision
                // (que es la de la cantidad). Ver formatPriceForSymbol.
                pricePrecision: Number.isFinite(Number(pair.quotePrecision)) ? Number(pair.quotePrecision) : 6,
            };
        }
    } catch (e) {
        console.error(`[Qty] No se pudo consultar la precisión de ${symbolPair}, usando fallback:`, e);
    }
    qtyPrecisionCache.set(symbolPair, info);
    return info;
}

// Formatea `qty` con la precisión real de Bitunix para `symbolPair`. Devuelve
// null si, redondeada, la cantidad queda por debajo del mínimo operable — en
// vez de mandar una orden que Bitunix va a rechazar igual.
export async function formatQtyForSymbol(symbolPair, qty) {
    const { precision, minQty } = await getQtyPrecision(symbolPair);
    const rounded = Number(qty.toFixed(precision));
    if (!(rounded > 0) || (minQty > 0 && rounded < minQty)) return null;
    return rounded.toFixed(precision);
}

// Formatea un precio (tpPrice/slPrice) con la precisión real de Bitunix
// (quotePrecision) para `symbolPair`. calcLevels calcula los niveles con
// aritmética de punto flotante sobre el precio de entrada, que puede traer
// muchos más decimales de los que Bitunix acepta para ese contrato (ej.
// CHZUSDT: quotePrecision=5, pero el nivel calculado llega con ~15 decimales)
// — Bitunix rechaza la orden completa con "Parameter error"
// en place_order, y como el rechazo no depende del apalancamiento, un
// reintento escalando o bajando leverage nunca lo resuelve.
export async function formatPriceForSymbol(symbolPair, price) {
    const { pricePrecision } = await getQtyPrecision(symbolPair);
    return Number(price.toFixed(pricePrecision)).toFixed(pricePrecision);
}

// Monto fijo (en USDT) a usar en cada apertura automática. Persistido en
// localStorage — se mantiene hasta que el usuario lo cambie manualmente desde
// el campo de texto en patrones/page.jsx o patrones-1h/page.jsx.
export function getTradeAmount() {
    if (typeof window === 'undefined') return DEFAULT_TRADE_AMOUNT_USDT;
    const n = parseFloat(localStorage.getItem(TRADE_AMOUNT_LS_KEY));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TRADE_AMOUNT_USDT;
}

export function setTradeAmount(amount) {
    if (typeof window === 'undefined') return;
    const n = parseFloat(amount);
    if (Number.isFinite(n) && n > 0) localStorage.setItem(TRADE_AMOUNT_LS_KEY, String(n));
}

// Switch para activar/desactivar la apertura automática de posiciones, sin
// afectar el escaneo ni la lista de resultados mostrados. Persistido en
// localStorage — por defecto activado (mismo comportamiento que antes de
// existir este switch), hasta que el usuario lo apague manualmente.
export function isAutoTradeEnabled() {
    if (typeof window === 'undefined') return true;
    const v = localStorage.getItem(AUTO_TRADE_ENABLED_LS_KEY);
    return v === null ? true : v === 'true';
}

export function setAutoTradeEnabled(enabled) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(AUTO_TRADE_ENABLED_LS_KEY, enabled ? 'true' : 'false');
}

// Días de ápice (1-10) que activan la apertura automática. Persistido en
// localStorage — se mantiene hasta que el usuario lo cambie manualmente desde
// el campo de texto en patrones/page.jsx o patrones-1h/page.jsx.
export function getAutoTradeApexDays() {
    if (typeof window === 'undefined') return DEFAULT_AUTO_TRADE_APEX_DAYS;
    const n = parseInt(localStorage.getItem(AUTO_TRADE_APEX_DAYS_LS_KEY), 10);
    return Number.isFinite(n) && n >= MIN_AUTO_TRADE_APEX_DAYS && n <= MAX_AUTO_TRADE_APEX_DAYS
        ? n : DEFAULT_AUTO_TRADE_APEX_DAYS;
}

export function setAutoTradeApexDays(days) {
    if (typeof window === 'undefined') return;
    const n = parseInt(days, 10);
    if (Number.isFinite(n) && n >= MIN_AUTO_TRADE_APEX_DAYS && n <= MAX_AUTO_TRADE_APEX_DAYS)
        localStorage.setItem(AUTO_TRADE_APEX_DAYS_LS_KEY, String(n));
}

// Apalancamiento inicial (1-10) para aperturas automáticas Y para el modal
// manual de "Abrir posición" (ver OpenPositionModal en patrones/page.jsx y
// patrones-1h/page.jsx). Si Bitunix rechaza la orden, se sigue escalando
// hasta AUTO_MAX_LEVERAGE igual que antes — esto solo cambia dónde arranca
// esa escalada. Persistido en localStorage — se mantiene hasta que el
// usuario lo cambie manualmente desde el campo de texto en esas páginas.
export function getAutoTradeLeverage() {
    if (typeof window === 'undefined') return DEFAULT_AUTO_TRADE_LEVERAGE;
    const n = parseInt(localStorage.getItem(AUTO_TRADE_LEVERAGE_LS_KEY), 10);
    return Number.isFinite(n) && n >= MIN_AUTO_TRADE_LEVERAGE && n <= MAX_AUTO_TRADE_LEVERAGE
        ? n : DEFAULT_AUTO_TRADE_LEVERAGE;
}

export function setAutoTradeLeverage(leverage) {
    if (typeof window === 'undefined') return;
    const n = parseInt(leverage, 10);
    if (Number.isFinite(n) && n >= MIN_AUTO_TRADE_LEVERAGE && n <= MAX_AUTO_TRADE_LEVERAGE)
        localStorage.setItem(AUTO_TRADE_LEVERAGE_LS_KEY, String(n));
}

// Usado para decidir la apertura automática — ápice configurable (ver getAutoTradeApexDays).
export function isApexTarget(result) {
    return result?.daysToApex != null && result.daysToApex === getAutoTradeApexDays();
}

// Usado para filtrar qué tarjetas se muestran en los resultados — ápice 8, 9 o 10.
export function isApexDisplayTarget(result) {
    return result?.daysToApex != null && DISPLAY_APEX_DAYS.includes(result.daysToApex);
}

// Usado para decidir si un patrón se registra en el log de backtesting — ápice 8, 9 o 10.
export function isBacktestApexTarget(result) {
    return result?.daysToApex != null && BACKTEST_APEX_DAYS.includes(result.daysToApex);
}

// "TP2 favorable" — mismo umbral que la etiqueta "Favorable" mostrada en la tarjeta
// de niveles (lv.rr es el R:R hacia TP2, ver calcLevels).
export function isFavorableTp2(levels) {
    return levels?.rr != null && levels.rr >= 2;
}

async function fetchOpenPositions() {
    const res  = await fetch('/api/bitunix/api/v1/futures/position/get_pending_positions?pageNum=1&pageSize=100');
    const json = await res.json();
    const d = json?.data;
    if (Array.isArray(d?.positionList)) return d.positionList;
    if (Array.isArray(d?.list))         return d.list;
    if (Array.isArray(d))               return d;
    return [];
}

async function fetchAvailableBalance() {
    const res  = await fetch('/api/bitunix/api/v1/futures/account?marginCoin=USDT');
    const json = await res.json();
    if (json.code !== undefined && json.code !== 0 && json.code !== '0')
        throw new Error(`[${json.code}] ${json.msg || 'Error de API'}`);
    const acct = [json.data, json.result, json]
        .map(x => Array.isArray(x) ? x[0] : x)
        .find(x => x?.available != null);
    if (!acct) throw new Error('No se pudo leer el saldo disponible (campo "available" no encontrado)');
    return parseFloat(acct.available);
}

// Ajusta el apalancamiento y coloca una orden MARKET con TP1/SL adjuntos a
// mercado. Si Bitunix rechaza la orden, reintenta subiendo el apalancamiento
// hasta AUTO_MAX_LEVERAGE antes de rendirse — mismo comportamiento que el
// flujo manual de "Abrir posición" en patrones-1h/page.jsx (también a mercado).
async function placeAutoOrder({ symbolPair, isBull, sl, tp1, qtyStr }) {
    const attempt = async (lev) => {
        const levRes = await fetch("/api/bitunix/api/v1/futures/account/change_leverage", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: symbolPair, leverage: lev, marginCoin: "USDT" }),
        });
        const levData = await levRes.json();
        const levOk = levData?.code === 0 || levData?.code === "0";
        if (!levOk) return { ok: false, data: { step: "change_leverage", leverage: lev, ...levData } };

        const body = JSON.stringify({
            symbol:      symbolPair,
            side:        isBull ? "BUY" : "SELL",
            tradeSide:   "OPEN",
            orderType:   "MARKET",
            qty:         qtyStr,
            tpPrice:     String(tp1),
            tpStopType:  "LAST_PRICE",
            tpOrderType: "MARKET",
            slPrice:     String(sl),
            slStopType:  "LAST_PRICE",
            slOrderType: "MARKET",
        });
        const res  = await fetch("/api/bitunix/api/v1/futures/trade/place_order", {
            method: "POST", headers: { "Content-Type": "application/json" }, body,
        });
        const data = await res.json();
        const ok = data?.code === 0 || data?.code === "0" || data?.data?.orderId;
        return { ok, data: { step: "place_order", leverage: lev, ...data } };
    };

    const configured = getAutoTradeLeverage();
    let lev    = configured;
    let result = await attempt(lev);

    // 1) Escalar hacia ARRIBA hasta el tope — cubre el caso típico: rechazo
    // por margen insuficiente al apalancamiento configurado (más apalancamiento
    // = menos margen requerido para el mismo nocional).
    while (!result.ok && lev < AUTO_MAX_LEVERAGE) {
        lev += 1;
        result = await attempt(lev);
    }

    // 2) Si ya se llegó al tope (o arrancó ahí, ej. configurado=20=AUTO_MAX_
    // LEVERAGE) y sigue sin éxito, un par de reintentos al MISMO apalancamiento
    // por si el rechazo fue transitorio (glitch de red, rate limit momentáneo
    // de Bitunix) antes de asumir que es un problema real de configuración.
    for (let i = 0; !result.ok && i < 2; i++) {
        await new Promise(r => setTimeout(r, 1500));
        result = await attempt(lev);
    }

    // 3) Si sigue sin éxito, el problema puede ser justo al revés de lo que
    // asume el paso 1: el símbolo no acepta el apalancamiento configurado ni
    // el tope (ej. Bitunix responde "Parameter error" código 10002 en
    // place_order, no en change_leverage) — bajar el apalancamiento sí puede
    // resolverlo, a costa de exigir más margen para el mismo nocional. Se
    // baja desde configurado-1 (no desde el tope) porque, si en el paso 1 se
    // escaló hacia arriba, ya se probó cada valor entre configurado y el
    // tope sin éxito — repetirlos aquí sería inútil.
    if (!result.ok) {
        for (let l = configured - 1; !result.ok && l >= MIN_AUTO_TRADE_LEVERAGE; l--) {
            lev = l;
            result = await attempt(lev);
        }
    }

    return { ...result, leverage: lev };
}

async function sendTradeOpenedEmail(payload) {
    try {
        const res  = await fetch('/api/trade-opened-email', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) console.error('[TradeOpenedEmail] Error:', json);
        else         console.log('[TradeOpenedEmail] Enviado:', payload.symbol);
    } catch (e) {
        console.error('[TradeOpenedEmail] Excepción:', e);
    }
}

// Contraparte de sendTradeOpenedEmail — antes, si tryAutoOpenPosition fallaba
// por cualquier motivo, no quedaba ningún rastro visible fuera de la consola
// del navegador (que nadie revisa), así que una señal podía nunca abrirse en
// Bitunix sin que el usuario se enterara ni supiera por qué.
async function sendTradeFailedEmail(payload) {
    try {
        const res  = await fetch('/api/trade-failed-email', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) console.error('[TradeFailedEmail] Error:', json);
        else         console.log('[TradeFailedEmail] Enviado:', payload.symbol, payload.reason);
    } catch (e) {
        console.error('[TradeFailedEmail] Excepción:', e);
    }
}

// Intenta abrir automáticamente una posición para un patrón cuyo ápice está a
// 8-10 días. Antes de operar verifica EN VIVO contra Bitunix que no haya ya una
// posición abierta en ese símbolo (sin límite de operativas concurrentes).
// Manda correo tanto si la orden se coloca con éxito como si falla (salvo
// 'already_open', que es un skip esperado/rutinario, no una falla real) —
// para que una señal detectada nunca desaparezca sin dejar rastro.
export async function tryAutoOpenPosition({ coin, levels, isBull, patternLabel }) {
    const sym        = coin.symbol.toUpperCase();
    const symbolPair = `${sym}USDT`;

    const fail = async (reason, detail) => {
        console.error(`[AutoTrade] ${symbolPair}: no se abrió (${reason})`, detail ?? '');
        await sendTradeFailedEmail({
            symbol:      symbolPair,
            direction:   isBull ? 'LONG' : 'SHORT',
            patternLabel,
            entry:       levels?.entry,
            stopLoss:    levels?.sl,
            takeProfit1: levels?.tp1,
            reason,
            detail:      detail != null ? JSON.stringify(detail) : null,
            detectedAt:  new Date().toISOString(),
        });
        return { opened: false, reason, data: detail };
    };

    try {
        const positions    = await fetchOpenPositions();
        const openSymbols  = new Set(positions.map(p => p.symbol));

        if (openSymbols.has(symbolPair)) {
            console.log(`[AutoTrade] ${symbolPair}: ya hay una operativa abierta, se omite.`);
            return { opened: false, reason: 'already_open' };
        }

        const capital  = getTradeAmount();      // monto configurado = margen objetivo, no el nocional
        const leverage = getAutoTradeLeverage();
        console.log(`[AutoTrade] ${symbolPair}: monto/operación configurado = $${capital} (margen objetivo @ ${leverage}×)`);
        const balance = await fetchAvailableBalance();
        if (capital > balance) {
            return fail('insufficient_balance', { capital, balance });
        }

        // El monto configurado es el margen que se quiere comprometer — el nocional
        // (y por lo tanto qty) se calcula multiplicando por el apalancamiento inicial,
        // así margen = nocional ÷ apalancamiento = capital, en vez de capital ÷ apalancamiento.
        const notional = capital * leverage;
        const qty = levels.entry > 0 ? notional / levels.entry : 0;
        if (!(qty > 0)) return fail('invalid_qty', { notional, entry: levels.entry });
        const qtyStr = await formatQtyForSymbol(symbolPair, qty);
        if (!qtyStr) {
            return fail('qty_below_minimum', { qty });
        }

        // calcLevels calcula SL/TP1 con aritmética de punto flotante — llegan con
        // muchos más decimales de los que Bitunix acepta para ese contrato
        // (quotePrecision). Sin este redondeo, place_order rechaza la orden
        // completa con "Parameter error" sin importar el apalancamiento (ver
        // formatPriceForSymbol).
        const slStr  = await formatPriceForSymbol(symbolPair, levels.sl);
        const tp1Str = await formatPriceForSymbol(symbolPair, levels.tp1);

        const order = await placeAutoOrder({
            symbolPair, isBull, sl: slStr, tp1: tp1Str, qtyStr,
        });

        if (!order.ok) {
            return fail('order_failed', order.data);
        }

        await sendTradeOpenedEmail({
            symbol:       symbolPair,
            direction:    isBull ? 'LONG' : 'SHORT',
            patternLabel,
            entry:        levels.entry,
            stopLoss:     levels.sl,
            takeProfit1:  levels.tp1,
            qty:          qtyStr,
            capital,
            leverage:     order.leverage,
            openedAt:     new Date().toISOString(),
        });

        return { opened: true };
    } catch (e) {
        return fail('exception', { message: e.message });
    }
}
