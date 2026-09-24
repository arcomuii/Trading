// ─── Bot de trading real — Confluencia Forex (EUR/USD y los otros 5 pares) ──
// Pedido explícito del usuario: analiza cada par de forma independiente y,
// en cuanto encuentra un setup válido, abre la operación REAL en Capital.com
// (cuenta LIVE, dinero real — no hay demo configurada en este proyecto).
//
// Corre pegándole al PROXY de Next.js (http://localhost:3001/api/capital/...
// — mismo patrón que scripts/backtest-monitor.js contra /api/bitunix/...) en
// vez de reimplementar el login/sesión de Capital.com aquí: así no duplica
// credenciales ni la lógica de renovación de sesión que ya vive en
// app/api/capital/[...path]/route.js, y reutiliza esa ruta ya probada este
// mismo día (login, refresh, reintento en 401). Requiere que "next dev"
// (o el servicio de Windows que lo levanta 24/7, ver service-runner.js) esté
// corriendo — si no, cada ciclo falla con un error de red y se reintenta en
// el siguiente ciclo, sin tumbar el proceso.
//
// Arrancado por service-runner.js junto con "next dev" y el monitor de
// backtesting — vive mientras viva el Servicio de Windows (24/7, sin
// depender de ningún navegador ni de que alguien deje una terminal abierta).
//
// ── Gestión de capital (pedido explícito: "que no se acabe rápidamente") ──
// Con ~$10 de capital real, el tamaño MÍNIMO que permite Capital.com (100
// unidades, ver dealingRules.minDealSize — verificado igual para los 6
// pares) ya exige entre $3.3 y $4.5 de margen real, según el par (ver nota
// de `marginUsdFor` más abajo: el margen se calcula convirtiendo la divisa
// BASE a USD con la tasa correcta, no con el precio crudo de la cotización
// — un error que sí tenía el modelo de capital del backtest para pares
// cruzados como GBPJPY, corregido aquí desde el principio). Esto por sí solo
// ya limita el riesgo por operación a una fracción chica de la cuenta (no se
// puede pedir MÁS margen del mínimo, pero tampoco menos). Con eso en mente:
//   - Como máximo N operativas abiertas/pendientes a la vez EN TODA LA
//     CUENTA (no por par) — configurable desde /forex (pedido explícito),
//     por defecto 1 (ver DEFAULT_MAX_CONCURRENT_POSITIONS en
//     forexBotState.js): con $10 no tiene sentido comprometer varias
//     posiciones al mismo tiempo por defecto, pero se deja ajustable ahí
//     mismo si el capital crece o el usuario decide arriesgar más a la vez.
//     Se lee del estado compartido EN CADA CICLO (no es una constante fija
//     aquí), así que un cambio desde la página aplica sin reiniciar el bot.
//   - Volumen por operación configurable POR PAR desde /forex (pedido
//     explícito), por defecto el mínimo permitido por Capital.com (100
//     unidades) — con $10 no hay margen para escalar el tamaño por defecto,
//     pero queda ajustable ahí mismo si el capital crece. Igual que
//     maxConcurrentPositions, se lee del estado en cada ciclo.
//   - Circuit breaker: si el balance real cae por debajo del 50% del primer
//     balance que el bot observó, se detiene la apertura de NUEVAS
//     operativas (las que ya están abiertas siguen su curso normal hasta
//     cerrar) — para no seguir arriesgando una cuenta que ya perdió la
//     mitad. Se reactiva solo, si el balance se recupera arriba del 50%.
import { findLiveSetups, PAIR_PRESETS } from '../app/lib/forexConfluenceEngine.js'
import { readState, updateState, pushLog, PAIRS, DEFAULT_MAX_CONCURRENT_POSITIONS, DEFAULT_ORDER_SIZE } from '../app/lib/forexBotState.js'

const BASE_URL = `http://localhost:${process.env.TRADING_DEV_PORT || '3001'}`
const FETCH_TIMEOUT_MS = 40_000 // mismo margen que route.js contra la API real de Capital.com
const CYCLE_MS = 5 * 60_000 // alineado a M5 — no tiene sentido revisar más seguido, las velas nuevas tardan 5 min en cerrar
const HTF_INTERVAL_MS = 4 * 3_600_000 // H4

// El volumen por operación (antes ORDER_SIZE, fijo en 100 para los 6 pares)
// ahora es configurable POR PAR desde /forex — pedido explícito del usuario —
// ver `pairs[symbol].orderSize` en forexBotState.js. Se lee del estado en
// cada ciclo (más abajo, dentro del loop de PAIRS), no queda una constante
// fija acá.
const STALE_ORDER_HOURS = 10       // red de seguridad para una orden que quedó pendiente sin resolverse (ya no debería pasar con órdenes a mercado, que se resuelven en el mismo ciclo) — mismo criterio que CHOCH_TO_FILL_CANDLES del backtest
const CIRCUIT_BREAKER_RATIO = 0.5  // detiene aperturas nuevas si el balance cae debajo de esta fracción del balance inicial observado

// Cada par necesita M5 hacia atrás por lo menos `liquidityLookbackDays` (el
// más largo de los 6 presets, 60 días) + margen para el swingLookback/ATR/RSI
// — se pide con margen de sobra (75 días) para no quedar corto justo en el
// borde. H4 solo necesita cubrir el EMA50 (200h ≈ 8.3 días) — se pide con
// margen amplio (45 días) porque es una descarga barata (pocas velas).
const M5_LOOKBACK_DAYS = 75
const H4_LOOKBACK_DAYS = 45

function log(level, message) {
    const line = `[forex-bot] ${new Date().toISOString()} ${message}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
}

async function apiFetch(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${BASE_URL}/api/capital/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.errorCode || json?.error || `HTTP ${res.status}`)
    return json
}

function toCapitalDateStr(ms) { return new Date(ms).toISOString().slice(0, 19) }
function midPrice(p) {
    if (p == null) return null
    const bid = parseFloat(p.bid), ask = parseFloat(p.ask)
    if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2
    return Number.isFinite(bid) ? bid : Number.isFinite(ask) ? ask : null
}

// Una página de velas M5/H4 (mismo endpoint/límite real verificado hoy en
// app/lib/capitalMarket.js: epic en el path, tope real 1000 velas/request).
async function fetchKlines(epic, resolution, fromMs, toMs) {
    const params = new URLSearchParams({ resolution, max: '1000', from: toCapitalDateStr(fromMs), to: toCapitalDateStr(toMs) })
    const json = await apiFetch(`api/v1/prices/${epic}?${params}`)
    const rows = Array.isArray(json?.prices) ? json.prices : []
    return rows.map(r => ({
        openTime: new Date((r.snapshotTimeUTC ?? r.snapshotTime) + 'Z').getTime(), // ver nota en capitalMarket.js: SIN el 'Z' se lee como hora LOCAL, no UTC
        open: midPrice(r.openPrice), high: midPrice(r.highPrice), low: midPrice(r.lowPrice), close: midPrice(r.closePrice),
    })).filter(c => Number.isFinite(c.openTime) && c.close != null).sort((a, b) => a.openTime - b.openTime)
}

async function fetchKlinesRange(epic, resolution, fromMs, toMs, chunkDays) {
    const out = []
    let cursor = fromMs
    const chunkMs = chunkDays * 86_400_000
    while (cursor < toMs) {
        const end = Math.min(cursor + chunkMs, toMs)
        out.push(...await fetchKlines(epic, resolution, cursor, end))
        cursor = end
    }
    out.sort((a, b) => a.openTime - b.openTime)
    // Dedup por openTime (por si dos chunks contiguos devuelven la misma
    // vela de borde) — se queda con la última copia vista.
    const byTime = new Map()
    for (const c of out) byTime.set(c.openTime, c)
    return [...byTime.values()].sort((a, b) => a.openTime - b.openTime)
}

async function fetchMarketDetails(epic) {
    const json = await apiFetch(`api/v1/markets/${epic}`)
    const marginFactorPct = json?.instrument?.marginFactor
    return {
        marginFactor: Number.isFinite(marginFactorPct) ? marginFactorPct / 100 : null,
        baseCcy: json?.instrument?.symbol?.split('/')?.[0] ?? null,
        tickSize: json?.dealingRules?.minStepDistance?.value ?? 0.00001,
        bid: midPrice(json?.snapshot ?? null) ?? json?.snapshot?.bid ?? null,
    }
}

async function getAccount() {
    const json = await apiFetch('api/v1/accounts')
    const acct = json?.accounts?.find(a => a.preferred) ?? json?.accounts?.[0]
    if (!acct) throw new Error('Sin cuenta en la respuesta de /accounts')
    return { balance: acct.balance.balance, available: acct.balance.available }
}

async function getPositions() {
    const json = await apiFetch('api/v1/positions')
    return Array.isArray(json?.positions) ? json.positions : []
}

// El shape exacto de cada entrada de `workingOrders` no se pudo confirmar
// contra la API real hoy (la única orden de prueba se mandó a un nivel
// deliberadamente inalcanzable para no arriesgar dinero, y Capital.com la
// RECHAZÓ antes de que llegara a aparecer aquí — ver el hallazgo del
// 2026-09-17). `dealIdOf` cubre las 3 formas más probables (documentación
// pública + el mismo patrón que sí se confirmó en /positions:
// `{position:{...}}`); si ninguna calza, `reconcile` lo loguea completo para
// poder ajustarlo con el primer caso real.
function dealIdOf(workingOrderEntry) {
    return workingOrderEntry?.workingOrder?.dealId
        ?? workingOrderEntry?.workingOrderData?.dealId
        ?? workingOrderEntry?.dealId
        ?? null
}

async function getWorkingOrders() {
    const json = await apiFetch('api/v1/workingorders')
    return Array.isArray(json?.workingOrders) ? json.workingOrders : []
}

async function getConfirmation(dealReference) {
    return apiFetch(`api/v1/confirms/${dealReference}`)
}

// FOREX_BOT_DRY_RUN=1 — modo de prueba: hace TODO el análisis real (velas,
// señales, margen, reconciliación contra la cuenta real) pero NUNCA manda la
// orden real, solo la loguea. Usado para validar el pipeline completo sin
// arriesgar dinero antes de dejarlo corriendo de verdad — ver el mensaje al
// usuario del 2026-09-17 (el bloqueo del sandbox a "Real-World Transactions"
// al probar esto por Bash directo es la señal correcta: la ejecución real
// debe decidirla quien corre el script, no quien lo escribe).
const DRY_RUN = process.env.FOREX_BOT_DRY_RUN === '1'

// Abre la posición YA, al precio de mercado actual — a diferencia de una
// orden LIMIT (api/v1/workingorders con `level`/`type`), acá no se manda
// `level` ni `type`: Capital.com la ejecuta de inmediato contra el precio
// vigente (con el slippage normal de una orden a mercado) en vez de esperar
// a que el precio TOQUE un nivel específico. `level` sigue calculándose en
// runCycle() como referencia para el log/estado, pero el precio real de
// llenado es el que devuelve /confirms (ver `confirmation?.level` en el
// call site).
async function placeMarketOrder({ epic, direction, size, stopLevel, profitLevel }) {
    if (DRY_RUN) {
        log('warn', `[DRY RUN] NO se mandó ninguna orden real — hubiera sido: ${direction} ${size} ${epic} a mercado (SL ${stopLevel}, TP ${profitLevel})`)
        return { dealReference: `dryrun-${Date.now()}` }
    }
    return apiFetch('api/v1/positions', {
        method: 'POST',
        body: { epic, direction, size, stopLevel, profitLevel },
    })
}

async function cancelWorkingOrder(dealId) {
    return apiFetch(`api/v1/workingorders/${dealId}`, { method: 'DELETE' })
}

// Margen en USD que exige `size` unidades de la divisa BASE del par, al
// precio `entryPrice`, con el `marginFactor` (fracción) real del instrumento
// — CORRIGE un error que sí tenía el modelo de capital del backtest
// (app/lib/forexCapital.js): ahí se asumía que "precio × marginFactor" daba
// directamente el margen en USD para CUALQUIER par, lo cual es cierto solo
// cuando la divisa de COTIZACIÓN es USD (EURUSD, GBPUSD, AUDUSD). Cuando la
// divisa BASE ya es USD (USDJPY, USDCHF) el precio no debe multiplicarse en
// absoluto (100 USD de nocional son 100 USD, sin conversión). Cuando NINGUNA
// de las dos es USD (GBPJPY: base=GBP, cotización=JPY) hay que convertir la
// divisa base a USD con SU PROPIA tasa (GBP/USD), no con la cotización
// GBP/JPY del par que se está operando — verificado con datos reales el
// 2026-09-17: con la fórmula vieja, el margen "mínimo" de GBPJPY salía en
// ~$694 (imposible con $10), cuando el margen real es ~$4.45 (igual que
// GBPUSD, mismo tamaño de la misma divisa base).
function marginUsdFor(baseCcy, size, entryPrice, marginFactor, gbpUsdRate) {
    if (baseCcy === 'USD') return size * marginFactor
    if (baseCcy === 'GBP' && gbpUsdRate != null) return size * gbpUsdRate * marginFactor
    // EUR/GBP/AUD contra USD directo: `entryPrice` YA es la tasa base/USD.
    return size * entryPrice * marginFactor
}

// Precio medio de mercado a partir del objeto `market` que acompaña cada
// entrada de /positions ({ position, market }) — a diferencia de midPrice()
// (arriba, pensada para velas históricas con bid/ask), el snapshot en vivo de
// Capital.com nombra el lado vendedor `offer` en vez de `ask`; se prueban
// ambos nombres a propósito (sin confirmación 100% contra la API real, ver
// nota de dealIdOf() más arriba) para que, si el nombre real fuera distinto,
// esto devuelva null en vez de un precio inventado — el precio de salida
// simplemente se muestra como "no disponible" en vez de mostrar un dato falso.
function positionMidPrice(market) {
    if (!market) return null
    const bid = parseFloat(market.bid)
    const ask = parseFloat(market.offer ?? market.ask)
    if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2
    return Number.isFinite(bid) ? bid : Number.isFinite(ask) ? ask : null
}

function roundToTick(price, tickSize) {
    if (!tickSize) return price
    return Math.round(price / tickSize) * tickSize
}

// ── Reconciliación: sincroniza el estado local contra la cuenta REAL ───────
// Nunca decide con lo que el bot "cree" que pasó — siempre confirma contra
// /positions y /workingorders antes de actuar. Detecta 3 transiciones:
// orden pendiente que se LLENÓ (ya es una posición real) o se CANCELÓ/
// rechazó (ya no está en ninguna de las dos listas); posición abierta que se
// CERRÓ (ya no está en /positions).
async function reconcile(state, realPositions, realWorkingOrders) {
    // Se guarda la entrada completa ({ position, market }), no solo
    // `.position`, para poder leer también el precio de mercado en vivo
    // (`market`) al refrescar `lastKnownPrice` más abajo — antes solo se
    // quedaba con `.position` y se perdía el precio, dejando "precio de
    // salida" imposible de aproximar al cerrarse la posición.
    const positionByDealId = new Map(realPositions.map(p => [p.position.dealId, p]))
    for (const w of realWorkingOrders) {
        if (dealIdOf(w) == null) log('warn', `workingOrder con forma desconocida, ajustar dealIdOf(): ${JSON.stringify(w)}`)
    }
    const workingByDealId = new Map(realWorkingOrders.map(w => [dealIdOf(w), w]))

    // Órdenes pendientes: ¿ya son una posición? ¿ya no están en ningún lado?
    for (let i = state.pendingOrders.length - 1; i >= 0; i--) {
        const po = state.pendingOrders[i]
        if (positionByDealId.has(po.dealId) || positionByDealId.has(po.workingOrderId)) {
            const pos = (positionByDealId.get(po.dealId) ?? positionByDealId.get(po.workingOrderId)).position
            state.pendingOrders.splice(i, 1)
            state.openPositions.push({ ...po, dealId: pos.dealId, lastKnownUpl: pos.upl ?? 0, openedAt: new Date().toISOString() })
            pushLog(state, 'info', `${po.symbol}: orden LLENADA — posición real abierta (dealId ${pos.dealId})`)
            continue
        }
        if (!workingByDealId.has(po.dealId)) {
            // Ya no está pendiente ni es posición — se canceló, se rechazó, o venció
            // (con órdenes a mercado esto normalmente significa que el confirms del
            // ciclo anterior no llegó claro y, al revisar de nuevo, resultó rechazada).
            state.pendingOrders.splice(i, 1)
            pushLog(state, 'warn', `${po.symbol}: la orden ya no existe (cancelada/rechazada/vencida) — se descarta del seguimiento`)
            continue
        }
        // Sigue pendiente (esto ya solo debería pasar con una orden límite vieja
        // de antes de este cambio — una orden a mercado se resuelve en el mismo
        // ciclo) — ¿ya se puso vieja?
        const ageHours = (Date.now() - new Date(po.placedAt).getTime()) / 3_600_000
        if (ageHours > STALE_ORDER_HOURS) {
            try {
                await cancelWorkingOrder(po.dealId)
                pushLog(state, 'info', `${po.symbol}: orden cancelada por vieja (${ageHours.toFixed(1)}h sin llenarse)`)
            } catch (e) {
                pushLog(state, 'error', `${po.symbol}: no se pudo cancelar la orden vieja — ${e.message}`)
            }
            state.pendingOrders.splice(i, 1)
        }
    }

    // Posiciones abiertas: ¿siguen abiertas? Si no, se cerraron — el P&L
    // realizado se aproxima con el último `upl` observado (el P&L flotante
    // del ciclo anterior, el más reciente disponible sin golpear un
    // endpoint más de historial) — simplificación explícita, documentada.
    // Lo mismo para `lastKnownPrice`: es el precio de mercado del último
    // ciclo en que la posición seguía abierta (hasta 5 min de rezago), NO el
    // precio exacto de cierre real — Capital.com no confirma un precio de
    // cierre exacto por este camino (ver positionMidPrice más arriba), así
    // que se usa como la mejor aproximación disponible sin pegarle a un
    // endpoint de historial sin verificar contra la API real.
    for (let i = state.openPositions.length - 1; i >= 0; i--) {
        const op = state.openPositions[i]
        const real = positionByDealId.get(op.dealId)
        if (real) {
            op.lastKnownUpl = real.position.upl ?? op.lastKnownUpl
            op.lastKnownPrice = positionMidPrice(real.market) ?? op.lastKnownPrice
            continue
        }
        state.openPositions.splice(i, 1)
        const pnl = op.lastKnownUpl ?? 0
        state.trades.push({
            symbol: op.symbol, dealId: op.dealId, isBull: op.isBull,
            entry: op.entry, sl: op.sl, tp: op.tp, size: op.size, margin: op.margin ?? null,
            exitPrice: op.lastKnownPrice ?? null,
            openedAt: op.openedAt, closedAt: new Date().toISOString(),
            outcome: pnl >= 0 ? 'win' : 'loss', pnl,
        })
        pushLog(state, 'info', `${op.symbol}: posición cerrada — ${pnl >= 0 ? 'GANADORA' : 'PERDEDORA'} (P&L≈$${pnl.toFixed(2)})`)
    }
}

// ── Candelas: descarga completa una vez, incremental después (por par) ─────
const candleCache = {} // { [symbol]: { m5: [...], h4: [...] } } — en memoria, se pierde si el proceso reinicia (se re-descarga solo)

async function refreshCandles(symbol) {
    const nowMs = Date.now()
    let entry = candleCache[symbol]
    if (!entry) {
        const m5 = await fetchKlinesRange(symbol, 'MINUTE_5', nowMs - M5_LOOKBACK_DAYS * 86_400_000, nowMs, 3)
        const h4 = await fetchKlinesRange(symbol, 'HOUR_4', nowMs - H4_LOOKBACK_DAYS * 86_400_000, nowMs, 150)
        entry = { m5, h4 }
        candleCache[symbol] = entry
        log('info', `${symbol}: histórico inicial descargado — M5=${m5.length} H4=${h4.length}`)
        return entry
    }

    // Incremental: solo lo nuevo desde la última vela conocida, más un
    // pequeño solape (2 velas) por si la última que teníamos no había
    // cerrado todavía cuando se pidió.
    const lastM5 = entry.m5[entry.m5.length - 1]?.openTime ?? (nowMs - M5_LOOKBACK_DAYS * 86_400_000)
    const lastH4 = entry.h4[entry.h4.length - 1]?.openTime ?? (nowMs - H4_LOOKBACK_DAYS * 86_400_000)
    const newM5 = await fetchKlinesRange(symbol, 'MINUTE_5', lastM5 - 2 * 300_000, nowMs, 3)
    const newH4 = await fetchKlinesRange(symbol, 'HOUR_4', lastH4 - 2 * HTF_INTERVAL_MS, nowMs, 150)

    const mergeByTime = (oldArr, newArr, maxAgeMs) => {
        const byTime = new Map(oldArr.map(c => [c.openTime, c]))
        for (const c of newArr) byTime.set(c.openTime, c)
        const cutoff = nowMs - maxAgeMs
        return [...byTime.values()].filter(c => c.openTime >= cutoff).sort((a, b) => a.openTime - b.openTime)
    }
    entry.m5 = mergeByTime(entry.m5, newM5, M5_LOOKBACK_DAYS * 86_400_000)
    entry.h4 = mergeByTime(entry.h4, newH4, H4_LOOKBACK_DAYS * 86_400_000)
    return entry
}

// ── Un ciclo completo: reconciliar, y si hay cupo/capital, buscar señales ──
async function runCycle(circuitBreaker) {
    const state = await readState()

    let account
    try {
        account = await getAccount()
    } catch (e) {
        log('error', `No se pudo leer la cuenta — ciclo abortado: ${e.message}`)
        return circuitBreaker
    }

    if (circuitBreaker.initialBalance == null) circuitBreaker.initialBalance = account.balance
    const breakerTripped = account.balance < circuitBreaker.initialBalance * CIRCUIT_BREAKER_RATIO
    if (breakerTripped && !circuitBreaker.wasTripped) {
        log('error', `CIRCUIT BREAKER: balance ($${account.balance.toFixed(2)}) cayó debajo del ${(CIRCUIT_BREAKER_RATIO*100)}% del balance inicial ($${circuitBreaker.initialBalance.toFixed(2)}) — se detiene la apertura de operativas nuevas.`)
    }
    circuitBreaker.wasTripped = breakerTripped

    let realPositions, realWorkingOrders
    try {
        [realPositions, realWorkingOrders] = await Promise.all([getPositions(), getWorkingOrders()])
    } catch (e) {
        log('error', `No se pudo leer posiciones/órdenes — ciclo abortado: ${e.message}`)
        return circuitBreaker
    }

    await updateState(async s => {
        await reconcile(s, realPositions, realWorkingOrders)

        // Snapshot diario de capital (una vez por día, para las gráficas 7/30/90 días y el reporte semanal).
        const today = new Date().toISOString().slice(0, 10)
        if (!s.dailyCapital.length || s.dailyCapital[s.dailyCapital.length - 1].date !== today) {
            s.dailyCapital.push({ date: today, balance: account.balance })
        } else {
            s.dailyCapital[s.dailyCapital.length - 1].balance = account.balance // refresca el último del día
        }
        if (s.dailyCapital.length > 400) s.dailyCapital = s.dailyCapital.slice(-400)

        s.circuitBreaker = { initialBalance: circuitBreaker.initialBalance, tripped: breakerTripped }
        s.lastRunAt = new Date().toISOString()
        return s
    })

    // El cupo se cuenta contra la cuenta REAL completa (posiciones +
    // órdenes pendientes), no solo lo que el bot mismo abrió — hallazgo del
    // 2026-09-17: la cuenta ya tenía una posición manual abierta (EURUSD)
    // que el bot no conocía; contar solo lo propio hubiera dejado que el
    // bot abriera una SEGUNDA operativa encima de esa, rompiendo el límite
    // de "máximo 1 a la vez" que es precisamente lo que evita que $10 se
    // comprometan de más. El chequeo de margen disponible (`available`) ya
    // protegía contra quedarse sin margen, pero no contra tener más
    // operativas simultáneas de las que el capital debería permitir.
    const concurrentCount = realPositions.length + realWorkingOrders.length
    const maxConcurrentPositions = (await readState()).maxConcurrentPositions ?? DEFAULT_MAX_CONCURRENT_POSITIONS
    if (breakerTripped) { log('warn', 'Circuit breaker activo — no se buscan señales nuevas este ciclo.'); return circuitBreaker }
    if (concurrentCount >= maxConcurrentPositions) { log('info', `Ya hay ${concurrentCount} operativa(s) real(es) abierta(s)/pendiente(s) en la cuenta (propias o no) — cupo lleno (máx ${maxConcurrentPositions}), no se buscan señales nuevas.`); return circuitBreaker }

    // Un solo cupo global: se busca par por par, en orden, y se toma la
    // PRIMERA señal fresca que aparezca — si una la ocupa, los demás pares
    // de este mismo ciclo ya no tienen cupo (se revisa de nuevo el próximo ciclo).
    for (const symbol of PAIRS) {
        const stateNow = await readState()
        if (!stateNow.pairs[symbol]?.enabled) continue // apagado — no se abren operativas nuevas para este par
        const orderSize = stateNow.pairs[symbol]?.orderSize ?? DEFAULT_ORDER_SIZE

        try {
            const { m5, h4 } = await refreshCandles(symbol)
            const params = PAIR_PRESETS[symbol]
            const setups = findLiveSetups(m5, h4, HTF_INTERVAL_MS, params)
            if (!setups.length) continue

            const latest = setups[setups.length - 1]
            const lastActed = stateNow.lastActedChochTime[symbol] ?? 0
            if (latest.chochTime <= lastActed) continue // ya se atendió este mismo CHoCH antes

            // Setup demasiado viejo (el bot estuvo caído, o el ciclo se
            // saltó varias velas) — no tiene sentido perseguir un giro de
            // hace horas, se descarta sin abrir nada.
            const ageHours = (Date.now() - latest.chochTime) / 3_600_000
            if (ageHours > STALE_ORDER_HOURS) {
                await updateState(s => { s.lastActedChochTime[symbol] = latest.chochTime; return s })
                continue
            }

            const market = await fetchMarketDetails(symbol)
            if (!Number.isFinite(market.marginFactor)) { log('warn', `${symbol}: sin marginFactor, se omite esta señal`); continue }

            let gbpUsdRate = null
            if (market.baseCcy === 'GBP') {
                const gbpUsd = await fetchMarketDetails('GBPUSD')
                gbpUsdRate = gbpUsd.bid
            }
            const requiredMargin = marginUsdFor(market.baseCcy, orderSize, latest.entry, market.marginFactor, gbpUsdRate)
            const acctNow = await getAccount()
            if (requiredMargin > acctNow.available) {
                log('warn', `${symbol}: setup encontrado pero falta margen (necesita $${requiredMargin.toFixed(2)}, disponible $${acctNow.available.toFixed(2)}) — se omite.`)
                await updateState(s => { s.lastActedChochTime[symbol] = latest.chochTime; return s })
                continue
            }

            const level = roundToTick(latest.entry, market.tickSize)
            const stopLevel = roundToTick(latest.sl, market.tickSize)
            const profitLevel = roundToTick(latest.tp1, market.tickSize)
            const direction = latest.isBull ? 'BUY' : 'SELL'

            log('info', `${symbol}: señal nueva (${direction}) entry≈${level} sl=${stopLevel} tp=${profitLevel} rr=${latest.rr.toFixed(2)} — mandando orden A MERCADO real por ${orderSize} unidades (margen≈$${requiredMargin.toFixed(2)})`)
            const order = await placeMarketOrder({ epic: symbol, direction, size: orderSize, stopLevel, profitLevel })
            const confirmation = DRY_RUN ? null : await getConfirmation(order.dealReference).catch(() => null)
            const accepted = !DRY_RUN && (confirmation?.dealStatus === 'ACCEPTED' || confirmation == null) // sin confirmación clara, se asume aceptada y se reconcilia en el próximo ciclo

            await updateState(s => {
                s.lastActedChochTime[symbol] = latest.chochTime // se marca atendido incluso en dry-run, para no repetir la misma señal cada ciclo de prueba
                if (DRY_RUN) {
                    pushLog(s, 'info', `[DRY RUN] ${symbol}: señal detectada, orden NO enviada de verdad (${direction} ${orderSize} @ ${level}, SL ${stopLevel}, TP ${profitLevel})`)
                } else if (accepted) {
                    // Entra a pendingOrders igual que antes (no directo a openPositions):
                    // reconcile() ya sabe promover pendingOrders -> openPositions en cuanto
                    // aparece en /positions (el próximo ciclo, ~5 min), y ese mismo camino
                    // cubre el caso "confirmation == null" sin duplicar lógica. Con una orden
                    // a mercado esto se resuelve casi siempre en el ciclo siguiente (se llena
                    // al toque), a diferencia de una LIMIT que podía tardar horas.
                    s.pendingOrders.push({
                        symbol, dealId: confirmation?.dealId ?? order.dealReference, dealReference: order.dealReference,
                        isBull: latest.isBull, entry: confirmation?.level ?? level, sl: stopLevel, tp: profitLevel, size: orderSize,
                        margin: requiredMargin,
                        placedAt: new Date().toISOString(), chochTime: latest.chochTime,
                    })
                    pushLog(s, 'info', `${symbol}: orden a mercado real colocada (${direction} ${orderSize} ≈@ ${confirmation?.level ?? level}, SL ${stopLevel}, TP ${profitLevel})`)
                } else {
                    pushLog(s, 'error', `${symbol}: la orden fue RECHAZADA por Capital.com — ${confirmation?.reason ?? 'sin detalle'}`)
                }
                return s
            })
            break // cupo (único) ya usado este ciclo
        } catch (e) {
            log('error', `${symbol}: error en el ciclo de análisis — ${e.message}`)
        }
    }

    return circuitBreaker
}

async function main() {
    log('info', `Bot de Confluencia Forex iniciado — ciclo cada ${CYCLE_MS / 60_000} min, contra ${BASE_URL}`)
    const circuitBreaker = { initialBalance: null, wasTripped: false }
    // Primer ciclo inmediato, luego cada CYCLE_MS.
    const tick = async () => {
        try { await runCycle(circuitBreaker) }
        catch (e) { log('error', `Ciclo falló por completo (se reintenta el próximo): ${e.message}`) }
    }
    await tick()
    setInterval(tick, CYCLE_MS)
}

process.on('unhandledRejection', (err) => log('error', `Rechazo no manejado: ${err?.message ?? err}`))

main()
