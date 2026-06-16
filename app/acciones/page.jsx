'use client'
import { useState, useEffect } from 'react'

const STOCKS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA']
const NAMES  = { AAPL: 'Apple', MSFT: 'Microsoft', GOOG: 'Alphabet', AMZN: 'Amazon', NVDA: 'NVIDIA', META: 'Meta', TSLA: 'Tesla' }

function PriceChart({ data, color = '#4f46e5', id = 'chart' }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const W = 400, H = 120, P = 10
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * (W - P * 2) + P
    const y = H - ((val - min) / range) * (H - P * 2) - P
    return `${x},${y}`
  })
  const pathData = `M ${points[0]} L ${points.join(' L ')}`
  const areaData = `${pathData} L ${W - P},${H} L ${P},${H} Z`
  return (
    <div className="mt-8 pt-6 border-t border-gray-100 dark:border-slate-800">
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-4">
        <span>Inicio del día</span><span>Movimiento (5m)</span><span>Ahora</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 overflow-visible">
        <defs>
          <linearGradient id={`gradient-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaData} fill={`url(#gradient-${id})`} />
        <path d={pathData} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function StockCard({ stock, history }) {
  const change = stock.regularMarketChangePercent ?? 0
  const pos    = change >= 0
  const color  = pos ? '#16a34a' : '#dc2626'
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 p-8 flex flex-col justify-between">
      <h2 className="text-sm font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-4">
        {stock.symbol} · {NAMES[stock.symbol] ?? stock.shortName}
      </h2>
      <p className={`text-5xl font-black ${pos ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
        ${(stock.regularMarketPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
      </p>
      <p className={`text-sm font-semibold mt-2 ${pos ? 'text-green-500 dark:text-green-400' : 'text-red-400 dark:text-red-400'}`}>
        {pos ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
        <span className="text-gray-400 dark:text-slate-500 font-normal ml-2">
          ({pos ? '+' : ''}{(stock.regularMarketChange ?? 0).toFixed(2)})
        </span>
      </p>
      <PriceChart data={history} color={color} id={stock.symbol} />
    </div>
  )
}

export default function AccionesPage() {
  const [stocks, setStocks]         = useState([])
  const [histories, setHistories]   = useState({})
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    const fetchAll = async () => {
      try {
        setError(null)
        const [quotesRes, ...histResponses] = await Promise.all([
          fetch(`/api/yahoo/v7/finance/quote?symbols=${STOCKS.join(',')}`),
          ...STOCKS.map(s => fetch(`/api/yahoo/v8/finance/chart/${s}?interval=5m&range=1d`)),
        ])
        const quotesJson = await quotesRes.json()
        const histJsons  = await Promise.all(histResponses.map(r => r.json()))
        const result = quotesJson?.quoteResponse?.result ?? []
        if (!result.length) throw new Error('Sin datos de Yahoo Finance')
        setStocks(result)
        const histMap = {}
        STOCKS.forEach((sym, i) => {
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
    fetchAll()
    const id = setInterval(fetchAll, 10 * 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-4 flex items-center justify-center">
      <div className="max-w-7xl w-full text-center">
        <h1 className="text-4xl font-bold text-indigo-700 dark:text-indigo-400 mb-2">Dashboard de Acciones</h1>
        <p className="text-gray-400 dark:text-slate-500 text-sm mb-8">
          NYSE / NASDAQ · actualiza cada 10 min
          {lastUpdate && <span> · {lastUpdate.toLocaleTimeString('es-MX')}</span>}
        </p>
        {loading && <p className="text-gray-600 dark:text-slate-400 text-lg">Cargando acciones...</p>}
        {error && (
          <div className="text-red-500 dark:text-red-400 text-lg font-medium">
            <p>Error al obtener datos</p>
            <p className="text-sm font-mono mt-1">{error}</p>
          </div>
        )}
        {!loading && !error && stocks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {stocks.map(s => (
              <StockCard key={s.symbol} stock={s} history={histories[s.symbol] ?? []} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
