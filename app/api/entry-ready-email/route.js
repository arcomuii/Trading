export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer       from 'nodemailer';

export async function POST(request) {
    try {
        const {
            coinName, symbol, image, price,
            patternLabel, direction,
            entry, stopLoss, takeProfit, riskReward,
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

        const isBull = direction === 'LONG';
        const color  = isBull ? '#22c55e' : '#ef4444';
        const emoji  = isBull ? '↑' : '↓';
        const sym    = (symbol || '').toUpperCase();

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
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:${color};padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,.85);text-transform:uppercase;">
              🎯 Momento óptimo de entrada
            </p>
            <p style="margin:8px 0 0;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">
              ${emoji} ${direction} · ${sym}
            </p>
            ${patternLabel ? `<p style="margin:4px 0 0;font-size:13px;font-weight:600;color:rgba(255,255,255,.85);">${patternLabel}</p>` : ''}
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
                  <p style="margin:0;font-size:20px;font-weight:800;color:#111;">${coinName ?? sym}</p>
                  <p style="margin:3px 0 0;font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;">${sym}</p>
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <p style="margin:0;font-size:20px;font-weight:800;color:#111;font-family:monospace;">${fmtPrice(price)}</p>
                  <p style="margin:3px 0 0;font-size:12px;color:#888;">Precio actual</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Entry / TP / SL -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px;">
              <tr>
                <td style="background:#eef2ff;border-radius:10px;padding:16px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.8px;">Entrada</p>
                  <p style="margin:8px 0 0;font-size:18px;font-weight:900;color:#4338ca;font-family:monospace;">${fmtPrice(entry)}</p>
                </td>
                <td style="background:#f0fdf4;border-radius:10px;padding:16px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.8px;">Take Profit</p>
                  <p style="margin:8px 0 0;font-size:18px;font-weight:900;color:#15803d;font-family:monospace;">${fmtPrice(takeProfit)}</p>
                </td>
                <td style="background:#fef2f2;border-radius:10px;padding:16px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.8px;">Stop Loss</p>
                  <p style="margin:8px 0 0;font-size:18px;font-weight:900;color:#b91c1c;font-family:monospace;">${fmtPrice(stopLoss)}</p>
                </td>
              </tr>
            </table>
            <p style="margin:10px 0 0;text-align:center;font-size:13px;font-weight:700;color:#374151;">
              R:R 1:${riskReward != null ? Number(riskReward).toFixed(1) : '—'}
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;margin-top:20px;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Trading Signals · Monitoreo cada 5 min de señales confirmadas
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
            subject: `🎯 Entrada óptima · ${sym} — ${patternLabel ?? direction}`,
            html,
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('Entry-ready email error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
