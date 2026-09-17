import { NextResponse } from 'next/server'

// ─── Proxy autenticado hacia la API REST de Capital.com ─────────────────────
// Mismo propósito que app/api/bitunix/[...path]/route.js (mantener las
// credenciales en el servidor, el cliente solo habla con /api/capital/...),
// pero el esquema de autenticación de Capital.com es distinto al de Bitunix:
// no es un HMAC por request, es una SESIÓN — hay que hacer login una vez
// (POST /api/v1/session con X-CAP-API-KEY + identifier/password) y Capital.com
// regresa dos headers (CST, X-SECURITY-TOKEN) que hay que reenviar en cada
// request subsecuente. Esos tokens expiran a los 10 minutos de INACTIVIDAD
// (no de creación) — se cachean en memoria del proceso (igual de "un solo
// servidor, sin estado compartido" que el resto de esta app) y se renuevan
// solos si ya pasaron ~9 min o si el upstream responde 401.
//
// CAPITAL_IDENTIFIER: correo/usuario de la cuenta Capital.com — pendiente de
// configurar (ver .env.local). Sin él el login falla con 400/401 y esta ruta
// devuelve el error de Capital.com tal cual para que se note de inmediato.
const CAPITAL_API_KEY    = process.env.CAPITAL_API_KEY
const CAPITAL_IDENTIFIER = process.env.CAPITAL_IDENTIFIER
const CAPITAL_PASSWORD   = process.env.CAPITAL_PASSWORD
const CAPITAL_BASE       = process.env.CAPITAL_BASE || 'https://api-capital.backend-capital.com' // LIVE — no hay cuenta demo configurada

// Respaldo del `cache: 'no-store'` de cada fetch individual (ver `forward`):
// esto evita que Next.js optimice/cachee esta ruta como estática entre
// builds/despliegues. Esta ruta SIEMPRE debe golpear a Capital.com en vivo.
export const dynamic = 'force-dynamic'

// Medido contra la API real de Capital.com pidiendo velas de 1H: la latencia
// es bastante variable (2s a >15s de un request a otro, sin patrón claro —
// probablemente throttling del lado de Capital.com), así que 15s se quedaba
// corto y tronaba con "aborted due to timeout" en varios pares. 40s da margen
// de sobra sobre lo peor medido (~15s) sin dejar la ruta colgada indefinidamente.
const FETCH_TIMEOUT_MS  = 40_000
const SESSION_MAX_AGE_MS = 9 * 60_000 // margen bajo los 10 min de inactividad que documenta Capital.com

// Cache de sesión en memoria del proceso. `sessionPromise` evita que ráfagas
// de requests en paralelo (el backtest pide muchos chunks de velas a la vez)
// disparen logins duplicados — todas esperan la MISMA promesa de login.
let session = null // { cst, securityToken, obtainedAt }
let sessionPromise = null

async function login() {
    if (!CAPITAL_API_KEY || !CAPITAL_IDENTIFIER || !CAPITAL_PASSWORD) {
        throw new Error('Faltan credenciales de Capital.com: revisa CAPITAL_API_KEY / CAPITAL_IDENTIFIER / CAPITAL_PASSWORD en .env.local')
    }
    const res = await fetch(`${CAPITAL_BASE}/api/v1/session`, {
        method: 'POST',
        headers: { 'X-CAP-API-KEY': CAPITAL_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: CAPITAL_IDENTIFIER, password: CAPITAL_PASSWORD, encryptedPassword: false }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const cst = res.headers.get('cst')
    const securityToken = res.headers.get('x-security-token')
    if (!res.ok || !cst || !securityToken) {
        const body = await res.text().catch(() => '')
        throw new Error(`Login Capital.com falló (HTTP ${res.status}): ${body || 'sin CST/X-SECURITY-TOKEN en la respuesta'}`)
    }
    session = { cst, securityToken, obtainedAt: Date.now() }
    return session
}

async function getSession(forceRefresh = false) {
    if (!forceRefresh && session && (Date.now() - session.obtainedAt) < SESSION_MAX_AGE_MS) return session
    if (!sessionPromise) sessionPromise = login().finally(() => { sessionPromise = null })
    return sessionPromise
}

async function forward(request, { path }) {
    const segments   = path || []
    const targetPath = '/' + segments.join('/')
    const url         = new URL(request.url)
    const targetUrl   = `${CAPITAL_BASE}${targetPath}${url.search}`

    const method = request.method
    const rawBody = (method === 'POST' || method === 'PUT') ? await request.text() : undefined

    let sess
    try {
        sess = await getSession()
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 502 })
    }

    // `cache: 'no-store'` es OBLIGATORIO aquí: Next.js 14 cachea por defecto
    // (Data Cache) cualquier `fetch` GET indefinidamente, usando la URL
    // completa (con querystring) como llave — así que sin esto, un chunk de
    // velas pedido con un `from`/`to` exacto queda pegado para siempre con la
    // respuesta de la PRIMERA vez que se pidió esa URL en este proceso, sin
    // volver a consultar a Capital.com. Eso es especialmente grave con velas
    // recientes: si la vela más nueva del chunk todavía no cerraba en ese
    // primer request, su high/low quedan cacheados incompletos y todas las
    // corridas futuras del backtest ven ese valor viejo/incorrecto en vez del
    // precio real y ya cerrado. Encontrado al confirmar que una operativa
    // reportada por el usuario tenía una entrada (211.506) que el precio real
    // JAMÁS alcanzó en la ventana de esa vela — el precio fresco de Capital.com
    // para ese mismo timestamp era ~211.05.
    const doFetch = (s) => fetch(targetUrl, {
        method,
        cache: 'no-store',
        headers: {
            'X-CAP-API-KEY'   : CAPITAL_API_KEY,
            'CST'             : s.cst,
            'X-SECURITY-TOKEN': s.securityToken,
            'Content-Type'    : 'application/json',
            'Accept'          : 'application/json',
        },
        body: rawBody,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    try {
        let res = await doFetch(sess)
        // Token vencido/inválido (401) a media corrida (backtest largo) — un
        // solo reintento con sesión fresca antes de rendirse.
        if (res.status === 401) {
            sess = await getSession(true)
            res = await doFetch(sess)
        }
        const data = await res.json().catch(() => null)
        return NextResponse.json(data, { status: res.status })
    } catch (err) {
        return NextResponse.json({ error: err.message, url: targetUrl }, { status: 502 })
    }
}

export async function GET(request, { params })  { return forward(request, params) }
export async function POST(request, { params }) { return forward(request, params) }
