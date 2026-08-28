'use client'
import { useMemo, useRef, useState } from 'react'
import { BITUNIX_TICKERS } from '../patrones-1h/page'
import { fetchHistoricalCandles, INTERVAL_SCALE } from '../lib/binanceHistory'
import { simulateSymbolTrades, applyCapitalCompounding, PATTERN_META, windowSize, apexDaysTarget } from '../lib/backtestPatternEngine'

// Backtest histórico basado en la MISMA lógica de detección/validación que
// app/patrones-1h/page.jsx (ver app/lib/backtestPatternEngine.js) — replica,
// vela a vela (4 horas) desde el 1 de enero de hace BACKTEST_YEARS_BACK años,
// exactamente el mismo gate que dispara logBacktestEntry/tryAutoOpenPosition en
// vivo: ápice exactamente a 10 días + TP2 favorable (R:R ≥ 2) + checklist 100%
// cumplido. Las ventanas de detección están escaladas ÷4 respecto al motor
// original en 1H para cubrir el mismo lapso real con velas de 4 horas.
//
// Corre enteramente en el navegador (sin servidor/cron en este proyecto, igual
// que el resto de la app) — puede tardar varios minutos si se corren muchos
// símbolos, ya que cada uno requiere descargar el histórico paginado.

const LOOKBACK_BUFFER_DAYS = 10 // margen (en días, no depende del tamaño de vela) para que la ventana tenga historia antes del inicio del rango

const INTERVAL_OPTIONS = [
    { value: '4h', label: '4H' },
    { value: '1h', label: '1H' },
    { value: '1d', label: '1D' },
]

const DEFAULT_SYMBOLS = [
    // Mas ganadoras
        // 'AGLD', 'JOE', 'STX', 'QTUM', 'LPT', 'DASH', 'OGN', 'SOL', 'ZRX', 'NMR', 'ICX', 'ONG', 'RLC', 'ADA', 'ZEN', 'INJ', 'CHZ', 'EGLD', 'KAVA', 'DOT', 'WOO', 'FET', 'BAT', 'SAND', 'SUSHI', 'POWR', 'KNC', 'YGG', 'CVC', 'TAO', 'AAVE', 'XRP', 'ENS', 'DYDX', 'RSR', 'MINA', 'ROSE', 'DUSK', 'CELO', 'LTC', 'BAND', 'COTI', 'IOST', 'ILV', 'PUNDIX', 'CELR', 'MAV', 'HFT', 'BLZ', 'VET', 'RAY', 'IOTA', 'GLM', 'RVN', 'VTHO', 'UMA', 'NEAR', 'MTL', 'STORJ', 'IOTX', 'PHB', 'APE', 'HBAR', 'DEXE', 'ATOM', 'CAKE', 'GRT', 'ZEC', 'XVS', 'XVG', 'ANKR', 'API3', 'SSV', 'SKL', 'LSK', 'CTK', 'RARE', 'ARPA', 'REN', 'UNFI', 'STMX', 'HIGH', 'ALICE', 'UNI', 'ETC', 'APT', 'AXS', 'TWT', 'AR', 'CVX', '1INCH', 'RIF', 'YFI', 'KSM', 'HOT', 'WAVES', 'AUCTION', 'CTSI', 'GTC', 'OP', 

    // Mejor Ratio
        // 'CELO', 'XMR', 'MORPHO', 'IO', 'REZ', 'CELR', 'POL', 'BERA', 'EUL', 'DOLO', 'SCR', 'WAL', 'ZAMA', 'SPK', '0G', 'MANTA', 'GPS', 'MANTRA', 'VANA', 'ACX', 'WAVES', 'GIGGLE', 'AGIX', 'AEVO', 'CGPT', 'ERA', 'TUT', 'HEMI', 'EDEN', 'TREE', 'G', 'HOLO', 'SKY', 'TRUMP', 'WOO', 'OCEAN', 'COS', 'HBAR', 'SUI', 'DASH', 'KSM', 'BARD', 'RAD', 'AR', 'ZEN', 'MUBARAK', 'ANIME', 'SEI', 'JST', 'LQTY', 'ALICE', 'API3', 'BNB', 'KAVA', 'BLUR', 'TRB', 'SSV', 'CYBER', 'KAITO', 'SFP', 'MET', 'SYN', 'ORCA', 'ORDI', 'ZBT', 'STEEM', 'USUAL', 'STO', 'KEY', 'BTC', 'KAIA', '1000CHEEMS', 'ACH', '1INCH', 'ZRX', 'STORJ', 'SUPER', 'ZEC', 'FIDA', 'OGN', 'ENA', 'EIGEN', 'XVS', 'GMT', 'RESOLV', 'GAL', 'TON', 'PUNDIX', 'VET', 'ETHFI', 'GAS', 'ZIL', 'ICX', 'KNC', 'DIA', 'ALPINE', 'T', 'SOL', 'KLAY', 'GLM', 'RIF', 'ILV', 'AVAX', 'CVX', 'BAND', 'XVG', 'CVC', 'CAKE', 'ETH', 'IMX', 'ONT', 'XRP', 'CHZ', 'RAY', 'ENS', 'ASTR', 'NEAR', 'ID', 'JOE', 'STMX', 'OP', 'BANANA', 'FTM', 'SUN', 'WIF', 'TWT', 'BOME', 'LUMIA', 'RARE', 'WCT', 'XTZ', 'PUMP', 'METIS', '1MBABYDOGE', 
    
    //Todos
        "BNB", "XLM", "XMR", "CC", "LINK", "LAB", "HBAR", "AVAX", "SUI", "XAUT", "TAO", "PAXG", "ASTER", "OKB", "WLD", "ONDO", "MNT", "AAVE", "ICP", "MORPHO", "ETC", "DEXE", "QNT", "STABLE", "ATOM", "RENDER", "ALGO", "BEAT", "KAS", "JST", "ENA", "VELVET", "VVV", "APT", "INJ", "AERO", "CAKE", "LIT", "DASH", "JTO", "FET", "VET", "PENGU", "VIRTUAL", "TIA", "XRP", "GWEI", "SUN", "GRASS", "ETHFI", "STX", "SPX", "PYTH", "BSV", "XPL", "FRAX", "ZBCN", "MON", "2Z", "PIEVERSE", "JASMY", "UB", "PENDLE", "LDO", "ZRO", "STRK", "GRT", "FF", "DOGE", "CHZ", "WIF", "AXS", "EIGEN", "RAY", "ENS", "SYRUP", "IOTA", "COMP", "TWT", "KAITO", "SKYAI", "NEO", "DYDX", "THETA", "MANA", "BAT", "SAND", "BAS", "AR", "GALA", "BILL", "SFP", "TAC", "TAG", "AWE", "IMX", "CVX", "ZK", "A", "KMNO", "GLM", "1INCH", "SENT", "RE", "MET", "ATH", "BANANAS31", "ZEC", "FORM", "MAGMA", "RAVE", "SYN", "LPT", "WAL", "SNX", "EGLD", "ARKM", "GAS", "QTUM", "RSR", "USELESS", "ORCA", "RIVER", "HOME", "RIF", "MELANIA", "ALLO", "Q", "ZRX", "FLUID", "ORDI", "ZAMA", "RVN", "SIREN", "SAFE", "BIO", "SOON", "NMR", "PLUME", "IO", "YFI", "ALCH", "ICNT", "BERA", "ENJ", "ZIL", "JELLYJELLY", "KSM", "GMX", "HOT", "LINEA", "CYS", "ZETA", "BRETT", "SPK", "COAI", "APR", "MINA", "AXL", "POLYX", "IDOL", "ROSE", "DUSK", "0G", "KAVA", "CKB", "BARD", "FLOW", "POPCAT", "ASTR", "ZEREBRO", "XVS", "ESP", "BLUR", "BR", "CELO", "SUSHI", "DEEP", "RED", "MANTA", "GPS", "MOODENG", "TRB", "TRIA", "HUMA", "AZTEC", "SAHARA", "ROBO", "NOT", "KGEN", "PROVE", "XVG", "SQD", "VTHO", "CROSS", "NXPC", "MMT", "MOCA", "ANKR", "MANTRA", "FOGO", "ZEST", "UMA", "VANA", "FOLKS", "AT", "ZORA", "MEW", "TRUTH", "LTC", "RPL", "API3", "USTC", "POWR", "ACX", "AVNT", "SSV", "IRYS", "BOME", "HIVE", "OCEAN", "ICX", "BNT", "CATI", "NOW", "WAVES", "SKR", "REZ", "BAND", "PEOPLE", "ZBT", "OPG", "GIGGLE", "ACU", "COTI", "EUL", "IOST", "NAORIS", "EDU", "MERL", "ETHW", "XAN", "AUCTION", "GMT", "NEAR", "ILV", "STG", "CYBER", "STEEM", "ONG", "CARV", "FIDA", "PUNDIX", "B2", "MTL", "SKL", "ARK", "RLC", "XPIN", "BNX", "CTSI", "LSK", "PROM", "SIGN", "LISTA", "AIXBT", "AGIX", "KNC", "WAXP", "EWT", "BREV", "BCH", "SAPIEN", "LQTY", "YGG", "AEVO", "CTK", "SXT", "MYX", "USUAL", "CGPT", "CVC", "SPELL", "SLP", "LUMIA", "BLUAI", "NIL", "SOMI", "TRX", "CTR", "PIPPIN", "MAGIC", "CETUS", "INX", "YB", "AGLD", "MOVR", "ERA", "WET", "BLESS", "CHR", "BIGTIME", "LAYER", "BICO", "FLOCK", "AIOT", "TA", "HEI", "DOT", "ZKC", "TAIKO", "XNY", "C98", "DIA", "ENSO", "LA", "OG", "XAI", "BLEND", "DOLO", "PARTI", "TNSR", "KERNEL", "HMSTR", "DOOD", "ON", "FIL", "STORJ", "GUN", "RAD", "CELR", "PORTAL", "NEWT", "STO", "MUBARAK", "OGN", "RARE", "GRIFFAIN", "ELSA", "DRIFT", "TRUST", "MAV", "CHILLGUY", "DYM", "MITO", "AKE", "TUT", "4", "RESOLV", "RECALL", "WCT", "MAVIA", "ARPA", "LYN", "ASR", "HFT", "COOKIE", "GAL", "SWARMS", "VANRY", "TRADOOR", "ANTHROPIC", "TLM", "V", "GTC", "SHELL", "SAGA", "AVA", "AIA", "VIC", "BTR", "TAKE", "ESPORTS", "FHE", "XEM", "EVAA", "HEMI", "MU", "SOLV", "EPIC", "KOMA", "MLN", "TOWNS", "NFP", "BLZ", "ALPINE", "REN", "HAEDAL", "XPT", "COIN", "OPN", "ACT", "OPENAI", "ZKP", "MASK", "SNDK", "FRONT", "XTZ", "PTB", "IOTX", "PRL", "PUMP", "ONT", "DRAM", "KAT", "KITE", "BAN", "T", "PI", "ACE", "CORE", "ID", "FARTCOIN", "UP", "SLX", "UNFI", "PHB", "BABY", "SPACE", "EDEN", "JUP", "DIS", "BMT", "FIGHT", "SOPH", "BOND", "COST", "JOE", "HD", "M", "APEX", "DOGS", "KEY", "S", "ARIA", "TURTLE", "BASED", "ADA", "LOOM", "SPCX", "TURBO", "TST", "AIN", "COS", "XAU", "POL", "MEGA", "UAI", "SONIC", "SOL", "CLO", "HANA", "BTW", "PNUT", "NIGHT", "GUA", "GOAT", "BROCCOLI", "GENIUS", "STMX", "SUPER", "OP", "ZEN", "TREE", "ORCL", "BSB", "TOSHI", "IN", "NOM", "ME", "COMBO", "XPD", "LIGHT", "POWER", "G", "PIXEL", "HOLO", "PROMPT", "BTC", "H", "RUNE", "THE", "TEST", "F", "COW", "COPPER", "CFX", "B", "ANIME", "W", "TON", "OPEN", "MEME", "KAIA", "CLANKER", "C", "SKY", "MSTR", "US", "BANK", "ORBS", "BB", "ARB", "WLFI", "WOO", "TSLA", "DAR", "CHIP", "1000BONK", "ALT", "USAR", "AMD", "INTC", "ZM", "CRCL", "TRUMP", "1000SATS", "SEI", "O", "ARX", "HYPER", "ETH", "AAOI", "CBRS", "METIS", "BIRB", "NBIS", "CRO", "ACH", "HIGH", "STBL", "ALICE", "SMCI", "PLTR", "LITE", "BANANA", "QCOM", "NFLX", "NVDA", "AIO", "MRVL", "CRM", "CRWD", "GOOGL", "MSFT", "CRWV", "SPY", "AMZN", "1000CAT", "BABA", "ASTS", "KLAY", "FLNC", "APE", "AMAT", "HYPE", "AAPL", "GLW", "CRV", "META", "ORDER", "LLY", "COLLECT", "IREN", "EWY", "1MBABYDOGE", "1000SHIB", "RIVN", "MATIC", "JCT", "UNI", "1000RATS", "USO", "INIT", "AVGO", "CFG", "MOVE", "RKLB", "DOG", "BE", "ONE", "QQQ", "ASML", "MIRA", "DELL", "SCR", "1000CHEEMS", "TSM", "FTM",
].join(', ')

function normalizeSymbol(raw) {
    const s = raw.trim().toUpperCase()
    if (!s) return null
    return s.endsWith('USDT') ? s : `${s}USDT`
}

function parseSymbols(text) {
    const withPair = text.split(/[,\n]/).map(normalizeSymbol).filter(Boolean)
    return [...new Set(withPair)]
}

// Quita `symbol` (ya normalizado, ej. "XYZUSDT") de la lista cruda del textarea,
// preservando cómo lo haya escrito el usuario (con o sin el sufijo USDT).
function removeSymbolFromText(text, symbol) {
    const kept = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
        .filter(tok => normalizeSymbol(tok) !== symbol)
    return kept.join(', ')
}

function fmtUsdt(n) {
    if (n == null) return '—'
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)} USDT`
}
function fmtPct(n) {
    if (n == null) return '—'
    return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
}
function fmtDate(ms) {
    if (ms == null) return '—'
    return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })
}
function fmtDay(ms) {
    if (ms == null) return '—'
    return new Date(ms).toLocaleDateString('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' })
}

const BACKTEST_YEARS_BACK = 1

// 1 de enero de hace BACKTEST_YEARS_BACK años (ej. si hoy es 2026 y vale 3,
// arranca en 2023-01-01).
function backtestStartMs() {
    const now = new Date()
    return new Date(now.getFullYear() - BACKTEST_YEARS_BACK, 0, 1).getTime()
}

export default function BacktestHistoricoPage() {
    const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS)
    const [candleInterval, setCandleInterval] = useState('4h')
    const [leverage, setLeverage] = useState(2)
    const [initialTotalCapital, setInitialTotalCapital] = useState(100)
    const [initialPerTradeCapital, setInitialPerTradeCapital] = useState(2)
    const [capitalStep, setCapitalStep] = useState(10)
    const [perTradeStep, setPerTradeStep] = useState(1)

    const [running, setRunning] = useState(false)
    const [progress, setProgress] = useState({ done: 0, total: 0, current: null })
    const [rawTrades, setRawTrades] = useState([])
    const [symbolStatus, setSymbolStatus] = useState({})
    const stopRef = useRef(false)

    const useAllSymbols = () => setSymbolsText(BITUNIX_TICKERS.join(', '))

    const runBacktest = async () => {
        const symbols = parseSymbols(symbolsText)
        if (symbols.length === 0) return

        const scale = INTERVAL_SCALE[candleInterval]
        const minCandlesNeeded = windowSize(scale) + 10 // WINDOW (escalado ÷scale, ver backtestPatternEngine.js) + margen

        setRawTrades([])
        setSymbolStatus({})
        setProgress({ done: 0, total: symbols.length, current: null })
        setRunning(true)
        stopRef.current = false

        const endMs   = Date.now()
        const startMs = backtestStartMs() - LOOKBACK_BUFFER_DAYS * 24 * 3_600_000

        for (let idx = 0; idx < symbols.length; idx++) {
            if (stopRef.current) break
            const symbol = symbols[idx]
            setProgress({ done: idx, total: symbols.length, current: symbol })

            try {
                const candles = await fetchHistoricalCandles(symbol, startMs, endMs, candleInterval)
                if (candles.length < minCandlesNeeded) {
                    setSymbolStatus(s => ({ ...s, [symbol]: `sin historial suficiente (${candles.length} velas)` }))
                } else {
                    const symbolTrades = simulateSymbolTrades(candles, scale).map(t => ({ ...t, symbol }))
                    setRawTrades(prev => [...prev, ...symbolTrades])
                    setSymbolStatus(s => ({ ...s, [symbol]: `${symbolTrades.length} operativa(s)` }))
                }
            } catch (err) {
                // Símbolos que marcan error se quitan solos de la lista — normalmente
                // significa que el ticker no existe en Binance con ese nombre.
                setSymbolStatus(s => ({ ...s, [symbol]: `error: ${err.message}` }))
                setSymbolsText(prev => removeSymbolFromText(prev, symbol))
            }

            setProgress({ done: idx + 1, total: symbols.length, current: symbol })
        }

        setRunning(false)
    }

    const stopBacktest = () => { stopRef.current = true }

    const { trades, finalCapital, availableCapital, maxConcurrentOpen } = useMemo(
        () => applyCapitalCompounding(rawTrades, { leverage, initialTotalCapital, initialPerTradeCapital, capitalStep, perTradeStep }),
        [rawTrades, leverage, initialTotalCapital, initialPerTradeCapital, capitalStep, perTradeStep]
    )

    const executed = trades.filter(t => t.executed)
    const skipped  = trades.filter(t => !t.executed)
    const closed   = executed.filter(t => t.outcome !== 'open')
    const openTrades = executed.filter(t => t.outcome === 'open')
    const wins     = closed.filter(t => t.outcome === 'win')
    const losses   = closed.filter(t => t.outcome === 'loss')
    const openCnt  = openTrades.length
    const winRate  = closed.length > 0 ? (wins.length / closed.length) * 100 : null
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnlUsdt ?? 0), 0)

    const lossRanking = useMemo(() => {
        const bySymbol = {}
        for (const t of losses) {
            bySymbol[t.symbol] ??= { losses: 0, wins: 0 }
            bySymbol[t.symbol].losses += 1
        }
        for (const t of wins) {
            if (!bySymbol[t.symbol]) continue // solo símbolos que ya tienen al menos una perdedora
            bySymbol[t.symbol].wins += 1
        }
        return Object.entries(bySymbol).sort((a, b) => b[1].losses - a[1].losses)
    }, [losses, wins])

    const winRanking = useMemo(() => {
        const bySymbol = {}
        for (const t of wins) {
            bySymbol[t.symbol] ??= { wins: 0, losses: 0 }
            bySymbol[t.symbol].wins += 1
        }
        for (const t of losses) {
            if (!bySymbol[t.symbol]) continue // solo símbolos que ya tienen al menos una ganadora
            bySymbol[t.symbol].losses += 1
        }
        return Object.entries(bySymbol).sort((a, b) => b[1].wins - a[1].wins)
    }, [wins, losses])

    // Ratio ganadoras/perdedoras por símbolo. Sin perdedoras = ratio infinito
    // (JS ordena Infinity al principio solo); empate se rompe por más ganadoras.
    const ratioRanking = useMemo(() => {
        const bySymbol = {}
        for (const t of closed) {
            bySymbol[t.symbol] ??= { wins: 0, losses: 0 }
            if (t.outcome === 'win') bySymbol[t.symbol].wins += 1
            else bySymbol[t.symbol].losses += 1
        }
        return Object.entries(bySymbol)
            .map(([symbol, stats]) => ({
                symbol, ...stats,
                ratio: stats.losses === 0 ? Infinity : stats.wins / stats.losses,
            }))
            .sort((a, b) => b.ratio - a.ratio || b.wins - a.wins)
    }, [closed])

    // Capital restante día por día: el escaneo ya procesa las operativas de
    // TODOS los símbolos en orden cronológico real (ver applyCapitalCompounding
    // — abre/cierra por timestamp real, no símbolo por símbolo), y libera el
    // capital comprometido apenas cierra cada operativa. Esto arma, a partir de
    // esos cierres, una foto del capital total al final de cada día desde la
    // fecha más vieja del backtest hasta hoy (los días sin cierres mantienen el
    // capital del día anterior — no hubo movimiento).
    const dailyCapital = useMemo(() => {
        const closeEvents = executed
            .filter(t => t.exitTime != null && t.capitalAfter != null)
            .map(t => ({ time: t.exitTime, capital: t.capitalAfter }))
            .sort((a, b) => a.time - b.time)
        if (closeEvents.length === 0) return []

        const MS_PER_DAY = 24 * 3_600_000
        const firstDay = Math.floor(backtestStartMs() / MS_PER_DAY) * MS_PER_DAY
        const lastDay  = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY

        const days = []
        let capital = initialTotalCapital
        let idx = 0
        for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
            const dayEnd = day + MS_PER_DAY
            let closesToday = 0
            while (idx < closeEvents.length && closeEvents[idx].time < dayEnd) {
                capital = closeEvents[idx].capital
                closesToday++
                idx++
            }
            days.push({ date: day, capital, closesToday })
        }
        return days
    }, [executed, initialTotalCapital])

    // Ascendente (más viejo primero): la tabla debe leerse en el mismo orden en
    // que corre el backtest (desde hace 3 años hacia hoy), no al revés.
    const sortedTrades = [...trades].sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0))

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100">Backtest histórico ({BACKTEST_YEARS_BACK} años · patrones, velas {candleInterval.toUpperCase()})</h1>
                <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                    Corre la misma detección y checklist de <code className="text-xs">/patrones-1h</code> desde
                    el 1 de enero de hace {BACKTEST_YEARS_BACK} años, buscando ápice exactamente a {apexDaysTarget(INTERVAL_SCALE[candleInterval])} (equivalente a 10 días en velas de 1H) con TP2 favorable (R:R ≥ 2).
                    Apalancamiento {leverage}× sobre un capital que empieza en ${initialTotalCapital} y ${initialPerTradeCapital}/operación
                    (sube ${perTradeStep} cada vez que el capital total sube ${capitalStep}).
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
                <div>
                    <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1">Intervalo de velas</label>
                    <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden">
                        {INTERVAL_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setCandleInterval(opt.value)}
                                disabled={running}
                                className={`px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                    candleInterval === opt.value
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        1H = mismas ventanas de detección que el motor original (más lento de correr, más señales).
                        4H = ventanas escaladas ÷4 para cubrir el mismo lapso real con menos velas por símbolo.
                        1D = ventanas sin escalar (igual que 1H) pero en días — consolidación ~2 meses, historial ~5 años por símbolo.
                    </p>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-gray-500 dark:text-slate-400">Símbolos a analizar (separados por coma)</label>
                        <button
                            type="button"
                            onClick={useAllSymbols}
                            disabled={running}
                            className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                        >
                            Usar los {BITUNIX_TICKERS.length} símbolos de Bitunix (tardará mucho)
                        </button>
                    </div>
                    <textarea
                        value={symbolsText}
                        onChange={e => setSymbolsText(e.target.value)}
                        disabled={running}
                        rows={3}
                        className="w-full text-xs font-mono p-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-slate-200 disabled:opacity-60"
                    />
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        Los símbolos que terminen en error durante la corrida se quitan solos de esta lista.
                    </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital total inicial
                        <input
                            type="number" min={1} step={1}
                            value={initialTotalCapital}
                            onChange={e => setInitialTotalCapital(parseFloat(e.target.value) || 0)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital por operación inicial
                        <input
                            type="number" min={1} step={1}
                            value={initialPerTradeCapital}
                            onChange={e => setInitialPerTradeCapital(parseFloat(e.target.value) || 0)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital total sube de a
                        <input
                            type="number" min={1} step={1}
                            value={capitalStep}
                            onChange={e => setCapitalStep(parseFloat(e.target.value) || 1)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital/operación sube de a
                        <input
                            type="number" min={0} step={1}
                            value={perTradeStep}
                            onChange={e => setPerTradeStep(parseFloat(e.target.value) || 0)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Apalancamiento
                        <input
                            type="number" min={1} step={1}
                            value={leverage}
                            onChange={e => setLeverage(parseFloat(e.target.value) || 1)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
                        />
                    </label>
                </div>

                <div className="flex items-center gap-4 flex-wrap pt-1">
                    {!running ? (
                        <button
                            type="button"
                            onClick={runBacktest}
                            className="text-sm font-bold px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                        >
                            ▶ Iniciar backtest
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={stopBacktest}
                            className="text-sm font-bold px-5 py-2 rounded-xl bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
                        >
                            ■ Detener
                        </button>
                    )}

                    {progress.total > 0 && (
                        <span className="text-xs text-gray-400 dark:text-slate-500">
                            {progress.done}/{progress.total} símbolos
                            {progress.current && running ? ` · analizando ${progress.current}…` : ''}
                        </span>
                    )}
                </div>

                {progress.total > 0 && (
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                        <div
                            className="h-full bg-indigo-500 transition-all"
                            style={{ width: `${(progress.done / progress.total) * 100}%` }}
                        />
                    </div>
                )}
            </div>

            {/* ── Resultados ── */}
            <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Operativas cerradas</div>
                    <div className="text-2xl font-semibold text-gray-800 dark:text-slate-100">{closed.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">En curso</div>
                    <div className="text-2xl font-semibold text-blue-500 dark:text-blue-400">{openTrades.length}</div>
                    {openTrades.length > 0 && <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">sin cerrar al final del histórico</div>}
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Ganadoras</div>
                    <div className="text-2xl font-semibold text-green-600 dark:text-green-400">{wins.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Perdedoras</div>
                    <div className="text-2xl font-semibold text-red-500 dark:text-red-400">{losses.length}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Win rate</div>
                    <div className="text-2xl font-semibold text-gray-800 dark:text-slate-100">
                        {winRate != null ? `${winRate.toFixed(1)}%` : '—'}
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Sin capital disponible</div>
                    <div className="text-2xl font-semibold text-amber-500 dark:text-amber-400">{skipped.length}</div>
                    {skipped.length > 0 && <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">señales que no se pudieron tomar</div>}
                </div>
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Máx. operativas simultáneas</div>
                    <div className="text-2xl font-semibold text-purple-600 dark:text-purple-400">{maxConcurrentOpen}</div>
                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">ejecutadas al mismo tiempo, en cualquier símbolo</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Capital final (de ${initialTotalCapital} inicial)</div>
                    <div className={`text-2xl font-semibold ${finalCapital >= initialTotalCapital ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        ${finalCapital.toFixed(2)}
                    </div>
                    <div className={`text-xs mt-1 font-medium ${totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {fmtUsdt(totalPnl)} acumulado
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-1">Capital disponible</div>
                    <div className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
                        ${availableCapital.toFixed(2)}
                    </div>
                    <div className="text-xs mt-1 text-gray-400 dark:text-slate-500">
                        {finalCapital - availableCapital > 0
                            ? `$${(finalCapital - availableCapital).toFixed(2)} comprometidos en operativas sin cerrar`
                            : 'nada comprometido — todas las operativas cerraron'}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <div className="text-xs text-gray-400 dark:text-slate-500 mb-2">Símbolos con más operativas perdedoras</div>
                    {lossRanking.length === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-slate-500">Sin perdedoras todavía.</p>
                    ) : (
                        <ol className="text-sm space-y-1">
                            {lossRanking.slice(0, 10).map(([symbol, stats], i) => (
                                <li key={symbol} className="flex items-center justify-between">
                                    <span className="text-gray-600 dark:text-slate-300">{i + 1}. {symbol}</span>
                                    <span>
                                        <span className="font-semibold text-red-500 dark:text-red-400">{stats.losses} perdedora{stats.losses !== 1 ? 's' : ''}</span>
                                        <span className="text-gray-400 dark:text-slate-500"> · </span>
                                        <span className="font-semibold text-green-600 dark:text-green-400">{stats.wins} ganadora{stats.wins !== 1 ? 's' : ''}</span>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </div>

            {/* ── Top 100 símbolos con más operativas ganadoras ── */}
            {winRanking.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Top {Math.min(150, winRanking.length)} símbolos con más operativas ganadoras
                    </summary>
                    <div className="max-h-96 overflow-y-auto mt-3">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">#</th>
                                    <th className="py-1.5 pr-3">Símbolo</th>
                                    <th className="py-1.5 pr-3">Ganadoras</th>
                                    <th className="py-1.5 pr-3">Perdedoras</th>
                                </tr>
                            </thead>
                            <tbody>
                                {winRanking.slice(0, 150).map(([symbol, stats], i) => (
                                    <tr key={symbol} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{i + 1}</td>
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{symbol}</td>
                                        <td className="py-1 pr-3 font-semibold text-green-600 dark:text-green-400">{stats.wins}</td>
                                        <td className="py-1 pr-3 text-red-500 dark:text-red-400">{stats.losses}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {/* ── Top 100 símbolos con mejor ratio ganadoras/perdedoras ── */}
            {ratioRanking.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Top {Math.min(150, ratioRanking.length)} símbolos con mejor ratio ganadoras/perdedoras
                    </summary>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 mb-2">
                        Ratio = ganadoras ÷ perdedoras. "∞" significa que ese símbolo no tuvo ninguna perdedora
                        (ojo: con pocas operativas un ∞ no dice mucho — revisa cuántas cerró en total).
                    </p>
                    <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">#</th>
                                    <th className="py-1.5 pr-3">Símbolo</th>
                                    <th className="py-1.5 pr-3">Ratio</th>
                                    <th className="py-1.5 pr-3">Ganadoras</th>
                                    <th className="py-1.5 pr-3">Perdedoras</th>
                                    <th className="py-1.5 pr-3">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ratioRanking.slice(0, 150).map((r, i) => (
                                    <tr key={r.symbol} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{i + 1}</td>
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{r.symbol}</td>
                                        <td className="py-1 pr-3 font-semibold text-indigo-600 dark:text-indigo-400">
                                            {r.ratio === Infinity ? '∞' : r.ratio.toFixed(2)}
                                        </td>
                                        <td className="py-1 pr-3 text-green-600 dark:text-green-400">{r.wins}</td>
                                        <td className="py-1 pr-3 text-red-500 dark:text-red-400">{r.losses}</td>
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{r.wins + r.losses}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {/* ── Capital restante día por día ── */}
            {dailyCapital.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Capital restante día por día ({dailyCapital.length} días, desde {fmtDay(dailyCapital[0].date)})
                    </summary>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 mb-2">
                        El capital solo se mueve cuando cierra una operativa (se libera lo que tenía comprometido y se
                        le suma/resta el P&L) — los días sin cierres mantienen el capital del día anterior.
                    </p>
                    <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white dark:bg-slate-800">
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">Día</th>
                                    <th className="py-1.5 pr-3">Cierres ese día</th>
                                    <th className="py-1.5 pr-3">Capital restante</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyCapital.map((d, i) => (
                                    <tr key={i} className={`border-b border-gray-50 dark:border-slate-800/60 ${d.closesToday > 0 ? 'font-medium' : ''}`}>
                                        <td className="py-1 pr-3 text-gray-600 dark:text-slate-300">{fmtDay(d.date)}</td>
                                        <td className="py-1 pr-3 text-gray-400 dark:text-slate-500">{d.closesToday > 0 ? d.closesToday : '—'}</td>
                                        <td className={`py-1 pr-3 ${d.capital >= initialTotalCapital ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                            ${d.capital.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}

            {/* ── Operativas sin cerrar ── */}
            {openTrades.length > 0 && (
                <div className="bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
                    <div className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-1">
                        {openTrades.length} operativa{openTrades.length !== 1 ? 's' : ''} sin cerrar al final del histórico
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-2">
                        Se abrieron pero nunca tocaron SL ni TP1 dentro de las velas descargadas — su capital sigue
                        comprometido (por eso restan del "Capital disponible" de hoy) y no cuentan como ganadora ni perdedora.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">Símbolo</th>
                                    <th className="py-1.5 pr-3">Patrón</th>
                                    <th className="py-1.5 pr-3">Dirección</th>
                                    <th className="py-1.5 pr-3">Apertura</th>
                                    <th className="py-1.5 pr-3">Entrada</th>
                                    <th className="py-1.5 pr-3">SL</th>
                                    <th className="py-1.5 pr-3">TP1</th>
                                    <th className="py-1.5 pr-3">R:R</th>
                                    <th className="py-1.5 pr-3">Capital comprometido</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...openTrades].sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0)).map((t, i) => (
                                    <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{t.symbol}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{PATTERN_META[t.type]?.label ?? t.type}</td>
                                        <td className="py-1 pr-3">
                                            <span className={t.isBull ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}>
                                                {t.isBull ? 'LONG' : 'SHORT'}
                                            </span>
                                        </td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.entryTime)}</td>
                                        <td className="py-1 pr-3 text-gray-600 dark:text-slate-300">{t.entry?.toFixed(6)}</td>
                                        <td className="py-1 pr-3 text-red-500">{t.sl?.toFixed(6)}</td>
                                        <td className="py-1 pr-3 text-green-600">{t.tp1?.toFixed(6)}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{t.rr?.toFixed(2)}</td>
                                        <td className="py-1 pr-3 text-indigo-600 dark:text-indigo-400">${t.assignedCapital?.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Señales no ejecutadas por falta de capital ── */}
            {skipped.length > 0 && (
                <div className="bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
                    <div className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-1">
                        {skipped.length} señal{skipped.length !== 1 ? 'es' : ''} no se ejecutó{skipped.length !== 1 ? 'aron' : ''} por falta de capital disponible
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-2">
                        "Necesitaba" y "Disponible" son el capital en ESA fecha (había otras operativas abiertas
                        comprometiéndolo en ese momento) — no tiene que coincidir con el "Capital disponible" de
                        hoy que se ve arriba, que es el capital libre al final de todo el backtest.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                    <th className="py-1.5 pr-3">Símbolo</th>
                                    <th className="py-1.5 pr-3">Fecha</th>
                                    <th className="py-1.5 pr-3">Necesitaba en esa fecha</th>
                                    <th className="py-1.5 pr-3">Disponible en esa fecha</th>
                                    <th className="py-1.5 pr-3">Hubiera sido</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...skipped].sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0)).map((t, i) => (
                                    <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                        <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-slate-200">{t.symbol}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.entryTime)}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">${t.wouldNeedCapital?.toFixed(2)}</td>
                                        <td className="py-1 pr-3 text-gray-500 dark:text-slate-400">${t.availableAtTime?.toFixed(2)}</td>
                                        <td className="py-1 pr-3">
                                            <span className={
                                                t.outcome === 'win'  ? 'text-green-600 dark:text-green-400' :
                                                t.outcome === 'loss' ? 'text-red-500 dark:text-red-400' :
                                                                        'text-blue-500 dark:text-blue-400'
                                            }>
                                                {t.outcome === 'win' ? 'Ganadora' : t.outcome === 'loss' ? 'Perdedora' : 'Sin cerrar'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Detalle por símbolo ── */}
            {Object.keys(symbolStatus).length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer">
                        Estado por símbolo ({Object.keys(symbolStatus).length})
                    </summary>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                        {Object.entries(symbolStatus).map(([sym, status]) => (
                            <div key={sym} className="flex justify-between gap-2 text-gray-500 dark:text-slate-400">
                                <span className="font-mono">{sym}</span>
                                <span className={status.startsWith('error') ? 'text-red-500' : ''}>{status}</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* ── Tabla de operativas ── */}
            {trades.length > 0 && (
                <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-slate-700">
                                <th className="py-2 pr-3">Símbolo</th>
                                <th className="py-2 pr-3">Patrón</th>
                                <th className="py-2 pr-3">Dirección</th>
                                <th className="py-2 pr-3">Entrada</th>
                                <th className="py-2 pr-3">SL</th>
                                <th className="py-2 pr-3">TP1</th>
                                <th className="py-2 pr-3">R:R</th>
                                <th className="py-2 pr-3">Apertura</th>
                                <th className="py-2 pr-3">Cierre</th>
                                <th className="py-2 pr-3">Resultado</th>
                                <th className="py-2 pr-3">Capital usado</th>
                                <th className="py-2 pr-3">P&L ({leverage}×)</th>
                                <th className="py-2 pr-3">Capital restante</th>
                                <th className="py-2 pr-3">Capital disponible</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedTrades.map((t, i) => (
                                <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                                    <td className="py-1.5 pr-3 font-semibold text-gray-700 dark:text-slate-200">{t.symbol}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{PATTERN_META[t.type]?.label ?? t.type}</td>
                                    <td className="py-1.5 pr-3">
                                        <span className={t.isBull ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}>
                                            {t.isBull ? 'LONG' : 'SHORT'}
                                        </span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-300">{t.entry?.toFixed(6)}</td>
                                    <td className="py-1.5 pr-3 text-red-500">{t.sl?.toFixed(6)}</td>
                                    <td className="py-1.5 pr-3 text-green-600">{t.tp1?.toFixed(6)}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{t.rr?.toFixed(2)}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{fmtDate(t.entryTime)}</td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{t.outcome === 'open' ? 'Sin cerrar' : fmtDate(t.exitTime)}</td>
                                    <td className="py-1.5 pr-3">
                                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                                            !t.executed          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' :
                                            t.outcome === 'win'  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' :
                                            t.outcome === 'loss' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' :
                                                                    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                                        }`}>
                                            {!t.executed ? 'Sin capital' : t.outcome === 'win' ? 'Ganadora' : t.outcome === 'loss' ? 'Perdedora' : 'Abierta'}
                                        </span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">${t.assignedCapital?.toFixed(2) ?? '—'}</td>
                                    <td className={`py-1.5 pr-3 font-medium ${t.pnlUsdt == null ? 'text-gray-400' : t.pnlUsdt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                        {t.pnlUsdt != null ? `${fmtUsdt(t.pnlUsdt)} (${fmtPct(t.pct)})` : '—'}
                                    </td>
                                    <td className="py-1.5 pr-3 font-semibold text-gray-700 dark:text-slate-200">
                                        {t.capitalAfter != null ? `$${t.capitalAfter.toFixed(2)}` : '—'}
                                    </td>
                                    <td className="py-1.5 pr-3 text-indigo-600 dark:text-indigo-400">
                                        {t.availableAfter != null ? `$${t.availableAfter.toFixed(2)}` : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
