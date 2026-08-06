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

  useEffect(() => {
    if (!containerRef.current || !data || data.length === 0) return

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

    // Zonas sombreadas: se dibujan primero para que las velas queden encima.
    // Cada una es una línea plana (flat) al nivel del TP1/SL, con el relleno
    // anclado (baseValue) en el precio de entrada.
    const addZone = (flatPrice, fillColor) => {
      if (flatPrice == null) return
      const zoneSeries = chart.addSeries(AreaSeries, {
        lineColor: 'rgba(0,0,0,0)',
        lineWidth: 1,
        topColor: fillColor,
        bottomColor: fillColor,
        baseValue: { type: 'price', price: entry },
        priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      zoneSeries.setData(data.map(c => ({ time: c.time, value: flatPrice })))
    }
    addZone(tp1, 'rgba(251,192,45,0.15)')
    addZone(sl, 'rgba(81,45,168,0.15)')

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    })
    series.setData(data)

    // Sin "title": el precio sigue mostrándose del lado derecho (axisLabelVisible),
    // pero sin el texto "Entrada"/"SL"/"TP1" superpuesto — ese dato ya se ve en las
    // tarjetas de arriba, y quitarlo evita que se amontonen las etiquetas.
    const addLine = (price, color) => {
      if (price == null) return
      series.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true })
    }
    addLine(entry, '#3b82f6')
    addLine(sl, '#512da8')
    addLine(tp1, '#fbc02d')

    if (emaPeriod) {
      const emaData = computeEma(data, emaPeriod)
      if (emaData.length > 0) {
        const emaSeries = chart.addSeries(LineSeries, {
          color: '#ff9800',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        })
        emaSeries.setData(emaData)
      }
    }

    if (stochastic) {
      const { period, smoothK, smoothD } = stochastic
      const { k, d } = computeStochastic(data, period, smoothK, smoothD)
      if (k.length > 0) {
        const kSeries = chart.addSeries(LineSeries, {
          color: '#2962ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: true, title: `%K ${period}`,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        }, 1)
        kSeries.setData(k)
        kSeries.createPriceLine({ price: 80, color: '#94a3b8', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        kSeries.createPriceLine({ price: 20, color: '#94a3b8', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })

        if (d.length > 0) {
          const dSeries = chart.addSeries(LineSeries, {
            color: '#f97316', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
            crosshairMarkerVisible: true, title: `%D ${smoothD}`,
            priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
          }, 1)
          dSeries.setData(d)
        }

        chart.panes()[1]?.setHeight(Math.round(height * 0.4))
      }
    }

    chart.timeScale().fitContent()

    const onResize = () => chart.applyOptions({ width: containerRef.current.clientWidth })
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
    }
  }, [data, entry, sl, tp1, emaPeriod, stochastic, height])

  return <div ref={containerRef} className="w-full" />
}
