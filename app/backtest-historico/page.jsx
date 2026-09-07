'use client'
import { useMemo, useRef, useState } from 'react'
import { BITUNIX_TICKERS } from '../patrones-1h/page'
import { fetchHistoricalCandles, INTERVAL_SCALE } from '../lib/bitunixHistory'
import { simulateSymbolTrades, applyCapitalCompounding, PATTERN_META, windowSize, apexDaysTarget } from '../lib/backtestPatternEngine'

// Backtest histórico basado en la MISMA lógica de detección/validación que
// app/patrones-1h/page.jsx (ver app/lib/backtestPatternEngine.js) — replica,
// vela a vela, desde el 1 de enero de hace `yearsBack` años (1 a 5,
// configurable en el campo "Años de historial") hasta hoy, exactamente el
// mismo gate que dispara logBacktestEntry/tryAutoOpenPosition en vivo: ápice
// exactamente a 10 días + TP2 favorable (R:R ≥ 2) + checklist 100% cumplido.
// Las ventanas de detección están escaladas ÷4 respecto al motor original en
// 1H para cubrir el mismo lapso real con velas de 4 horas.
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

    // Mejor Ratio 1H
        //"CROSS", "NIGHT", "STBL", "BAS", "CTK", "F", "TREE", "TURBO", "4", "AKE", "AVGO", "H", "MSTR", "ARX", "CFG", "CRWV", "DELL", "FIGHT", "MEGA", "NBIS", "OPEN", "SPACE", "SPCX", "ZAMA", "APT", "0G", "ZIL", "G", "RVN", "CVX", "ANIME", "EWY", "FLUID", "ROSE", "CETUS", "RARE", "RAY", "THETA", "ZEREBRO", "MASK", "ACT", "BERA", "BLUR", "HYPER", "MORPHO", "VVV", "AIO", "BROCCOLI", "DOGS", "GMX", "LAB", "LYN", "MAGMA", "MAVIA", "STEEM", "TA", "TOWNS", "ZKC", "EGLD", "ENS", "STRK", "ILV", "AERO", "AXS", "ELSA", "ESPORTS", "M", "RENDER", "SPK", "DRIFT", "DOT", "NOT", "JST", "ERA", "HAEDAL", "HEI", "SIREN", "WIF", "APEX", "BABY", "CHILLGUY", "CHIP", "COAI", "CVC", "FOLKS", "HYPE", "KITE", "MANTRA", "RECALL", "ROBO", "SKR", "SXT", "SYN", "DOGE", "ARB", "FLOW", "POWR", "QTUM", "ALICE", "SUSHI", "DYM", "ETC", "FET", "MOVE", "SAHARA", "SAND", "SSV", "TLM", "XLM", "BIGTIME", "CRV", "ME", "MEME", "METIS", "NEAR", "T", "AIXBT", "ARIA", "C", "ESP", "KERNEL", "OG", "PROMPT", "PUNDIX", "Q", "REZ", "SFP", "TAC", "VANA", "XTZ", "ZRX", "ARPA", "DOLO", "SEI", "ONG", "ACU", "ASR", "CC", "CELR", "COTI", "DIA", "FORM", "LA", "PARTI", "RLC", "SYRUP", "WAL", "XNY", "BANANA", "TAO"
    
    // Mejor Ratio 4H
        //"AGLD", "ARK", "BAN", "GAS", "GMT", "MANA", "ACH", "APEX", "AR", "BICO", "EDU", "HEI", "ID", "IOTX", "JELLYJELLY", "MASK", "NMR", "RIF", "ROSE", "SAPIEN", "SOLV", "SPK", "USTC", "XAI", "1MBABYDOGE", "4", "ADA", "AIO", "ALT", "ANIME", "APR", "ARPA", "AXS", "BABY", "BOME", "BR", "C98", "CHILLGUY", "CHZ", "COMP", "DOLO", "ENA", "ESPORTS", "ETH", "EUL", "EVAA", "FF", "FIDA", "G", "GLM", "H", "HAEDAL", "HBAR", "IN", "INIT", "LDO", "LISTA", "M", "MANTA", "ME", "MOCA", "MOODENG", "MORPHO", "MUBARAK", "MYX", "NAORIS", "NEAR", "NEO", "NEWT", "NOM", "OPEN", "ORDI", "PIEVERSE", "PNUT", "POL", "POWR", "PROM", "QTUM", "RUNE", "RVN", "SHELL", "SKY", "SONIC", "STEEM", "TNSR", "TREE", "TRUMP", "TWT", "UNI", "WAL", "WLD", "XPIN", "ZK", "ZORA", "ZRX", "CVC", "ZRO", "1000CHEEMS", "APE", "KAITO", "KMNO", "LTC", "STX", "MNT", "VET", "XRP", "AIN", "ANKR", "ARB", "BAND", "BIGTIME", "BLESS", "BNB", "COTI", "COW", "CRV", "DYM", "ENJ", "EPIC", "GTC", "INJ", "KNC", "NIL", "ONT", "PIPPIN", "POLYX", "PROMPT", "SENT", "SNX", "SOL", "STG", "SUN", "SUSHI", "SWARMS", "TLM", "TRB", "UB", "VIRTUAL", "W", "XLM", "XNY", "XVS", "ZIL", "FHE", "NOT", "AVAX", "BIO", "ETHW", "JUP", "LQTY"
    
    //Todos
        "0G", "1000BONK", "1000CAT", "1000CHEEMS", "1000RATS", "1000SATS", "1000SHIB", "1INCH", "1MBABYDOGE", "2Z", "4", "AAVE", "ACE", "ACH", "ACT", "ACU", "ACX", "ADA", "AEVO", "AERO", "AGIX", "AGLD", "AIA", "AIN", "AIO", "AIOT", "AIXBT", "AKE", "ALCH", "ALICE", "ALGO", "ALLO", "ALPINE", "ALT", "ANIME", "ANKR", "APE", "APEX", "API3", "APR", "APT", "AR", "ARB", "ARIA", "ARK", "ARKM", "ARPA", "ARX", "ASR", "ASTER", "ASTR", "AT", "ATH", "ATOM", "AUCTION", "AVA", "AVAX", "AVNT", "AWE", "AXL", "AXS", "AZTEC", "B2", "BABY", "BAN", "BANANA", "BANANAS31", "BAND", "BANK", "BAS", "BASED", "BAT", "BB", "BCH", "BEAT", "BERA", "BICO", "BIGTIME", "BIO", "BIRB", "BLEND", "BLESS", "BLUAI", "BLUR", "BLZ", "BMT", "BNB", "BNT", "BNX", "BOME", "BOND", "BR", "BRETT", "BREV", "BROCCOLI", "BSB", "BSV", "BTC", "BTR", "BTW", "C98", "CAKE", "CARV", "CATI", "CBRS", "CC", "CELO", "CELR", "CETUS", "CFG", "CFX", "CGPT", "CHILLGUY", "CHIP", "CHR", "CHZ", "CKB", "CLANKER", "CLO", "COAI", "COLLECT", "COMBO", "COMP", "COOKIE", "COPPER", "CORE", "COS", "COTI", "COW", "CRCL", "CRO", "CROSS", "CRV", "CRWV", "CTK", "CTR", "CTSI", "CVC", "CVX", "CYBER", "CYS", "DAR", "DASH", "DEEP", "DEXE", "DIA", "DOG", "DOGE", "DOGS", "DOLO", "DOOD", "DOT", "DRAM", "DRIFT", "DUSK", "DYDX", "DYM", "EDEN", "EDU", "EGLD", "EIGEN", "ELSA", "ENA", "ENJ", "ENS", "ENSO", "EPIC", "ERA", "ESP", "ESPORTS", "ETC", "ETH", "ETHFI", "ETHW", "EUL", "EVAA", "EWT", "FARTCOIN", "FET", "FF", "FHE", "FIDA", "FIGHT", "FIL", "FLNC", "FLOCK", "FLOW", "FLUID", "FOGO", "FOLKS", "FORM", "FRAX", "FRONT", "FTM", "G", "GAL", "GALA", "GAS", "GENIUS", "GIGGLE", "GLM", "GMT", "GMX", "GOAT", "GPS", "GRASS", "GRIFFAIN", "GRT", "GTC", "GUA", "GUN", "GWEI", "H", "HAEDAL", "HANA", "HBAR", "HEI", "HEMI", "HFT", "HIGH", "HIVE", "HOLO", "HOME", "HOT", "HUMA", "HYPE", "HYPER", "ICNT", "ICP", "ICX", "ID", "IDOL", "ILV", "IMX", "IN", "INIT", "INJ", "INX", "IO", "IOST", "IOTA", "IOTX", "IRYS", "JASMY", "JCT", "JELLYJELLY", "JOE", "JST", "JTO", "JUP", "KAIA", "KAITO", "KAS", "KAT", "KAVA", "KERNEL", "KEY", "KGEN", "KITE", "KLAY", "KMNO", "KNC", "KOMA", "KSM", "LA", "LAB", "LAYER", "LDO", "LIGHT", "LINEA", "LINK", "LISTA", "LIT", "LITE", "LOOM", "LPT", "LQTY", "LSK", "LTC", "LUMIA", "LYN", "MAGIC", "MAGMA", "MANA", "MANTA", "MANTRA", "MASK", "MATIC", "MAV", "MAVIA", "ME", "MEGA", "MELANIA", "MEME", "MERL", "MET", "METIS", "MEW", "MINA", "MIRA", "MITO", "MLN", "MMT", "MNT", "MOCA", "MON", "MOODENG", "MORPHO", "MOVE", "MOVR", "MTL", "MUBARAK", "MYX", "NAORIS", "NBIS", "NEAR", "NEO", "NEWT", "NFP", "NIGHT", "NIL", "NMR", "NOM", "NOT", "NOW", "NXPC", "OCEAN", "OG", "OGN", "OKB", "ONDO", "ONE", "ONG", "ONT", "OP", "OPEN", "OPG", "OPN", "ORBS", "ORCA", "ORDER", "ORDI", "PARTI", "PAXG", "PENDLE", "PENGU", "PEOPLE", "PHB", "PI", "PIEVERSE", "PIPPIN", "PIXEL", "PLUME", "PNUT", "POL", "POLYX", "POPCAT", "PORTAL", "POWER", "POWR", "PRL", "PROM", "PROMPT", "PROVE", "PTB", "PUMP", "PUNDIX", "PYTH", "QNT", "QTUM", "RAD", "RARE", "RAVE", "RAY", "RE", "RECALL", "RED", "REN", "RENDER", "RESOLV", "REZ", "RIF", "RIVER", "RLC", "ROBO", "ROSE", "RPL", "RSR", "RUNE", "RVN", "SAFE", "SAGA", "SAHARA", "SAND", "SAPIEN", "SCR", "SEI", "SENT", "SFP", "SHELL", "SIGN", "SIREN", "SKL", "SKR", "SKY", "SKYAI", "SLP", "SLX", "SNX", "SOL", "SOLV", "SOMI", "SONIC", "SOON", "SOPH", "SPACE", "SPCX", "SPELL", "SPK", "SQD", "SSV", "STABLE", "STBL", "STEEM", "STG", "STMX", "STO", "STORJ", "STRK", "STX", "SUI", "SUN", "SUPER", "SUSHI", "SWARMS", "SXT", "SYN", "SYRUP", "TA", "TAC", "TAG", "TAIKO", "TAKE", "TAO", "TEST", "THE", "THETA", "TIA", "TLM", "TNSR", "TON", "TOSHI", "TOWNS", "TRADOOR", "TRB", "TREE", "TRIA", "TRUMP", "TRUST", "TRUTH", "TRX", "TST", "TURBO", "TURTLE", "TUT", "TWT", "UAI", "UB", "UMA", "UNFI", "UNI", "UP", "US", "USAR", "USELESS", "USTC", "USUAL", "VANA", "VANRY", "VELVET", "VET", "VIC", "VIRTUAL", "VTHO", "VVV", "W", "WAL", "WAVES", "WAXP", "WCT", "WET", "WIF", "WLD", "WLFI", "WOO", "XAI", "XAN", "XAUT", "XEM", "XLM", "XMR", "XNY", "XPIN", "XPL", "XRP", "XTZ", "XVG", "XVS", "YB", "YFI", "YGG", "ZAMA", "ZBCN", "ZBT", "ZEC", "ZEN", "ZEREBRO", "ZEST", "ZETA", "ZIL", "ZK", "ZKC", "ZKP", "ZORA", "ZRO", "ZRX"
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

const DEFAULT_YEARS_BACK = 1
const MIN_YEARS_BACK = 1
const MAX_YEARS_BACK = 5

// 1 de enero de hace `yearsBack` años (ej. si hoy es 2026 y vale 3, arranca
// en 2023-01-01). Antes era una constante fija (BACKTEST_YEARS_BACK); ahora
// es configurable desde el campo "Años de historial" (1 a 5).
function backtestStartMs(yearsBack) {
    const now = new Date()
    return new Date(now.getFullYear() - yearsBack, 0, 1).getTime()
}

export default function BacktestHistoricoPage() {
    const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS)
    const [candleInterval, setCandleInterval] = useState('4h')
    const [yearsBack, setYearsBack] = useState(DEFAULT_YEARS_BACK)
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
        const startMs = backtestStartMs(yearsBack) - LOOKBACK_BUFFER_DAYS * 24 * 3_600_000

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
                // significa que el ticker no existe en Bitunix con ese nombre.
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
        const firstDay = Math.floor(backtestStartMs(yearsBack) / MS_PER_DAY) * MS_PER_DAY
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
    }, [executed, initialTotalCapital, yearsBack])

    // Ascendente (más viejo primero): la tabla debe leerse en el mismo orden en
    // que corre el backtest (desde hace 3 años hacia hoy), no al revés.
    const sortedTrades = [...trades].sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0))

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100">Backtest histórico ({yearsBack} año{yearsBack !== 1 ? 's' : ''} · patrones, velas {candleInterval.toUpperCase()})</h1>
                <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                    Corre la misma detección y checklist de <code className="text-xs">/patrones-1h</code> desde
                    el 1 de enero de hace {yearsBack} año{yearsBack !== 1 ? 's' : ''}, buscando ápice exactamente a {apexDaysTarget(INTERVAL_SCALE[candleInterval])} (equivalente a 10 días en velas de 1H) con TP2 favorable (R:R ≥ 2).
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
                    <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1">
                        Años de historial a analizar ({MIN_YEARS_BACK}-{MAX_YEARS_BACK})
                    </label>
                    <input
                        type="number" min={MIN_YEARS_BACK} max={MAX_YEARS_BACK} step={1}
                        value={yearsBack}
                        onChange={e => {
                            const n = parseInt(e.target.value, 10)
                            if (!Number.isFinite(n)) return
                            setYearsBack(Math.min(MAX_YEARS_BACK, Math.max(MIN_YEARS_BACK, n)))
                        }}
                        disabled={running}
                        className="w-24 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
                    />
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        Corre desde el 1 de enero de hace tantos años hasta hoy. Más años = más velas por símbolo y una corrida más lenta.
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
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital por operación inicial
                        <input
                            type="number" min={1} step={1}
                            value={initialPerTradeCapital}
                            onChange={e => setInitialPerTradeCapital(parseFloat(e.target.value) || 0)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital total sube de a
                        <input
                            type="number" min={1} step={1}
                            value={capitalStep}
                            onChange={e => setCapitalStep(parseFloat(e.target.value) || 1)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Capital/operación sube de a
                        <input
                            type="number" min={0} step={1}
                            value={perTradeStep}
                            onChange={e => setPerTradeStep(parseFloat(e.target.value) || 0)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-slate-400">
                        Apalancamiento
                        <input
                            type="number" min={1} step={1}
                            value={leverage}
                            onChange={e => setLeverage(parseFloat(e.target.value) || 1)}
                            disabled={running}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-800 dark:text-white text-sm disabled:opacity-60"
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
