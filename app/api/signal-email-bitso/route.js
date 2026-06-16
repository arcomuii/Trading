export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer       from 'nodemailer';

export async function POST(request) {
    try {
        const { name, symbol, signal, price, stopLoss, tpMin, tpMax,
                riskReward, riskPct, adx, pdi, mdi, stochK, stochD,
                isSqueezeOn, reasoning } = await request.json();

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

        await transporter.verify();

        const isHighRisk = signal === 'SWING_LONG_ALTO_RIESGO';
        const color      = isHighRisk ? '#f97316' : '#22c55e';
        const label      = isHighRisk ? '⚠ SWING LONG · Alto Riesgo' : '▲ SWING LONG';

        const fmtP = n => {
            if (n == null || isNaN(n)) return '—';
            if (n >= 1000) return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
            if (n >= 1)    return `$${Number(n).toFixed(2)}`;
            if (n >= 0.01) return `$${Number(n).toFixed(4)}`;
            return `$${Number(n).toFixed(8)}`;
        };

        const reasoningRows = (reasoning ?? []).map(r =>
            `<tr><td style="padding:4px 0;font-size:12px;color:#374151;">✓ ${r}</td></tr>`
        ).join('');

        const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:${color};padding:28px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,.8);text-transform:uppercase;">
              Bitso · Swing Trading · Velas 1D
            </p>
            <p style="margin:10px 0 4px;font-size:40px;font-weight:900;color:#fff;line-height:1;">${label}</p>
            <p style="margin:0;font-size:22px;font-weight:800;color:rgba(255,255,255,.9);">${symbol}/USD</p>
          </td>
        </tr>

        <!-- Coin + Price -->
        <tr>
          <td style="padding:24px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:20px;font-weight:800;color:#111;">${name}</p>
                  <p style="margin:3px 0 0;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:1px;">${symbol} · USD</p>
                </td>
                <td style="text-align:right;">
                  <p style="margin:0;font-size:26px;font-weight:900;color:#111;font-family:monospace;">${fmtP(price)}</p>
                  <p style="margin:3px 0 0;font-size:11px;color:#9ca3af;">Precio actual</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Niveles de riesgo -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 0;">
              <tr>
                <td width="33%" style="background:#fef2f2;border-radius:10px;padding:14px 8px;text-align:center;">
                  <p style="margin:0;font-size:9px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.8px;">Stop Loss</p>
                  <p style="margin:6px 0 2px;font-size:16px;font-weight:900;color:#dc2626;font-family:monospace;">${fmtP(stopLoss)}</p>
                  <p style="margin:0;font-size:9px;color:#ef4444;">Riesgo ATR ${riskPct != null ? (riskPct*100).toFixed(1)+'%' : ''}</p>
                </td>
                <td width="33%" style="background:#f0fdf4;border-radius:10px;padding:14px 8px;text-align:center;">
                  <p style="margin:0;font-size:9px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.8px;">Take Profit +8%</p>
                  <p style="margin:6px 0 2px;font-size:16px;font-weight:900;color:#15803d;font-family:monospace;">${fmtP(tpMin)}</p>
                  <p style="margin:0;font-size:9px;color:#16a34a;">Objetivo mínimo</p>
                </td>
                <td width="33%" style="background:#f0fdf4;border-radius:10px;padding:14px 8px;text-align:center;">
                  <p style="margin:0;font-size:9px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.8px;">Take Profit +15%</p>
                  <p style="margin:6px 0 2px;font-size:16px;font-weight:900;color:#15803d;font-family:monospace;">${fmtP(tpMax)}</p>
                  <p style="margin:0;font-size:9px;color:#16a34a;">R/R ${riskReward != null ? riskReward.toFixed(2)+'x' : ''}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Indicadores -->
        <tr>
          <td style="padding:16px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 0;">
              <tr>
                <td width="25%" style="background:#f9fafb;border-radius:10px;padding:12px 8px;text-align:center;">
                  <p style="margin:0;font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;">ADX</p>
                  <p style="margin:5px 0 2px;font-size:18px;font-weight:900;color:#6366f1;">${adx != null ? Number(adx).toFixed(1) : '—'}</p>
                  <p style="margin:0;font-size:9px;color:#9ca3af;">+DI ${pdi != null ? Number(pdi).toFixed(1) : '—'} / -DI ${mdi != null ? Number(mdi).toFixed(1) : '—'}</p>
                </td>
                <td width="25%" style="background:#f9fafb;border-radius:10px;padding:12px 8px;text-align:center;">
                  <p style="margin:0;font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;">Estocástico</p>
                  <p style="margin:5px 0 2px;font-size:18px;font-weight:900;color:#22c55e;">${stochK != null ? Number(stochK).toFixed(1) : '—'}</p>
                  <p style="margin:0;font-size:9px;color:#9ca3af;">D: ${stochD != null ? Number(stochD).toFixed(1) : '—'}</p>
                </td>
                <td width="25%" style="background:#f9fafb;border-radius:10px;padding:12px 8px;text-align:center;">
                  <p style="margin:0;font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;">Squeeze</p>
                  <p style="margin:5px 0 2px;font-size:18px;font-weight:900;color:${isSqueezeOn ? '#f97316' : '#22c55e'};">${isSqueezeOn ? '🔴 ON' : '🟢 OFF'}</p>
                  <p style="margin:0;font-size:9px;color:#9ca3af;">${isSqueezeOn ? 'Acumulación' : 'Expansión'}</p>
                </td>
                <td width="25%" style="background:#f9fafb;border-radius:10px;padding:12px 8px;text-align:center;">
                  <p style="margin:0;font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;">R/R Ratio</p>
                  <p style="margin:5px 0 2px;font-size:18px;font-weight:900;color:#6366f1;">${riskReward != null ? Number(riskReward).toFixed(2)+'x' : '—'}</p>
                  <p style="margin:0;font-size:9px;color:#9ca3af;">Objetivo 8%</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Reasoning -->
        ${reasoningRows ? `
        <tr>
          <td style="padding:16px 32px 0;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.8px;">Condiciones confirmadas</p>
            <table width="100%" cellpadding="0" cellspacing="0">${reasoningRows}</table>
          </td>
        </tr>` : ''}

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;margin-top:20px;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Trading Signals · Bitso Swing 1D · ADX · Squeeze · Estocástico
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
            subject: `${isHighRisk ? '⚠' : '▲'} Swing Long · ${symbol}/USD — ${isHighRisk ? 'Alto Riesgo' : 'Señal confirmada'}`,
            html,
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('Swing email error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
