// ─── Datos de mercado de Bitunix (velas/tickers) ────────────────────────────
// Sustituye a Binance (antes app/api/binance) como fuente de precios para que
// la detección de patrones, los charts y el monitor de operaciones usen los
// mismos precios contra los que realmente se opera (Bitunix) — antes había un
// pequeño desajuste entre el precio de Binance (fuente de datos) y el de
// Bitunix (donde se ejecuta la orden real).
//
// Los códigos de intervalo son los mismos que usaba Binance (1m,5m,15m,30m,1h,
// 2h,4h,6h,12h,1d,1w,1M) — verificado contra la API real, no hace falta mapeo.
//
// Diferencia importante con Binance: Bitunix topa cada request a 200 velas SIN
// IMPORTAR el `limit` pedido (Binance permite hasta 1000). Y cuando el rango
// [startTime, endTime] pedido excede esas 200 velas, Bitunix devuelve las MÁS
// RECIENTES hasta `endTime` (ancla en endTime, no en startTime) — verificado
// empíricamente pidiendo un año completo de velas 1D: con limit=200 devolvió
// los últimos ~200 días antes de endTime, no los primeros 200 después de
// startTime. fetchKlinesRange pagina en consecuencia, retrocediendo endTime
// en cada página en vez de avanzar startTime.

const MAX_KLINES_PER_REQUEST = 200;

const MS_PER_INTERVAL = {
    '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000, '30m': 30 * 60_000,
    '1h': 3_600_000, '2h': 2 * 3_600_000, '4h': 4 * 3_600_000, '6h': 6 * 3_600_000, '12h': 12 * 3_600_000,
    '1d': 24 * 3_600_000,
};

const RETRY_DELAYS = [2000, 5000, 10000];

// Una página de velas (hasta MAX_KLINES_PER_REQUEST), normalizadas y en orden
// ASCENDENTE (Bitunix responde descendente — más reciente primero — igual que
// el resto del código ya esperaba de Binance). Reintenta ante 429/rate-limit.
export async function fetchKlines(symbolPair, interval, { limit = MAX_KLINES_PER_REQUEST, startTime, endTime } = {}, attempt = 0) {
    const params = new URLSearchParams({
        symbol: symbolPair,
        interval,
        limit: String(Math.min(limit, MAX_KLINES_PER_REQUEST)),
    });
    if (startTime != null) params.set('startTime', String(startTime));
    if (endTime   != null) params.set('endTime',   String(endTime));

    const res = await fetch(`/api/bitunix/api/v1/futures/market/kline?${params}`);
    if (res.status === 429 || res.status === 418) {
        if (attempt < RETRY_DELAYS.length) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
            return fetchKlines(symbolPair, interval, { limit, startTime, endTime }, attempt + 1);
        }
        throw new Error('RATE_LIMIT');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.code !== 0 && json?.code !== '0') throw new Error(json?.msg || `Bitunix error ${json?.code}`);

    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.slice().reverse().map(r => ({
        openTime: Number(r.time),
        open:     parseFloat(r.open),
        high:     parseFloat(r.high),
        low:      parseFloat(r.low),
        close:    parseFloat(r.close),
    }));
}

// Descarga TODAS las velas del `interval` entre startMs y endMs (epoch ms) para
// un símbolo de Bitunix (ej. "BTCUSDT"), paginando hacia atrás desde endMs
// (ver nota arriba sobre el ancla de Bitunix). `onBatch` se llama tras cada
// página para reportar progreso. Devuelve [] si el símbolo no existe o no
// tiene velas en el rango — no lanza error para esos casos, igual que antes
// con fetchHistoricalCandles/Binance.
export async function fetchKlinesRange(symbolPair, interval, startMs, endMs, { onBatch } = {}) {
    const msPerCandle = MS_PER_INTERVAL[interval];
    if (!msPerCandle) throw new Error(`Intervalo no soportado: ${interval}`);

    const candles = [];
    let cursorEnd = endMs;

    while (cursorEnd > startMs) {
        let rows;
        try {
            rows = await fetchKlines(symbolPair, interval, { limit: MAX_KLINES_PER_REQUEST, startTime: startMs, endTime: cursorEnd });
        } catch (e) {
            if (candles.length === 0) return [];
            throw e;
        }
        if (rows.length === 0) break;

        candles.push(...rows);
        onBatch?.(candles.length);

        const earliestOpenTime = rows[0].openTime; // rows viene ascendente
        const nextCursorEnd = earliestOpenTime - 1; // siguiente página: estrictamente antes de la más vieja ya obtenida
        if (nextCursorEnd >= cursorEnd) break; // salvaguarda contra loops infinitos
        cursorEnd = nextCursorEnd;

        if (rows.length < MAX_KLINES_PER_REQUEST) break; // ya no queda más historia entre startMs y cursorEnd
    }

    candles.sort((a, b) => a.openTime - b.openTime);
    return candles;
}

// Todos los tickers de Bitunix Futures en una sola petición (equivalente al
// bulk /ticker/24hr de Binance que se usaba antes). Bitunix no expone
// `priceChangePercent` directo — se calcula desde `open`/`last`.
export async function fetchAllTickers() {
    const res = await fetch('/api/bitunix/api/v1/futures/market/tickers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.code !== 0 && json?.code !== '0') throw new Error(json?.msg || `Bitunix error ${json?.code}`);
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.map(t => {
        const open = parseFloat(t.open);
        const last = parseFloat(t.last ?? t.lastPrice);
        return {
            symbol:              t.symbol,
            lastPrice:           last,
            priceChangePercent:  open > 0 ? ((last - open) / open) * 100 : null,
            quoteVolume:         parseFloat(t.quoteVol),
        };
    });
}

// Último precio de un solo símbolo — usado por el monitor de operaciones
// (checkOpenTrades) cada 60s para cada operativa en curso.
export async function fetchLastPrice(symbolPair) {
    const res = await fetch(`/api/bitunix/api/v1/futures/market/tickers?symbols=${symbolPair}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.code !== 0 && json?.code !== '0') throw new Error(json?.msg || `Bitunix error ${json?.code}`);
    const t = json?.data?.[0];
    if (!t) throw new Error(`Sin ticker para ${symbolPair}`);
    return parseFloat(t.last ?? t.lastPrice);
}
