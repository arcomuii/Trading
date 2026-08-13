// ─── Auto-trading: apertura automática de posiciones cuando el ápice está a ────
// 8, 9 o 10 días. Compartido entre app/patrones/page.jsx (4H) y
// app/patrones-1h/page.jsx (1H). Sólo corre mientras la pestaña del navegador
// está abierta (no hay cron/servidor en este proyecto) — se invoca desde el
// mismo runScan que ya dispara las notificaciones/correos de patrón.

export const DISPLAY_APEX_DAYS     = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // qué se muestra en los resultados de las páginas de patrones
export const BACKTEST_APEX_DAYS    = [10]; // registro en el log de backtesting
export const AUTO_INITIAL_LEVERAGE = 2;
export const AUTO_MAX_LEVERAGE     = 10;
export const DEFAULT_TRADE_AMOUNT_USDT = 20;
export const DEFAULT_AUTO_TRADE_APEX_DAYS = 10; // mismo valor que el TARGET_APEX_DAYS fijo anterior
export const MIN_AUTO_TRADE_APEX_DAYS = 1;
export const MAX_AUTO_TRADE_APEX_DAYS = 20;

const TRADE_AMOUNT_LS_KEY   = 'trading_auto_trade_amount_usdt';
const AUTO_TRADE_ENABLED_LS_KEY = 'trading_auto_trade_enabled';
const AUTO_TRADE_APEX_DAYS_LS_KEY = 'trading_auto_trade_apex_days';

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

    let lev    = AUTO_INITIAL_LEVERAGE;
    let result = await attempt(lev);
    while (!result.ok && lev < AUTO_MAX_LEVERAGE) {
        lev += 1;
        result = await attempt(lev);
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

// Intenta abrir automáticamente una posición para un patrón cuyo ápice está a
// 8-10 días. Antes de operar verifica EN VIVO contra Bitunix que no haya ya una
// posición abierta en ese símbolo (sin límite de operativas concurrentes).
// Sólo envía correo si la orden se coloca con éxito.
export async function tryAutoOpenPosition({ coin, levels, isBull, patternLabel }) {
    const sym        = coin.symbol.toUpperCase();
    const symbolPair = `${sym}USDT`;

    try {
        const positions    = await fetchOpenPositions();
        const openSymbols  = new Set(positions.map(p => p.symbol));

        if (openSymbols.has(symbolPair)) {
            console.log(`[AutoTrade] ${symbolPair}: ya hay una operativa abierta, se omite.`);
            return { opened: false, reason: 'already_open' };
        }

        const capital = getTradeAmount(); // monto configurado = margen objetivo, no el nocional
        console.log(`[AutoTrade] ${symbolPair}: monto/operación configurado = $${capital} (margen objetivo @ ${AUTO_INITIAL_LEVERAGE}×)`);
        const balance = await fetchAvailableBalance();
        if (capital > balance) {
            console.log(`[AutoTrade] ${symbolPair}: monto configurado ($${capital}) excede el saldo disponible ($${balance.toFixed(2)}), se omite.`);
            return { opened: false, reason: 'insufficient_balance' };
        }

        // El monto configurado es el margen que se quiere comprometer — el nocional
        // (y por lo tanto qty) se calcula multiplicando por el apalancamiento inicial,
        // así margen = nocional ÷ apalancamiento = capital, en vez de capital ÷ apalancamiento.
        const notional = capital * AUTO_INITIAL_LEVERAGE;
        const qty = levels.entry > 0 ? notional / levels.entry : 0;
        if (!(qty > 0)) return { opened: false, reason: 'invalid_qty' };
        const qtyStr  = qty.toFixed(qty < 1 ? 6 : qty < 100 ? 4 : 2);

        const order = await placeAutoOrder({
            symbolPair, isBull, sl: levels.sl, tp1: levels.tp1, qtyStr,
        });

        if (!order.ok) {
            console.error(`[AutoTrade] ${symbolPair}: falló la orden`, order.data);
            return { opened: false, reason: 'order_failed', data: order.data };
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
        console.error(`[AutoTrade] ${symbolPair}: excepción`, e);
        return { opened: false, reason: 'exception', error: e.message };
    }
}
