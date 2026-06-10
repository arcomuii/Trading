'use client'
import { useState, useEffect } from 'react'

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
    <div className="mt-8 pt-6 border-t border-gray-100">
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-4">
        <span>Hace 60 min</span><span>Movimiento última hora (1m)</span><span>Ahora</span>
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

export default function CriptosPage() {
  const [bitcoinPrice, setBitcoinPrice] = useState(null)
  const [ethPrice, setEthPrice]         = useState(null)
  const [btcHistory, setBtcHistory]     = useState([])
  const [ethHistory, setEthHistory]     = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        setError(null)
        const [priceRes, btcHistRes, ethHistRes] = await Promise.all([
          fetch('/api/coingecko/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd'),
          fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60'),
          fetch('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=60'),
        ])
        if (!priceRes.ok || !btcHistRes.ok || !ethHistRes.ok) throw new Error('Error en la comunicación con las APIs')
        const priceData   = await priceRes.json()
        const btcHistData = await btcHistRes.json()
        const ethHistData = await ethHistRes.json()
        if (priceData.bitcoin?.usd)  setBitcoinPrice(priceData.bitcoin.usd)
        if (priceData.ethereum?.usd) setEthPrice(priceData.ethereum.usd)
        setBtcHistory(btcHistData.map(d => parseFloat(d[4])))
        setEthHistory(ethHistData.map(d => parseFloat(d[4])))
      } catch (err) {
        setError('No se pudo obtener la información de precios.')
      } finally {
        setLoading(false)
      }
    }
    fetchPrices()
    const id = setInterval(fetchPrices, 60000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 flex items-center justify-center">
      <div className="max-w-5xl w-full text-center">
        <h1 className="text-4xl font-bold text-indigo-700 mb-6">Dashboard de Criptomonedas</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Bitcoin */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 flex flex-col justify-between">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Bitcoin (BTC)</h2>
            {loading && <p className="text-gray-600 text-lg">Cargando precio...</p>}
            {error && <div className="text-red-500 text-lg font-medium"><p>Error:</p><p>{error}</p></div>}
            {bitcoinPrice && !loading && !error && (
              <p className="text-5xl font-black text-green-600">${bitcoinPrice.toLocaleString('en-US')} USD</p>
            )}
            {!loading && !error && btcHistory.length > 0 && (
              <PriceChart data={btcHistory} color={btcHistory[btcHistory.length - 1] >= btcHistory[0] ? '#16a34a' : '#dc2626'} id="btc" />
            )}
          </div>
          {/* Ethereum */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 flex flex-col justify-between">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Ethereum (ETH)</h2>
            {loading && <p className="text-gray-600 text-lg">Cargando precio...</p>}
            {error && <div className="text-red-500 text-lg font-medium"><p>Error:</p><p>{error}</p></div>}
            {ethPrice && !loading && !error && (
              <div className="space-y-2">
                <p className="text-5xl font-black text-indigo-600">${ethPrice.toLocaleString('en-US')} USD</p>
                <p className="text-gray-400 text-sm">Actualizado vía CoinGecko + Binance</p>
              </div>
            )}
            {!loading && !error && ethHistory.length > 0 && (
              <PriceChart data={ethHistory} color={ethHistory[ethHistory.length - 1] >= ethHistory[0] ? '#16a34a' : '#dc2626'} id="eth" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
