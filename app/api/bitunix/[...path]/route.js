import { createHash }        from 'crypto'
import { request as httpConn } from 'http'
import { request as httpsReq } from 'https'
import { NextResponse }        from 'next/server'

const BITUNIX_API_KEY      = process.env.BITUNIX_API_KEY || 'e6aea4343b38c0568e524558020afbe2'
const BITUNIX_SECRET       = process.env.BITUNIX_SECRET  || 'fb29ee282e536d6dc05a7c3fa7479146'
const BITUNIX_FUTURES_BASE = 'https://fapi.bitunix.com'
const BITUNIX_SPOT_BASE    = 'https://openapi.bitunix.com'
const PROXY_URL            = process.env.FIXIE_URL || 'http://fixie:1MX93MVBcmRdcIH@criterium.usefixie.com:80'

// Realiza una petición HTTPS a través de un proxy HTTP (túnel CONNECT)
function proxyFetch(targetUrl, headers) {
  return new Promise((resolve, reject) => {
    const proxy  = new URL(PROXY_URL)
    const target = new URL(targetUrl)
    const auth   = Buffer.from(
      `${proxy.username}:${decodeURIComponent(proxy.password)}`
    ).toString('base64')

    // 1. Abrir túnel CONNECT con el proxy
    const tunnel = httpConn({
      host   : proxy.hostname,
      port   : parseInt(proxy.port) || 80,
      method : 'CONNECT',
      path   : `${target.hostname}:443`,
      headers: {
        'Host'               : target.hostname,
        'Proxy-Authorization': `Basic ${auth}`,
      },
    })

    tunnel.once('connect', (_res, socket) => {
      // 2. Petición HTTPS sobre el túnel
      httpsReq({
        host   : target.hostname,
        path   : target.pathname + target.search,
        method : 'GET',
        headers,
        socket,
        agent  : false,
      }, res => {
        const chunks = []
        res.on('data',  c  => chunks.push(c))
        res.on('end',   ()  => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString())
            resolve({ status: res.statusCode, data })
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`))
          }
        })
        res.on('error', reject)
      }).on('error', reject).end()
    })

    tunnel.once('error', reject)
    tunnel.end()
  })
}

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
    const { status, data } = await proxyFetch(targetUrl, headers)
    return NextResponse.json(data, { status })
  } catch (err) {
    return NextResponse.json({ error: err.message, url: targetUrl }, { status: 502 })
  }
}
