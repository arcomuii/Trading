// ─── Estado persistente del bot de Forex (Confluencia EUR/USD y demás pares) ──
// EXCLUSIVO del bot de trading real (scripts/forex-bot.mjs + app/forex/page.jsx
// + app/api/forex-bot/route.js). Mismo patrón que app/api/backtesting/route.js
// (JSON plano en disco + escritura atómica archivo temporal→rename + lock en
// proceso) — la diferencia es que AQUÍ dos procesos DISTINTOS leen/escriben el
// mismo archivo (el script standalone del bot, y el servidor de Next.js para
// la página /forex) — la escritura atómica (rename) sigue evitando que un
// lector vea un archivo a medias entre ambos procesos; lo que NO cubre es la
// carrera de "ambos leen viejo, ambos escriben" si los dos escriben en la
// MISMA fracción de segundo — aceptable aquí porque las escrituras son poco
// frecuentes (un toggle manual vs. un ciclo del bot cada 5 minutos).
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR   = path.join(process.cwd(), 'data')
const STATE_FILE = path.join(DATA_DIR, 'forex-bot-state.json')

export const PAIRS = ['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD', 'GBPJPY', 'USDCHF']
export const DEFAULT_MAX_CONCURRENT_POSITIONS = 1 // ver la nota de gestión de capital en scripts/forex-bot.mjs — con ~$10 reales, 1 es lo prudente
export const MIN_MAX_CONCURRENT_POSITIONS = 1
export const MAX_MAX_CONCURRENT_POSITIONS = 6 // no tiene sentido pedir más que el número de pares

function defaultState() {
    const pairs = {}
    for (const sym of PAIRS) pairs[sym] = { enabled: true }
    return {
        pairs,               // { [symbol]: { enabled: bool } } — el switch de encendido/apagado
        maxConcurrentPositions: DEFAULT_MAX_CONCURRENT_POSITIONS, // configurable desde /forex — ver scripts/forex-bot.mjs, lo lee en cada ciclo
        pendingOrders: [],   // órdenes límite YA mandadas a Capital.com, esperando llenarse: { symbol, dealId, dealReference, isBull, entry, sl, tp, size, placedAt, chochTime }
        openPositions: [],   // posiciones YA llenas, abiertas por el bot: { symbol, dealId, isBull, entry, sl, tp, size, openedAt, chochTime }
        trades: [],          // historial cerrado: { symbol, dealId, isBull, entry, sl, tp, size, openedAt, closedAt, outcome: 'win'|'loss', pnl }
        lastActedChochTime: {}, // { [symbol]: ms } — último setup ya atendido por par, para no reaccionar dos veces al mismo CHoCH
        dailyCapital: [],     // { date: 'YYYY-MM-DD', balance } — snapshot diario del balance REAL de la cuenta, para las gráficas 7/30/90 días
        weeklyReports: [],    // { weekStart: 'YYYY-MM-DD' (lunes), startBalance, endBalance } — reporte de cada viernes
        lastRunAt: null,
        circuitBreaker: null, // { initialBalance, tripped } — ver scripts/forex-bot.mjs
        log: [],              // últimos eventos del bot (para mostrar en la página) — { time, level: 'info'|'warn'|'error', message }
    }
}

let chain = Promise.resolve()
function withLock(fn) {
    const result = chain.then(fn, fn)
    chain = result.then(() => {}, () => {})
    return result
}

async function readStateRaw() {
    try {
        const raw = await fs.readFile(STATE_FILE, 'utf-8')
        const parsed = JSON.parse(raw)
        // Merge superficial con el default: si se agregó un par nuevo o un
        // campo nuevo después de que ya existiera el archivo, no se pierde.
        const base = defaultState()
        return {
            ...base, ...parsed,
            pairs: { ...base.pairs, ...(parsed.pairs || {}) },
        }
    } catch (err) {
        if (err.code === 'ENOENT') return defaultState()
        throw err
    }
}

async function writeStateRaw(state) {
    await fs.mkdir(DATA_DIR, { recursive: true })
    const tmpFile = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf-8')
    await fs.rename(tmpFile, STATE_FILE)
}

// Lectura simple (para la página/API — solo mostrar, no modificar).
export async function readState() {
    return withLock(readStateRaw)
}

// Lee, aplica `mutator` (recibe el estado y lo modifica en el lugar o
// devuelve uno nuevo), escribe, y devuelve el estado final — todo dentro del
// mismo lock, para que dos llamadas seguidas no se pisen entre sí DENTRO de
// este mismo proceso.
export async function updateState(mutator) {
    return withLock(async () => {
        const state = await readStateRaw()
        const next = (await mutator(state)) ?? state
        await writeStateRaw(next)
        return next
    })
}

// Agrega una línea al log corto que se muestra en la página — mantiene solo
// las últimas 200 para que el archivo no crezca sin límite.
export function pushLog(state, level, message) {
    state.log.push({ time: new Date().toISOString(), level, message })
    if (state.log.length > 200) state.log = state.log.slice(-200)
}
