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
            </div>
        </div>
    )
}
