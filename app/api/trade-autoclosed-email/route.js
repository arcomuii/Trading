export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer       from 'nodemailer';

export async function POST(request) {
    try {
        const { symbol, side, candles4h, closedAt, estimatedPnl } = await request.json();

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

        const pnlNum  = estimatedPnl != null ? Number(estimatedPnl) : null;
        const isProfit = pnlNum != null && pnlNum >= 0;
        const color   = pnlNum == null ? '#6366f1' : isProfit ? '#22c55e' : '#ef4444';

        const fmtDate = (iso) => {
            if (!iso) return '—';
            return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
        };
        const fmtPnl = (v) => {
            if (v == null) return '—';
            const s = v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
            return v >= 0 ? `+${s}` : s;
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
          <td style="background:${color};padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,.8);text-transform:uppercase;">
              Posición cerrada automáticamente · +${candles4h ?? '?'} velas 4H
            </p>
            <p style="margin:8px 0 0;font-size:30px;font-weight:900;color:#fff;line-height:1.1;">
              ${symbol}${side ? ` · ${String(side).toUpperCase()}` : ''}
            </p>
          </td>
        </tr>

        <!-- Details -->
        <tr>
          <td style="padding:24px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px;">
              <tr>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Velas 4H</p>
                  <p style="margin:6px 0 0;font-size:18px;font-weight:900;color:#374151;">${candles4h ?? '—'}</p>
                </td>
                <td style="background:#f9fafb;border-radius:10px;padding:14px 8px;text-align:center;width:34%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;">Hora de cierre</p>
                  <p style="margin:6px 0 0;font-size:12px;font-weight:800;color:#374151;">${fmtDate(closedAt)}</p>
                </td>
                <td style="background:${isProfit ? '#f0fdf4' : '#fef2f2'};border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:${isProfit ? '#16a34a' : '#ef4444'};text-transform:uppercase;letter-spacing:.8px;">P&amp;G estimado</p>
                  <p style="margin:6px 0 0;font-size:16px;font-weight:900;color:${isProfit ? '#15803d' : '#b91c1c'};font-family:monospace;">${fmtPnl(pnlNum)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Bitunix CTA -->
        <tr>
          <td style="padding:24px 32px 20px;text-align:center;">
            <a href="https://www.bitunix.com/es-es/contract-trade/${symbol}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;background:${color};color:#fff;font-size:14px;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:10px;">
              Ver en Bitunix →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Trading Signals · Cierre automático por tiempo en posición (&gt;14 velas 4H)
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
            subject: `⏱ Cierre automático · ${symbol} (+${candles4h ?? '?'} velas 4H)`,
            html,
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('Trade autoclosed email error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
