// ─── Descarga paginada de velas históricas (Capital.com / forex) ──────────
// Usada por app/backtesting-forex — misma idea que app/lib/bitunixHistory.js
// pero contra Capital.com (ver app/lib/capitalMarket.js).

import { fetchKlinesRange } from './capitalMarket'

// `scale` = cuántas "velas de 1H" cubre una vela de este intervalo — mismo
// significado que en app/lib/bitunixHistory.js, usado por backtestPatternEngine.js.
export const INTERVAL_SCALE = { '1h': 1, '4h': 4, '1d': 24 }

// Descarga TODAS las velas del `interval` elegido ('5m', '15m', '1h', '4h' o
// '1d') entre startMs y endMs (epoch ms) para un par de Capital.com (ej.
// "EURUSD"). Incluye `open` (a diferencia de bitunixHistory.js) porque el
// motor SMC (ver app/lib/smcEngine.js) necesita el color de la vela
// (alcista/bajista) para ubicar Order Blocks.
export async function fetchHistoricalCandles(epic, startMs, endMs, interval = '4h', { onBatch } = {}) {
    const rows = await fetchKlinesRange(epic, interval, startMs, endMs, { onBatch })
    return rows.map(r => ({ openTime: r.openTime, open: r.open, high: r.high, low: r.low, close: r.close }))
}
