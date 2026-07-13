export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer       from 'nodemailer';

export async function POST(request) {
    try {
        const {
            coinName, symbol, image, bitunixUrl,
            direction, price, sessionHigh, sessionLow, distancePct,
        } = await request.json();

        const transporter = nodemailer.createTransport({
            host:   'smtp.gmail.com',
            port:   465,
            secure: true,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
            tls: { rejectUnauthorized: false },
        });

        await transporter.verify();

        const isHigh = direction === 'high';
        const color  = isHigh ? '#ef4444' : '#22c55e';
        const emoji  = isHigh ? '▲' : '▼';
        const label  = isHigh ? 'Cerca del máximo de sesión' : 'Cerca del mínimo de sesión';

        const fmtPrice = (p) => {
            if (p == null) return '—';
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
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:${color};padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,.85);text-transform:uppercase;">
              Sesión NY · velas 30m
            </p>
            <p style="margin:8px 0 0;font-size:26px;font-weight:900;color:#fff;line-height:1.1;">
              ${emoji} ${label}
            </p>
          </td>
        </tr>

        <!-- Coin info -->
        <tr>
          <td style="padding:24px 32px 0;">
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

        <!-- Session metrics -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px;">
              <tr>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Máximo</p>
                  <p style="margin:6px 0 0;font-size:15px;font-weight:900;color:#ef4444;font-family:monospace;">${fmtPrice(sessionHigh)}</p>
                </td>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Mínimo</p>
                  <p style="margin:6px 0 0;font-size:15px;font-weight:900;color:#22c55e;font-family:monospace;">${fmtPrice(sessionLow)}</p>
                </td>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Distancia</p>
                  <p style="margin:6px 0 0;font-size:15px;font-weight:900;color:${color};">${distancePct != null ? Number(distancePct).toFixed(2) + '%' : '—'}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Bitunix CTA -->
        ${bitunixUrl ? `
        <tr>
          <td style="padding:24px 32px 20px;text-align:center;">
            <a href="${bitunixUrl}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;background:${color};color:#fff;font-size:14px;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:10px;">
              Ver en Bitunix →
            </a>
          </td>
        </tr>` : ''}

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Trading Signals · Análisis de Mercado · Proximidad a máximos/mínimos de sesión NY (8:30–15:00 Méx)
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

        await transporter.sendMail({
            from:    `"Trading Signals" <${process.env.SMTP_USER}>`,
            to:      process.env.SMTP_TO || process.env.SMTP_USER,
            subject: `${emoji} ${label} · ${symbol.toUpperCase()}`,
            html,
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('Session alert email error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
