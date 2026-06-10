import { NextResponse } from 'next/server'

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
let yahooSession = { cookie: '', crumb: '', refreshAt: 0 }

async function refreshYahooSession() {
  try {
    const fcRes    = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': YAHOO_UA }, redirect: 'follow' })
    const setCooks = fcRes.headers.getSetCookie?.() ?? [fcRes.headers.get('set-cookie') ?? '']
    const cookie   = setCooks.map(c => c.split(';')[0]).filter(Boolean).join('; ')

    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YAHOO_UA, 'Cookie': cookie },
    })
    const crumb = await crumbRes.text()
    yahooSession = { cookie, crumb, refreshAt: Date.now() + 3_600_000 }
  } catch (err) {
    console.error('[yahoo] error renovando sesión:', err.message)
  }
}

export async function GET(request, { params }) {
  if (Date.now() >= yahooSession.refreshAt) await refreshYahooSession()

  const segments   = params.path || []
  const targetPath = '/' + segments.join('/')
  const url        = new URL(request.url)
  const targetUrl  = new URL(targetPath, 'https://query1.finance.yahoo.com')
  // Forward original query params + crumb
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v))
  targetUrl.searchParams.set('crumb', yahooSession.crumb)

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: { 'User-Agent': YAHOO_UA, 'Cookie': yahooSession.cookie, 'Accept': 'application/json' },
    })
    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
