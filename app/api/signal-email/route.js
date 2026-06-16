export const runtime = 'nodejs'; // Nodemailer requiere runtime Node.js, no Edge

import { NextResponse } from 'next/server';
import nodemailer       from 'nodemailer';

export async function POST(request) {
    try {
        const { coinName, symbol, direction, price, adx, stochK, stochZone, trendDir, image } =
            await request.json();

        // Crear transporter dentro del handler evita problemas de bundling
        const transporter = nodemailer.createTransport({
            host:   'smtp.gmail.com',
            port:   465,
            secure: true,
            auth: {
                user: process.env.SMTP_USER || 'arcomuii@gmail.com',
                pass: process.env.SMTP_PASS || 'rlqnxrnzgkbbosic',
            },
            tls: { rejectUnauthorized: false },
        });

        // Verificar conexión antes de enviar
        await transporter.verify();

        const isLong  = direction === 'LONG';
        const emoji   = isLong ? '▲' : '▼';
        const color   = isLong ? '#22c55e' : '#ef4444';
        const darkClr = isLong ? '#16a34a' : '#dc2626';

        const fmtPrice = (p) => {
            if (!p) return '—';
            return p < 1
                ? `$${Number(p).toFixed(5)}`
                : `$${Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:${color};padding:28px 32px;text-align:center;">
            <p style="margin:0;font-size:14px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,.8);text-transform:uppercase;">
              Señal confirmada de entrada
            </p>
            <p style="margin:10px 0 0;font-size:42px;font-weight:900;color:#fff;line-height:1;">
              ${emoji} ${direction}
            </p>
          </td>
        </tr>

        <!-- Coin info -->
        <tr>
          <td style="padding:28px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;width:52px;">
                  ${image ? `<img src="${image}" width="48" height="48" style="border-radius:50%;display:block;" />` : ''}
                </td>
                <td style="vertical-align:middle;padding-left:14px;">
                  <p style="margin:0;font-size:20px;font-weight:800;color:#111;">${coinName}</p>
                  <p style="margin:3px 0 0;font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;">${symbol}</p>
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <p style="margin:0;font-size:22px;font-weight:800;color:#111;font-family:monospace;">${fmtPrice(price)}</p>
                  <p style="margin:3px 0 0;font-size:12px;color:#888;">Precio actual</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Indicators -->
        <tr>
          <td style="padding:20px 32px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px;">
              <tr>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">ADX</p>
                  <p style="margin:6px 0 2px;font-size:22px;font-weight:900;color:#6366f1;">${adx ?? '—'}</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;">Tendencia fuerte</p>
                </td>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Estoc. 14,3,3</p>
                  <p style="margin:6px 0 2px;font-size:22px;font-weight:900;color:${darkClr};">${stochK ?? '—'}</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;">${stochZone ?? ''}</p>
                </td>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Tendencia</p>
                  <p style="margin:6px 0 2px;font-size:22px;font-weight:900;color:${darkClr};">${isLong ? '▲' : '▼'}</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;">${trendDir ?? direction}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Trading Signals · Análisis técnico 4H · EMA-50 · ADX · Squeeze · Estocástico
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

        await transporter.sendMail({
            from:    `"Trading Signals" <arcomuii@gmail.com>`,
            to:      'arcomuii@hotmail.com, arcomuii@gmail.com, arcomuii@proton.me',
            subject: `${emoji} ${direction} · ${symbol.toUpperCase()} — Señal confirmada de entrada`,
            html,
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('Signal email error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
