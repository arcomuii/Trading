import { NextResponse } from 'next/server'

const BITSO_BASE = 'https://api.bitso.com'

export async function GET(request, { params }) {
  const segments   = params.path || []
  const targetPath = '/' + segments.join('/')
  const url        = new URL(request.url)
  const targetUrl  = `${BITSO_BASE}${targetPath}${url.search}`

  try {
    const upstream = await fetch(targetUrl, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    })
    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
