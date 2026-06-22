export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer       from 'nodemailer';

export async function POST(request) {
    try {
        const {
            coinName, symbol, price, image,
            patternLabel, direction, bias,
            compression, daysToApex, pricePos, quality,
            condsMet, condsTotal,
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

        const isBull = bias === 'bullish';
        const isBear = bias === 'bearish';
        const color  = isBull ? '#22c55e' : isBear ? '#ef4444' : '#6366f1';
        const emoji  = isBull ? '↑' : isBear ? '↓' : '→';

        const fmtPrice = (p) => {
            if (!p) return '—';
            return p < 1
                ? `$${Number(p).toFixed(5)}`
                : `$${Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const comprPct  = compression != null ? Math.round(compression * 100) : null;
        const posPct    = pricePos    != null ? Math.round(pricePos * 100)     : null;
        const qualPct   = quality     != null ? Math.round(quality * 100)      : null;

        // Filled vs empty dots for entry conditions
        const dotsHtml = Array.from({ length: condsTotal ?? 5 }, (_, i) =>
            `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 2px;background:${i < (condsMet ?? 0) ? color : '#e5e7eb'};"></span>`
        ).join('');

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
          <td style="background:${color};padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,.8);text-transform:uppercase;">
              Patrón cerca del quiebre · 4H
            </p>
            <p style="margin:8px 0 0;font-size:30px;font-weight:900;color:#fff;line-height:1.1;">
              ${emoji} ${patternLabel ?? direction}
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

        <!-- Pattern metrics -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px;">
              <tr>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Compresión</p>
                  <p style="margin:6px 0 2px;font-size:22px;font-weight:900;color:#6366f1;">${comprPct != null ? comprPct + '%' : '—'}</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;">del canal</p>
                </td>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Ápice en</p>
                  <p style="margin:6px 0 2px;font-size:22px;font-weight:900;color:${color};">${daysToApex != null ? daysToApex + 'd' : '—'}</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;">días</p>
                </td>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Posición</p>
                  <p style="margin:6px 0 2px;font-size:22px;font-weight:900;color:#374151;">${posPct != null ? posPct + '%' : '—'}</p>
                  <p style="margin:0;font-size:10px;color:#9ca3af;">en el canal</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Entry conditions -->
        <tr>
          <td style="padding:16px 32px 24px;">
            <div style="background:#f9fafb;border-radius:10px;padding:14px 16px;text-align:center;">
              <p style="margin:0 0 8px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">
                Condiciones de entrada
              </p>
              <div style="margin-bottom:6px;">${dotsHtml}</div>
              <p style="margin:0;font-size:13px;font-weight:700;color:${(condsMet ?? 0) >= (condsTotal ?? 5) ? color : '#d97706'};">
                ${condsMet ?? 0} de ${condsTotal ?? 5} cumplidas
                ${(condsMet ?? 0) >= (condsTotal ?? 5) ? ' · ✓ Listo para entrada' : ''}
              </p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Trading Signals · Patrones de compresión 4H · Triángulos · Cuñas · Banderas
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

        const dirLabel = isBull ? 'Alcista' : isBear ? 'Bajista' : 'Neutral';
        await transporter.sendMail({
            from:    `"Trading Signals" <${process.env.SMTP_USER}>`,
            to:      process.env.SMTP_TO || process.env.SMTP_USER,
            subject: `${emoji} Patrón ${dirLabel} · ${symbol.toUpperCase()} — ${patternLabel}`,
            html,
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('Pattern email error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
