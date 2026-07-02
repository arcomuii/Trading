'use client'
import { useState, useEffect } from 'react'

// ── localStorage ───────────────────────────────────────────────
const LS_KEY = 'trading_equity_history'

function loadHistory() {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}

function upsertSnapshot(equity) {
    const d    = new Date().toISOString().slice(0, 10)
    const hist = loadHistory()
    const idx  = hist.findIndex(e => e.date === d)
    if (idx >= 0) hist[idx].equity = equity
    else hist.push({ date: d, equity })
    hist.sort((a, b) => a.date.localeCompare(b.date))
    const out = hist.slice(-90)
    localStorage.setItem(LS_KEY, JSON.stringify(out))
    return out
}

// ── date helpers ──────────────────────────────────────────────
function mondayOf(date) {
    const d   = new Date(date)
    const day = d.getDay() // 0=Dom..6=Sáb
    d.setDate(d.getDate() + (day === 0 ? -6 : 1) - day)
    return d.toISOString().slice(0, 10)
}

// ── formatters ────────────────────────────────────────────────
const fmt  = (v, d = 2) => {
    const n = parseFloat(v)
    return isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
const fmtS = (v, d = 2) => {
    const n = parseFloat(v)
    if (isNaN(n)) return '—'
    return (n >= 0 ? '+' : '') + fmt(n, d)
}
const pColor = v => v == null ? 'text-gray-400 dark:text-slate-500' : v > 0 ? 'text-green-600 dark:text-green-400' : v < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'
const pBg    = v => v == null ? '' : v > 0 ? 'bg-green-50 dark:bg-green-950 border-green-100 dark:border-green-900' : v < 0 ? 'bg-red-50 dark:bg-red-950 border-red-100 dark:border-red-900' : 'bg-gray-50 dark:bg-slate-800 border-gray-100 dark:border-slate-800'

// ── analytics ─────────────────────────────────────────────────
function computeMetrics(history, equity) {
    if (!history.length || equity == null) return {}
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
    const today  = new Date().toISOString().slice(0, 10)
    const month  = today.slice(0, 7)

    const yesterday = sorted.filter(e => e.date < today).at(-1)
    const firstMon  = sorted.find(e => e.date.startsWith(month))

    const d30 = new Date(); d30.setDate(d30.getDate() - 30)
    const base30 = sorted.find(e => e.date >= d30.toISOString().slice(0, 10)) ?? sorted[0]

    const monday    = mondayOf(new Date())
    const fridayDt  = new Date(`${monday}T00:00:00`)
    fridayDt.setDate(fridayDt.getDate() + 4)
    const friday    = fridayDt.toISOString().slice(0, 10)
    const firstWeek = sorted.find(e => e.date >= monday && e.date <= friday)

    return {
        dailyPnl:   yesterday ? equity - yesterday.equity : null,
        weeklyPnl:  firstWeek ? equity - firstWeek.equity : null,
        monthlyPnl: firstMon  ? equity - firstMon.equity  : null,
        pnl30:      base30    ? equity - base30.equity     : null,
        baseDaily:  yesterday?.equity ?? null,
        baseWeek:   firstWeek?.equity ?? null,
        baseMonth:  firstMon?.equity  ?? null,
        base30:     base30?.equity    ?? null,
    }
}

function buildPnlSeries(history) {
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
    return sorted.slice(1).map((e, i) => ({ date: e.date, pnl: e.equity - sorted[i].equity }))
}

function buildMonthlyMap(history) {
    const map = {}
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
    for (const entry of sorted) {
        const m = entry.date.slice(0, 7)
        if (!map[m]) map[m] = { first: entry.equity, last: entry.equity }
        else map[m].last = entry.equity
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
}

// ── SVG Area Chart ────────────────────────────────────────────
function AreaChart({ data }) {
    if (!data || data.length < 2) return (
        <div className="h-48 flex items-center justify-center text-sm text-gray-300 dark:text-slate-600">
            Acumulando historial...
        </div>
    )
    const W = 900, H = 200
    const p = { t: 16, r: 20, b: 36, l: 64 }
    const cW = W - p.l - p.r
    const cH = H - p.t - p.b

    const vals  = data.map(d => d.equity)
    const minV  = Math.min(...vals)
    const maxV  = Math.max(...vals)
    const range = maxV - minV || 1
    const xOf   = i => p.l + (i / (data.length - 1)) * cW
    const yOf   = v => p.t + (1 - (v - minV) / range) * cH

    const pts  = data.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.equity).toFixed(1)}`)
    const line = 'M ' + pts.join(' L ')
    const area = `${line} L ${xOf(data.length - 1).toFixed(1)},${(p.t + cH).toFixed(1)} L ${xOf(0).toFixed(1)},${(p.t + cH).toFixed(1)} Z`

    const yTicks = Array.from({ length: 5 }, (_, i) => minV + (i / 4) * range)
    const lc     = Math.min(7, data.length)
    const lIdx   = lc < 2
        ? [0]
        : Array.from({ length: lc }, (_, i) => Math.round(i / (lc - 1) * (data.length - 1)))

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
            <defs>
                <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
                </linearGradient>
            </defs>
            {yTicks.map((t, i) => (
                <g key={i}>
                    <line x1={p.l} x2={p.l + cW} y1={yOf(t)} y2={yOf(t)} stroke="var(--chart-grid)" strokeWidth="1" />
                    <text x={p.l - 8} y={yOf(t) + 4} textAnchor="end" fontSize="11" fill="var(--chart-axis)">
                        {fmt(t, 0)}
                    </text>
                </g>
            ))}
            <path d={area} fill="url(#ag)" />
            <path d={line} fill="none" stroke="var(--chart-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {lIdx.map(i => (
                <g key={i}>
                    <circle cx={xOf(i)} cy={yOf(data[i].equity)} r="4.5" fill="var(--chart-grid)" stroke="var(--chart-line)" strokeWidth="2" />
                    <text x={xOf(i)} y={p.t + cH + 24} textAnchor="middle" fontSize="11" fill="var(--chart-axis)">
                        {data[i].date.slice(5)}
                    </text>
                </g>
            ))}
        </svg>
    )
}

// ── SVG Bar Chart ─────────────────────────────────────────────
function BarChart({ data }) {
    if (!data || data.length === 0) return (
        <div className="h-32 flex items-center justify-center text-sm text-gray-300 dark:text-slate-600">
            Acumulando datos diarios...
        </div>
    )
    const W = 900, H = 150
    const p = { t: 10, r: 20, b: 28, l: 64 }
    const cW = W - p.l - p.r
    const cH = H - p.t - p.b

    const maxA  = Math.max(...data.map(d => Math.abs(d.pnl)), 0.01)
    const zeroY = p.t + cH / 2
    const scY   = (cH / 2) / maxA
    const bw    = Math.max(4, (cW / data.length) * 0.65)

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
            {[-maxA, 0, maxA].map((t, i) => {
                const y = zeroY - t * scY
                return (
                    <g key={i}>
                        <line x1={p.l} x2={p.l + cW} y1={y} y2={y}
                              stroke={t === 0 ? 'var(--chart-zero)' : 'var(--chart-grid)'}
                              strokeWidth={t === 0 ? 1.5 : 1} />
                        {t !== 0 && (
                            <text x={p.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="var(--chart-axis)">
                                {fmtS(t, 1)}
                            </text>
                        )}
                    </g>
                )
            })}
            {data.map((d, i) => {
                const x  = p.l + (i + 0.5) * (cW / data.length)
                const bh = Math.max(Math.abs(d.pnl) * scY, 2)
                const y  = d.pnl >= 0 ? zeroY - bh : zeroY
                return (
                    <rect key={i} x={x - bw / 2} y={y} width={bw} height={bh}
                          rx="2" fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'} opacity="0.85" />
                )
            })}
            {data.map((d, i) => {
                if (i !== 0 && i !== data.length - 1 && (i + 1) % 5 !== 0) return null
                const x = p.l + (i + 0.5) * (cW / data.length)
                return (
                    <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--chart-axis)">
                        {d.date.slice(5)}
                    </text>
                )
            })}
        </svg>
    )
}

// ── MetricCard ────────────────────────────────────────────────
function MetricCard({ label, value, sub, pct, color = 'text-gray-800 dark:text-slate-100', loading }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-3">{label}</p>
            {loading
                ? <div className="h-7 bg-gray-100 dark:bg-slate-800 rounded animate-pulse w-3/4 mb-1" />
                : <p className={`text-2xl font-black font-mono ${color}`}>{value}</p>
            }
            {!loading && (pct || sub) && (
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                    {pct && <span className={`font-semibold mr-1 ${color}`}>{pct}</span>}
                    {sub}
                </p>
            )}
        </div>
    )
}

// ── Page ──────────────────────────────────────────────────────
export default function DashboardPage() {
    const [equity,    setEquity]    = useState(null)
    const [loading,   setLoading]   = useState(true)
    const [error,     setError]     = useState(null)
    const [history,   setHistory]   = useState([])
    const [lastFetch, setLastFetch] = useState(null)

    useEffect(() => {
        const run = async () => {
            // Load history first so charts render immediately with cached data
            const hist = loadHistory()
            setHistory(hist)

            try {
                setError(null)
                const res  = await fetch('/api/bitunix/api/v1/futures/account?marginCoin=USDT')
                const json = await res.json()
                if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
                if (json.code !== undefined && json.code !== 0 && json.code !== '0')
                    throw new Error(`[${json.code}] ${json.msg ?? 'API error'}`)

                // Normalize response shape
                const acct = [json.data, json.result, json]
                    .map(x => Array.isArray(x) ? x[0] : x)
                    .find(x => x?.available != null)

                const total = [
                    acct?.available,
                    acct?.margin,
                    acct?.crossUnrealizedPNL,
                    acct?.isolationUnrealizedPNL,
                ].reduce((s, v) => s + parseFloat(v ?? 0), 0)

                setEquity(total)
                const updated = upsertSnapshot(total)
                setHistory(updated)
                setLastFetch(new Date())
            } catch (err) {
                setError(err.message)
            } finally {
                setLoading(false)
            }
        }
        run()
        const iv = setInterval(run, 10 * 60 * 1000)
        return () => clearInterval(iv)
    }, [])

    const { dailyPnl, weeklyPnl, monthlyPnl, pnl30, baseDaily, baseWeek, baseMonth, base30 } =
        computeMetrics(history, equity)

    const pct = (pnl, base) =>
        base && base > 0 && pnl != null ? `(${fmtS((pnl / base) * 100, 2)}%)` : null

    const now    = new Date()
    const month  = now.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
    const monthN = now.toLocaleDateString('es-MX', { month: 'long' })

    const monday      = mondayOf(now)
    const fridayDt    = new Date(`${monday}T00:00:00`)
    fridayDt.setDate(fridayDt.getDate() + 4)
    const weekRangeFmt = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    const weekLabel    = `${weekRangeFmt(new Date(`${monday}T00:00:00`))} – ${weekRangeFmt(fridayDt)}`

    const d30ago = new Date(); d30ago.setDate(d30ago.getDate() - 30)
    const cutoff = d30ago.toISOString().slice(0, 10)
    const hist30 = history.filter(e => e.date >= cutoff)
    const pnlSer = buildPnlSeries(hist30)
    const monthly = buildMonthlyMap(history)

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-8 px-6">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-end justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Dashboard</h1>
                        <p className="text-gray-400 dark:text-slate-500 text-sm mt-0.5">
                            Bitunix Futures · actualiza cada 10 min
                            {lastFetch && (
                                <span> · última vez: {lastFetch.toLocaleTimeString('es-MX')}</span>
                            )}
                        </p>
                    </div>
                    {error && (
                        <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2 max-w-xs">
                            {error}
                        </p>
                    )}
                </div>

                {/* Metric cards */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <MetricCard
                        label="Equity actual"
                        value={equity != null ? `${fmt(equity)} USDT` : '—'}
                        sub="Disponible + Margen + PnL"
                        loading={loading}
                    />
                    <MetricCard
                        label="P&L Hoy"
                        value={dailyPnl != null ? `${fmtS(dailyPnl)} USDT` : '—'}
                        pct={pct(dailyPnl, baseDaily)}
                        color={pColor(dailyPnl)}
                        loading={loading}
                    />
                    <MetricCard
                        label="P&L Semana (Lun-Vie)"
                        value={weeklyPnl != null ? `${fmtS(weeklyPnl)} USDT` : '—'}
                        pct={pct(weeklyPnl, baseWeek)}
                        sub={weekLabel}
                        color={pColor(weeklyPnl)}
                        loading={loading}
                    />
                    <MetricCard
                        label={`P&L ${month}`}
                        value={monthlyPnl != null ? `${fmtS(monthlyPnl)} USDT` : '—'}
                        pct={pct(monthlyPnl, baseMonth)}
                        sub={`desde el 1 de ${monthN}`}
                        color={pColor(monthlyPnl)}
                        loading={loading}
                    />
                    <MetricCard
                        label="P&L últimos 30 días"
                        value={pnl30 != null ? `${fmtS(pnl30)} USDT` : '—'}
                        pct={pct(pnl30, base30)}
                        color={pColor(pnl30)}
                        loading={loading}
                    />
                </div>

                {/* Area chart — equity history */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Historial de equity</p>
                            <p className="text-xs text-gray-400 dark:text-slate-500">Últimos 30 días · USDT</p>
                        </div>
                        <span className="text-xs font-mono text-gray-300 dark:text-slate-600">{hist30.length} registros</span>
                    </div>
                    <AreaChart data={hist30} />
                </div>

                {/* Bar chart — daily P&L */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Ganancias / Pérdidas diarias</p>
                            <p className="text-xs text-gray-400 dark:text-slate-500">Últimos 30 días · USDT</p>
                        </div>
                        <div className="flex gap-3 text-xs text-gray-400 dark:text-slate-500">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />
                                Ganancia
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
                                Pérdida
                            </span>
                        </div>
                    </div>
                    <BarChart data={pnlSer} />
                </div>

                {/* Monthly summary */}
                {monthly.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                        <p className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Resumen mensual</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">Del día 1 al último día de cada mes</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {monthly.map(([key, { first, last }]) => {
                                const pnl  = last - first
                                const pct2 = first > 0 ? (pnl / first) * 100 : 0
                                const [yr, mo] = key.split('-')
                                const label = new Date(parseInt(yr), parseInt(mo) - 1, 1)
                                    .toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
                                return (
                                    <div key={key} className={`rounded-xl p-4 border ${pBg(pnl)}`}>
                                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-2 capitalize">
                                            {label}
                                        </p>
                                        <p className={`text-xl font-black font-mono ${pColor(pnl)}`}>
                                            {fmtS(pnl)}
                                        </p>
                                        <p className={`text-xs font-semibold mt-0.5 ${pColor(pnl)}`}>
                                            {fmtS(pct2, 2)}%
                                        </p>
                                        <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">USDT</p>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Detailed history table */}
                {history.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                        <p className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-4">Historial detallado</p>
                        <div className="overflow-auto max-h-72">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white dark:bg-slate-900">
                                    <tr className="text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-widest border-b border-gray-100 dark:border-slate-800">
                                        <th className="text-left pb-2 pr-4">Fecha</th>
                                        <th className="text-right pb-2 pr-4">Equity</th>
                                        <th className="text-right pb-2 pr-4">P&L diario</th>
                                        <th className="text-right pb-2">P&L acum. mes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...history].reverse().map((row, i, arr) => {
                                        const prev = arr[i + 1]  // arr is reversed, so prev = older entry
                                        const pnlD = prev != null ? row.equity - prev.equity : null
                                        const mon  = row.date.slice(0, 7)
                                        const firstInMon = history
                                            .filter(e => e.date.startsWith(mon) && e.date <= row.date)
                                            .sort((a, b) => a.date.localeCompare(b.date))[0]
                                        const pnlM = firstInMon != null ? row.equity - firstInMon.equity : null
                                        return (
                                            <tr key={row.date}
                                                className="border-b border-gray-50 dark:border-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                                                <td className="py-2.5 font-mono text-xs text-gray-500 dark:text-slate-400 pr-4">
                                                    {row.date}
                                                </td>
                                                <td className="py-2.5 text-right font-mono font-semibold text-gray-800 dark:text-slate-100 pr-4">
                                                    {fmt(row.equity)}
                                                </td>
                                                <td className={`py-2.5 text-right font-mono font-semibold pr-4 ${pColor(pnlD)}`}>
                                                    {pnlD != null ? fmtS(pnlD) : '—'}
                                                </td>
                                                <td className={`py-2.5 text-right font-mono font-semibold ${pColor(pnlM)}`}>
                                                    {pnlM != null ? fmtS(pnlM) : '—'}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            </div>
        </div>
    )
}
