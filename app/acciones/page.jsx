'use client'
import { useState, useEffect, useRef } from 'react'

const DEFAULT_STOCKS = [
    { symbol: 'AAPL',  label: 'AAPL',  name: 'Apple' },
    { symbol: 'MSFT',  label: 'MSFT',  name: 'Microsoft' },
    { symbol: 'GOOG',  label: 'GOOG',  name: 'Alphabet' },
    { symbol: 'AMZN',  label: 'AMZN',  name: 'Amazon' },
    { symbol: 'NVDA',  label: 'NVDA',  name: 'NVIDIA' },
    { symbol: 'META',  label: 'META',  name: 'Meta' },
    { symbol: 'TSLA',  label: 'TSLA',  name: 'Tesla' },
]

const LS_PORTFOLIO = 'acc_portfolio'
const LS_CUSTOM    = 'acc_custom_stocks'

function loadPortfolio() {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem(LS_PORTFOLIO) ?? '{}') }
    catch { return {} }
}
function loadCustom() {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem(LS_CUSTOM) ?? '[]') }
    catch { return [] }
}
function savePortfolio(data) { localStorage.setItem(LS_PORTFOLIO, JSON.stringify(data)) }
function saveCustom(data)    { localStorage.setItem(LS_CUSTOM,    JSON.stringify(data)) }

function normalizeTicker(raw) { return raw.trim().toUpperCase() }

function usd(n) {
    if (n == null || isNaN(n)) return '—'
    return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(n) {
    if (n == null || isNaN(n)) return '—'
    return `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%`
}

/* ── Chart ─────────────────────────────────────────────── */
function PriceChart({ data, color = '#4f46e5', id = 'chart' }) {
    if (!data || data.length < 2) return null
    const min = Math.min(...data), max = Math.max(...data)
    const range = max - min || 1
    const W = 400, H = 100, P = 8
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * (W - P * 2) + P
        const y = H - ((v - min) / range) * (H - P * 2) - P
        return `${x},${y}`
    })
    const path = `M ${pts[0]} L ${pts.join(' L ')}`
    const area = `${path} L ${W - P},${H} L ${P},${H} Z`
    return (
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-slate-800">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-3">
                <span>Inicio del día</span><span>Precio (5m)</span><span>Ahora</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24 overflow-visible">
                <defs>
                    <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
                        <stop offset="100%" stopColor={color} stopOpacity="0"    />
                    </linearGradient>
                </defs>
                <path d={area} fill={`url(#grad-${id})`} />
                <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </div>
    )
}

/* ── Portfolio inputs + P&L ─────────────────────────────── */
function PortfolioSection({ symbol, currentPrice, portfolio, onChange }) {
    const entry    = portfolio[symbol] ?? { qty: '', buyPrice: '' }
    const qty      = parseFloat(entry.qty)
    const buyPrice = parseFloat(entry.buyPrice)
    const hasPL    = currentPrice && qty > 0 && buyPrice > 0
    const pl       = hasPL ? (currentPrice - buyPrice) * qty : null
    const plPct    = hasPL ? ((currentPrice - buyPrice) / buyPrice) * 100 : null
    const curVal   = hasPL ? currentPrice * qty : null
    const invested = hasPL ? buyPrice * qty : null
    const isGain   = pl >= 0

    function update(field, val) {
        const next = { ...portfolio, [symbol]: { ...entry, [field]: val } }
        onChange(next)
        savePortfolio(next)
    }

    return (
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-slate-800">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-3">Mi posición</p>
            <div className="flex gap-2 mb-3">
                <div className="flex-1">
                    <label className="text-[10px] text-gray-400 dark:text-slate-500 font-semibold uppercase tracking-wider block mb-1">Acciones</label>
                    <input
                        type="number" min="0" placeholder="0"
                        value={entry.qty}
                        onChange={e => update('qty', e.target.value)}
                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 bg-gray-50 dark:bg-slate-800 text-gray-800 dark:text-slate-100"
                    />
                </div>
                <div className="flex-1">
                    <label className="text-[10px] text-gray-400 dark:text-slate-500 font-semibold uppercase tracking-wider block mb-1">Precio compra (USD)</label>
                    <input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={entry.buyPrice}
                        onChange={e => update('buyPrice', e.target.value)}
                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 bg-gray-50 dark:bg-slate-800 text-gray-800 dark:text-slate-100"
                    />
                </div>
            </div>
            {hasPL && (
                <div className={`rounded-xl p-3 ${isGain ? 'bg-green-50 dark:bg-green-950 border border-green-100 dark:border-green-900' : 'bg-red-50 dark:bg-red-950 border border-red-100 dark:border-red-900'}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-0.5">Ganancia / Pérdida</p>
                            <p className={`text-xl font-black ${isGain ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                {isGain ? '+' : ''}{usd(pl)}
                            </p>
                            <p className={`text-xs font-semibold mt-0.5 ${isGain ? 'text-green-500 dark:text-green-400' : 'text-red-400 dark:text-red-400'}`}>
                                {pct(plPct)}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-0.5">Valor actual</p>
                            <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">{usd(curVal)}</p>
                            <p className="text-[11px] text-gray-400 dark:text-slate-500">Invertido: {usd(invested)}</p>
                        </div>
                    </div>
                </div>
            )}
            {!hasPL && (entry.qty || entry.buyPrice) && (
                <p className="text-xs text-gray-400 dark:text-slate-500 text-center">Completa acciones y precio de compra para ver P&L</p>
            )}
        </div>
    )
}

/* ── Stock card ─────────────────────────────────────────── */
function StockCard({ stock, meta, history, portfolio, onPortfolioChange, onRemove }) {
    const change = stock?.regularMarketChangePercent ?? 0
    const price  = stock?.regularMarketPrice ?? 0
    const pos    = change >= 0
    const color  = pos ? '#16a34a' : '#dc2626'

    if (!stock) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow border border-red-100 dark:border-red-900 p-7 flex flex-col">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">{meta.label}</h2>
                        <p className="text-sm text-red-400 mt-1">Símbolo no encontrado</p>
                    </div>
                    {onRemove && (
                        <button onClick={onRemove} className="text-gray-300 dark:text-slate-600 hover:text-red-400 transition-colors ml-2" title="Eliminar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    )}
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500">Verifica que el ticker sea válido en Yahoo Finance (ej. AAPL, NVDA)</p>
            </div>
        )
    }

    const displayName = meta.name || stock.shortName || meta.label

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-7 flex flex-col">
            <div className="flex items-start justify-between mb-5">
                <div>
                    <h2 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">{meta.label}</h2>
                    <p className="text-base font-semibold text-gray-700 dark:text-slate-200 mt-0.5">{displayName}</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${pos ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400'}`}>
                        {pct(change)}
                    </span>
                    {onRemove && (
                        <button onClick={onRemove} className="text-gray-300 dark:text-slate-600 hover:text-red-400 transition-colors" title="Eliminar acción">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    )}
                </div>
            </div>

            <p className={`text-4xl font-black ${pos ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                {usd(price)}
            </p>
            <p className={`text-sm font-semibold mt-1 ${pos ? 'text-green-500 dark:text-green-400' : 'text-red-400 dark:text-red-400'}`}>
                {pos ? '+' : ''}{usd(stock.regularMarketChange ?? 0)} hoy
            </p>

            <PriceChart data={history} color={color} id={meta.symbol} />

            <PortfolioSection
                symbol={meta.symbol}
                currentPrice={price}
                portfolio={portfolio}
                onChange={onPortfolioChange}
            />
        </div>
    )
}

/* ── Add stock form ─────────────────────────────────────── */
function AddStockForm({ existing, onAdd }) {
    const [open, setOpen]     = useState(false)
    const [ticker, setTicker] = useState('')
    const [adding, setAdding] = useState(false)
    const [err, setErr]       = useState('')
    const inputRef            = useRef(null)

    async function handleAdd(e) {
        e.preventDefault()
        setErr('')
        const sym = normalizeTicker(ticker)
        if (!ticker.trim())         { setErr('Ingresa un ticker.'); return }
        if (existing.includes(sym)) { setErr(`${sym} ya está en la lista.`); return }

        setAdding(true)
        try {
            const res  = await fetch(`/api/yahoo/v7/finance/quote?symbols=${sym}`)
            const json = await res.json()
            const result = json?.quoteResponse?.result ?? []
            if (!result.length) { setErr(`No se encontró "${sym}" en Yahoo Finance.`); return }
            onAdd(sym)
            setTicker('')
            setOpen(false)
        } catch {
            setErr('Error al verificar el ticker. Inténtalo de nuevo.')
        } finally {
            setAdding(false)
        }
    }

    useEffect(() => { if (open) inputRef.current?.focus() }, [open])

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-gray-300 dark:border-slate-700 text-gray-400 dark:text-slate-500 text-sm font-medium hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Agregar acción
            </button>
        )
    }

    return (
        <form onSubmit={handleAdd} className="flex items-start gap-2">
            <div>
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Ej. AAPL, NVDA, AMD"
                    value={ticker}
                    onChange={e => { setTicker(e.target.value); setErr('') }}
                    className="border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 bg-white dark:bg-slate-900 dark:text-slate-100 shadow-sm w-52"
                />
                {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
            </div>
            <button type="submit" disabled={adding}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {adding ? 'Verificando…' : 'Agregar'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setTicker(''); setErr('') }}
                className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500 text-sm hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                Cancelar
            </button>
        </form>
    )
}

/* ── Portfolio summary ──────────────────────────────────── */
function TotalSummary({ stockMap, allMeta, portfolio }) {
    const items = allMeta.map(m => {
        const s = stockMap[m.symbol]
        if (!s) return null
        const entry    = portfolio[m.symbol] ?? {}
        const qty      = parseFloat(entry.qty)
        const buyPrice = parseFloat(entry.buyPrice)
        const price    = s.regularMarketPrice ?? 0
        if (!qty || !buyPrice || !price) return null
        return {
            pl:       (price - buyPrice) * qty,
            curVal:   price * qty,
            invested: buyPrice * qty,
        }
    }).filter(Boolean)

    if (!items.length) return null

    const totalPL       = items.reduce((a, b) => a + b.pl, 0)
    const totalCurVal   = items.reduce((a, b) => a + b.curVal, 0)
    const totalInvested = items.reduce((a, b) => a + b.invested, 0)
    const totalPLPct    = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0
    const isGain        = totalPL >= 0

    return (
        <div className={`rounded-2xl border p-6 mb-6 ${isGain ? 'bg-green-50 dark:bg-green-950 border-green-100 dark:border-green-900' : 'bg-red-50 dark:bg-red-950 border-red-100 dark:border-red-900'}`}>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-3">Resumen de portafolio</p>
            <div className="flex flex-wrap gap-8">
                <div>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mb-0.5">Total invertido</p>
                    <p className="text-lg font-bold text-gray-700 dark:text-slate-200">{usd(totalInvested)}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mb-0.5">Valor actual</p>
                    <p className="text-lg font-bold text-gray-700 dark:text-slate-200">{usd(totalCurVal)}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mb-0.5">Ganancia / Pérdida</p>
                    <p className={`text-2xl font-black ${isGain ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {isGain ? '+' : ''}{usd(totalPL)}
                    </p>
                    <p className={`text-xs font-semibold ${isGain ? 'text-green-500 dark:text-green-400' : 'text-red-400 dark:text-red-400'}`}>
                        {pct(totalPLPct)}
                    </p>
                </div>
            </div>
        </div>
    )
}

// ─── SQZ Scanner NYSE/NASDAQ ─────────────────────────────────────────────────
function sqzEMA(values, period) {
    if (values.length < period) return []
    const k = 2 / (period + 1)
    let prev = values.slice(0, period).reduce((a, b) => a + b) / period
    const out = new Array(period - 1).fill(null)
    out.push(prev)
    for (let i = period; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k)
        out.push(prev)
    }
    return out
}

function calcSqzMomentum(high, low, close, period = 20) {
    const n = close.length
    if (n < period * 2) return null
    const ema = sqzEMA(close, period)
    const deltas = []
    for (let i = period - 1; i < n; i++) {
        if (ema[i] == null) continue
        const hSlice = high.slice(i - period + 1, i + 1)
        const lSlice = low.slice(i - period + 1, i + 1)
        const midHL  = (Math.max(...hSlice) + Math.min(...lSlice)) / 2
        deltas.push(close[i] - (midHL + ema[i]) / 2)
    }
    if (deltas.length < period) return null
    const reg = deltas.slice(-period)
    const N = reg.length
    let sx = 0, sy = 0, sxy = 0, sx2 = 0
    for (let i = 0; i < N; i++) { sx += i; sy += reg[i]; sxy += i * reg[i]; sx2 += i * i }
    const ax = sx / N, ay = sy / N
    const d = sx2 - N * ax * ax
    if (!d) return ay
    const sl = (sxy - N * ax * ay) / d, ic = ay - sl * ax
    return sl * (N - 1) + ic
}

const US_SCAN_LIST = [
    { symbol: 'AAPL', label: 'AAPL', name: 'Apple',     exchange: 'NASDAQ' },
    { symbol: 'MSFT', label: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' },
    { symbol: 'GOOG', label: 'GOOG', name: 'Alphabet',  exchange: 'NASDAQ' },
    { symbol: 'AMZN', label: 'AMZN', name: 'Amazon',    exchange: 'NASDAQ' },
    { symbol: 'NVDA', label: 'NVDA', name: 'NVIDIA',    exchange: 'NASDAQ' },
    { symbol: 'META', label: 'META', name: 'Meta',      exchange: 'NASDAQ' },
    { symbol: 'TSLA', label: 'TSLA', name: 'Tesla',     exchange: 'NASDAQ' },
]

const SQZ_SLOTS_US = [2, 6, 10, 14, 18, 22]

function sqzMsToSlotUS() {
    const now = new Date()
    for (const h of SQZ_SLOTS_US) {
        const d = new Date(now); d.setHours(h, 0, 0, 0)
        if (d > now) return d - now
    }
    const next = new Date(now)
    next.setDate(next.getDate() + 1); next.setHours(SQZ_SLOTS_US[0], 0, 0, 0)
    return next - now
}
function sqzNextSlotUS() {
    const now = new Date()
    for (const h of SQZ_SLOTS_US) {
        const d = new Date(now); d.setHours(h, 0, 0, 0)
        if (d > now) return d
    }
    const next = new Date(now)
    next.setDate(next.getDate() + 1); next.setHours(SQZ_SLOTS_US[0], 0, 0, 0)
    return next
}
function sqzFmtCdUS(ms) {
    if (ms <= 0) return 'ahora'
    const m = Math.ceil(ms / 60_000)
    const h = Math.floor(m / 60), r = m % 60
    return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`
}
async function sqzWaitUS(ms, ref) {
    const end = Date.now() + ms
    while (Date.now() < end) {
        if (ref.current) return
        await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())))
    }
}

async function fetchUSWeekly(symbol) {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${symbol}?interval=1wk&range=2y`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const chart = json?.chart?.result?.[0]
    if (!chart) throw new Error('sin datos')
    const q = chart.indicators?.quote?.[0] ?? {}
    const h = [], l = [], c = []
    const raw = q.close ?? []
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] != null && q.high[i] != null && q.low[i] != null) {
            h.push(q.high[i]); l.push(q.low[i]); c.push(raw[i])
        }
    }
    if (c.length < 42) throw new Error(`insuficiente: ${c.length}`)
    const n   = c.length
    const mom  = calcSqzMomentum(h, l, c, 20)
    const momP = calcSqzMomentum(h.slice(0, n - 1), l.slice(0, n - 1), c.slice(0, n - 1), 20)
    if (mom === null) throw new Error('cálculo fallido')
    return {
        momentum:             mom,
        momentumPrev:         momP,
        redValleyDeveloped:   mom < 0 && momP !== null && mom > momP,
        greenValleyDeveloped: mom > 0 && momP !== null && mom < momP,
        sqzMomNeg: mom < 0,
        sqzMomPos: mom > 0,
    }
}

const tvUS = (exchange, symbol) =>
    `https://es.tradingview.com/chart/?symbol=${encodeURIComponent(exchange + ':' + symbol)}`

function SqzScannerSection() {
    const [results,     setResults]     = useState({})
    const [scanRunning, setScanRunning] = useState(false)
    const [lastScan,    setLastScan]    = useState(null)
    const [countdown,   setCountdown]   = useState(() => sqzFmtCdUS(sqzMsToSlotUS()))
    const abortRef  = useRef(false)
    const scanIdRef = useRef(0)

    useEffect(() => {
        const id = setInterval(() => setCountdown(sqzFmtCdUS(sqzMsToSlotUS())), 30_000)
        return () => clearInterval(id)
    }, [])

    useEffect(() => {
        runScan()
        return () => { abortRef.current = true; scanIdRef.current++ }
    }, []) // eslint-disable-line

    async function runScan() {
        abortRef.current = false
        const myId = ++scanIdRef.current
        const init = {}
        US_SCAN_LIST.forEach(s => { init[s.symbol] = { loading: true } })
        setResults(init)
        setScanRunning(true)

        await Promise.all(US_SCAN_LIST.map(async stock => {
            try {
                const data = await fetchUSWeekly(stock.symbol)
                if (scanIdRef.current === myId)
                    setResults(prev => ({ ...prev, [stock.symbol]: { ...data, loading: false } }))
            } catch {
                if (scanIdRef.current === myId)
                    setResults(prev => ({ ...prev, [stock.symbol]: { error: true, loading: false } }))
            }
        }))

        if (scanIdRef.current === myId && !abortRef.current) {
            setLastScan(new Date())
            setScanRunning(false)
            await sqzWaitUS(sqzMsToSlotUS(), abortRef)
            if (scanIdRef.current === myId && !abortRef.current) runScan()
        } else if (scanIdRef.current === myId) {
            setScanRunning(false)
        }
    }

    function restart() { abortRef.current = true; scanIdRef.current++; setTimeout(runScan, 150) }

    const redDev   = US_SCAN_LIST.filter(s => results[s.symbol]?.redValleyDeveloped)
    const greenDev = US_SCAN_LIST.filter(s => results[s.symbol]?.greenValleyDeveloped)
    const done     = US_SCAN_LIST.filter(s => results[s.symbol] && !results[s.symbol].loading).length
    const pctDone  = Math.round(done / US_SCAN_LIST.length * 100)

    return (
        <div className="mt-14 border-t-2 border-gray-100 dark:border-slate-800 pt-10">

            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100">
                        Scanner Squeeze Momentum <span className="text-indigo-500">1W</span>
                    </h2>
                    <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">
                        {US_SCAN_LIST.length} acciones NYSE/NASDAQ · Vela semanal · Valle rojo desarrollado = posible LONG
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {lastScan && !scanRunning && (
                        <span className="text-xs text-gray-400 dark:text-slate-500">
                            Último: {lastScan.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                    <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        {scanRunning ? 'Analizando…' : `${sqzNextSlotUS().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · en ${countdown}`}
                    </span>
                    <button onClick={restart} disabled={scanRunning}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full transition-colors bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        <svg className={`w-3 h-3 ${scanRunning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        {scanRunning ? 'Analizando…' : 'Actualizar ahora'}
                    </button>
                </div>
            </div>

            {/* Barra de progreso */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        {scanRunning
                            ? <><svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">Analizando SQZ 1W…</span></>
                            : <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">✓ Análisis completado</span>
                        }
                    </div>
                    <span className="text-sm font-mono text-gray-500 dark:text-slate-400">{done} / {US_SCAN_LIST.length}</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-1.5 mb-2">
                    <div className={`h-1.5 rounded-full transition-all duration-500 ${scanRunning ? 'bg-indigo-500' : 'bg-green-500'}`}
                         style={{ width: `${pctDone}%` }} />
                </div>
                {(redDev.length > 0 || greenDev.length > 0) && (
                    <p className="text-xs text-gray-400 dark:text-slate-500">
                        {redDev.length > 0 && <span className="text-blue-600 dark:text-blue-400 font-semibold">{redDev.length} valle{redDev.length > 1 ? 's' : ''} rojo{redDev.length > 1 ? 's' : ''} desarrollado{redDev.length > 1 ? 's' : ''}</span>}
                        {redDev.length > 0 && greenDev.length > 0 && ' · '}
                        {greenDev.length > 0 && <span className="text-orange-500 dark:text-orange-400 font-semibold">{greenDev.length} valle{greenDev.length > 1 ? 's' : ''} verde{greenDev.length > 1 ? 's' : ''} desarrollado{greenDev.length > 1 ? 's' : ''}</span>}
                    </p>
                )}
            </div>

            {/* Valle Rojo Desarrollado */}
            {redDev.length > 0 && (
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-4">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-slate-100">Valle Rojo Desarrollado</h3>
                        <span className="bg-blue-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">{redDev.length}</span>
                        <span className="text-xs text-gray-400 dark:text-slate-500">· momentum negativo girando al alza · posible LONG</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                        {redDev.map(s => {
                            const r = results[s.symbol]
                            return (
                                <div key={s.symbol} className="bg-gradient-to-br from-blue-50 dark:from-blue-950/60 to-white dark:to-slate-900 border-2 border-blue-200 dark:border-blue-700 rounded-xl p-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">▲ LONG</span>
                                        <span className="text-[9px] text-blue-400 dark:text-blue-500 font-mono">{r?.momentum != null ? r.momentum.toExponential(2) : '—'}</span>
                                    </div>
                                    <p className="text-sm font-bold text-gray-800 dark:text-slate-100 leading-tight">{s.label}</p>
                                    <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{s.name}</p>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0"/>
                                            <p className="text-[9px] text-blue-600 dark:text-blue-400">Valle rojo girando ↑</p>
                                        </div>
                                        <a href={tvUS(s.exchange, s.symbol)} target="_blank" rel="noopener noreferrer"
                                           className="text-[9px] font-semibold text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-0.5 transition-colors">
                                            TV<svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                        </a>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Valle Verde Desarrollado */}
            {greenDev.length > 0 && (
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-4">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-slate-100">Valle Verde Desarrollado</h3>
                        <span className="bg-orange-400 text-white text-xs font-bold px-2.5 py-1 rounded-full">{greenDev.length}</span>
                        <span className="text-xs text-gray-400 dark:text-slate-500">· momentum positivo girando a la baja · posible SHORT</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                        {greenDev.map(s => {
                            const r = results[s.symbol]
                            return (
                                <div key={s.symbol} className="bg-gradient-to-br from-orange-50 dark:from-orange-950/60 to-white dark:to-slate-900 border-2 border-orange-200 dark:border-orange-700 rounded-xl p-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-400 text-white">▼ SHORT</span>
                                        <span className="text-[9px] text-orange-400 dark:text-orange-500 font-mono">{r?.momentum != null ? r.momentum.toExponential(2) : '—'}</span>
                                    </div>
                                    <p className="text-sm font-bold text-gray-800 dark:text-slate-100 leading-tight">{s.label}</p>
                                    <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{s.name}</p>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0"/>
                                            <p className="text-[9px] text-orange-500 dark:text-orange-400">Valle verde girando ↓</p>
                                        </div>
                                        <a href={tvUS(s.exchange, s.symbol)} target="_blank" rel="noopener noreferrer"
                                           className="text-[9px] font-semibold text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-0.5 transition-colors">
                                            TV<svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                        </a>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {done > 0 && redDev.length === 0 && greenDev.length === 0 && !scanRunning && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-8 text-center mb-6">
                    <p className="text-gray-400 dark:text-slate-500 text-sm">Sin valles desarrollados en este ciclo</p>
                </div>
            )}

            {/* Grid de todos los activos */}
            <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-3">Todos los activos</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3">
                    {US_SCAN_LIST.map(s => {
                        const r  = results[s.symbol]
                        const st = !r                     ? 'pending'
                                 : r.loading             ? 'loading'
                                 : r.error               ? 'error'
                                 : r.redValleyDeveloped  ? 'redDev'
                                 : r.sqzMomNeg           ? 'red'
                                 : r.greenValleyDeveloped ? 'greenDev'
                                 : r.sqzMomPos           ? 'green'
                                 : 'neutral'
                        const dotCls = {
                            pending:  'bg-gray-200 dark:bg-slate-600',
                            loading:  'bg-gray-300 dark:bg-slate-500 animate-pulse',
                            error:    'bg-red-200 dark:bg-red-900',
                            redDev:   'bg-blue-500',
                            red:      'bg-blue-200 dark:bg-blue-800',
                            greenDev: 'bg-orange-400',
                            green:    'bg-orange-200 dark:bg-orange-800',
                            neutral:  'bg-gray-300 dark:bg-slate-600',
                        }[st]
                        const bgCls = st === 'redDev'
                            ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
                            : st === 'greenDev'
                            ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800'
                            : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800'
                        const lblCls = st === 'redDev'   ? 'text-blue-600 dark:text-blue-400 font-bold'
                                     : st === 'greenDev' ? 'text-orange-600 dark:text-orange-400 font-bold'
                                     : 'text-gray-700 dark:text-slate-200'
                        const momLabel = r?.momentum != null
                            ? (r.sqzMomPos ? '+' : '') + r.momentum.toExponential(1)
                            : r?.loading ? '…' : '—'
                        return (
                            <a key={s.symbol} href={tvUS(s.exchange, s.symbol)} target="_blank" rel="noopener noreferrer"
                               className={`rounded-xl border p-3 flex flex-col gap-1 transition-opacity hover:opacity-80 ${bgCls}`}>
                                <div className="flex items-center gap-1.5">
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`}/>
                                    <span className={`text-sm font-bold leading-tight ${lblCls}`}>{s.label}</span>
                                </div>
                                <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{s.name}</p>
                                <p className="text-[10px] font-mono text-gray-400 dark:text-slate-500">{momLabel}</p>
                            </a>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

/* ── Main page ──────────────────────────────────────────── */
export default function AccionesPage() {
    const [customStocks, setCustomStocks] = useState(loadCustom)
    const [stockMap,     setStockMap]     = useState({})
    const [histories,    setHistories]    = useState({})
    const [loading,      setLoading]      = useState(true)
    const [error,        setError]        = useState(null)
    const [lastUpdate,   setLastUpdate]   = useState(null)
    const [portfolio,    setPortfolio]    = useState(loadPortfolio)

    const allMeta = [
        ...DEFAULT_STOCKS,
        ...customStocks.map(sym => ({ symbol: sym, label: sym, name: '' })),
    ]

    const allSymbols = allMeta.map(m => m.symbol)
    const symbolsKey = allSymbols.join(',')

    useEffect(() => {
        if (!allSymbols.length) return

        const fetchAll = async () => {
            try {
                setError(null)
                const [quotesRes, ...histResponses] = await Promise.all([
                    fetch(`/api/yahoo/v7/finance/quote?symbols=${symbolsKey}`),
                    ...allSymbols.map(s => fetch(`/api/yahoo/v8/finance/chart/${s}?interval=5m&range=1d`)),
                ])
                const quotesJson = await quotesRes.json()
                const histJsons  = await Promise.all(histResponses.map(r => r.json()))

                const result = quotesJson?.quoteResponse?.result ?? []
                const map = {}
                result.forEach(s => { map[s.symbol] = s })
                setStockMap(map)

                const histMap = {}
                allSymbols.forEach((sym, i) => {
                    const closes = histJsons[i]?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
                    histMap[sym] = closes.filter(v => v != null)
                })
                setHistories(histMap)
                setLastUpdate(new Date())
            } catch (err) {
                setError(err.message)
            } finally {
                setLoading(false)
            }
        }

        setLoading(true)
        fetchAll()
        const id = setInterval(fetchAll, 10 * 60_000)
        return () => clearInterval(id)
    }, [symbolsKey])

    function addStock(sym) {
        const next = [...customStocks, sym]
        setCustomStocks(next)
        saveCustom(next)
    }

    function removeStock(sym) {
        const next = customStocks.filter(s => s !== sym)
        setCustomStocks(next)
        saveCustom(next)
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Acciones · NYSE / NASDAQ</h1>
                        <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">
                            Precios en USD · actualiza cada 10 min
                            {lastUpdate && <span> · {lastUpdate.toLocaleTimeString('es-MX')}</span>}
                        </p>
                    </div>
                    <AddStockForm existing={allSymbols} onAdd={addStock} />
                </div>

                {/* Resumen portafolio */}
                {!loading && !error && (
                    <TotalSummary stockMap={stockMap} allMeta={allMeta} portfolio={portfolio} />
                )}

                {loading && (
                    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-slate-500 text-lg">
                        Cargando acciones…
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-red-700 dark:text-red-300">
                        <p className="font-semibold mb-1">Error al obtener datos</p>
                        <p className="text-sm font-mono">{error}</p>
                    </div>
                )}

                {!loading && !error && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[...allMeta].sort((a, b) => {
                            const plPctOf = meta => {
                                const s     = stockMap[meta.symbol]
                                const e     = portfolio[meta.symbol] ?? {}
                                const buy   = parseFloat(e.buyPrice)
                                const price = s?.regularMarketPrice
                                if (price && buy > 0) return ((price - buy) / buy) * 100
                                return -Infinity
                            }
                            return plPctOf(b) - plPctOf(a)
                        }).map(meta => (
                            <StockCard
                                key={meta.symbol}
                                meta={meta}
                                stock={stockMap[meta.symbol]}
                                history={histories[meta.symbol] ?? []}
                                portfolio={portfolio}
                                onPortfolioChange={setPortfolio}
                                onRemove={customStocks.includes(meta.symbol) ? () => removeStock(meta.symbol) : null}
                            />
                        ))}
                    </div>
                )}

                {/* ── SQZ Scanner 1W ── */}
                <SqzScannerSection />
            </div>
        </div>
    )
}
