// Monitor server-side de operaciones "en_proceso" — misma lógica que
// checkOpenTrades() en app/lib/backtestLog.js, pero corriendo acá porque esa
// versión es client-side (solo se ejecuta mientras alguien tiene la pestaña
// de la app abierta en el navegador). Eso fue lo que dejó CRVUSDT, ZAMAUSDT
// y BABYUSDT marcadas "en_proceso" el 2026-09-09 pese a que el mercado ya
// las había cerrado (una incluso por una mecha grande que tocó el SL) —
// nadie tenía el navegador abierto en el momento exacto.
//
// Lo arranca service-runner.js como proceso hijo, junto con "next dev", así
// que vive mientras viva el Servicio de Windows (TradingDevServer) — es
// decir, 24/7, sin depender de ningún navegador. Pega contra el propio
// servidor Next en localhost (GET/PATCH /api/backtesting, proxy
// /api/bitunix) en vez de reimplementar la firma de la API de Bitunix, que
// ya vive en app/api/bitunix/[...path]/route.js.
const BASE_URL = `http://localhost:${process.env.TRADING_DEV_PORT || '3001'}`;
const CHECK_INTERVAL_MS = 60_000;
// Mismo motivo que FETCH_TIMEOUT_MS en app/api/bitunix/[...path]/route.js: un
// corte de internet puede dejar el pool de conexiones de este proceso con
// sockets muertos que ni truenan ni resuelven — sin este timeout, checkOpenTrades
// se queda colgado para siempre en el primer fetch y este proceso deja de
// revisar operativas en silencio (así se descubrió el 2026-09-10: el proceso
// seguía "vivo" pero sin loguear nada desde el corte de internet).
const FETCH_TIMEOUT_MS = 15_000;

function log(...args) {
    console.log(`[backtest-monitor] ${new Date().toISOString()}`, ...args);
}

async function fetchOpenTrades() {
    const res = await fetch(`${BASE_URL}/api/backtesting`, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const records = await res.json();
    return records.filter(r => r.estatus === 'en_proceso');
}

async function fetchLastPrice(activo) {
    const res = await fetch(`${BASE_URL}/api/bitunix/api/v1/futures/market/tickers?symbols=${activo}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.code !== 0 && json?.code !== '0') throw new Error(json?.msg || `Bitunix error ${json?.code}`);
    const t = json?.data?.[0];
    if (!t) throw new Error(`Sin ticker para ${activo}`);
    return parseFloat(t.last ?? t.lastPrice);
}

// Revisa cada operativa "en_proceso": si el precio actual ya tocó TP1
// (ganadora) o SL (perdedora), cierra el registro. Si sigue abierta, solo
// refresca ultimoPrecio — igual que la versión client-side.
async function checkOpenTrades() {
    let open;
    try {
        open = await fetchOpenTrades();
    } catch (e) {
        log('Error al leer el log:', e.message);
        return;
    }

    for (const trade of open) {
        let price;
        try {
            price = await fetchLastPrice(trade.activo);
        } catch (e) {
            log(`Error al obtener precio de ${trade.activo}:`, e.message);
            continue;
        }

        const isLong = trade.tipoPosicion === 'long';
        const hitTp1 = isLong ? price >= trade.takeProfit1 : price <= trade.takeProfit1;
        const hitSl  = isLong ? price <= trade.stopLoss     : price >= trade.stopLoss;

        const updates = { ultimoPrecio: price };
        if (hitTp1) {
            updates.estatus = 'ganadora';
            updates.horaCierre = new Date().toISOString();
            log(`${trade.activo} cerró GANADORA a ${price} (TP1=${trade.takeProfit1})`);
        } else if (hitSl) {
            updates.estatus = 'perdedora';
            updates.horaCierre = new Date().toISOString();
            log(`${trade.activo} cerró PERDEDORA a ${price} (SL=${trade.stopLoss})`);
        }

        try {
            await fetch(`${BASE_URL}/api/backtesting`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: trade.id, ...updates }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
        } catch (e) {
            log(`Error al actualizar ${trade.activo}:`, e.message);
        }
    }
}

// No debe tumbar el proceso por un error suelto (p.ej. un fetch que rechaza
// fuera del try/catch de arriba) — si muere, service-runner.js lo reinicia,
// pero mejor evitar el reinicio innecesario y solo loguear.
process.on('unhandledRejection', (err) => {
    log('Rechazo no manejado:', err?.message ?? err);
});

log(`Monitor de operaciones iniciado (revisa cada 60s contra ${BASE_URL})`);
checkOpenTrades();
setInterval(checkOpenTrades, CHECK_INTERVAL_MS);
