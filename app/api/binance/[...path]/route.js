import { NextResponse } from 'next/server'

const BINANCE_BASE = 'https://api.binance.com'

export async function GET(request, { params }) {
  const segments   = params.path || []
  const targetPath = '/' + segments.join('/')

  const url       = new URL(request.url)
  const targetUrl = `${BINANCE_BASE}${targetPath}${url.search}`

  const headers = {
    'Accept'    : 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  }

  try {
    const upstream = await fetch(targetUrl, { headers, next: { revalidate: 0 } })
    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
