'use client'
import { useEffect, useState } from 'react'

// ─── Panel del bot de trading REAL — Confluencia Forex ─────────────────────
// Pedido explícito del usuario: pestañas independientes por par, cuántas
// operativas lleva cada uno, % ganadas/perdidas, P&L, estado de las
// operativas abiertas, encendido/apagado por par, reporte semanal (viernes)
// de capital, y gráficas de P&L diario a 7/30/90 días.
//
// Solo LEE y manda el toggle de encendido/apagado — la lógica de trading
// real (análisis + apertura de operaciones en Capital.com) vive en
// scripts/forex-bot.mjs, corriendo 24/7 como parte del mismo Servicio de
// Windows que ya usa este proyecto (ver service-runner.js) — esta página no
// necesita estar abierta para que el bot opere.

const PAIRS = ['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD', 'GBPJPY', 'USDCHF']
const POLL_MS = 20_000
const CHART_WINDOWS = [{ label: '7 días', days: 7 }, { label: '30 días', days: 30 }, { label: '90 días', days: 90 }]

function fmtMoney(n) {
    if (n == null || !Number.isFinite(n)) return '—'
    return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`
}
function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }) + ' CDMX'
}
function fmtDay(dateStr) {
    // dateStr ya viene como 'YYYY-MM-DD' (fecha calendario, sin hora) — no
    // pasar por Date con zona horaria para no correrla un día para atrás/adelante.
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}`
}

// Lunes (ISO) de la semana a la que pertenece `dateStr` — para agrupar
// dailyCapital en semanas y armar el reporte de "cada viernes".
function isoWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z')
    const dow = d.getUTCDay() // 0=domingo
    const diff = dow === 0 ? -6 : 1 - dow // retrocede hasta el lunes
    d.setUTCDate(d.getUTCDate() + diff)
    return d.toISOString().slice(0, 10)
}

function buildWeeklyReports(dailyCapital) {
    if (!dailyCapital?.length) return []
    const byWeek = new Map()
    for (const d of dailyCapital) {
        const wk = isoWeekStart(d.date)
        if (!byWeek.has(wk)) byWeek.set(wk, [])
        byWeek.get(wk).push(d)
    }
    return [...byWeek.entries()]
        .map(([weekStart, days]) => {
            days.sort((a, b) => a.date.localeCompare(b.date))
            return { weekStart, startBalance: days[0].balance, endBalance: days[days.length - 1].balance, lastDate: days[days.length - 1].date }
        })
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
}

function buildDailyPnl(dailyCapital, days) {
    if (!dailyCapital?.length) return []
    const cutoff = Date.now() - days * 86_400_000
    const recent = dailyCapital.filter(d => new Date(d.date + 'T00:00:00Z').getTime() >= cutoff)
    const out = []
    for (let i = 1; i < recent.length; i++) {
        out.push({ date: recent[i].date, pnl: recent[i].balance - recent[i - 1].balance })
    }
    return out
}

// Barras simples en CSS puro — no hace falta una librería de gráficas para
// un P&L diario de barras verdes/rojas.
function DailyPnlChart({ data }) {
    if (!data.length) return <p className="text-xs text-gray-400 dark:text-slate-500">Sin datos suficientes todavía en esta ventana.</p>
    const maxAbs = Math.max(0.01, ...data.map(d => Math.abs(d.pnl)))
    return (
        <div className="flex items-end gap-0.5 h-32 overflow-x-auto pb-1">
            {data.map((d, i) => {
                const heightPct = Math.max(4, (Math.abs(d.pnl) / maxAbs) * 100)
                return (
                    <div key={i} className="flex flex-col items-center justify-end h-full flex-shrink-0" style={{ width: 10 }} title={`${fmtDay(d.date)}: ${fmtMoney(d.pnl)}`}>
                        <div
                            className={`w-full rounded-sm ${d.pnl >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                            style={{ height: `${heightPct}%` }}
                        />
                    </div>
                )
            })}
        </div>
    )
}

export default function ForexBotPage() {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState(PAIRS[0])
    const [chartDays, setChartDays] = useState(30)
    const [toggling, setToggling] = useState(null)
    const [maxPosDraft, setMaxPosDraft] = useState(null) // valor en edición del input — null = todavía no se tocó, se muestra el del servidor
    const [savingMaxPos, setSavingMaxPos] = useState(false)
    const [maxPosSaved, setMaxPosSaved] = useState(false)

    const load = async () => {
        try {
            const res = await fetch('/api/forex-bot', { cache: 'no-store' })
            const json = await res.json()
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
            setData(json)
            setError(null)
        } catch (e) {
            setError(e.message)
        }
    }

    useEffect(() => {
        load()
        const id = setInterval(load, POLL_MS)
        return () => clearInterval(id)
    }, [])

    const toggle = async (symbol, enabled) => {
        setToggling(symbol)
        try {
            await fetch('/api/forex-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, enabled }) })
            await load()
        } finally {
            setToggling(null)
        }
    }

    const saveMaxConcurrentPositions = async () => {
        const n = parseInt(maxPosDraft, 10)
        if (!Number.isInteger(n) || n < 1) return
        setSavingMaxPos(true)
        try {
            const res = await fetch('/api/forex-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxConcurrentPositions: n }) })
            if (res.ok) { setMaxPosSaved(true); setTimeout(() => setMaxPosSaved(false), 2000) }
            await load()
            setMaxPosDraft(null) // vuelve a mostrar el valor confirmado del servidor
        } finally {
            setSavingMaxPos(false)
        }
    }

    if (error) {
        return <div className="p-6"><p className="text-sm text-red-500">Error al cargar el bot: {error}</p></div>
    }
    if (!data) {
        return <div className="p-6"><p className="text-sm text-gray-400">Cargando…</p></div>
    }

    const { state, account } = data
    const accountError = account?.error

    const tradesFor = symbol => state.trades.filter(t => t.symbol === symbol)
    const openFor = symbol => [
        ...state.openPositions.filter(p => p.symbol === symbol).map(p => ({ ...p, kind: 'abierta' })),
        ...state.pendingOrders.filter(p => p.symbol === symbol).map(p => ({ ...p, kind: 'pendiente' })),
    ]

    const activeTrades = tradesFor(activeTab)
    const activeOpen = openFor(activeTab)
    const wins = activeTrades.filter(t => t.outcome === 'win').length
    const losses = activeTrades.filter(t => t.outcome === 'loss').length
    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : null
    const totalPnl = activeTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)

    const weeklyReports = buildWeeklyReports(state.dailyCapital)
    const dailyPnl = buildDailyPnl(state.dailyCapital, chartDays)

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100">Forex · Bot de Confluencia (dinero real)</h1>
                <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                    Analiza cada par de forma independiente (ver app/lib/forexConfluenceEngine.js) y abre operaciones REALES
                    en Capital.com cuando encuentra un setup válido — corre 24/7 en scripts/forex-bot.mjs (Servicio de
                    Windows), esta página solo muestra el estado y permite encender/apagar cada par.
                </p>
            </div>

            {/* ── Resumen de cuenta real ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Balance real</div>
                    <div className="text-2xl font-semibold text-gray-800 dark:text-slate-100">
                        {accountError ? '—' : `$${account.balance?.toFixed(2) ?? '—'}`}
                    </div>
                    {accountError && <div className="text-[10px] text-red-500 mt-1">No se pudo leer la cuenta: {accountError}</div>}
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Disponible</div>
                    <div className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
                        {accountError ? '—' : `$${account.available?.toFixed(2) ?? '—'}`}
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Operativas reales abiertas/pendientes</div>
                    <div className="text-2xl font-semibold text-purple-600 dark:text-purple-400">
                        {accountError ? '—' : (account.positions.length + account.workingOrders.length)}
                        <span className="text-sm text-gray-400 dark:text-slate-500"> / máx {state.maxConcurrentPositions ?? 1}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 mb-2">en TODA la cuenta (propias del bot o no)</div>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number" min={1} max={6} step={1}
                            value={maxPosDraft ?? state.maxConcurrentPositions ?? 1}
                            onChange={e => setMaxPosDraft(e.target.value)}
                            title="Con ~$10 de capital, cada operativa adicional simultánea compromete más margen a la vez — subir este número aumenta el riesgo de quedarse sin capital disponible."
                            className="w-14 px-1.5 py-1 rounded-md border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-xs"
                        />
                        <button
                            type="button"
                            onClick={saveMaxConcurrentPositions}
                            disabled={savingMaxPos || maxPosDraft == null}
                            className="text-[11px] font-semibold px-2 py-1 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {maxPosSaved ? '✓ Guardado' : 'Guardar'}
                        </button>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Circuit breaker</div>
                    <div className={`text-2xl font-semibold ${state.circuitBreaker?.tripped ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                        {state.circuitBreaker?.tripped ? 'ACTIVO' : 'normal'}
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        {state.circuitBreaker?.tripped ? 'sin operativas nuevas hasta que el balance se recupere' : `se activa si el balance baja del 50% de $${state.circuitBreaker?.initialBalance?.toFixed(2) ?? '—'}`}
                    </div>
                </div>
            </div>

            <p className="text-[10px] text-gray-400 dark:text-slate-500">
                Último ciclo del bot: {fmtDate(state.lastRunAt)}
            </p>

            {/* ── Pestañas por par ── */}
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden flex-wrap">
                {PAIRS.map(sym => (
                    <button
                        key={sym}
                        type="button"
                        onClick={() => setActiveTab(sym)}
                        className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                            activeTab === sym
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                        }`}
                    >
                        {sym} {state.pairs[sym]?.enabled === false ? '🔴' : '🟢'}
                    </button>
                ))}
            </div>

            {/* ── Panel del par activo ── */}
            <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h2 className="text-lg font-bold text-gray-800 dark:text-slate-100">{activeTab}</h2>
                    <button
                        type="button"
                        disabled={toggling === activeTab}
                        onClick={() => toggle(activeTab, !(state.pairs[activeTab]?.enabled ?? true))}
                        className={`text-sm font-bold px-4 py-1.5 rounded-xl transition-colors disabled:opacity-60 ${
                            state.pairs[activeTab]?.enabled === false
                                ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 hover:bg-green-200'
                                : 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-200'
                        }`}
                    >
                        {state.pairs[activeTab]?.enabled === false ? '▶ Encender' : '■ Apagar'}
                    </button>
                </div>
                <p className="text-[10px] text-gray-400 dark:text-slate-500 -mt-2">
                    Apagado = no se abren operativas NUEVAS para este par (las que ya están abiertas/pendientes siguen su curso normal).
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3">
                        <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Operativas cerradas</div>
                        <div className="text-xl font-semibold text-gray-800 dark:text-slate-100">{activeTrades.length}</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3">
                        <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Ganadas / Perdidas</div>
                        <div className="text-xl font-semibold"><span className="text-green-600 dark:text-green-400">{wins}</span> / <span className="text-red-500 dark:text-red-400">{losses}</span></div>
                    </div>
                    <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3">
                        <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Win rate</div>
                        <div className="text-xl font-semibold text-gray-800 dark:text-slate-100">{winRate != null ? `${winRate.toFixed(1)}%` : '—'}</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3">
                        <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">P&L acumulado</div>
                        <div className={`text-xl font-semibold ${totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{fmtMoney(totalPnl)}</div>
                    </div>
                </div>

                {/* Operativas abiertas/pendientes de este par */}
                {activeOpen.length > 0 && (
                    <div>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-2">Operativas abiertas/pendientes</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                        <th className="py-1 pr-3">Estado</th>
                                        <th className="py-1 pr-3">Dirección</th>
                                        <th className="py-1 pr-3">Entrada</th>
                                        <th className="py-1 pr-3">SL</th>
                                        <th className="py-1 pr-3">TP</th>
                                        <th className="py-1 pr-3">Tamaño</th>
                                        <th className="py-1 pr-3">Desde</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeOpen.map((p, i) => (
                                        <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                            <td className="py-1 pr-3">
                                                <span className={`px-2 py-0.5 rounded-full font-medium ${p.kind === 'abierta' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'}`}>
                                                    {p.kind === 'abierta' ? 'Abierta' : 'Orden pendiente'}
                                                </span>
                                            </td>
                                            <td className="py-1 pr-3">
                                                <span className={p.isBull ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}>{p.isBull ? 'LONG' : 'SHORT'}</span>
                                            </td>
                                            <td className="py-1 pr-3 text-gray-600 dark:text-slate-300">{p.entry?.toFixed(5)}</td>
                                            <td className="py-1 pr-3 text-red-500">{p.sl?.toFixed(5)}</td>
                                            <td className="py-1 pr-3 text-green-600">{p.tp?.toFixed(5)}</td>
                                            <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{p.size}</td>
                                            <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(p.openedAt ?? p.placedAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Historial cerrado de este par */}
                {activeTrades.length > 0 && (
                    <div>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-2">Historial cerrado</h3>
                        <div className="overflow-x-auto max-h-72 overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                    <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                        <th className="py-1 pr-3">Dirección</th>
                                        <th className="py-1 pr-3">Entrada</th>
                                        <th className="py-1 pr-3">Apertura</th>
                                        <th className="py-1 pr-3">Cierre</th>
                                        <th className="py-1 pr-3">Resultado</th>
                                        <th className="py-1 pr-3">P&L</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...activeTrades].sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt)).map((t, i) => (
                                        <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                            <td className="py-1 pr-3">
                                                <span className={t.isBull ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}>{t.isBull ? 'LONG' : 'SHORT'}</span>
                                            </td>
                                            <td className="py-1 pr-3 text-gray-600 dark:text-slate-300">{t.entry?.toFixed(5)}</td>
                                            <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.openedAt)}</td>
                                            <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.closedAt)}</td>
                                            <td className="py-1 pr-3">
                                                <span className={`px-2 py-0.5 rounded-full font-medium ${t.outcome === 'win' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'}`}>
                                                    {t.outcome === 'win' ? 'Ganadora' : 'Perdedora'}
                                                </span>
                                            </td>
                                            <td className={`py-1 pr-3 font-medium ${t.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{fmtMoney(t.pnl)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeOpen.length === 0 && activeTrades.length === 0 && (
                    <p className="text-sm text-gray-400 dark:text-slate-500">Todavía no hay operativas para este par.</p>
                )}
            </div>

            {/* ── Reporte semanal (viernes): capital al empezar vs al terminar cada semana ── */}
            <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Reporte semanal de capital</h2>
                <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-3">
                    Capital al primer registro de la semana (lunes) vs. al último (viernes, o el más reciente disponible si la semana sigue en curso).
                </p>
                {weeklyReports.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-slate-500">Todavía no hay suficiente historial para armar un reporte semanal.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1 pr-3">Semana de</th>
                                    <th className="py-1 pr-3">Capital inicial</th>
                                    <th className="py-1 pr-3">Capital final</th>
                                    <th className="py-1 pr-3">Cambio</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weeklyReports.map(w => (
                                    <tr key={w.weekStart} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 text-gray-600 dark:text-slate-300">{w.weekStart}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">${w.startBalance.toFixed(2)}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">${w.endBalance.toFixed(2)}</td>
                                        <td className={`py-1 pr-3 font-medium ${w.endBalance - w.startBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                            {fmtMoney(w.endBalance - w.startBalance)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Gráficas de P&L diario ── */}
            <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200">P&L por día</h2>
                    <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden">
                        {CHART_WINDOWS.map(w => (
                            <button
                                key={w.days}
                                type="button"
                                onClick={() => setChartDays(w.days)}
                                className={`px-3 py-1 text-xs font-semibold transition-colors ${
                                    chartDays === w.days ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                                }`}
                            >
                                {w.label}
                            </button>
                        ))}
                    </div>
                </div>
                <DailyPnlChart data={dailyPnl} />
            </div>

            {/* ── Log del bot ── */}
            {state.log.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Actividad reciente del bot ({state.log.length})
                    </summary>
                    <div className="mt-3 max-h-72 overflow-y-auto space-y-1">
                        {[...state.log].reverse().map((l, i) => (
                            <div key={i} className={`text-xs font-mono ${l.level === 'error' ? 'text-red-500' : l.level === 'warn' ? 'text-amber-500' : 'text-gray-500 dark:text-slate-400'}`}>
                                {fmtDate(l.time)} · {l.message}
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    )
}
