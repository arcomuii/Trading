// ─── Descarga paginada de velas históricas (Binance) ──────────────────────────
// Usada por el backtest histórico de patrones (app/backtest-historico), que
// soporta velas de 1H, 4H o 1D (selector de intervalo en la página). Binance
// limita a 1000 velas por request, así que se pagina avanzando startTime hasta
// cubrir todo el rango pedido.
//
// El intervalo pasó de 1H → 5m → 4H, y ahora es elegible entre 1H, 4H y 1D. Las
// ventanas de detección en backtestPatternEngine.js se escalan respecto a la
// línea base original de 1H (÷scale, scale=1 para 1H, 4 para 4H y 24 para 1D,
// según cuántas horas cubre cada vela) para seguir cubriendo el mismo lapso
// real sin importar el intervalo elegido.

const MS_PER_CANDLE = { '1h': 3_600_000, '4h': 4 * 3_600_000, '1d': 24 * 3_600_000 };

// `scale` = cuántas "velas de 1H" cubre una vela de este intervalo — el valor
// que hay que pasarle a las funciones de backtestPatternEngine.js (windowSize,
// simulateSymbolTrades, evaluateWindow) para que sus ventanas cubran el mismo
// lapso real sin importar el intervalo.
export const INTERVAL_SCALE = { '1h': 1, '4h': 4, '1d': 24 };

// Descarga TODAS las velas del `interval` elegido ('1h' o '4h') entre startMs
// y endMs (ambos en epoch ms) para un símbolo de Binance (ej. "BTCUSDT").
// `onBatch` se llama tras cada página, útil para reportar progreso. Devuelve
// [] si el símbolo no existe en Binance o no tiene datos en el rango (no
// lanza error para esos casos — el llamador decide si eso cuenta como "sin
// suficiente historia").
export async function fetchHistoricalCandles(symbol, startMs, endMs, interval = '4h', { onBatch } = {}) {
    const msPerCandle = MS_PER_CANDLE[interval];
    if (!msPerCandle) throw new Error(`Intervalo no soportado: ${interval}`);

    const candles = [];
    let cursor = startMs;

    while (cursor < endMs) {
        const url = `/api/binance/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();

        // Binance responde un objeto {code, msg} (no array) para símbolos inexistentes.
        if (!Array.isArray(raw)) {
            if (candles.length === 0) return [];
            break;
        }
        if (raw.length === 0) break;

        for (const row of raw) {
            candles.push({
                openTime: row[0],
                high:     parseFloat(row[2]),
                low:      parseFloat(row[3]),
                close:    parseFloat(row[4]),
            });
        }
        onBatch?.(candles.length);

        const lastOpenTime = raw[raw.length - 1][0];
        const nextCursor = lastOpenTime + msPerCandle;
        if (nextCursor <= cursor) break; // salvaguarda contra loops infinitos
        cursor = nextCursor;

        if (raw.length < 1000) break; // última página disponible
    }

    return candles;
}
