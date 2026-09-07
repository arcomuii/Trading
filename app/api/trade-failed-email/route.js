export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer       from 'nodemailer';

// Contraparte de trade-opened-email: antes, si tryAutoOpenPosition fallaba por
// CUALQUIER motivo (orden rechazada, excepción, saldo insuficiente...), no se
// avisaba en ningún lado visible — solo un console.error en las herramientas
// de desarrollador del navegador, que nadie revisa. Así una señal detectada
// podía nunca abrirse en Bitunix sin que quedara ningún rastro para el usuario.
export async function POST(request) {
    try {
        const {
            symbol, direction, patternLabel,
            entry, stopLoss, takeProfit1,
            reason, detail, detectedAt,
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
        const emoji  = isBull ? '↑' : '↓';

        const REASON_LABEL = {
            already_open:        'Ya había una operativa abierta en este símbolo',
            insufficient_balance: 'El monto configurado excede el saldo disponible',
            invalid_qty:          'No se pudo calcular una cantidad válida',
            qty_below_minimum:    'La cantidad calculada queda bajo el mínimo operable de Bitunix',
            order_failed:         'Bitunix rechazó la orden',
            exception:            'Excepción inesperada al intentar abrir la posición',
        };
        const reasonLabel = REASON_LABEL[reason] ?? reason ?? 'Motivo desconocido';

        const fmtPrice = (p) => {
            if (p == null) return '—';
            return p < 1
                ? `$${Number(p).toFixed(5)}`
                : `$${Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };
        const fmtDate = (iso) => {
            if (!iso) return '—';
            return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
        };

        const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.10);">

        <tr>
          <td style="background:#f59e0b;padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:2px;color:rgba(255,255,255,.85);text-transform:uppercase;">
              ⚠ No se pudo abrir automáticamente
            </p>
            <p style="margin:8px 0 0;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">
              ${emoji} ${direction ?? ''} · ${symbol}
            </p>
            ${patternLabel ? `<p style="margin:6px 0 0;font-size:14px;font-weight:700;color:rgba(255,255,255,.85);">${patternLabel}</p>` : ''}
          </td>
        </tr>

        <tr>
          <td style="padding:24px 32px 0;">
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:10px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.8px;">Motivo</p>
              <p style="margin:6px 0 0;font-size:14px;font-weight:800;color:#92400e;">${reasonLabel}</p>
              ${detail ? `<p style="margin:8px 0 0;font-size:12px;color:#92400e;font-family:monospace;word-break:break-all;">${detail}</p>` : ''}
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px;">
              <tr>
                <td style="background:#eef2ff;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.8px;">Entrada</p>
                  <p style="margin:6px 0 0;font-size:15px;font-weight:900;color:#4338ca;font-family:monospace;">${fmtPrice(entry)}</p>
                </td>
                <td style="background:#fef2f2;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.8px;">Stop Loss</p>
                  <p style="margin:6px 0 0;font-size:15px;font-weight:900;color:#b91c1c;font-family:monospace;">${fmtPrice(stopLoss)}</p>
                </td>
                <td style="background:#f0fdf4;border-radius:10px;padding:14px 8px;text-align:center;width:33%;">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.8px;">Take Profit 1</p>
                  <p style="margin:6px 0 0;font-size:15px;font-weight:900;color:#15803d;font-family:monospace;">${fmtPrice(takeProfit1)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 32px 20px;text-align:center;">
            <a href="https://www.bitunix.com/es-es/contract-trade/${symbol}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;background:#f59e0b;color:#fff;font-size:14px;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:10px;">
              Abrir manualmente en Bitunix →
            </a>
          </td>
        </tr>

        <tr>
          <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Trading Signals · Señal detectada ${fmtDate(detectedAt)}
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
            subject: `⚠ No se pudo abrir · ${direction ?? ''} ${symbol}`,
            html,
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('Trade failed email error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
