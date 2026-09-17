'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchHistoricalCandles } from '../lib/capitalHistory'
import { fetchMarketDetails } from '../lib/capitalMarket'
import { simulateSymbolTrades, PATTERN_META, windowSize } from '../lib/forexPatternEngine'
import { findConfluenceTrades, CONFLUENCE_META, MIN_M5_CANDLES, MIN_HTF_CANDLES, PAIR_PRESETS } from '../lib/forexConfluenceEngine'
import { applyVolumeCompounding } from '../lib/forexCapital'
import { CandlestickChart } from '../../components/CandlestickChart'

// Backtest histórico de FOREX — pedido explícito del usuario: volver a la
// MISMA estrategia de detección de patrones que app/backtest-historico
// (triángulos, cuñas, banderas/banderines, taza y asa, con checklist de
// entrada + ápice a N días + R:R≥2), en vez del motor de Smart Money
// Concepts que se había construido antes en app/lib/smcEngine.js (ese
// archivo queda sin usar en esta página, no se borró por si se quiere
// retomar, pero YA NO se importa aquí).
//
// Usa app/lib/forexPatternEngine.js — copia deliberada de
// app/lib/backtestPatternEngine.js (que sigue intacta, compartida con
// app/backtest-historico, no se toca) — con UNA sola diferencia real: el
// colchón de Stop Loss está recalibrado para la volatilidad real de forex
// en vez de la de cripto (ver el comentario largo al inicio de ese archivo:
// con el piso/techo originales, calibrados en Binance, la estrategia NUNCA
// generaba señales en 1H/4H en forex real, y casi nunca en 1D). El resto de
// la calibración (compression≥0.28, quality≥0.40, ápice objetivo por
// escala, R:R≥2) se deja igual — verificado con datos reales que SÍ deja
// pasar señales razonables en 1D.
//
// Las ventanas de detección (consolidación, polo, ápice objetivo...) SOLO
// están calibradas/validadas empíricamente para `scale` 1/4/24 (1H/4H/1D) —
// por eso el selector de intervalo de esta página se limita a esas tres,
// igual que app/backtest-historico, en vez de los 5m/15m que usaba el motor
// SMC. En la práctica, 1D es donde esta estrategia SÍ encuentra señales con
// datos reales de forex — 1H/4H casi nunca generan ninguna (el canal del
// patrón en esos intervalos rara vez alcanza un R:R≥2 real contra pares de
// forex mayores), se dejan disponibles para quien quiera probar de todos
// modos.
//
// Lo que SÍ sigue siendo exclusivo de esta página (no se tocó): la fuente de
// datos (Capital.com, no Bitunix — ver app/lib/capitalHistory.js/
// capitalMarket.js) y el modelo de capital/margen real por par
// (app/lib/forexCapital.js#applyVolumeCompounding, que reemplaza al
// `applyCapitalCompounding` de apalancamiento fijo que usa backtest-historico).
//
// Corre enteramente en el navegador — puede tardar si se combina un rango
// largo con muchos pares, ya que cada uno requiere descargar el histórico
// paginado (ver app/lib/capitalMarket.js — tope real de 1000 velas por
// request).

const LOOKBACK_BUFFER_DAYS = 10 // margen para que ya haya ventana completa (200 velas equivalentes) desde el inicio del rango analizado

// "5m" corre el motor de Confluencia EUR/USD (ver app/lib/forexConfluenceEngine.js
// — HTF EMA50 + barrido/OB + divergencia RSI, R:R mínimo 2:1 dinámico, sin
// Break Even — la operativa corre hasta SL o TP). 1H/4H/1D siguen corriendo
// el motor de patrones (ver app/lib/forexPatternEngine.js) — los únicos
// `scale` (1/4/24) para los que ese motor está calibrado.
const INTERVAL_OPTIONS = [
    { value: '5m', label: '5m' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
]
const INTERVAL_SCALE = { '1h': 1, '4h': 4, '1d': 24 } // cuántas velas de 1H cubre una vela de este intervalo — mismo criterio que bitunixHistory.js (no aplica a "5m", que usa su propio motor de Confluencia)
const INTERVAL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000, '4h': 4 * 60 * 60_000, '1d': 24 * 60 * 60_000 }
const HTF_INTERVAL = '4h' // temporalidad mayor fija para el sesgo del motor de Confluencia — pedido explícito ("EMA de 50 en H1 o H4"), se eligió H4 por mayor selectividad
const HTF_CANDLE_MS = INTERVAL_MS[HTF_INTERVAL]
const CHART_CONTEXT_CANDLES = 40 // velas de margen antes de la entrada y después de la salida, para ver el contexto
const ALL_TRADE_META = { ...PATTERN_META, ...CONFLUENCE_META } // para poder mostrar el tipo de operativa venga del motor que venga

// Rangos largos (2/3/5 años) agregados tras recalibrar para forex: con esta
// estrategia, en 1D las señales que sí pasan el checklist completo + R:R≥2
// aparecen a un ritmo bajo (verificado con datos reales: ~1 cada 1-2 años
// por par) — con solo "1 año" lo más probable es no ver ninguna operativa
// todavía, no porque algo esté roto sino porque a esa escala de tiempo el
// checklist completo (compresión + calidad + ápice + retest + barrido de
// liquidez + R:R≥2, todo a la vez) es poco frecuente. Mismo tope que
// app/backtest-historico (hasta 5 años).
const RANGE_OPTIONS = [
    { value: '1w', label: '1 semana', days: 7 },
    { value: '1m', label: '1 mes',    days: 30 },
    { value: '3m', label: '3 meses',  days: 90 },
    { value: '6m', label: '6 meses',  days: 180 },
    { value: '1y', label: '1 año',    days: 365 },
    { value: '2y', label: '2 años',   days: 730 },
    { value: '3y', label: '3 años',   days: 1095 },
    { value: '5y', label: '5 años',   days: 1825 },
]

// Los 6 pares de forex pedidos. Los "epics" de Capital.com para pares
// mayores coinciden con el nombre del par tal cual (ej. "EURUSD") —
// verificado contra la API real.
const PAIRS = ['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD', 'GBPJPY', 'USDCHF']
const DEFAULT_SYMBOLS = PAIRS.join(', ')

function normalizeSymbol(raw) {
    const s = raw.trim().toUpperCase()
    return s || null
}

function parseSymbols(text) {
    const list = text.split(/[,\n]/).map(normalizeSymbol).filter(Boolean)
    return [...new Set(list)]
}

// Quita `symbol` de la lista cruda del textarea, preservando el resto tal
// cual lo haya escrito el usuario.
function removeSymbolFromText(text, symbol) {
    const kept = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
        .filter(tok => normalizeSymbol(tok) !== symbol)
    return kept.join(', ')
}

function fmtMoney(n) {
    if (n == null) return '—'
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)} USD`
}
function fmtPct(n) {
    if (n == null) return '—'
    return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
}
// Hora de Ciudad de México (UTC-6, sin horario de verano desde 2022) para
// TODA la página — mismo criterio pedido por el usuario para poder comparar
// contra la plataforma de Capital.com en su propia zona horaria. "CDMX" se
// deja visible en el texto para que quede claro contra qué comparar.
const CDMX_OFFSET_MS = 6 * 3_600_000
function fmtDate(ms) {
    if (ms == null) return '—'
    return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }) + ' CDMX'
}
function fmtDay(ms) {
    if (ms == null) return '—'
    return new Date(ms).toLocaleDateString('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' })
}

const DEFAULT_RANGE = '5y' // ver nota en RANGE_OPTIONS — a este ritmo bajo de señales, "1 año" muy probablemente no muestra ninguna operativa todavía

export default function BacktestingForexPage() {
    const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS)
    const [candleInterval, setCandleInterval] = useState('1d') // 1D es donde esta estrategia sí encuentra señales en forex real (ver comentario arriba)
    const [rangeValue, setRangeValue] = useState(DEFAULT_RANGE)
    const [initialTotalCapital, setInitialTotalCapital] = useState(100)
    const [capitalPercent, setCapitalPercent] = useState(10) // % del capital total por operación — pedido explícito

    const isConfluence = candleInterval === '5m'

    // Modo Confluencia (5m): una PESTAÑA por par (pedido explícito) — cada
    // una con su propia calibración (ver PAIR_PRESETS en
    // app/lib/forexConfluenceEngine.js) y sus propios resultados, para poder
    // cambiar de pestaña sin perder la corrida de las demás.
    const [activeTab, setActiveTab] = useState(PAIRS[0])
    const [confluenceByPair, setConfluenceByPair] = useState({}) // { [symbol]: { trades: [], status: string|null } }
    const [confluenceRunning, setConfluenceRunning] = useState(false)

    const [running, setRunning] = useState(false)
    const [progress, setProgress] = useState({ done: 0, total: 0, current: null })
    const [rawTrades, setRawTrades] = useState([])
    const [symbolStatus, setSymbolStatus] = useState({})
    const stopRef = useRef(false)

    // Gráfico de velas por operativa — ver bloque "Modal del gráfico" más
    // abajo. `chartTrade` es la operativa elegida (o null si el modal está
    // cerrado); las velas se piden aparte, con margen antes/después, cada
    // vez que cambia.
    const [chartTrade, setChartTrade] = useState(null)
    const [chartCandles, setChartCandles] = useState(null)
    const [chartError, setChartError] = useState(null)

    useEffect(() => {
        if (!chartTrade) return
        let cancelled = false
        setChartCandles(null)
        setChartError(null)

        const intervalMs = INTERVAL_MS[candleInterval]
        const contextMs = CHART_CONTEXT_CANDLES * intervalMs
        const startMs = chartTrade.entryTime - contextMs
        const endMs   = (chartTrade.exitTime ?? chartTrade.entryTime) + contextMs

        fetchHistoricalCandles(chartTrade.symbol, startMs, endMs, candleInterval)
            .then(candles => {
                if (cancelled) return
                // lightweight-charts SIEMPRE muestra el `time` que recibe como si
                // fuera UTC literal (no tiene noción de zona horaria) — se le resta
                // el offset de CDMX para que el eje quede en hora CDMX (mismo
                // criterio que fmtDate/fmtDay arriba). Las líneas de entrada/SL/TP
                // son de PRECIO, no de tiempo, así que este corrimiento no las
                // afecta — solo corrige la etiqueta horaria bajo cada vela.
                setChartCandles(candles.map(c => ({
                    time: Math.floor((c.openTime - CDMX_OFFSET_MS) / 1000),
                    open: c.open, high: c.high, low: c.low, close: c.close,
                })))
            })
            .catch(err => { if (!cancelled) setChartError(err.message) })

        return () => { cancelled = true }
    }, [chartTrade, candleInterval])

    useEffect(() => {
        if (!chartTrade) return
        const onKey = e => { if (e.key === 'Escape') setChartTrade(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [chartTrade])

    const useDefaultSymbols = () => setSymbolsText(DEFAULT_SYMBOLS)
    const rangeDays = RANGE_OPTIONS.find(r => r.value === rangeValue)?.days ?? 30

    // Modo Confluencia: corre SOLO para la pestaña activa, con su
    // calibración propia (PAIR_PRESETS[activeTab]) — no combina pares.
    const runConfluenceBacktest = async () => {
        const symbol = activeTab
        setConfluenceByPair(s => ({ ...s, [symbol]: { trades: [], status: null } }))
        setConfluenceRunning(true)
        stopRef.current = false

        const endMs      = Date.now()
        const rangeStartMs = endMs - rangeDays * 24 * 3_600_000
        const fetchStartMs = rangeStartMs - LOOKBACK_BUFFER_DAYS * 24 * 3_600_000

        try {
            const [m5Candles, htfCandles, market] = await Promise.all([
                fetchHistoricalCandles(symbol, fetchStartMs, endMs, '5m'),
                fetchHistoricalCandles(symbol, fetchStartMs, endMs, HTF_INTERVAL),
                fetchMarketDetails(symbol),
            ])

            if (m5Candles.length < MIN_M5_CANDLES || htfCandles.length < MIN_HTF_CANDLES) {
                setConfluenceByPair(s => ({ ...s, [symbol]: { trades: [], status: `sin historial suficiente (${m5Candles.length} M5 / ${htfCandles.length} ${HTF_INTERVAL.toUpperCase()})` } }))
            } else if (!Number.isFinite(market.marginFactor)) {
                setConfluenceByPair(s => ({ ...s, [symbol]: { trades: [], status: 'sin marginFactor en Capital.com para este epic' } }))
            } else {
                const params = PAIR_PRESETS[symbol] // calibración específica de este par
                const symbolTrades = findConfluenceTrades(m5Candles, htfCandles, HTF_CANDLE_MS, params)
                    .map(t => ({ ...t, symbol, marginFactor: market.marginFactor }))
                setConfluenceByPair(s => ({ ...s, [symbol]: { trades: symbolTrades, status: `${symbolTrades.length} operativa(s) · margen ${(market.marginFactor * 100).toFixed(2)}%` } }))
            }
        } catch (err) {
            setConfluenceByPair(s => ({ ...s, [symbol]: { trades: [], status: `error: ${err.message}` } }))
        }

        setConfluenceRunning(false)
    }

    const runPatternBacktest = async () => {
        const symbols = parseSymbols(symbolsText)
        if (symbols.length === 0) return

        const scale = INTERVAL_SCALE[candleInterval]

        setRawTrades([])
        setSymbolStatus({})
        setProgress({ done: 0, total: symbols.length, current: null })
        setRunning(true)
        stopRef.current = false

        const endMs      = Date.now()
        const rangeStartMs = endMs - rangeDays * 24 * 3_600_000
        const fetchStartMs = rangeStartMs - LOOKBACK_BUFFER_DAYS * 24 * 3_600_000

        for (let idx = 0; idx < symbols.length; idx++) {
            if (stopRef.current) break
            const symbol = symbols[idx]
            setProgress({ done: idx, total: symbols.length, current: symbol })

            try {
                const minCandlesNeeded = windowSize(scale) + 10 // WINDOW (escalado ÷scale, ver forexPatternEngine.js) + margen
                const [candles, market] = await Promise.all([
                    fetchHistoricalCandles(symbol, fetchStartMs, endMs, candleInterval),
                    fetchMarketDetails(symbol),
                ])

                if (candles.length < minCandlesNeeded) {
                    setSymbolStatus(s => ({ ...s, [symbol]: `sin historial suficiente (${candles.length} velas)` }))
                } else if (!Number.isFinite(market.marginFactor)) {
                    setSymbolStatus(s => ({ ...s, [symbol]: 'sin marginFactor en Capital.com para este epic' }))
                } else {
                    // marginFactor de CADA par (varía por instrumento — ver
                    // app/lib/forexCapital.js) va pegado a cada operativa para que
                    // el margen se calcule con el valor real de ese par.
                    const symbolTrades = simulateSymbolTrades(candles, scale).map(t => ({ ...t, symbol, marginFactor: market.marginFactor }))
                    setRawTrades(prev => [...prev, ...symbolTrades])
                    setSymbolStatus(s => ({ ...s, [symbol]: `${symbolTrades.length} operativa(s) · margen ${(market.marginFactor * 100).toFixed(2)}%` }))
                }
            } catch (err) {
                // Pares que marcan error se quitan solos de la lista — normalmente
                // significa que el epic no existe en Capital.com con ese nombre,
                // o que faltan credenciales (ver app/api/capital/[...path]/route.js).
                setSymbolStatus(s => ({ ...s, [symbol]: `error: ${err.message}` }))
                setSymbolsText(prev => removeSymbolFromText(prev, symbol))
            }

            setProgress({ done: idx + 1, total: symbols.length, current: symbol })
        }

        setRunning(false)
    }

    const runBacktest = isConfluence ? runConfluenceBacktest : runPatternBacktest
    const stopBacktest = () => { stopRef.current = true }
    const isRunning = isConfluence ? confluenceRunning : running

    // Fuente efectiva de operativas crudas: en modo Confluencia, solo las de
    // la pestaña activa (cada pestaña guarda las suyas por separado).
    const effectiveRawTrades = isConfluence ? (confluenceByPair[activeTab]?.trades ?? []) : rawTrades
    const effectiveSymbolStatus = isConfluence
        ? (confluenceByPair[activeTab]?.status ? { [activeTab]: confluenceByPair[activeTab].status } : {})
        : symbolStatus

    const { trades, finalCapital, availableCapital, maxConcurrentOpen } = useMemo(
        () => applyVolumeCompounding(effectiveRawTrades, { initialTotalCapital, capitalPercent }),
        [effectiveRawTrades, initialTotalCapital, capitalPercent]
    )

    const executed = trades.filter(t => t.executed)
    const skipped  = trades.filter(t => !t.executed)
    const closed   = executed.filter(t => t.outcome !== 'open')
    const openTrades = executed.filter(t => t.outcome === 'open')
    const wins     = closed.filter(t => t.outcome === 'win')
    const losses   = closed.filter(t => t.outcome === 'loss')
    const winRate  = closed.length > 0 ? (wins.length / closed.length) * 100 : null
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnlUsdt ?? 0), 0)

    const lossRanking = useMemo(() => {
        const bySymbol = {}
        for (const t of losses) {
            bySymbol[t.symbol] ??= { losses: 0, wins: 0 }
            bySymbol[t.symbol].losses += 1
        }
        for (const t of wins) {
            if (!bySymbol[t.symbol]) continue
            bySymbol[t.symbol].wins += 1
        }
        return Object.entries(bySymbol).sort((a, b) => b[1].losses - a[1].losses)
    }, [losses, wins])

    const winRanking = useMemo(() => {
        const bySymbol = {}
        for (const t of wins) {
            bySymbol[t.symbol] ??= { wins: 0, losses: 0 }
            bySymbol[t.symbol].wins += 1
        }
        for (const t of losses) {
            if (!bySymbol[t.symbol]) continue
            bySymbol[t.symbol].losses += 1
        }
        return Object.entries(bySymbol).sort((a, b) => b[1].wins - a[1].wins)
    }, [wins, losses])

    const ratioRanking = useMemo(() => {
        const bySymbol = {}
        for (const t of closed) {
            bySymbol[t.symbol] ??= { wins: 0, losses: 0 }
            if (t.outcome === 'win') bySymbol[t.symbol].wins += 1
            else bySymbol[t.symbol].losses += 1
        }
        return Object.entries(bySymbol)
            .map(([symbol, stats]) => ({
                symbol, ...stats,
                ratio: stats.losses === 0 ? Infinity : stats.wins / stats.losses,
            }))
            .sort((a, b) => b.ratio - a.ratio || b.wins - a.wins)
    }, [closed])

    const dailyCapital = useMemo(() => {
        const closeEvents = executed
            .filter(t => t.exitTime != null && t.capitalAfter != null)
            .map(t => ({ time: t.exitTime, capital: t.capitalAfter }))
            .sort((a, b) => a.time - b.time)
        if (closeEvents.length === 0) return []

        const MS_PER_DAY = 24 * 3_600_000
        const firstDay = Math.floor((Date.now() - rangeDays * MS_PER_DAY) / MS_PER_DAY) * MS_PER_DAY
        const lastDay  = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY

        const days = []
        let capital = initialTotalCapital
        let idx = 0
        for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
            const dayEnd = day + MS_PER_DAY
            let closesToday = 0
            while (idx < closeEvents.length && closeEvents[idx].time < dayEnd) {
                capital = closeEvents[idx].capital
                closesToday++
                idx++
            }
            days.push({ date: day, capital, closesToday })
        }
        return days
    }, [executed, initialTotalCapital, rangeDays])

    const sortedTrades = [...trades].sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0))

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100">
                    Backtest histórico Forex · {isConfluence ? `Confluencia ${activeTab}` : 'Estrategia de Patrones'} ({RANGE_OPTIONS.find(r => r.value === rangeValue)?.label} · {candleInterval.toUpperCase()})
                </h1>
                {isConfluence ? (
                    <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                        HTF EMA50 en H4 + barrido/OB + divergencia RSI, R:R mínimo 2:1 dinámico (siguiente liquidez
                        estructural), sin Break Even. Cada pestaña ({PAIRS.join(', ')}) tiene su propia calibración
                        (ver "Estado por par" abajo) para caer en 45-55% de acierto y 3-10 operativas/mes con datos
                        reales de Capital.com. Capital total inicial ${initialTotalCapital}, cada operación compromete
                        el <b>{capitalPercent}% del capital total</b> en ese momento — el volumen real que hay que
                        operar en Capital.com se deriva con el <code className="text-xs">marginFactor</code> real de este par.
                    </p>
                ) : (
                    <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                        Misma detección de patrones que app/backtest-historico (ver "Estrategia de Patrones" — triángulos,
                        cuñas, banderas/banderines y taza-asa sobre una ventana deslizante), con el mismo checklist de entrada,
                        ápice exactamente al target de esta escala y R:R mínimo 2:1 contra TP2. Barrido de liquidez como
                        condición adicional del checklist. Capital total inicial ${initialTotalCapital}, cada operación
                        compromete el <b>{capitalPercent}% del capital total</b> en ese momento — el volumen real que hay
                        que operar en Capital.com se deriva con el <code className="text-xs">marginFactor</code> real de cada par.
                    </p>
                )}
            </div>

            <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
                <div>
                    <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1">Intervalo de velas</label>
                    <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden">
                        {INTERVAL_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setCandleInterval(opt.value)}
                                disabled={isRunning}
                                className={`px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                    candleInterval === opt.value
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        {candleInterval === '5m'
                            ? 'Motor de Confluencia (HTF EMA50 en H4 + barrido/OB + divergencia RSI) — una pestaña por par, cada una calibrada por separado. Descarga M5 + H4.'
                            : '1H/4H/1D: motor de patrones (triángulos, cuñas, banderas, taza-asa) — ventanas de detección calibradas y validadas empíricamente solo para estas tres escalas (ver app/lib/forexPatternEngine.js).'}
                    </p>
                </div>

                {isConfluence ? (
                    <div>
                        <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1">Par (cada pestaña tiene su propia calibración y resultados)</label>
                        <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden flex-wrap">
                            {PAIRS.map(sym => (
                                <button
                                    key={sym}
                                    type="button"
                                    onClick={() => setActiveTab(sym)}
                                    disabled={isRunning}
                                    className={`px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                        activeTab === sym
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {sym}
                                    {confluenceByPair[sym]?.trades?.length ? ` (${confluenceByPair[sym].trades.length})` : ''}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                            El número entre paréntesis es cuántas operativas encontró la última corrida de esa pestaña. Cambiar de pestaña no borra los resultados de las demás.
                        </p>
                    </div>
                ) : (
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-semibold text-gray-500 dark:text-slate-400">Pares a analizar (separados por coma)</label>
                            <button
                                type="button"
                                onClick={useDefaultSymbols}
                                disabled={isRunning}
                                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                            >
                                Restaurar los 6 pares por defecto
                            </button>
                        </div>
                        <textarea
                            value={symbolsText}
                            onChange={e => setSymbolsText(e.target.value)}
                            disabled={isRunning}
                            rows={2}
                            className="w-full text-xs font-mono p-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-slate-200 disabled:opacity-60"
                        />
                        <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                            Los pares que terminen en error durante la corrida (epic no reconocido por Capital.com, o sesión sin credenciales) se quitan solos de esta lista.
                        </p>
                    </div>
                )}

                <div>
                    <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1">Rango de historial a analizar</label>
                    <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden flex-wrap">
                        {RANGE_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setRangeValue(opt.value)}
                                disabled={isRunning}
                                className={`px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                    rangeValue === opt.value
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        Corre desde hoy hacia atrás tantos días. Rango más largo o intervalo más fino = más velas por par y una corrida más lenta.
                    </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital total inicial
                        <input
                            type="number" min={1} step={1}
                            value={initialTotalCapital}
                            onChange={e => setInitialTotalCapital(parseFloat(e.target.value) || 0)}
                            disabled={isRunning}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital por operación (% del total)
                        <input
                            type="number" min={0.1} step={0.5}
                            value={capitalPercent}
                            onChange={e => setCapitalPercent(parseFloat(e.target.value) || 0)}
                            disabled={isRunning}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
                        />
                    </label>
                </div>
                <p className="text-[10px] text-gray-400 dark:text-slate-500 -mt-1">
                    Cada operación compromete ese % del capital TOTAL en el momento de abrirse (mismo método que Capital.com:
                    el margen se fija primero y el volumen real se deriva con el marginFactor de cada par) — compounding
                    natural: si el capital sube, el % de la siguiente operación es un monto mayor en dólares; si baja, menor.
                </p>

                <div className="flex items-center gap-4 flex-wrap pt-1">
                    {!isRunning ? (
                        <button
                            type="button"
                            onClick={runBacktest}
                            className="text-sm font-bold px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                        >
                            ▶ Iniciar backtest
                        </button>
                    ) : isConfluence ? (
                        <button type="button" disabled
                            className="text-sm font-bold px-5 py-2 rounded-xl bg-indigo-200 dark:bg-indigo-900 text-indigo-500 dark:text-indigo-300 cursor-not-allowed"
                        >
                            ⏳ Analizando {activeTab}…
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={stopBacktest}
                            className="text-sm font-bold px-5 py-2 rounded-xl bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
                        >
                            ■ Detener
                        </button>
                    )}

                    {!isConfluence && progress.total > 0 && (
                        <span className="text-xs text-gray-400 dark:text-slate-500">
                            {progress.done}/{progress.total} pares
                            {progress.current && running ? ` · analizando ${progress.current}…` : ''}
                        </span>
                    )}
                </div>

                {!isConfluence && progress.total > 0 && (
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                        <div
                            className="h-full bg-indigo-500 transition-all"
                            style={{ width: `${(progress.done / progress.total) * 100}%` }}
                        />
                    </div>
                )}
            </div>

            {/* ── Resultados ── */}
            <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Operativas cerradas</div>
                    <div className="text-2xl font-semibold text-gray-800 dark:text-slate-100">{closed.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">En curso</div>
                    <div className="text-2xl font-semibold text-blue-500 dark:text-blue-400">{openTrades.length}</div>
                    {openTrades.length > 0 && <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">sin cerrar al final del histórico</div>}
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Ganadoras</div>
                    <div className="text-2xl font-semibold text-green-600 dark:text-green-400">{wins.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Perdedoras</div>
                    <div className="text-2xl font-semibold text-red-500 dark:text-red-400">{losses.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Win rate</div>
                    <div className="text-2xl font-semibold text-gray-800 dark:text-slate-100">
                        {winRate != null ? `${winRate.toFixed(1)}%` : '—'}
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Sin capital disponible</div>
                    <div className="text-2xl font-semibold text-amber-500 dark:text-amber-400">{skipped.length}</div>
                    {skipped.length > 0 && <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">señales que no se pudieron tomar</div>}
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Máx. operativas simultáneas</div>
                    <div className="text-2xl font-semibold text-purple-600 dark:text-purple-400">{maxConcurrentOpen}</div>
                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">ejecutadas al mismo tiempo, en cualquier par</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Capital final (de ${initialTotalCapital} inicial)</div>
                    <div className={`text-2xl font-semibold ${finalCapital >= initialTotalCapital ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        ${finalCapital.toFixed(2)}
                    </div>
                    <div className={`text-xs mt-1 font-medium ${totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {fmtMoney(totalPnl)} acumulado
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Capital disponible</div>
                    <div className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
                        ${availableCapital.toFixed(2)}
                    </div>
                    <div className="text-xs mt-1 text-gray-400 dark:text-slate-500">
                        {finalCapital - availableCapital > 0
                            ? `$${(finalCapital - availableCapital).toFixed(2)} comprometidos en operativas sin cerrar`
                            : 'nada comprometido — todas las operativas cerraron'}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-2">Pares con más operativas perdedoras</div>
                    {lossRanking.length === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-slate-500">Sin perdedoras todavía.</p>
                    ) : (
                        <ol className="text-sm space-y-1">
                            {lossRanking.slice(0, 10).map(([symbol, stats], i) => (
                                <li key={symbol} className="flex items-center justify-between">
                                    <span className="text-gray-600 dark:text-slate-300">{i + 1}. {symbol}</span>
                                    <span>
                                        <span className="font-semibold text-red-500 dark:text-red-400">{stats.losses} perdedora{stats.losses !== 1 ? 's' : ''}</span>
                                        <span className="text-gray-400 dark:text-slate-500"> · </span>
                                        <span className="font-semibold text-green-600 dark:text-green-400">{stats.wins} ganadora{stats.wins !== 1 ? 's' : ''}</span>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </div>

            {/* ── Ranking de pares con más operativas ganadoras ── */}
            {winRanking.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Pares con más operativas ganadoras ({winRanking.length})
                    </summary>
                    <div className="max-h-96 overflow-y-auto mt-3">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">#</th>
                                    <th className="py-1.5 pr-3">Par</th>
                                    <th className="py-1.5 pr-3">Ganadoras</th>
                                    <th className="py-1.5 pr-3">Perdedoras</th>
                                </tr>
                            </thead>
                            <tbody>
                                {winRanking.map(([symbol, stats], i) => (
                                    <tr key={symbol} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{i + 1}</td>
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{symbol}</td>
                                        <td className="py-1 pr-3 font-semibold text-green-600 dark:text-green-400">{stats.wins}</td>
                                        <td className="py-1 pr-3 text-red-500 dark:text-red-400">{stats.losses}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {/* ── Ranking de pares con más operativas perdedoras ── */}
            {lossRanking.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Pares con más operativas perdedoras ({lossRanking.length})
                    </summary>
                    <div className="max-h-96 overflow-y-auto mt-3">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">#</th>
                                    <th className="py-1.5 pr-3">Par</th>
                                    <th className="py-1.5 pr-3">Perdedoras</th>
                                    <th className="py-1.5 pr-3">Ganadoras</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lossRanking.map(([symbol, stats], i) => (
                                    <tr key={symbol} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{i + 1}</td>
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{symbol}</td>
                                        <td className="py-1 pr-3 font-semibold text-red-500 dark:text-red-400">{stats.losses}</td>
                                        <td className="py-1 pr-3 text-green-600 dark:text-green-400">{stats.wins}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {/* ── Ranking de pares por ratio ganadoras/perdedoras ── */}
            {ratioRanking.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Pares por ratio ganadoras/perdedoras ({ratioRanking.length})
                    </summary>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 mb-2">
                        Ratio = ganadoras ÷ perdedoras. "∞" significa que ese par no tuvo ninguna perdedora
                        (ojo: con pocas operativas un ∞ no dice mucho — revisa cuántas cerró en total).
                    </p>
                    <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">#</th>
                                    <th className="py-1.5 pr-3">Par</th>
                                    <th className="py-1.5 pr-3">Ratio</th>
                                    <th className="py-1.5 pr-3">Ganadoras</th>
                                    <th className="py-1.5 pr-3">Perdedoras</th>
                                    <th className="py-1.5 pr-3">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ratioRanking.map((r, i) => (
                                    <tr key={r.symbol} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{i + 1}</td>
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{r.symbol}</td>
                                        <td className="py-1 pr-3 font-semibold text-indigo-600 dark:text-indigo-400">
                                            {r.ratio === Infinity ? '∞' : r.ratio.toFixed(2)}
                                        </td>
                                        <td className="py-1 pr-3 text-green-600 dark:text-green-400">{r.wins}</td>
                                        <td className="py-1 pr-3 text-red-500 dark:text-red-400">{r.losses}</td>
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{r.wins + r.losses}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {/* ── Capital restante día por día ── */}
            {dailyCapital.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Capital restante día por día ({dailyCapital.length} días, desde {fmtDay(dailyCapital[0].date)})
                    </summary>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 mb-2">
                        El capital solo se mueve cuando cierra una operativa — los días sin cierres mantienen el capital del día anterior.
                    </p>
                    <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">Día</th>
                                    <th className="py-1.5 pr-3">Cierres ese día</th>
                                    <th className="py-1.5 pr-3">Capital restante</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyCapital.map((d, i) => (
                                    <tr key={i} className={`border-b border-gray-50 dark:border-slate-800/60 ${d.closesToday > 0 ? 'font-medium' : ''}`}>
                                        <td className="py-1 pr-3 text-gray-600 dark:text-slate-300">{fmtDay(d.date)}</td>
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{d.closesToday > 0 ? d.closesToday : '—'}</td>
                                        <td className={`py-1 pr-3 ${d.capital >= initialTotalCapital ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                            ${d.capital.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {/* ── Operativas sin cerrar ── */}
            {openTrades.length > 0 && (
                <div className="bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
                    <div className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-1">
                        {openTrades.length} operativa{openTrades.length !== 1 ? 's' : ''} sin cerrar al final del histórico
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-2">
                        Se abrieron pero nunca tocaron SL ni TP dentro de las velas descargadas — su capital sigue
                        comprometido (por eso restan del "Capital disponible" de hoy) y no cuentan como ganadora ni perdedora.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">Par</th>
                                    <th className="py-1.5 pr-3">Patrón</th>
                                    <th className="py-1.5 pr-3">Dirección</th>
                                    <th className="py-1.5 pr-3">Apertura</th>
                                    <th className="py-1.5 pr-3">Entrada</th>
                                    <th className="py-1.5 pr-3">SL</th>
                                    <th className="py-1.5 pr-3">TP</th>
                                    <th className="py-1.5 pr-3">R:R</th>
                                    <th className="py-1.5 pr-3">Capital comprometido</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...openTrades].sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0)).map((t, i) => (
                                    <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{t.symbol}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{ALL_TRADE_META[t.type]?.label ?? t.type}</td>
                                        <td className="py-1 pr-3">
                                            <span className={t.isBull ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}>
                                                {t.isBull ? 'LONG' : 'SHORT'}
                                            </span>
                                        </td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.entryTime)}</td>
                                        <td className="py-1 pr-3 text-gray-600 dark:text-slate-300">{t.entry?.toFixed(5)}</td>
                                        <td className="py-1 pr-3 text-red-500">{t.sl?.toFixed(5)}</td>
                                        <td className="py-1 pr-3 text-green-600">{t.tp1?.toFixed(5)}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{t.rr?.toFixed(2)}</td>
                                        <td className="py-1 pr-3 text-indigo-600 dark:text-indigo-400">${t.assignedCapital?.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Señales no ejecutadas por falta de capital ── */}
            {skipped.length > 0 && (
                <div className="bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
                    <div className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-1">
                        {skipped.length} señal{skipped.length !== 1 ? 'es' : ''} no se ejecutó{skipped.length !== 1 ? 'aron' : ''} por falta de capital disponible
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-2">
                        "Necesitaba" y "Disponible" son el capital en ESA fecha (había otras operativas abiertas
                        comprometiéndolo en ese momento) — no tiene que coincidir con el "Capital disponible" de
                        hoy que se ve arriba, que es el capital libre al final de todo el backtest.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">Par</th>
                                    <th className="py-1.5 pr-3">Fecha</th>
                                    <th className="py-1.5 pr-3">Necesitaba en esa fecha</th>
                                    <th className="py-1.5 pr-3">Disponible en esa fecha</th>
                                    <th className="py-1.5 pr-3">Hubiera sido</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...skipped].sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0)).map((t, i) => (
                                    <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{t.symbol}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.entryTime)}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">${t.wouldNeedCapital?.toFixed(2)}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">${t.availableAtTime?.toFixed(2)}</td>
                                        <td className="py-1 pr-3">
                                            <span className={
                                                t.outcome === 'win'  ? 'text-green-600 dark:text-green-400' :
                                                t.outcome === 'loss' ? 'text-red-500 dark:text-red-400' :
                                                                        'text-blue-500 dark:text-blue-400'
                                            }>
                                                {t.outcome === 'win' ? 'Ganadora' : t.outcome === 'loss' ? 'Perdedora' : 'Sin cerrar'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Detalle por par ── */}
            {Object.keys(effectiveSymbolStatus).length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Estado por par ({Object.keys(effectiveSymbolStatus).length})
                    </summary>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                        {Object.entries(effectiveSymbolStatus).map(([sym, status]) => (
                            <div key={sym} className="flex justify-between gap-2 text-gray-500 dark:text-slate-400">
                                <span className="font-mono">{sym}</span>
                                <span className={status.startsWith('error') ? 'text-red-500' : ''}>{status}</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* ── Tabla de operativas ── */}
            {trades.length > 0 && (
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                <th className="py-2 pr-3">Par</th>
                                <th className="py-2 pr-3">Patrón</th>
                                <th className="py-2 pr-3">Dirección</th>
                                <th className="py-2 pr-3">Entrada</th>
                                <th className="py-2 pr-3">SL</th>
                                <th className="py-2 pr-3">TP</th>
                                <th className="py-2 pr-3">R:R</th>
                                <th className="py-2 pr-3">Apertura</th>
                                <th className="py-2 pr-3">Cierre</th>
                                <th className="py-2 pr-3">Resultado</th>
                                <th className="py-2 pr-3">Capital usado</th>
                                <th className="py-2 pr-3">Volumen</th>
                                <th className="py-2 pr-3">P&L</th>
                                <th className="py-2 pr-3">Capital restante</th>
                                <th className="py-2 pr-3">Capital disponible</th>
                                <th className="py-2 pr-3">Gráfico</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedTrades.map((t, i) => (
                                <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                    <td className="py-1.5 pr-3 font-semibold text-gray-700 dark:text-slate-200">{t.symbol}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{ALL_TRADE_META[t.type]?.label ?? t.type}</td>
                                    <td className="py-1.5 pr-3">
                                        <span className={t.isBull ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}>
                                            {t.isBull ? 'LONG' : 'SHORT'}
                                        </span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-300">{t.entry?.toFixed(5)}</td>
                                    <td className="py-1.5 pr-3 text-red-500">{t.sl?.toFixed(5)}</td>
                                    <td className="py-1.5 pr-3 text-green-600">{t.tp1?.toFixed(5)}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{t.rr?.toFixed(2)}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.entryTime)}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{t.outcome === 'open' ? 'Sin cerrar' : fmtDate(t.exitTime)}</td>
                                    <td className="py-1.5 pr-3">
                                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                                            !t.executed          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' :
                                            t.outcome === 'win'  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' :
                                            t.outcome === 'loss' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' :
                                                                    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                                        }`}>
                                            {!t.executed ? 'Sin capital' : t.outcome === 'win' ? 'Ganadora' : t.outcome === 'loss' ? 'Perdedora' : 'Abierta'}
                                        </span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">${t.assignedCapital?.toFixed(2) ?? '—'}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{t.volume != null ? t.volume.toFixed(0) : '—'}</td>
                                    <td className={`py-1.5 pr-3 font-medium ${t.pnlUsdt == null ? 'text-gray-400' : t.pnlUsdt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                        {t.pnlUsdt != null ? `${fmtMoney(t.pnlUsdt)} (${fmtPct(t.pct)})` : '—'}
                                    </td>
                                    <td className="py-1.5 pr-3 font-semibold text-gray-700 dark:text-slate-200">
                                        {t.capitalAfter != null ? `$${t.capitalAfter.toFixed(2)}` : '—'}
                                    </td>
                                    <td className="py-1.5 pr-3 text-indigo-600 dark:text-indigo-400">
                                        {t.availableAfter != null ? `$${t.availableAfter.toFixed(2)}` : '—'}
                                    </td>
                                    <td className="py-1.5 pr-3">
                                        <button
                                            type="button"
                                            onClick={() => setChartTrade(t)}
                                            className="text-[11px] font-semibold px-2 py-1 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors whitespace-nowrap"
                                        >
                                            📊 Ver
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── Modal del gráfico de velas (Entrada/SL/TP marcados) ── */}
            {chartTrade && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setChartTrade(null)} />
                    <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                            <div>
                                <h2 className="font-bold text-gray-800 dark:text-slate-100 text-lg">
                                    {chartTrade.symbol} · {chartTrade.isBull ? 'LONG' : 'SHORT'} · {ALL_TRADE_META[chartTrade.type]?.label ?? chartTrade.type}
                                </h2>
                                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                                    Entrada {fmtDate(chartTrade.entryTime)} · {chartTrade.outcome === 'open' ? 'sin cerrar' : `cierre ${fmtDate(chartTrade.exitTime)}`} · velas {candleInterval.toUpperCase()}
                                </p>
                            </div>
                            <button onClick={() => setChartTrade(null)}
                                className="text-gray-300 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <div className="px-6 py-5">
                            {chartError && <div className="text-xs text-red-500">Error al cargar velas: {chartError}</div>}
                            {!chartError && chartCandles === null && <div className="text-xs text-gray-400 dark:text-slate-500">Cargando gráfico...</div>}
                            {!chartError && chartCandles && chartCandles.length === 0 && <div className="text-xs text-gray-400 dark:text-slate-500">Sin datos de velas para este rango.</div>}
                            {!chartError && chartCandles && chartCandles.length > 0 && (
                                <CandlestickChart data={chartCandles} entry={chartTrade.entry} sl={chartTrade.sl} tp1={chartTrade.tp1} height={440} />
                            )}
                            <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-400 dark:text-slate-500">
                                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-blue-500 inline-block" /> Entrada</span>
                                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-purple-700 inline-block" /> Stop Loss</span>
                                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-yellow-500 inline-block" /> Take Profit</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
