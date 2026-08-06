'use client'
import { useState, useEffect, useCallback } from 'react'
import { CandlestickChart } from '../../components/CandlestickChart'
import { fetchBacktestLog } from '../lib/backtestLog'

// Monto asumido por operación para estimar el P&L en USDT — el log no guarda
// el tamaño real de la posición, así que se usa un monto fijo de referencia.
const PNL_NOTIONAL_USDT = 4

const REFRESH_MS = 30_000
const CHART_REFRESH_MS = 10 * 60_000

const DEFAULT_CANDLE_INTERVAL = '1h'

// Opciones de vela disponibles para el gráfico de operaciones "En proceso".
const CANDLE_INTERVALS = [
    { value: '5m', label: '5m' },
    { value: '1h', label: '1h' },
    { value: '4h', label: '4h' },
]
const INTERVAL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000, '4h': 4 * 60 * 60_000 }

// lightweight-charts renderiza las marcas de tiempo como si fueran UTC. México
// (America/Mexico_City) dejó el horario de verano desde 2022 → siempre UTC-6,
// así que restamos ese offset fijo para que el eje muestre hora de CDMX.
const CDMX_OFFSET_SECONDS = 6 * 3600

async function fetchCandles(activo, startMs, endMs, interval = DEFAULT_CANDLE_INTERVAL) {
    // Binance limita a 1000 velas por request. Con intervalos chicos (5m) una
    // operación de varios días excedería ese límite si se pide desde la
    // apertura real, y Binance recortaría por el lado más reciente (justo lo
    // que se quiere ver en una operación en curso). Por eso se acota la
    // ventana a las últimas 1000 velas del intervalo elegido.
    const cappedStartMs = Math.max(startMs, endMs - INTERVAL_MS[interval] * 1000)
    const res = await fetch(
        `/api/binance/api/v3/klines?symbol=${activo}&interval=${interval}&startTime=${cappedStartMs}&endTime=${endMs}&limit=1000`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.json()
    if (!Array.isArray(raw)) return []
    return raw.map(([openTime, open, high, low, close]) => ({
        time: Math.floor(openTime / 1000) - CDMX_OFFSET_SECONDS,
        open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close),
    }))
}

const STATUS_META = {
    ganadora:   { label: 'Ganadora',   classes: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
    perdedora:  { label: 'Perdedora',  classes: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
    en_proceso: { label: 'En proceso', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
}

const STATUS_GROUPS = [
    { key: 'en_proceso', label: 'En proceso' },
    { key: 'ganadora',   label: 'Ganadoras' },
    { key: 'perdedora',  label: 'Perdedoras' },
]

function fmt(n) {
    if (n == null) return '—'
    return n < 1 ? n.toFixed(6) : n.toFixed(2)
}

// Ganancia/pérdida estimada en USDT: no guardamos el tamaño real de la
// posición en el log, así que se asume un monto fijo de PNL_NOTIONAL_USDT.
// Ganadora → se asume cierre en TP1; Perdedora → en SL; En proceso → último precio (no realizada).
function calcPnl(record) {
    const entry = record.precioEntrada
    if (entry == null) return null

    const exitPrice = record.estatus === 'ganadora' ? record.takeProfit1
        : record.estatus === 'perdedora' ? record.stopLoss
        : record.ultimoPrecio
    if (exitPrice == null) return null

    const isLong = record.tipoPosicion === 'long'
    const pct = isLong ? (exitPrice - entry) / entry : (entry - exitPrice) / entry
    return { pct: pct * 100, usdt: pct * PNL_NOTIONAL_USDT }
}

function fmtUsdt(n) {
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)} USDT`
}

function fmtPct(n) {
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtTime(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' })
}

function StatsBarChart({ ganadoras, perdedoras }) {
    const max = Math.max(ganadoras, perdedoras, 1)
    const bar = (label, value, color) => (
        <div className="flex items-center gap-3">
            <span className="w-20 text-xs text-gray-500 dark:text-slate-400">{label}</span>
            <div className="flex-1 h-5 bg-gray-100 dark:bg-slate-800 rounded overflow-hidden">
                <div className={`h-full ${color}`} style={{ width: `${(value / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right text-sm font-medium text-gray-700 dark:text-slate-200">{value}</span>
        </div>
    )
    return (
        <div className="space-y-3">
            {bar('Ganadoras', ganadoras, 'bg-green-500')}
            {bar('Perdedoras', perdedoras, 'bg-red-500')}
        </div>
    )
}

function PositionIcon({ isLong }) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {isLong ? (
                <>
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <polyline points="5 11 12 4 19 11" />
                </>
            ) : (
                <>
                    <line x1="12" y1="4" x2="12" y2="20" />
                    <polyline points="5 13 12 20 19 13" />
                </>
            )}
        </svg>
    )
}

function IntervalPicker({ value, onChange }) {
    return (
        <div className="inline-flex rounded-full bg-gray-100 dark:bg-slate-700 p-0.5 text-xs">
            {CANDLE_INTERVALS.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={`px-2.5 py-1 rounded-full font-semibold transition-colors ${
                        value === opt.value
                            ? 'bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-100 shadow-sm'
                            : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                    }`}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

function BacktestCard({ record }) {
    const [candles, setCandles] = useState(null)
    const [error, setError] = useState(null)
    const [showChartModal, setShowChartModal] = useState(false)
    const [chartInterval, setChartInterval] = useState(DEFAULT_CANDLE_INTERVAL)
    const meta = STATUS_META[record.estatus] ?? STATUS_META.en_proceso
    const isLong = record.tipoPosicion === 'long'
    const isClosed = record.estatus === 'ganadora' || record.estatus === 'perdedora'
    const pnl = calcPnl(record)

    useEffect(() => {
        let cancelled = false
        const load = () => {
            const startMs = new Date(record.horaApertura).getTime()
            const endMs   = record.horaCierre ? new Date(record.horaCierre).getTime() : Date.now()
            setCandles(null)
            fetchCandles(record.activo, startMs, endMs, chartInterval)
                .then(data => { if (!cancelled) setCandles(data) })
                .catch(err => { if (!cancelled) setError(err.message) })
        }
        load()
        const id = record.horaCierre ? null : setInterval(load, CHART_REFRESH_MS)
        return () => { cancelled = true; if (id) clearInterval(id) }
    }, [record.activo, record.horaApertura, record.horaCierre, chartInterval])

    useEffect(() => {
        if (!showChartModal) return
        const h = e => { if (e.key === 'Escape') setShowChartModal(false) }
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
    }, [showChartModal])

    const renderChart = (height) => (
        <>
            {error && <div className="text-xs text-red-500">Error al cargar velas: {error}</div>}
            {!error && candles === null && <div className="text-xs text-gray-400 dark:text-slate-500">Cargando gráfico...</div>}
            {!error && candles && candles.length === 0 && <div className="text-xs text-gray-400 dark:text-slate-500">Sin datos de velas para este rango.</div>}
            {!error && candles && candles.length > 0 && (
                <CandlestickChart data={candles} entry={record.precioEntrada} sl={record.stopLoss} tp1={record.takeProfit1} height={height} />
            )}
        </>
    )

    return (
        <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800 dark:text-slate-100">{record.activo}</span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${isLong ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'}`}>
                        <PositionIcon isLong={isLong} />
                        {isLong ? 'LONG' : 'SHORT'}
                    </span>
                    {record.patternLabel && (
                        <span className="text-xs text-gray-400 dark:text-slate-500">{record.patternLabel}</span>
                    )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.classes}`}>{meta.label}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><div className="text-gray-400 dark:text-slate-500">Entrada</div><div className="font-medium text-gray-700 dark:text-slate-200">{fmt(record.precioEntrada)}</div></div>
                <div><div className="text-gray-400 dark:text-slate-500">Stop-Loss</div><div className="font-medium text-red-600 dark:text-red-400">{fmt(record.stopLoss)}</div></div>
                <div><div className="text-gray-400 dark:text-slate-500">TP1</div><div className="font-medium text-green-600 dark:text-green-400">{fmt(record.takeProfit1)}</div></div>
                <div><div className="text-gray-400 dark:text-slate-500">Último precio</div><div className="font-medium text-gray-700 dark:text-slate-200">{fmt(record.ultimoPrecio)}</div></div>
                <div><div className="text-gray-400 dark:text-slate-500">Apertura</div><div className="font-medium text-gray-700 dark:text-slate-200">{fmtTime(record.horaApertura)}</div></div>
                <div><div className="text-gray-400 dark:text-slate-500">Cierre</div><div className="font-medium text-gray-700 dark:text-slate-200">{fmtTime(record.horaCierre)}</div></div>
                <div>
                    <div className="text-gray-400 dark:text-slate-500">{isClosed ? 'P&L estimado' : 'P&L no realizado'}</div>
                    <div className={`font-medium ${pnl == null ? 'text-gray-400 dark:text-slate-500' : pnl.usdt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {pnl == null ? '—' : `${fmtPct(pnl.pct)} · ${fmtUsdt(pnl.usdt)}`}
                    </div>
                </div>
            </div>

            {isClosed ? (
                <button
                    type="button"
                    onClick={() => setShowChartModal(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                >
                    📊 Ver gráfico
                </button>
            ) : (
                <div className="space-y-2">
                    <div className="flex justify-end">
                        <IntervalPicker value={chartInterval} onChange={setChartInterval} />
                    </div>
                    {renderChart(260)}
                </div>
            )}

            {isClosed && showChartModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowChartModal(false)} />
                    <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                            <h2 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{record.activo} · Gráfico</h2>
                            <button onClick={() => setShowChartModal(false)}
                                className="text-gray-300 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <div className="px-6 py-5">
                            {renderChart(440)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default function BacktestingPage() {
    const [records, setRecords] = useState(null)
    const [error, setError] = useState(null)

    const load = useCallback(() => {
        fetchBacktestLog().then(setRecords).catch(err => setError(err.message))
    }, [])

    useEffect(() => {
        load()
        const id = setInterval(load, REFRESH_MS)
        return () => clearInterval(id)
    }, [load])

    if (error) {
        return <div className="p-6 text-red-500">Error al cargar el log de backtesting: {error}</div>
    }
    if (records === null) {
        return <div className="p-6 text-gray-400 dark:text-slate-500">Cargando...</div>
    }

    const ganadoras  = records.filter(r => r.estatus === 'ganadora').length
    const perdedoras = records.filter(r => r.estatus === 'perdedora').length
    const enProceso  = records.filter(r => r.estatus === 'en_proceso').length
    const resueltas  = ganadoras + perdedoras
    const winRate    = resueltas > 0 ? (ganadoras / resueltas) * 100 : null

    // P&L estimado asumiendo el monto/apalancamiento default del auto-trade real.
    const closedPnl = records
        .filter(r => r.estatus === 'ganadora' || r.estatus === 'perdedora')
        .map(calcPnl)
        .filter(Boolean)
    const totalClosedPnlUsdt = closedPnl.reduce((sum, p) => sum + p.usdt, 0)

    const openPnl = records.filter(r => r.estatus === 'en_proceso').map(calcPnl).filter(Boolean)
    const totalOpenPnlUsdt = openPnl.reduce((sum, p) => sum + p.usdt, 0)

    const sorted = [...records].sort((a, b) => new Date(b.horaApertura) - new Date(a.horaApertura))

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100">Backtesting</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Operaciones totales</div>
                    <div className="text-2xl font-semibold text-gray-800 dark:text-slate-100">{records.length}</div>
                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">{enProceso} en proceso</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-2">Ganadoras vs. Perdedoras</div>
                    <StatsBarChart ganadoras={ganadoras} perdedoras={perdedoras} />
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">% de operaciones ganadoras</div>
                    <div className="text-2xl font-semibold text-gray-800 dark:text-slate-100">
                        {winRate != null ? `${winRate.toFixed(1)}%` : '—'}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                        {resueltas > 0 ? `sobre ${resueltas} operaciones cerradas` : 'sin operaciones cerradas aún'}
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">P&L estimado (cerradas)</div>
                    <div className={`text-2xl font-semibold ${totalClosedPnlUsdt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {fmtUsdt(totalClosedPnlUsdt)}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                        {enProceso > 0 ? `${fmtUsdt(totalOpenPnlUsdt)} no realizado en proceso` : `basado en $${PNL_NOTIONAL_USDT} por operación`}
                    </div>
                </div>
            </div>

            <div className="space-y-8">
                {sorted.length === 0 && (
                    <div className="text-sm text-gray-400 dark:text-slate-500">Aún no hay activos registrados en el log de backtesting.</div>
                )}
                {STATUS_GROUPS.map(group => {
                    const items = sorted.filter(r => r.estatus === group.key)
                    if (items.length === 0) return null
                    return (
                        <div key={group.key} className="space-y-4">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                                    {group.label}
                                </h2>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_META[group.key].classes}`}>
                                    {items.length}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                {items.map(record => <BacktestCard key={record.id} record={record} />)}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
