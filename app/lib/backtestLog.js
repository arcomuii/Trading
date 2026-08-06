// Log persistente (JSON en disco vía app/api/backtesting) de patrones que
// cumplieron TODAS las validaciones de entrada, con ápice a 8-10 días y TP2
// favorable (R:R >= 2). Compartido entre patrones/page.jsx, patrones-1h/page.jsx
// (registro de nuevos hallazgos) y AppShell.jsx (monitor de precio cada minuto).
// Igual que el resto del proyecto, sólo corre mientras el navegador está abierto.

const CHECK_INTERVAL_MS = 60_000;

export async function fetchBacktestLog() {
    const res = await fetch('/api/backtesting', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Registra un nuevo hallazgo si el ápice está en 8-10 días y el TP2 es favorable.
// El API deduplica: si ya hay un registro "en_proceso" para el mismo activo, no
// crea uno nuevo (evita duplicar la misma operativa en cada corrida del scan).
export async function logBacktestEntry({ coin, levels, isBull, patternLabel }) {
    const activo = `${coin.symbol.toUpperCase()}USDT`;
    try {
        const res = await fetch('/api/backtesting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                activo,
                tipoPosicion: isBull ? 'long' : 'short',
                precioEntrada: levels.entry,
                stopLoss: levels.sl,
                takeProfit1: levels.tp1,
                patternLabel: patternLabel ?? null,
            }),
        });
        if (!res.ok) console.error('[BacktestLog] Error al registrar', activo, await res.text());
    } catch (e) {
        console.error('[BacktestLog] Excepción al registrar', activo, e);
    }
}

async function fetchLastPrice(symbol) {
    const res = await fetch(`/api/binance/api/v3/ticker/price?symbol=${symbol}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return parseFloat(json.price);
}

// Revisa cada operativa "en_proceso": obtiene el precio actual y determina si
// ya tocó TP1 (ganadora) o SL (perdedora). Actualiza horaCierre/estatus solo
// cuando efectivamente cierra; si sigue abierta, solo refresca ultimoPrecio.
export async function checkOpenTrades() {
    let open;
    try {
        open = (await fetchBacktestLog()).filter(r => r.estatus === 'en_proceso');
    } catch (e) {
        console.error('[BacktestLog] Error al leer el log', e);
        return;
    }

    for (const trade of open) {
        let price;
        try {
            price = await fetchLastPrice(trade.activo);
        } catch (e) {
            console.error('[BacktestLog] Error al obtener precio de', trade.activo, e);
            continue;
        }

        const isLong = trade.tipoPosicion === 'long';
        const hitTp1 = isLong ? price >= trade.takeProfit1 : price <= trade.takeProfit1;
        const hitSl  = isLong ? price <= trade.stopLoss     : price >= trade.stopLoss;

        const updates = { ultimoPrecio: price };
        if (hitTp1) {
            updates.estatus = 'ganadora';
            updates.horaCierre = new Date().toISOString();
        } else if (hitSl) {
            updates.estatus = 'perdedora';
            updates.horaCierre = new Date().toISOString();
        }

        try {
            await fetch('/api/backtesting', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: trade.id, ...updates }),
            });
        } catch (e) {
            console.error('[BacktestLog] Error al actualizar', trade.activo, e);
        }
    }
}

// Arranca el monitor de precio (cada 60s). Devuelve una función para detenerlo.
export function startBacktestMonitor() {
    checkOpenTrades();
    const id = setInterval(checkOpenTrades, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
}
