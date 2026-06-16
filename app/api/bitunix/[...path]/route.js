import { createHash } from 'crypto'
import { NextResponse } from 'next/server'

const BITUNIX_API_KEY      = process.env.BITUNIX_API_KEY || 'e6aea4343b38c0568e524558020afbe2'
const BITUNIX_SECRET       = process.env.BITUNIX_SECRET  || 'fb29ee282e536d6dc05a7c3fa7479146'
const BITUNIX_FUTURES_BASE = 'https://fapi.bitunix.com'
const BITUNIX_SPOT_BASE    = 'https://openapi.bitunix.com'

export async function GET(request, { params }) {
  const segments   = params.path || []
  const targetPath = '/' + segments.join('/')

  const url = new URL(request.url)
  const queryParams = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('')

  const nonce     = String(Math.floor(Math.random() * 900000 + 100000))
  const timestamp = String(Date.now())
  const body      = ''

  const digest    = createHash('sha256').update(nonce + timestamp + BITUNIX_API_KEY + queryParams + body).digest('hex')
  const signature = createHash('sha256').update(digest + BITUNIX_SECRET).digest('hex')

  const base      = targetPath.startsWith('/api/spot/') ? BITUNIX_SPOT_BASE : BITUNIX_FUTURES_BASE
  const targetUrl = `${base}${targetPath}${url.search}`

  const headers = {
    'api-key'     : BITUNIX_API_KEY,
    'sign'        : signature,
    'nonce'       : nonce,
    'timestamp'   : timestamp,
    'Content-Type': 'application/json',
    'Accept'      : 'application/json',
    'User-Agent'  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  }

  try {
    const res  = await fetch(targetUrl, { headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: err.message, url: targetUrl }, { status: 502 })
  }
}

export async function POST(request, { params }) {
  const segments   = params.path || []
  const targetPath = '/' + segments.join('/')

  const url         = new URL(request.url)
  const rawBody     = await request.text()
  const queryParams = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('')

  const nonce     = String(Math.floor(Math.random() * 900000 + 100000))
  const timestamp = String(Date.now())

  const digest    = createHash('sha256').update(nonce + timestamp + BITUNIX_API_KEY + queryParams + rawBody).digest('hex')
  const signature = createHash('sha256').update(digest + BITUNIX_SECRET).digest('hex')

  const base      = targetPath.startsWith('/api/spot/') ? BITUNIX_SPOT_BASE : BITUNIX_FUTURES_BASE
  const targetUrl = `${base}${targetPath}${url.search}`

  const headers = {
    'api-key'     : BITUNIX_API_KEY,
    'sign'        : signature,
    'nonce'       : nonce,
    'timestamp'   : timestamp,
    'Content-Type': 'application/json',
    'Accept'      : 'application/json',
    'User-Agent'  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  }

  try {
    const res  = await fetch(targetUrl, { method: 'POST', headers, body: rawBody })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: err.message, url: targetUrl }, { status: 502 })
  }
}
