// ─── API de la página /forex ────────────────────────────────────────────
// GET: estado del bot (operativas, log, capital diario) + snapshot de la
// cuenta REAL de Capital.com (balance/posiciones/órdenes) para mostrar en la
// página. POST: encender/apagar un par (el bot mismo lee este archivo en
// cada ciclo — ver scripts/forex-bot.mjs).
import { NextResponse } from 'next/server'
import { readState, updateState, PAIRS, MIN_MAX_CONCURRENT_POSITIONS, MAX_MAX_CONCURRENT_POSITIONS, MIN_ORDER_SIZE, MAX_ORDER_SIZE } from '../../lib/forexBotState'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function fetchAccountSnapshot(origin) {
    const headers = {}
    const [acctRes, posRes, ordRes] = await Promise.all([
        fetch(`${origin}/api/capital/api/v1/accounts`, { cache: 'no-store', headers }),
        fetch(`${origin}/api/capital/api/v1/positions`, { cache: 'no-store', headers }),
        fetch(`${origin}/api/capital/api/v1/workingorders`, { cache: 'no-store', headers }),
    ])
    const [acctJson, posJson, ordJson] = await Promise.all([acctRes.json(), posRes.json(), ordRes.json()])
    const acct = acctJson?.accounts?.find(a => a.preferred) ?? acctJson?.accounts?.[0] ?? null
    return {
        balance: acct?.balance?.balance ?? null,
        available: acct?.balance?.available ?? null,
        profitLoss: acct?.balance?.profitLoss ?? null,
        positions: Array.isArray(posJson?.positions) ? posJson.positions : [],
        workingOrders: Array.isArray(ordJson?.workingOrders) ? ordJson.workingOrders : [],
    }
}

export async function GET(request) {
    try {
        const [state, account] = await Promise.all([
            readState(),
            fetchAccountSnapshot(request.nextUrl.origin).catch(err => ({ error: err.message })),
        ])
        return NextResponse.json({ state, account, pairs: PAIRS })
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

// Dos acciones posibles en el mismo POST (según qué campos traiga el body):
//
// 1) { symbol, enabled } — enciende/apaga un par. El bot (scripts/forex-bot.mjs)
//    lee `pairs[symbol].enabled` en cada ciclo antes de buscar señales nuevas
//    para ese par; no afecta operativas ya abiertas/pendientes, que siguen
//    su curso normal hasta cerrar.
//
// 2) { maxConcurrentPositions } — pedido explícito del usuario: máximo de
//    operativas abiertas/pendientes a la vez EN TODA LA CUENTA. El bot lee
//    este valor del estado EN CADA CICLO (no es una constante fija en el
//    script), así que el cambio aplica sin reiniciar el bot ni el servicio.
//
// 3) { symbol, orderSize } — pedido explícito del usuario: volumen (unidades
//    de la divisa base) con el que el bot abre cada operativa NUEVA de ESE
//    par. El bot lee `pairs[symbol].orderSize` en cada ciclo, igual que
//    `enabled`; no afecta operativas ya abiertas/pendientes (esas ya
//    quedaron con el volumen que tenían al momento de abrirse).
export async function POST(request) {
    const body = await request.json().catch(() => null)
    const { symbol, enabled, maxConcurrentPositions, orderSize } = body || {}

    if (maxConcurrentPositions !== undefined) {
        const n = Number(maxConcurrentPositions)
        if (!Number.isInteger(n) || n < MIN_MAX_CONCURRENT_POSITIONS || n > MAX_MAX_CONCURRENT_POSITIONS) {
            return NextResponse.json({ error: `maxConcurrentPositions debe ser un entero entre ${MIN_MAX_CONCURRENT_POSITIONS} y ${MAX_MAX_CONCURRENT_POSITIONS}` }, { status: 400 })
        }
        const state = await updateState(s => { s.maxConcurrentPositions = n; return s })
        return NextResponse.json({ maxConcurrentPositions: state.maxConcurrentPositions })
    }

    if (orderSize !== undefined) {
        const n = Number(orderSize)
        if (!PAIRS.includes(symbol) || !Number.isInteger(n) || n < MIN_ORDER_SIZE || n > MAX_ORDER_SIZE) {
            return NextResponse.json({ error: `orderSize debe ser un entero entre ${MIN_ORDER_SIZE} y ${MAX_ORDER_SIZE}, con un symbol válido` }, { status: 400 })
        }
        const state = await updateState(s => {
            s.pairs[symbol] = { ...(s.pairs[symbol] || {}), orderSize: n }
            return s
        })
        return NextResponse.json({ pairs: state.pairs })
    }

    if (!PAIRS.includes(symbol) || typeof enabled !== 'boolean') {
        return NextResponse.json({ error: 'symbol/enabled inválidos' }, { status: 400 })
    }

    const state = await updateState(s => {
        s.pairs[symbol] = { ...(s.pairs[symbol] || {}), enabled }
        return s
    })
    return NextResponse.json({ pairs: state.pairs })
}
