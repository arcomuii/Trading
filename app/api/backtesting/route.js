import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

const DATA_DIR  = path.join(process.cwd(), 'data')
const LOG_FILE  = path.join(DATA_DIR, 'backtesting-log.json')

// Serializa lecturas/escrituras del archivo dentro de este proceso para evitar
// que dos requests concurrentes se pisen (no hay base de datos, es un JSON plano).
let chain = Promise.resolve()
function withLock(fn) {
  const result = chain.then(fn, fn)
  chain = result.then(() => {}, () => {})
  return result
}

async function readLog() {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// Escritura atómica (archivo temporal + rename) — evita que una lectura
// concurrente (o un reinicio del dev server a medio escribir) encuentre el
// archivo truncado/corrupto. fs.rename es atómico en el mismo filesystem, así
// que un lector nunca ve un estado a medias.
async function writeLog(records) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmpFile = `${LOG_FILE}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpFile, JSON.stringify(records, null, 2), 'utf-8')
  await fs.rename(tmpFile, LOG_FILE)
}

export async function GET() {
  const records = await withLock(readLog)
  return NextResponse.json(records)
}

// Registra un nuevo hallazgo (ápice 8-10 + TP2 favorable). Si ya existe un
// registro "en_proceso" para el mismo activo, no duplica — devuelve el existente.
export async function POST(request) {
  const body = await request.json()
  const { activo, tipoPosicion, precioEntrada, stopLoss, takeProfit1, patternLabel } = body

  if (!activo || !tipoPosicion || precioEntrada == null || stopLoss == null || takeProfit1 == null) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const result = await withLock(async () => {
    const records = await readLog()
    const existing = records.find(r => r.activo === activo && r.estatus === 'en_proceso')
    if (existing) return { record: existing, duplicate: true }

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      activo,
      tipoPosicion,
      precioEntrada,
      stopLoss,
      takeProfit1,
      patternLabel: patternLabel ?? null,
      horaApertura: new Date().toISOString(),
      horaCierre: null,
      estatus: 'en_proceso',
      ultimoPrecio: precioEntrada,
    }
    records.push(record)
    await writeLog(records)
    return { record, duplicate: false }
  })

  return NextResponse.json(result.record, { status: result.duplicate ? 200 : 201 })
}

// Actualiza un registro existente (usado por el monitor de precio cada minuto
// para cerrar operaciones al tocar TP1/SL, o refrescar el último precio visto).
export async function PATCH(request) {
  const body = await request.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const result = await withLock(async () => {
    const records = await readLog()
    const idx = records.findIndex(r => r.id === id)
    if (idx === -1) return null
    records[idx] = { ...records[idx], ...updates }
    await writeLog(records)
    return records[idx]
  })

  if (!result) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })
  return NextResponse.json(result)
}
