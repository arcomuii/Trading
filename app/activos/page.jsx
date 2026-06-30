'use client'
import { useState, useEffect, useRef } from 'react'

const REQUEST_DELAY = 60_000  // 1 minuto entre peticiones
const RETRY_DELAY   = 5_000   // 5 segundos antes de reintentar

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function fmt(n, d = 2) {
  if (n == null || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtCompact(n) {
  if (n == null) return '—'
  if (n >= 1e12) return `$${fmt(n / 1e12)}T`
  if (n >= 1e9)  return `$${fmt(n / 1e9)}B`
  if (n >= 1e6)  return `$${fmt(n / 1e6)}M`
  return `$${fmt(n)}`
}

export default function ActivosPage() {
  const [assets,   setAssets]   = useState([])
  const [cgData,   setCgData]   = useState({})   // baseCoin → datos de CoinGecko
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [progress, setProgress] = useState(null) // null | { i, total, symbol, status }
  const [error,    setError]    = useState(null)
  const abortRef = useRef(false)

  useEffect(() => {
    abortRef.current = false
    run()
    return () => { abortRef.current = true }
  }, [])

  async function run() {
    try {
      setLoading(true)
      setError(null)

      // Paso 1: Bitunix tickers + lista de IDs de CoinGecko en paralelo
      const [btRes, cgListRes] = await Promise.all([
        fetch('/api/bitunix/api/v1/futures/market/tickers'),
        fetch('/api/coingecko/api/v3/coins/list'),
      ])

      if (!btRes.ok) throw new Error(`Bitunix HTTP ${btRes.status}`)
      const btData = await btRes.json()

      const code = btData?.code
      if (code !== undefined && code !== 0 && code !== '0') {
        throw new Error(`Bitunix API: ${btData.msg || 'Error'} (${code})`)
      }

      const rawList =
        Array.isArray(btData?.data?.tickerList) ? btData.data.tickerList :
        Array.isArray(btData?.data?.list)        ? btData.data.list       :
        Array.isArray(btData?.data)              ? btData.data            :
        Array.isArray(btData?.result)            ? btData.result          : []

      const usdt = rawList
        .filter(a =>
          (a.quoteCoin || '').toUpperCase() === 'USDT' ||
          (a.symbol    || '').toUpperCase().endsWith('USDT')
        )
        .map(a => ({
          ...a,
          baseCoin: (
            a.baseCoin || (a.symbol || '').replace(/USDT$/i, '').replace(/PERP$/i, '')
          ).toUpperCase(),
        }))

      setAssets(usdt)
      setLoading(false)

      // Paso 2: Construir mapa symbol → CoinGecko ID
      const idMap = {}
      if (cgListRes.ok) {
        const cgList = await cgListRes.json()
        for (const c of cgList) {
          const sym = (c.symbol || '').toUpperCase()
          if (!idMap[sym]) idMap[sym] = c.id  // primer match = más popular
        }
      }

      // Paso 3: Enriquecimiento progresivo — 1 petición/minuto con reintento
      for (let i = 0; i < usdt.length; i++) {
        if (abortRef.current) break

        const asset = usdt[i]
        const cgId  = idMap[asset.baseCoin]

        setProgress({ i: i + 1, total: usdt.length, symbol: asset.baseCoin, status: 'fetching' })

        if (cgId) {
          let success = false
          for (let attempt = 0; attempt < 2 && !success && !abortRef.current; attempt++) {
            if (attempt > 0) {
              setProgress(p => ({ ...p, status: 'retry' }))
              await sleep(RETRY_DELAY)
            }
            try {
              const res  = await fetch(`/api/coingecko/api/v3/coins/markets?vs_currency=usd&ids=${cgId}`)
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const data = await res.json()
              const coin = Array.isArray(data) && data[0] ? data[0] : null
              if (coin) {
                setCgData(prev => ({ ...prev, [asset.baseCoin]: coin }))
                success = true
              }
            } catch {
              // el bucle reintentará o continuará
            }
          }
          setProgress(p => ({ ...p, status: success ? 'ok' : 'skip' }))
        } else {
          setProgress(p => ({ ...p, status: 'no-id' }))
        }

        if (i < usdt.length - 1 && !abortRef.current) {
          await sleep(REQUEST_DELAY)
        }
      }

      setProgress(null)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const enriched = assets
    .map(a => ({ ...a, cg: cgData[a.baseCoin] ?? null }))
    .filter(a => a.cg !== null)

  const q        = search.trim().toUpperCase()
  const filtered = (q
    ? enriched.filter(a =>
        (a.symbol   || '').toUpperCase().includes(q) ||
        (a.baseCoin || '').toUpperCase().includes(q) ||
        (a.cg?.name || '').toUpperCase().includes(q))
    : enriched
  ).slice().sort((a, b) => (b.cg?.market_cap ?? 0) - (a.cg?.market_cap ?? 0))

  const enrichedCount = Object.keys(cgData).length

  return (
    <div className="container mx-auto px-4 py-8">

      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            Activos de Futuros en Bitunix
          </h1>
          {assets.length > 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {q
                ? `${filtered.length} de ${assets.length} activos`
                : `${assets.length} activos`}
              {enrichedCount > 0 && (
                <span className="ml-2 text-green-600 dark:text-green-400">
                  · {enrichedCount} con datos CoinGecko
                </span>
              )}
            </p>
          )}
        </div>
        {assets.length > 0 && (
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar símbolo o nombre…"
            className="border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm w-64
                       focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700
                       bg-white dark:bg-slate-900 dark:text-slate-100 shadow-sm"
          />
        )}
      </div>

      {/* Barra de progreso de enriquecimiento */}
      {progress && (
        <div className="mb-5 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-blue-700 dark:text-blue-300 font-medium">
              {progress.status === 'retry'    && '↻ Reintentando…'}
              {progress.status === 'fetching' && `Consultando CoinGecko: ${progress.symbol}`}
              {progress.status === 'ok'       && `✓ ${progress.symbol}`}
              {progress.status === 'skip'     && `✗ Sin datos: ${progress.symbol}`}
              {progress.status === 'no-id'    && `— Sin ID: ${progress.symbol}`}
            </span>
            <span className="text-blue-500 dark:text-blue-400 tabular-nums">
              {progress.i} / {progress.total}
            </span>
          </div>
          <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${(progress.i / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Loading inicial */}
      {loading && (
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Cargando activos…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-5 mb-6 text-red-700 dark:text-red-300">
          <p className="font-semibold mb-1">Error al obtener activos</p>
          <p className="text-sm font-mono">{error}</p>
        </div>
      )}

      {/* Sin activos */}
      {!loading && !error && assets.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400 text-sm">No se encontraron activos.</p>
      )}

      {/* Lista */}
      {enrichedCount === 0 && !loading && !error && progress && (
        <p className="text-slate-400 dark:text-slate-500 text-sm">
          Consultando CoinGecko… los resultados aparecerán aquí conforme se obtengan.
        </p>
      )}

      {filtered.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
          {/* Encabezado tabla */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-4 px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span className="w-8 text-center">#</span>
            <span>Activo</span>
            <span className="text-right">Precio</span>
            <span className="text-right">24h</span>
            <span className="text-right">Market cap</span>
            <span className="text-right">Volumen 24h</span>
            <span />
          </div>

          {filtered.length === 0 && (
            <p className="px-4 py-6 text-slate-400 dark:text-slate-500 text-sm">
              Sin resultados para "{search}"
            </p>
          )}

          {filtered.map((asset) => {
            const cg     = asset.cg
            const change = cg.price_change_percentage_24h
            const up     = change != null && change >= 0

            return (
              <div key={asset.symbol}
                   className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-4 px-4 py-3 border-b border-slate-50 dark:border-slate-700/50 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">

                {/* Rank */}
                <span className="w-8 text-center text-xs text-slate-300 dark:text-slate-600 font-mono">
                  {cg.market_cap_rank ?? '—'}
                </span>

                {/* Nombre */}
                <div className="flex items-center gap-3 min-w-0">
                  {cg.image
                    ? <img src={cg.image} alt={cg.name} className="w-7 h-7 rounded-full shrink-0" />
                    : (
                      <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 text-[10px] font-bold shrink-0">
                        {asset.baseCoin.slice(0, 2)}
                      </div>
                    )
                  }
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white text-sm leading-tight">
                      {asset.baseCoin}<span className="text-slate-400 font-normal">/USDT</span>
                    </p>
                    <p className="text-xs text-slate-400 truncate">{cg.name}</p>
                  </div>
                </div>

                {/* Precio */}
                <span className="text-right font-semibold text-slate-800 dark:text-slate-100 tabular-nums text-sm">
                  ${fmt(cg.current_price)}
                </span>

                {/* Cambio 24h */}
                <span className={`text-right font-semibold tabular-nums text-sm ${up ? 'text-green-500' : 'text-red-500'}`}>
                  {change != null ? `${up ? '+' : ''}${fmt(change)}%` : '—'}
                </span>

                {/* Market cap */}
                <span className="text-right text-slate-600 dark:text-slate-300 tabular-nums text-sm">
                  {fmtCompact(cg.market_cap)}
                </span>

                {/* Volumen */}
                <span className="text-right text-slate-600 dark:text-slate-300 tabular-nums text-sm">
                  {fmtCompact(cg.total_volume)}
                </span>

                {/* Enlace */}
                <a
                  href={`https://www.bitunix.com/es-es/contract-trade/${asset.symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 whitespace-nowrap transition-colors"
                >
                  Abrir →
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
