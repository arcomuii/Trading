'use client'
import { useState, useEffect } from "react";

function fmt(value, decimals = 2) {
    const num = parseFloat(value);
    if (isNaN(num) || value === null || value === undefined) return "—";
    return num.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function MetricCard({ label, value, sub, color = "text-gray-800 dark:text-slate-100" }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-2">{label}</p>
            <p className={`text-2xl font-black font-mono ${color}`}>{value}</p>
            {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{sub}</p>}
        </div>
    );
}

function extractAccount(json) {
    if (!json) return null;
    const d = json.data ?? json.result ?? json;
    return Array.isArray(d) ? d[0] ?? null : d;
}

export default function BitunixBalancePage() {
    const [account, setAccount]   = useState(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState(null);
    const [rawData, setRawData]   = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);

    useEffect(() => {
        const fetchBalance = async () => {
            try {
                setError(null);
                const res  = await fetch("/api/bitunix/api/v1/futures/account?marginCoin=USDT");
                const json = await res.json();
                setRawData(json);
                if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}: ${res.statusText}`);
                if (json.code !== undefined && json.code !== 0 && json.code !== "0") {
                    throw new Error(`[${json.code}] ${json.msg ?? "Error de API"}`);
                }
                setAccount(extractAccount(json));
                setLastUpdate(new Date());
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchBalance();
        const interval = setInterval(fetchBalance, 10 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const coin       = account?.marginCoin ?? "USDT";
    const available  = account?.available;
    const frozen     = account?.frozen;
    const margin     = account?.margin;
    const transfer   = account?.transfer;
    const crossPnl   = account?.crossUnrealizedPNL;
    const isoPnl     = account?.isolationUnrealizedPNL;
    const bonus      = account?.bonus;
    const posMode    = account?.positionMode;

    const totalPnl    = parseFloat(crossPnl ?? 0) + parseFloat(isoPnl ?? 0);
    const pnlColor    = totalPnl > 0
        ? "text-green-600 dark:text-green-400"
        : totalPnl < 0
            ? "text-red-500 dark:text-red-400"
            : "text-gray-800 dark:text-slate-100";
    const hasKnownFields = available !== undefined;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-10 px-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Balance Futures</h1>
                    <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">
                        Bitunix · actualiza cada 10 min
                        {lastUpdate && (
                            <span> · última vez: {lastUpdate.toLocaleTimeString("es-MX")}</span>
                        )}
                    </p>
                </div>

                {loading && (
                    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-slate-500 text-lg">
                        Cargando balance...
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-red-700 dark:text-red-300">
                        <p className="font-semibold mb-1">Error al obtener el balance</p>
                        <p className="text-sm font-mono">{error}</p>
                        {rawData && (
                            <details className="mt-4">
                                <summary className="cursor-pointer text-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">Ver respuesta raw</summary>
                                <pre className="mt-2 text-xs bg-red-100 dark:bg-red-900 rounded p-3 overflow-auto max-h-64">
                                    {JSON.stringify(rawData, null, 2)}
                                </pre>
                            </details>
                        )}
                    </div>
                )}

                {!loading && !error && account && hasKnownFields && (
                    <>
                        {(() => {
                            const total      = parseFloat(available ?? 0) + parseFloat(margin ?? 0) + totalPnl;
                            const totalColor = totalPnl > 0
                                ? "text-green-600 dark:text-green-400"
                                : totalPnl < 0
                                    ? "text-red-500 dark:text-red-400"
                                    : "text-gray-800 dark:text-slate-100";
                            return (
                                <div className="flex justify-center mb-6">
                                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-lg px-10 py-6 text-center min-w-64">
                                        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-2">
                                            Equity total
                                        </p>
                                        <p className={`text-4xl font-black font-mono ${totalColor}`}>
                                            {fmt(total)} {coin}
                                        </p>
                                        <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">
                                            Disponible + Margen en uso + PnL no realizado
                                        </p>
                                    </div>
                                </div>
                            );
                        })()}

                        {posMode && (
                            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-4">
                                Modo: {posMode}
                            </p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <MetricCard
                                label="Disponible"
                                value={`${fmt(available)} ${coin}`}
                                sub="Saldo libre para operar"
                            />
                            <MetricCard
                                label="Margen en uso"
                                value={`${fmt(margin)} ${coin}`}
                                sub="Colateral ocupado en posiciones"
                            />
                            <MetricCard
                                label="Bloqueado"
                                value={`${fmt(frozen)} ${coin}`}
                                sub="Órdenes pendientes"
                            />
                            <MetricCard
                                label="PnL no realizado (Cross)"
                                value={`${parseFloat(crossPnl ?? 0) >= 0 ? "+" : ""}${fmt(crossPnl)} ${coin}`}
                                sub="Posiciones cross abiertas"
                                color={parseFloat(crossPnl ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
                            />
                            <MetricCard
                                label="PnL no realizado (Aislado)"
                                value={`${parseFloat(isoPnl ?? 0) >= 0 ? "+" : ""}${fmt(isoPnl)} ${coin}`}
                                sub="Posiciones aisladas abiertas"
                                color={parseFloat(isoPnl ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
                            />
                            <MetricCard
                                label="Transferible"
                                value={`${fmt(transfer)} ${coin}`}
                                sub="Máximo retirable"
                            />
                            {parseFloat(bonus ?? 0) > 0 && (
                                <MetricCard
                                    label="Bonus"
                                    value={`${fmt(bonus)} ${coin}`}
                                    sub="Bonificación de la cuenta"
                                />
                            )}
                        </div>
                    </>
                )}

                {!loading && !error && account && !hasKnownFields && (
                    <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-6">
                        <p className="font-semibold text-yellow-800 dark:text-yellow-300 mb-2">Respuesta recibida — campos no reconocidos</p>
                        <pre className="text-xs bg-yellow-100 dark:bg-yellow-900 rounded p-3 overflow-auto max-h-96 text-yellow-800 dark:text-yellow-300">
                            {JSON.stringify(rawData, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
