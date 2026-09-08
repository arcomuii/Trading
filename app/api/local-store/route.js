import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

// Espejo remoto de todo lo que la app guarda en localStorage (portafolios,
// historial de equity, config de alertas, ajustes de auto-trade, tema, etc.)
// — mismo rol que data/backtesting-log.json + app/api/backtesting/route.js,
// pero como un único objeto { [key]: value } en vez de un log append-only.
// localStorage sigue siendo la fuente de verdad para cada navegador; esto
// solo permite consultar ese estado remotamente (curl, otra máquina, etc.).
const DATA_DIR   = path.join(process.cwd(), 'data')
const STORE_FILE = path.join(DATA_DIR, 'local-store.json')

// Mismo patrón de lock que app/api/backtesting/route.js — serializa
// lecturas/escrituras dentro de este proceso para que dos requests
// concurrentes no se pisen (no hay base de datos, es un JSON plano).
let chain = Promise.resolve()
function withLock(fn) {
  const result = chain.then(fn, fn)
  chain = result.then(() => {}, () => {})
  return result
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

// Escritura atómica (archivo temporal + rename) — evita que una lectura
// concurrente encuentre el archivo truncado/corrupto.
async function writeStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpFile, JSON.stringify(store, null, 2), 'utf-8')
  await fs.rename(tmpFile, STORE_FILE)
}

// GET /api/local-store          -> todo el store: { [key]: value }
// GET /api/local-store?key=xxx  -> { key, value } (value: null si no existe)
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  const store = await withLock(readStore)
  if (key) return NextResponse.json({ key, value: key in store ? store[key] : null })
  return NextResponse.json(store)
}

// PUT /api/local-store
//   body: { key, value }        -> setea un valor (equivalente a localStorage.setItem)
//   body: { entries: {...} }    -> setea varios de una (usado en la migración inicial)
export async function PUT(request) {
  const body = await request.json()
  const { key, value, entries } = body

  if (!key && !entries) {
    return NextResponse.json({ error: 'Falta key o entries' }, { status: 400 })
  }

  await withLock(async () => {
    const store = await readStore()
    if (entries && typeof entries === 'object') Object.assign(store, entries)
    if (key) store[key] = value
    await writeStore(store)
  })

  return NextResponse.json({ ok: true })
}
