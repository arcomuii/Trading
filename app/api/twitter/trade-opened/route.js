export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { TwitterApi }   from 'twitter-api-v2';
import path              from 'path';

// Mismo copy de referidos en cada tweet — pedido explícito, no se arma
// dinámico porque siempre es el mismo. El link en texto se reemplazó por el
// QR (QR_CODE_PATH más abajo), adjunto como imagen del tweet.
const REFERRAL_INTRO = '¿No sabes donde operar?';
const REFERRAL_TEXT = 'Únete a #Bitunix y desbloquea más de 10,000 $USDT en recompensas para nuevos usuarios';
const HASHTAGS = '#Trading #TradingCommunity #CryptoSignals #USDT #CryptoTrading #Crypto';
// process.cwd() es la raíz del proyecto tanto en `next dev` como en `next start`.
const QR_CODE_PATH = path.join(process.cwd(), 'public', 'qr-code.png');

function fmtPrice(p) {
    if (p == null) return '—';
    const n = Number(p);
    return n < 1
        ? `$${n.toFixed(5)}`
        : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Contraparte "tweet" de trade-opened-email — se llama desde
// tryAutoOpenPosition (ver app/lib/autoTrade.js) justo después de que
// placeAutoOrder confirma la orden colocada en Bitunix, con los mismos datos
// que ya se mandan por correo. `entry` es el precio LIMIT calculado por el
// patrón (levels.entry), no el de ejecución real: la orden en sí sigue
// colocándose a MERCADO (orderType: "MARKET" en placeAutoOrder) — eso no
// cambia, el tweet solo informa el nivel de entrada del patrón.
export async function POST(request) {
    let symbol, direction, entry, stopLoss, takeProfit, leverage;
    try {
        ({ symbol, direction, entry, stopLoss, takeProfit, leverage } = await request.json());
    } catch (err) {
        return NextResponse.json({ error: 'Body inválido: ' + err.message }, { status: 400 });
    }

    const client = new TwitterApi({
        appKey:       process.env.TWITTER_CONSUMER_KEY,
        appSecret:    process.env.TWITTER_CONSUMER_SECRET,
        accessToken:  process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    });

    const isBuy   = direction === 'LONG';
    const hashtag = isBuy ? '#buy' : '#sell';
    const emoji   = isBuy ? '🟢' : '🔴';

    const text = [
        `${emoji} $${symbol} ${hashtag}`,
        '',
        `Entrada (limit): ${fmtPrice(entry)}`,
        `Stop Loss: ${fmtPrice(stopLoss)}`,
        `Take Profit: ${fmtPrice(takeProfit)}`,
        `Apalancamiento: ${leverage != null ? leverage + '×' : '—'}`,
        '',
        HASHTAGS,
        '',
        REFERRAL_INTRO,
        REFERRAL_TEXT,
    ].join('\n');

    // Reintentos: el error visto en producción ("credits depleted", 402) resultó
    // ser una capacidad intermitente del plan de X, no un bug — la misma llamada
    // reintentada segundos después funcionó sin cambios. En vez de perder la
    // publicación por eso, se reintenta un par de veces con espera antes de
    // rendirse. No se reintenta indefinidamente para no acumular llamadas si el
    // problema es real (llaves inválidas, símbolo/QR corrupto, etc.).
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            // uploadMedia sigue siendo v1.1 (Twitter no migró subida de media a
            // v2) aunque el tweet en sí se publique con v2.tweet.
            const mediaId = await client.v1.uploadMedia(QR_CODE_PATH);
            const { data } = await client.v2.tweet(text, { media: { media_ids: [mediaId] } });
            return NextResponse.json({ ok: true, id: data.id, attempt });
        } catch (err) {
            lastErr = err;
            console.error(`[${new Date().toISOString()}] Trade opened tweet error (intento ${attempt}/${MAX_ATTEMPTS}):`, err.message);
            if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
        }
    }

    return NextResponse.json({ error: lastErr.message }, { status: 500 });
}
