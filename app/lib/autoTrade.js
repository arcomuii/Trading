// ─── Auto-trading: apertura automática de posiciones cuando el ápice está a ────
// 8, 9 o 10 días. Compartido entre app/patrones/page.jsx (4H) y
// app/patrones-1h/page.jsx (1H). Sólo corre mientras la pestaña del navegador
// está abierta (no hay cron/servidor en este proyecto) — se invoca desde el
// mismo runScan que ya dispara las notificaciones/correos de patrón.

export const TARGET_APEX_DAYS      = [10];
export const AUTO_INITIAL_LEVERAGE = 2;
export const AUTO_MAX_LEVERAGE     = 10;
export const MAX_CONCURRENT_TRADES = 5;
export const DEFAULT_TRADE_AMOUNT_USDT = 20;

const TRADE_AMOUNT_LS_KEY = 'trading_auto_trade_amount_usdt';

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

export function isApexTarget(result) {
    return result?.daysToApex != null && TARGET_APEX_DAYS.includes(result.daysToApex);
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

// Ajusta el apalancamiento y coloca una orden LIMIT con TP1/SL adjuntos a mercado.
// Si Bitunix rechaza la orden, reintenta subiendo el apalancamiento hasta
// AUTO_MAX_LEVERAGE antes de rendirse — mismo comportamiento que el flujo manual
// de "Abrir posición" en patrones-1h/page.jsx.
async function placeAutoOrder({ symbolPair, isBull, entry, sl, tp1, qtyStr }) {
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
            orderType:   "LIMIT",
            price:       String(entry),
            qty:         qtyStr,
            effect:      "GTC",
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
// posición abierta en ese símbolo y que no se exceda MAX_CONCURRENT_TRADES.
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
        if (openSymbols.size >= MAX_CONCURRENT_TRADES) {
            console.log(`[AutoTrade] ${symbolPair}: ya hay ${openSymbols.size} operativas concurrentes, se omite.`);
            return { opened: false, reason: 'max_concurrent' };
        }

        const capital = getTradeAmount();
        const balance = await fetchAvailableBalance();
        if (capital > balance) {
            console.log(`[AutoTrade] ${symbolPair}: monto configurado ($${capital}) excede el saldo disponible ($${balance.toFixed(2)}), se omite.`);
            return { opened: false, reason: 'insufficient_balance' };
        }

        const qty = levels.entry > 0 ? capital / levels.entry : 0;
        if (!(qty > 0)) return { opened: false, reason: 'invalid_qty' };
        const qtyStr  = qty.toFixed(qty < 1 ? 6 : qty < 100 ? 4 : 2);

        const order = await placeAutoOrder({
            symbolPair, isBull, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, qtyStr,
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
