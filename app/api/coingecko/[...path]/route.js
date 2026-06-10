import { NextResponse } from 'next/server'

const CG_BASE = 'https://api.coingecko.com'

export async function GET(request, { params }) {
  const segments   = params.path || []
  const targetPath = '/' + segments.join('/')

  const url       = new URL(request.url)
  const targetUrl = `${CG_BASE}${targetPath}${url.search}`

  const headers = {
    'Accept'    : 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  }
  if (process.env.CG_API_KEY) headers['x-cg-demo-api-key'] = process.env.CG_API_KEY

  try {
    const upstream = await fetch(targetUrl, { headers, next: { revalidate: 0 } })
    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
