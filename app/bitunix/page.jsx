'use client'
import { useState, useEffect, useCallback, useRef, Fragment } from "react";

// ─── helpers ─────────────────────────────────────────────────────────────────

function SideBadge({ side }) {
    const isLong = (side || "").toUpperCase() === "LONG" || (side || "").toUpperCase() === "BUY";
    return (
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
            isLong ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400"
        }`}>
            {isLong ? "▲ LONG" : "▼ SHORT"}
        </span>
    );
}

function PnlCell({ value }) {
    const num = parseFloat(value);
    if (isNaN(num)) return <span className="text-gray-400 dark:text-slate-500">—</span>;
    const pos = num >= 0;
    return (
        <span className={`font-semibold tabular-nums ${pos ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
            {pos ? "+" : ""}{num.toFixed(4)}
        </span>
    );
}

function fmt(value, decimals = 2) {
    const num = parseFloat(value);
    if (isNaN(num)) return "—";
    return num.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pick(obj, ...keys) {
    for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null && v !== "" && v !== "0") return v;
    }
    return null;
}

function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(typeof ts === "number" ? ts : Number(ts));
    if (isNaN(d)) return String(ts);
    return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

// ─── PriceGauge ──────────────────────────────────────────────────────────────

function PriceGauge({ entry, current, tp, sl }) {
    const vals = {
        entry:   parseFloat(entry),
        current: parseFloat(current),
        tp:      parseFloat(tp),
        sl:      parseFloat(sl),
    };
    const def = Object.fromEntries(Object.entries(vals).filter(([, v]) => !isNaN(v) && v > 0));
    const prices = Object.values(def);
    if (prices.length < 2) {
        return <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-4">Sin datos de precio suficientes</p>;
    }

    const minP   = Math.min(...prices);
    const maxP   = Math.max(...prices);
    const spread = maxP - minP || minP * 0.01;
    const pad    = spread * 0.18;
    const lo     = minP - pad;
    const hi     = maxP + pad;
    const total  = hi - lo;

    const W = 460, trackY = 46, trackH = 10, LEFT = 24, RIGHT = W - 24;
    const trackW = RIGHT - LEFT;
    const px = v => LEFT + ((v - lo) / total) * trackW;

    // distance from current to SL / TP (as % of current price)
    const distSl = def.current && def.sl
        ? (def.current - def.sl) / def.current * 100
        : null;
    const distTp = def.current && def.tp
        ? (def.tp - def.current) / def.current * 100
        : null;

    // clamp label x so it never overflows the SVG
    const clamp = (x, w = 28) => Math.max(LEFT + w / 2, Math.min(RIGHT - w / 2, x));

    return (
        <div>
            <svg viewBox={`0 0 ${W} 94`} className="w-full">
                {/* Base track */}
                <rect x={LEFT} y={trackY} width={trackW} height={trackH} rx="5" fill="#e2e8f0" />

                {/* Red zone: SL → entry (danger) */}
                {def.sl && def.entry && (
                    <rect
                        x={px(Math.min(def.sl, def.entry))}
                        y={trackY}
                        width={Math.abs(px(def.entry) - px(def.sl))}
                        height={trackH}
                        fill="#fee2e2"
                    />
                )}

                {/* Green zone: entry → TP (profit) */}
                {def.entry && def.tp && (
                    <rect
                        x={px(Math.min(def.entry, def.tp))}
                        y={trackY}
                        width={Math.abs(px(def.tp) - px(def.entry))}
                        height={trackH}
                        fill="#dcfce7"
                    />
                )}

                {/* SL marker */}
                {def.sl && (
                    <>
                        <line x1={px(def.sl)} y1={trackY - 10} x2={px(def.sl)} y2={trackY + trackH + 10}
                              stroke="#ef4444" strokeWidth="2" />
                        <text x={clamp(px(def.sl))} y={trackY - 14}
                              textAnchor="middle" fill="#ef4444" fontSize="10" fontWeight="bold">SL</text>
                        <text x={clamp(px(def.sl))} y={trackY + trackH + 20}
                              textAnchor="middle" fill="#ef4444" fontSize="8.5">${fmt(def.sl)}</text>
                    </>
                )}

                {/* TP marker */}
                {def.tp && (
                    <>
                        <line x1={px(def.tp)} y1={trackY - 10} x2={px(def.tp)} y2={trackY + trackH + 10}
                              stroke="#22c55e" strokeWidth="2" />
                        <text x={clamp(px(def.tp))} y={trackY - 14}
                              textAnchor="middle" fill="#22c55e" fontSize="10" fontWeight="bold">TP</text>
                        <text x={clamp(px(def.tp))} y={trackY + trackH + 20}
                              textAnchor="middle" fill="#22c55e" fontSize="8.5">${fmt(def.tp)}</text>
                    </>
                )}

                {/* Entry marker (dashed) */}
                {def.entry && (
                    <>
                        <line x1={px(def.entry)} y1={trackY - 5} x2={px(def.entry)} y2={trackY + trackH + 5}
                              stroke="#6366f1" strokeWidth="1.5" strokeDasharray="3,2" />
                        <text x={clamp(px(def.entry))} y={trackY + trackH + 32}
                              textAnchor="middle" fill="#6366f1" fontSize="8">Entrada</text>
                    </>
                )}

                {/* Current price dot */}
                {def.current && (
                    <>
                        <circle cx={px(def.current)} cy={trackY + trackH / 2} r="8"
                                fill="#1e293b" stroke="white" strokeWidth="2" />
                        <text x={clamp(px(def.current))} y={trackY - 14}
                              textAnchor="middle" fill="#1e293b" fontSize="9" fontWeight="bold">
                            ${fmt(def.current)}
                        </text>
                    </>
                )}
            </svg>

            {/* Distance stats */}
            {(distSl !== null || distTp !== null) && (
                <div className="flex justify-around mt-1 text-xs border-t border-gray-100 dark:border-slate-700 pt-3">
                    {distSl !== null && (
                        <div className="text-center">
                            <p className="text-gray-400 dark:text-slate-500 mb-0.5">Distancia al SL</p>
                            <p className={`font-bold text-sm ${distSl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                                {distSl >= 0 ? "+" : ""}{distSl.toFixed(2)}%
                            </p>
                        </div>
                    )}
                    {def.current && (
                        <div className="text-center">
                            <p className="text-gray-400 dark:text-slate-500 mb-0.5">Precio actual</p>
                            <p className="font-bold text-sm text-gray-800 dark:text-slate-100">${fmt(def.current)}</p>
                        </div>
                    )}
                    {distTp !== null && (
                        <div className="text-center">
                            <p className="text-gray-400 dark:text-slate-500 mb-0.5">Distancia al TP</p>
                            <p className={`font-bold text-sm ${distTp >= 0 ? "text-blue-600 dark:text-blue-400" : "text-orange-500 dark:text-orange-400"}`}>
                                {distTp >= 0 ? "+" : ""}{distTp.toFixed(2)}%
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── TpSlModal ────────────────────────────────────────────────────────────────

function TpSlModal({ position, currentPrice, onClose }) {
    const [tpslData, setTpslData] = useState(null);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState(null);

    // Close on Escape
    useEffect(() => {
        const h = e => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    useEffect(() => {
        const params = new URLSearchParams({ pageNum: "1", pageSize: "20" });
        if (position.symbol)     params.append("symbol",     position.symbol);
        if (position.positionId) params.append("positionId", position.positionId);

        fetch(`/api/bitunix/api/v1/futures/tpsl/get_pending_orders?${params}`)
            .then(r => r.json())
            .then(json => { setTpslData(json); setLoading(false); })
            .catch(err  => { setError(err.message); setLoading(false); });
    }, [position]);

    const entryPrice = pick(position, "avgPrice","openPrice","entryPrice","avgOpenPrice","openAvgPrice","price");

    // Extract TP and SL from API response
    let tp = null, sl = null, orders = [];
    if (tpslData?.data) {
        const d = tpslData.data;
        orders = Array.isArray(d.tpslList)  ? d.tpslList  :
                 Array.isArray(d.orderList) ? d.orderList :
                 Array.isArray(d.list)      ? d.list      :
                 Array.isArray(d)           ? d           :
                 d                          ? [d]         : [];

        for (const ord of orders) {
            const type = (ord.type || ord.orderType || ord.tpslType || ord.side || "").toUpperCase();
            const trig = pick(ord, "triggerPrice","tpPrice","takeProfitPrice","price","tp");
            const trig2 = pick(ord, "triggerPrice","slPrice","stopLossPrice","price","sl");

            if (type.includes("TAKE") || type === "TP" || type.includes("PROFIT")) {
                if (!tp) tp = trig;
            } else if (type.includes("STOP") || type === "SL" || type.includes("LOSS")) {
                if (!sl) sl = trig2;
            }
        }
        // Fallback: try direct fields on first order
        if (!tp && orders[0]) tp = pick(orders[0], "tpPrice","takeProfitPrice","tp");
        if (!sl && orders[0]) sl = pick(orders[0], "slPrice","stopLossPrice","sl");
    }

    const hasData = tp || sl;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* Panel */}
            <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                    <div>
                        <h2 className="font-bold text-gray-800 dark:text-slate-100 text-lg">Take Profit / Stop Loss</h2>
                        <p className="text-gray-400 dark:text-slate-500 text-xs mt-0.5">
                            {position.symbol}
                            {position.side && <> · <SideBadge side={position.side} /></>}
                        </p>
                    </div>
                    <button onClick={onClose}
                        className="text-gray-300 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="px-6 py-5">
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-gray-300 dark:text-slate-600 text-sm gap-2">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                            Consultando órdenes TP/SL…
                        </div>
                    ) : error ? (
                        <div className="text-red-500 dark:text-red-400 text-sm py-4">
                            <p className="font-semibold mb-1">Error al consultar</p>
                            <p className="font-mono text-xs bg-red-50 dark:bg-red-950 p-2 rounded">{error}</p>
                        </div>
                    ) : (
                        <>
                            {/* Price gauge */}
                            {hasData ? (
                                <PriceGauge
                                    entry={entryPrice}
                                    current={currentPrice}
                                    tp={tp}
                                    sl={sl}
                                />
                            ) : (
                                <div className="text-center py-8 text-gray-400 dark:text-slate-500">
                                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                                         className="mx-auto mb-3 opacity-50">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="12" y1="8" x2="12" y2="12" />
                                        <line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                    <p className="text-sm">Sin órdenes TP/SL activas para esta posición</p>
                                </div>
                            )}

                            {/* Price cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
                                {[
                                    { label: "Entrada",     value: entryPrice,   color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950" },
                                    { label: "Actual",      value: currentPrice, color: "text-gray-800 dark:text-slate-100",    bg: "bg-gray-50 dark:bg-slate-800"    },
                                    { label: "Take Profit", value: tp,           color: "text-green-600 dark:text-green-400",   bg: "bg-green-50 dark:bg-green-950"   },
                                    { label: "Stop Loss",   value: sl,           color: "text-red-500 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-950"       },
                                ].map(({ label, value, color, bg }) => (
                                    <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                                        <p className="text-gray-400 dark:text-slate-500 text-[10px] uppercase tracking-wide font-semibold mb-1">{label}</p>
                                        <p className={`font-bold text-sm ${color} tabular-nums`}>
                                            {value ? `$${fmt(value)}` : "—"}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {/* Raw data */}
                            {orders.length > 0 ? (
                                <details className="mt-5">
                                    <summary className="cursor-pointer text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 select-none">
                                        Ver respuesta raw · {orders.length} orden{orders.length !== 1 ? "es" : ""}
                                    </summary>
                                    <pre className="mt-2 text-xs bg-gray-50 dark:bg-slate-800 rounded-xl p-3 overflow-auto max-h-52 text-gray-600 dark:text-slate-300">
                                        {JSON.stringify(orders, null, 2)}
                                    </pre>
                                </details>
                            ) : tpslData && (
                                <details className="mt-5">
                                    <summary className="cursor-pointer text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 select-none">
                                        Ver respuesta raw completa
                                    </summary>
                                    <pre className="mt-2 text-xs bg-gray-50 dark:bg-slate-800 rounded-xl p-3 overflow-auto max-h-52 text-gray-600 dark:text-slate-300">
                                        {JSON.stringify(tpslData, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── ClosePositionModal ───────────────────────────────────────────────────────

function ClosePositionModal({ position, onClose, onClosed }) {
    const [status,  setStatus]  = useState("idle");   // idle | loading | success | error
    const [apiResp, setApiResp] = useState(null);

    useEffect(() => {
        const h = e => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    const isLong = (position.side || "").toUpperCase() === "LONG" || (position.side || "").toUpperCase() === "BUY";
    const closeSide = isLong ? "SELL" : "BUY";
    const qty       = pick(position, "qty","size","quantity","positionAmt","available","vol");
    const pnl       = pick(position, "unrealizedPNL","unrealPnl","unrealisedPnl","unrealizedPnl","unrealPNL","pnl","profit");
    const pnlNum    = parseFloat(pnl);

    const handleClose = async () => {
        setStatus("loading");
        try {
            const body = JSON.stringify({
                symbol:    position.symbol,
                side:      closeSide,
                tradeSide: "CLOSE",
                orderType: "MARKET",
                qty:       qty ? String(qty) : undefined,
                ...(position.positionId ? { positionId: position.positionId } : {}),
            });
            const res  = await fetch("/api/bitunix/api/v1/futures/trade/place_order", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body,
            });
            const data = await res.json();
            setApiResp(data);
            const ok = data?.code === 0 || data?.code === "0" || data?.data?.orderId;
            setStatus(ok ? "success" : "error");
            if (ok) onClosed?.();
        } catch (err) {
            setApiResp({ error: err.message });
            setStatus("error");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

                {/* Header */}
                <div className={`px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between ${
                    status === "success" ? "bg-green-50 dark:bg-green-950" : status === "error" ? "bg-red-50 dark:bg-red-950" : ""
                }`}>
                    <div>
                        <h2 className="font-bold text-gray-800 dark:text-slate-100 text-lg">Cerrar posición</h2>
                        <p className="text-gray-400 dark:text-slate-500 text-xs mt-0.5 flex items-center gap-1.5">
                            {position.symbol} · <SideBadge side={position.side} />
                        </p>
                    </div>
                    <button onClick={onClose}
                        className="text-gray-300 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="px-6 py-5">
                    {status === "idle" && (
                        <>
                            {/* Resumen */}
                            <div className="grid grid-cols-2 gap-3 mb-5">
                                {[
                                    { label: "Cantidad",   value: qty  ? fmt(qty, 6)   : "—" },
                                    { label: "P&L no real.", value: pnl  ? null          : "—",
                                      custom: pnl ? <PnlCell value={pnl} /> : null },
                                ].map(({ label, value, custom }) => (
                                    <div key={label} className="bg-gray-50 dark:bg-slate-800 rounded-xl p-3 text-center">
                                        <p className="text-gray-400 dark:text-slate-500 text-[10px] uppercase tracking-wide font-semibold mb-1">{label}</p>
                                        <p className="font-bold text-sm text-gray-800 dark:text-slate-100">{custom ?? value}</p>
                                    </div>
                                ))}
                            </div>
                            <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
                                Se enviará una orden de <span className="font-bold text-gray-800 dark:text-slate-100">{closeSide}</span> a
                                precio de mercado con <code className="bg-gray-100 dark:bg-slate-700 dark:text-slate-300 px-1 rounded text-xs">reduceOnly: true</code>.
                            </p>
                            <button onClick={handleClose}
                                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl
                                           transition-colors flex items-center justify-center gap-2">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     strokeWidth="2.5" strokeLinecap="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6l-1 14H6L5 6" />
                                    <path d="M10 11v6M14 11v6" />
                                </svg>
                                Confirmar cierre a mercado
                            </button>
                        </>
                    )}

                    {status === "loading" && (
                        <div className="flex items-center justify-center py-10 text-gray-400 dark:text-slate-500 gap-3">
                            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                            Enviando orden de cierre…
                        </div>
                    )}

                    {status === "success" && (
                        <div className="text-center py-6">
                            <div className="w-14 h-14 bg-green-100 dark:bg-green-950 rounded-full flex items-center justify-center mx-auto mb-3">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                                     stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </div>
                            <p className="font-bold text-gray-800 dark:text-slate-100 text-lg">Orden enviada</p>
                            <p className="text-gray-400 dark:text-slate-500 text-sm mt-1 mb-4">La posición se está cerrando a mercado</p>
                            <button onClick={onClose}
                                className="bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold px-6 py-2 rounded-xl transition-colors">
                                Cerrar
                            </button>
                        </div>
                    )}

                    {status === "error" && (
                        <div className="text-center py-4">
                            <div className="w-14 h-14 bg-red-100 dark:bg-red-950 rounded-full flex items-center justify-center mx-auto mb-3">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                                     stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </div>
                            <p className="font-bold text-red-600 dark:text-red-400 mb-2">Error al cerrar</p>
                            {apiResp && (
                                <pre className="text-xs bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 rounded-xl p-3 text-left overflow-auto max-h-36 mb-4">
                                    {JSON.stringify(apiResp, null, 2)}
                                </pre>
                            )}
                            <div className="flex gap-2 justify-center">
                                <button onClick={() => setStatus("idle")}
                                    className="bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold px-5 py-2 rounded-xl transition-colors">
                                    Reintentar
                                </button>
                                <button onClick={onClose}
                                    className="bg-red-50 dark:bg-red-950 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400 font-semibold px-5 py-2 rounded-xl transition-colors">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── constants ────────────────────────────────────────────────────────────────

const COLUMNS = [
    { key: "symbol",           label: "Símbolo"        },
    { key: "side",             label: "Lado"           },
    { key: "qty",              label: "Cantidad"       },
    { key: "avgPrice",         label: "Precio entrada" },
    { key: "markPrice",        label: "Precio actual"  },
    { key: "unrealizedPNL",    label: "P&L no real."   },
    { key: "leverage",         label: "Apalancamiento" },
    { key: "liquidationPrice", label: "Liq. Price"     },
    { key: "margin",           label: "Margen"         },
    { key: "createTime",       label: "Apertura"       },
];

const ENDPOINTS = [
    "/api/bitunix/api/v1/futures/position/get_pending_positions",
    "/api/bitunix/api/v1/futures/trade/get_pending_orders",
];

function extractList(json) {
    if (!json?.data) return [];
    const d = json.data;
    if (Array.isArray(d.positionList) && d.positionList.length > 0) return d.positionList;
    if (Array.isArray(d.orderList)    && d.orderList.length    > 0) return d.orderList;
    if (Array.isArray(d.list)         && d.list.length         > 0) return d.list;
    if (Array.isArray(d))                                           return d;
    if (Array.isArray(d.positionList)) return d.positionList;
    if (Array.isArray(d.orderList))    return d.orderList;
    if (Array.isArray(d.list))         return d.list;
    return [];
}

// ─── main component ───────────────────────────────────────────────────────────

export default function BitunixPage() {
    const [expanded,   setExpanded]   = useState(null);
    const [tpslModal,  setTpslModal]  = useState(null);   // position object or null
    const [closeModal, setCloseModal] = useState(null);  // position object or null
    const [items,      setItems]      = useState([]);
    const [prices,     setPrices]     = useState({});
    const [lastUpdate, setLastUpdate] = useState(null);
    const [loading,    setLoading]    = useState(false);
    const [error,      setError]      = useState(null);
    const [rawData,    setRawData]    = useState(null);
    const [search,     setSearch]     = useState("");
    const [sortKey,    setSortKey]    = useState("symbol");
    const [sortDir,    setSortDir]    = useState("asc");
    const [symbol,     setSymbol]     = useState("");
    const [endpoint,   setEndpoint]   = useState(ENDPOINTS[0]);
    const [usedUrl,    setUsedUrl]    = useState("");
    const symbolRef = useRef("");

    const fetchPositions = useCallback(async (ep) => {
        const url = ep || endpoint;
        setLoading(true);
        setError(null);
        setRawData(null);
        try {
            const params = new URLSearchParams({ pageNum: "1", pageSize: "100" });
            const sym = symbolRef.current.trim().toUpperCase();
            if (sym) params.append("symbol", sym);

            const fullUrl = `${url}?${params}`;
            setUsedUrl(fullUrl);

            const [posRes, tickRes] = await Promise.all([
                fetch(fullUrl),
                fetch("/api/bitunix/api/v1/futures/market/tickers"),
            ]);

            if (!posRes.ok) throw new Error(`HTTP ${posRes.status}: ${posRes.statusText}`);

            const json = await posRes.json();
            setRawData(json);

            if (json.code !== undefined && json.code !== 0) {
                throw new Error(`${json.msg || "Error de API"} (código ${json.code})`);
            }

            setItems(extractList(json));
            setLastUpdate(new Date());

            if (tickRes.ok) {
                const tickJson = await tickRes.json();
                const list =
                    Array.isArray(tickJson?.data)   ? tickJson.data   :
                    Array.isArray(tickJson?.result) ? tickJson.result :
                    Array.isArray(tickJson)         ? tickJson        : [];
                const map = {};
                for (const t of list) {
                    if (t.symbol) map[t.symbol] = t.lastPrice ?? t.last ?? t.price;
                }
                setPrices(map);
            }
        } catch (err) {
            setError(err.message);
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [endpoint]);

    useEffect(() => {
        fetchPositions();
        const id = setInterval(() => fetchPositions(), 10 * 60 * 1000);
        return () => clearInterval(id);
    }, [fetchPositions]);

    const toggleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
    };

    const filtered = items
        .filter(o => {
            const q = search.toLowerCase();
            return !q
                || (o.symbol     || "").toLowerCase().includes(q)
                || (o.positionId || "").includes(q)
                || (o.orderId    || "").includes(q);
        })
        .sort((a, b) => {
            const strKeys = ["symbol", "side", "orderType", "status", "marginMode", "positionMode"];
            if (strKeys.includes(sortKey)) {
                const va = (a[sortKey] || "").toLowerCase();
                const vb = (b[sortKey] || "").toLowerCase();
                return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            const va = parseFloat(a[sortKey] ?? 0);
            const vb = parseFloat(b[sortKey] ?? 0);
            return sortDir === "asc" ? va - vb : vb - va;
        });

    const SortTh = ({ col }) => (
        <th
            onClick={() => toggleSort(col.key)}
            className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-widest cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-200 whitespace-nowrap"
        >
            {col.label}
            {sortKey === col.key && (
                <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>
            )}
        </th>
    );

    const switchEndpoint = (ep) => {
        setEndpoint(ep);
        fetchPositions(ep);
    };

    // +1 for the TP/SL action column
    const totalCols = COLUMNS.length + 1;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-6">
            <div className="max-w-7xl mx-auto">

                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Operaciones abiertas</h1>
                        <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">
                            Bitunix Futures · posiciones activas
                            {lastUpdate && (
                                <span className="ml-2 text-gray-300 dark:text-slate-600">
                                    · Actualizado: {lastUpdate.toLocaleTimeString("es-MX")}
                                </span>
                            )}
                        </p>
                    </div>
                    <button
                        onClick={() => fetchPositions()}
                        disabled={loading}
                        className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium text-sm px-4 py-2 rounded-xl transition-colors shadow-sm disabled:opacity-50"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                            strokeLinecap="round" strokeLinejoin="round"
                            className={loading ? "animate-spin" : ""}>
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        {loading ? "Actualizando…" : "Actualizar"}
                    </button>
                </div>

                <div className="flex flex-wrap gap-2 mb-5">
                    {ENDPOINTS.map(ep => {
                        const label = ep.includes("position") ? "Posiciones" : "Órdenes pendientes";
                        return (
                            <button key={ep} onClick={() => switchEndpoint(ep)}
                                className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                                    endpoint === ep
                                        ? "bg-indigo-500 text-white border-indigo-500"
                                        : "bg-white dark:bg-slate-900 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-500 dark:hover:text-indigo-400"
                                }`}>
                                {label}
                            </button>
                        );
                    })}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 mb-5">
                    <input type="text" value={symbol}
                        onChange={e => { setSymbol(e.target.value); symbolRef.current = e.target.value; }}
                        onKeyDown={e => e.key === "Enter" && fetchPositions()}
                        placeholder="Símbolo (ej. BTCUSDT) — Enter para aplicar"
                        className="flex-1 max-w-xs border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 bg-white dark:bg-slate-900 dark:text-slate-100 shadow-sm"
                    />
                    <input type="text" value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar en resultados…"
                        className="flex-1 max-w-xs border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 bg-white dark:bg-slate-900 dark:text-slate-100 shadow-sm"
                    />
                </div>

                {error && (
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-6 mb-6 text-red-700 dark:text-red-300">
                        <p className="font-semibold mb-1">Error al obtener datos</p>
                        <p className="text-sm font-mono mb-2">{error}</p>
                        <p className="text-xs text-red-400 dark:text-red-500 font-mono mb-3">URL: {usedUrl}</p>
                        {rawData && (
                            <details className="mt-2">
                                <summary className="cursor-pointer text-sm text-red-500 hover:text-red-700">Ver respuesta raw</summary>
                                <pre className="mt-2 text-xs bg-red-100 dark:bg-red-900 rounded p-3 overflow-auto max-h-64">
                                    {JSON.stringify(rawData, null, 2)}
                                </pre>
                            </details>
                        )}
                        <p className="text-xs text-red-400 dark:text-red-500 mt-3">Prueba cambiando el endpoint con los botones de arriba.</p>
                    </div>
                )}

                {!error && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden">
                        {loading && items.length === 0 ? (
                            <div className="flex items-center justify-center h-52 text-gray-300 dark:text-slate-600 text-sm">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                    strokeLinecap="round" strokeLinejoin="round" className="animate-spin mr-2">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                Cargando…
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-gray-300 dark:text-slate-600">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
                                    strokeLinecap="round" strokeLinejoin="round" className="mb-3">
                                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                                    <rect x="9" y="3" width="6" height="4" rx="1" />
                                    <path d="M9 12h6M9 16h4" />
                                </svg>
                                <p className="text-sm">Sin resultados para este endpoint</p>
                                <p className="text-xs mt-1 text-gray-200 dark:text-slate-700 font-mono">{usedUrl}</p>
                                {rawData && (
                                    <details className="mt-4 text-left">
                                        <summary className="cursor-pointer text-xs text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400">Ver respuesta raw</summary>
                                        <pre className="mt-2 text-xs bg-gray-50 dark:bg-slate-800 rounded p-3 overflow-auto max-h-64 text-gray-500 dark:text-slate-400">
                                            {JSON.stringify(rawData, null, 2)}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-800/70">
                                                {COLUMNS.map(col => <SortTh key={col.key} col={col} />)}
                                                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-widest whitespace-nowrap">
                                                    TP / SL
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filtered.map((o, i) => {
                                                const rowId  = o.positionId || o.orderId || i;
                                                const isOpen = expanded === rowId;

                                                const entryPrice = pick(o, "avgPrice","openPrice","entryPrice","avgOpenPrice","openAvgPrice","price");
                                                const markPrice  = prices[o.symbol] ?? pick(o, "markPrice","lastPrice","indexPrice","currentPrice","marketPrice","closePrice");
                                                const liqPrice   = pick(o, "liquidationPrice","liqPrice","forceLiqPrice","bankruptPrice","estLiqPrice","forcePrice");
                                                const qty        = pick(o, "qty","size","quantity","positionAmt","available","vol");
                                                const pnl        = pick(o, "unrealizedPNL","unrealPnl","unrealisedPnl","unrealizedPnl","unrealPNL","pnl","profit","achievedProfits");
                                                const lev        = pick(o, "leverage","lever","lev");
                                                const margin     = pick(o, "margin","initialMargin","positionMargin","im","posMargin","frozenMargin");
                                                const openTime   = pick(o, "createTime","openTime","ctime","createdAt","createTimestamp","time");

                                                return (
                                                    <Fragment key={rowId}>
                                                        <tr
                                                            onClick={() => setExpanded(isOpen ? null : rowId)}
                                                            className="border-b border-gray-50 dark:border-slate-800 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/30 transition-colors cursor-pointer">
                                                            <td className="px-4 py-3 font-bold text-gray-800 dark:text-slate-100 whitespace-nowrap">
                                                                <span className="mr-1.5 text-gray-300 dark:text-slate-600 text-xs">{isOpen ? "▼" : "▶"}</span>
                                                                {o.symbol}
                                                            </td>
                                                            <td className="px-4 py-3 whitespace-nowrap"><SideBadge side={o.side} /></td>
                                                            <td className="px-4 py-3 text-gray-600 dark:text-slate-300 tabular-nums whitespace-nowrap">{qty ? fmt(qty, 6) : "—"}</td>
                                                            <td className="px-4 py-3 font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap">
                                                                {entryPrice ? `$${fmt(entryPrice)}` : "—"}
                                                            </td>
                                                            <td className="px-4 py-3 font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap">
                                                                {markPrice ? `$${fmt(markPrice)}` : "—"}
                                                            </td>
                                                            <td className="px-4 py-3 whitespace-nowrap">
                                                                <PnlCell value={pnl} />
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap text-center">
                                                                {lev ? `${lev}×` : "—"}
                                                            </td>
                                                            <td className="px-4 py-3 font-mono text-orange-400 whitespace-nowrap text-xs">
                                                                {liqPrice ? `$${fmt(liqPrice)}` : "—"}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                                                                {margin ? `$${fmt(margin)}` : "—"}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-400 dark:text-slate-500 whitespace-nowrap text-xs tabular-nums">
                                                                {openTime ? fmtDate(openTime) : "—"}
                                                            </td>
                                                            {/* TP/SL button — stops row-expand propagation */}
                                                            <td className="px-4 py-3 whitespace-nowrap"
                                                                onClick={e => e.stopPropagation()}>
                                                                <button
                                                                    onClick={() => setTpslModal(o)}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                                                               border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950
                                                                               hover:bg-violet-100 dark:hover:bg-violet-900 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
                                                                >
                                                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                                                                         stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                                                        <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
                                                                    </svg>
                                                                    TP / SL
                                                                </button>
                                                            </td>
                                                        </tr>

                                                        {isOpen && (
                                                            <tr key={`${rowId}-exp`} className="bg-gray-50/80 dark:bg-slate-800/80">
                                                                <td colSpan={totalCols} className="px-6 py-4">
                                                                    {/* Botón cerrar posición */}
                                                                    <div className="mb-4">
                                                                        <button
                                                                            onClick={e => { e.stopPropagation(); setCloseModal(o); }}
                                                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                                                                                       bg-red-500 hover:bg-red-600 text-white transition-colors shadow-sm"
                                                                        >
                                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                                                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                                                                <polyline points="3 6 5 6 21 6" />
                                                                                <path d="M19 6l-1 14H6L5 6" />
                                                                                <path d="M10 11v6M14 11v6" />
                                                                            </svg>
                                                                            Cerrar posición
                                                                        </button>
                                                                    </div>
                                                                    <p className="text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                                                                        <a href={`https://www.bitunix.com/es-es/contract-trade/${o.symbol}`} className="underline text-green-500" target="_blank">Ver en Bitunix</a>
                                                                        <br />
                                                                        <a href={`https://es.tradingview.com/chart/tXjDAvNO/?symbol=BITUNIX%3A${o.symbol}.P`} className="underline text-red-500" target="_blank">Ver en Tradingview</a>
                                                                        <br />
                                                                        Todos los campos devueltos por la API
                                                                    </p>
                                                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-2">
                                                                        {Object.entries(o).map(([k, v]) => (
                                                                            <div key={k} className="text-xs">
                                                                                <span className="text-gray-400 dark:text-slate-500 font-mono">{k}: </span>
                                                                                <span className="text-gray-700 dark:text-slate-300 font-medium break-all">{String(v)}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="px-5 py-3 bg-gray-50/50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 text-xs text-gray-400 dark:text-slate-500 flex items-center justify-between">
                                    <span>{filtered.length} de {items.length} resultados</span>
                                    {loading && <span className="text-indigo-400">Actualizando…</span>}
                                </div>
                            </>
                        )}
                    </div>
                )}

            </div>

            {/* TP/SL Modal */}
            {tpslModal && (
                <TpSlModal
                    position={tpslModal}
                    currentPrice={prices[tpslModal.symbol] ?? pick(tpslModal, "markPrice","lastPrice","currentPrice")}
                    onClose={() => setTpslModal(null)}
                />
            )}

            {/* Close Position Modal */}
            {closeModal && (
                <ClosePositionModal
                    position={closeModal}
                    onClose={() => setCloseModal(null)}
                    onClosed={() => { setCloseModal(null); setTimeout(() => fetchPositions(), 1500); }}
                />
            )}
        </div>
    );
}
