'use client'
import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, AreaSeries, LineSeries } from 'lightweight-charts'

// EMA estándar: semilla = SMA de los primeros `period` cierres, luego
// ema[i] = close[i]*k + ema[i-1]*(1-k). Sin valor para los primeros
// (period - 1) puntos, igual que cualquier plataforma de trading.
function computeEma(data, period) {
  if (!data || data.length < period) return []
  const k = 2 / (period + 1)
  let sma = 0
  for (let i = 0; i < period; i++) sma += data[i].close
  sma /= period

  const result = [{ time: data[period - 1].time, value: sma }]
  let prevEma = sma
  for (let i = period; i < data.length; i++) {
    const ema = data[i].close * k + prevEma * (1 - k)
    result.push({ time: data[i].time, value: ema })
    prevEma = ema
  }
  return result
}

// Oscilador estocástico estándar: %K crudo (RSV) sobre `period` velas,
// suavizado con SMA(smoothK) → %K, y %D = SMA(%K, smoothD). Mismos
// parámetros/nombres que la mayoría de plataformas de trading.
function computeStochastic(data, period, smoothK, smoothD) {
  if (!data || data.length < period) return { k: [], d: [] }

  const rawK = []
  for (let i = period - 1; i < data.length; i++) {
    let highestHigh = -Infinity, lowestLow = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (data[j].high > highestHigh) highestHigh = data[j].high
      if (data[j].low < lowestLow) lowestLow = data[j].low
    }
    const range = highestHigh - lowestLow
    const rsv = range === 0 ? 0 : (data[i].close - lowestLow) / range * 100
    rawK.push({ time: data[i].time, value: rsv })
  }

  const sma = (arr, len) => {
    if (len <= 1) return arr
    const out = []
    for (let i = len - 1; i < arr.length; i++) {
      let sum = 0
      for (let j = i - len + 1; j <= i; j++) sum += arr[j].value
      out.push({ time: arr[i].time, value: sum / len })
    }
    return out
  }

  const k = sma(rawK, smoothK)
  const d = sma(k, smoothD)
  return { k, d }
}

// Gráfico de velas (open→close de una operativa registrada en el log de
// backtesting), con líneas horizontales de Entrada/SL/TP1 y las zonas de
// ganancia (Entrada→TP1) y riesgo (SL→Entrada) sombreadas. `emaPeriod`
// agrega una línea de Media Móvil Exponencial superpuesta (opcional).
// `stochastic` ({ period, smoothK, smoothD }) agrega el oscilador
// estocástico (%K/%D) en un panel independiente debajo del precio.
export function CandlestickChart({ data, entry, sl, tp1, emaPeriod, stochastic, height = 260 }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef({})
  const hasFitRef = useRef(false)

  // Crea el chart y sus series UNA sola vez (solo se reconstruye si cambia
  // `height` o si aparece/desaparece la EMA o el estocástico — algo que en
  // la práctica no pasa en este componente). A propósito NO depende de
  // `data`/`entry`/`sl`/`tp1`/`stochastic` (ver el otro efecto): si el chart
  // se recreara con cada actualización de datos, se perdía el zoom/pan que
  // el usuario hubiera hecho, porque abajo se llama fitContent() al crear.
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.1)' },
        horzLines: { color: 'rgba(148,163,184,0.1)' },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
    })
    chartRef.current = chart
    hasFitRef.current = false

    // Zonas sombreadas: se crean primero para que las velas queden encima.
    // Arrancan sin datos — el otro efecto les carga los puntos reales.
    const zoneOptions = fillColor => ({
      lineColor: 'rgba(0,0,0,0)',
      lineWidth: 1,
      topColor: fillColor,
      bottomColor: fillColor,
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    const tp1Zone = chart.addSeries(AreaSeries, zoneOptions('rgba(251,192,45,0.15)'))
    const slZone = chart.addSeries(AreaSeries, zoneOptions('rgba(81,45,168,0.15)'))

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    })

    // Sin "title": el precio sigue mostrándose del lado derecho (axisLabelVisible),
    // pero sin el texto "Entrada"/"SL"/"TP1" superpuesto — ese dato ya se ve en las
    // tarjetas de arriba, y quitarlo evita que se amontonen las etiquetas. Arrancan
    // ocultas (lineVisible: false) hasta que el otro efecto les ponga un precio real.
    const entryLine = candles.createPriceLine({ price: 0, color: '#3b82f6', lineWidth: 1, lineStyle: 2, lineVisible: false, axisLabelVisible: false })
    const slLine = candles.createPriceLine({ price: 0, color: '#512da8', lineWidth: 1, lineStyle: 2, lineVisible: false, axisLabelVisible: false })
    const tp1Line = candles.createPriceLine({ price: 0, color: '#fbc02d', lineWidth: 1, lineStyle: 2, lineVisible: false, axisLabelVisible: false })

    let emaSeries = null
    if (emaPeriod) {
      emaSeries = chart.addSeries(LineSeries, {
        color: '#ff9800',
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      })
    }

    let kSeries = null
    let dSeries = null
    if (stochastic) {
      kSeries = chart.addSeries(LineSeries, {
        color: '#2962ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
        crosshairMarkerVisible: true, title: `%K ${stochastic.period}`,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      }, 1)
      kSeries.createPriceLine({ price: 80, color: '#94a3b8', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      kSeries.createPriceLine({ price: 20, color: '#94a3b8', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })

      dSeries = chart.addSeries(LineSeries, {
        color: '#f97316', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
        crosshairMarkerVisible: true, title: `%D ${stochastic.smoothD}`,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      }, 1)

      chart.panes()[1]?.setHeight(Math.round(height * 0.4))
    }

    seriesRef.current = { candles, tp1Zone, slZone, entryLine, slLine, tp1Line, emaSeries, kSeries, dSeries }

    const onResize = () => chart.applyOptions({ width: containerRef.current.clientWidth })
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = {}
    }
  }, [height, !!emaPeriod, !!stochastic])

  // Empuja los datos nuevos al chart YA existente (setData/applyOptions en
  // vez de recrearlo) — así una vela nueva por polling o un re-render del
  // padre no le mueve el zoom/pan al usuario. fitContent() (encuadrar todo)
  // solo se dispara la primera vez que llegan datos, no en cada actualización.
  useEffect(() => {
    const s = seriesRef.current
    if (!s.candles || !data || data.length === 0) return

    s.candles.setData(data)
    s.tp1Zone.setData(tp1 != null ? data.map(c => ({ time: c.time, value: tp1 })) : [])
    s.slZone.setData(sl != null ? data.map(c => ({ time: c.time, value: sl })) : [])
    s.tp1Zone.applyOptions({ baseValue: { type: 'price', price: entry } })
    s.slZone.applyOptions({ baseValue: { type: 'price', price: entry } })

    const setLine = (line, price, color) => {
      if (!line) return
      line.applyOptions({ price: price ?? 0, color, lineVisible: price != null, axisLabelVisible: price != null })
    }
    setLine(s.entryLine, entry, '#3b82f6')
    setLine(s.slLine, sl, '#512da8')
    setLine(s.tp1Line, tp1, '#fbc02d')

    if (s.emaSeries) {
      s.emaSeries.setData(emaPeriod ? computeEma(data, emaPeriod) : [])
    }

    if (s.kSeries && stochastic) {
      const { period, smoothK, smoothD } = stochastic
      const { k, d } = computeStochastic(data, period, smoothK, smoothD)
      s.kSeries.setData(k)
      s.dSeries.setData(d)
    }

    if (!hasFitRef.current) {
      chartRef.current?.timeScale().fitContent()
      hasFitRef.current = true
    }
  }, [data, entry, sl, tp1, emaPeriod, stochastic])

  return <div ref={containerRef} className="w-full" />
}
