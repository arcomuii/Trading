// ─── Descarga paginada de velas 4H históricas (Binance) ───────────────────────
// Usada por el backtest histórico de patrones (app/backtest-historico). Binance
// limita a 1000 velas por request, así que se pagina avanzando startTime hasta
// cubrir todo el rango pedido.
//
// El intervalo pasó de 1H → 5m → 4H. Las ventanas de detección en
// backtestPatternEngine.js se escalan respecto a la línea base original de 1H
// (÷4 para 4H, ya que cada vela ahora cubre 4× más tiempo) para seguir
// cubriendo el mismo lapso real.

const MS_PER_CANDLE = 4 * 3_600_000; // 4 horas

// Descarga TODAS las velas de 4H entre startMs y endMs (ambos en epoch ms) para
// un símbolo de Binance (ej. "BTCUSDT"). `onBatch` se llama tras cada página,
// útil para reportar progreso. Devuelve [] si el símbolo no existe en Binance o
// no tiene datos en el rango (no lanza error para esos casos — el llamador
// decide si eso cuenta como "sin suficiente historia").
export async function fetch4hCandles(symbol, startMs, endMs, { onBatch } = {}) {
    const candles = [];
    let cursor = startMs;

    while (cursor < endMs) {
        const url = `/api/binance/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${cursor}&endTime=${endMs}&limit=1000`;
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
        const nextCursor = lastOpenTime + MS_PER_CANDLE;
        if (nextCursor <= cursor) break; // salvaguarda contra loops infinitos
        cursor = nextCursor;

        if (raw.length < 1000) break; // última página disponible
    }

    return candles;
}
