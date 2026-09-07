// ─── Descarga paginada de velas históricas (Bitunix) ──────────────────────────
// Usada por el backtest histórico de patrones (app/backtest-historico), que
// soporta velas de 1H, 4H o 1D (selector de intervalo en la página).
//
// Antes usaba Binance (era app/lib/binanceHistory.js); se migró a Bitunix (ver
// app/lib/bitunixMarket.js) para que el backtest evalúe patrones sobre los
// mismos precios contra los que realmente se opera. Ojo: Bitunix no tiene la
// misma profundidad histórica que Binance para todos los símbolos (verificado
// contra la API real: BTCUSDT solo llega ~2-3 años atrás, no los 5 que este
// backtest pide por defecto) — fetchKlinesRange ya devuelve lo que sí exista
// en vez de fallar, así que el backtest simplemente cubre menos historia para
// los símbolos donde Bitunix no llega tan atrás.

import { fetchKlinesRange } from './bitunixMarket'

// `scale` = cuántas "velas de 1H" cubre una vela de este intervalo — el valor
// que hay que pasarle a las funciones de backtestPatternEngine.js (windowSize,
// simulateSymbolTrades, evaluateWindow) para que sus ventanas cubran el mismo
// lapso real sin importar el intervalo.
export const INTERVAL_SCALE = { '1h': 1, '4h': 4, '1d': 24 };

// Descarga TODAS las velas del `interval` elegido ('1h', '4h' o '1d') entre
// startMs y endMs (epoch ms) para un símbolo de Bitunix (ej. "BTCUSDT").
// `onBatch` se llama tras cada página, útil para reportar progreso. Devuelve
// [] si el símbolo no existe en Bitunix o no tiene datos en el rango (no
// lanza error para esos casos — el llamador decide si eso cuenta como "sin
// suficiente historia").
export async function fetchHistoricalCandles(symbol, startMs, endMs, interval = '4h', { onBatch } = {}) {
    const rows = await fetchKlinesRange(symbol, interval, startMs, endMs, { onBatch })
    return rows.map(r => ({ openTime: r.openTime, high: r.high, low: r.low, close: r.close }))
}
