// Espeja los valores que la app guarda en localStorage hacia data/local-store.json
// (vía /api/local-store), para poder consultarlos remotamente (curl, otra
// máquina, etc.) sin depender del localStorage de un navegador en particular.
//
// localStorage sigue siendo la fuente de verdad para la UI de cada página
// (lecturas síncronas, sin parpadeo ni estados de carga); esto es solo un
// espejo de "mejor esfuerzo" hacia el servidor — si falla (offline, servidor
// caído) no debe romper ni bloquear la app, por eso nunca se hace `await` en
// los call sites y los errores se tragan en silencio.

// Todas las claves de localStorage usadas en la app, para la migración
// inicial de datos que ya existen en el navegador (ver migrateAllToRemote).
// Si se agrega una clave nueva en algún lado, agregarla también aquí.
export const KNOWN_LOCAL_STORAGE_KEYS = [
    'acc_portfolio',
    'acc_custom_stocks',
    'bmv_portfolio',
    'bmv_custom_stocks',
    'trading_equity_history',
    'bitunix_alert_config',
    'bitunix_alert_last_notified',
    'trading_auto_trade_amount_usdt',
    'trading_auto_trade_enabled',
    'trading_auto_trade_apex_days',
    'trading_auto_trade_leverage',
    'theme',
]

// Lee un único valor del espejo remoto. Usado por páginas que necesitan ver
// lo mismo en cualquier dispositivo (ej. dashboard) — no solo lo que haya en
// el localStorage de ESE navegador. Devuelve `fallback` si la clave no existe
// o si falla la petición (offline, servidor caído).
export async function fetchFromRemote(key, fallback = null) {
    if (typeof window === 'undefined') return fallback
    try {
        const res = await fetch(`/api/local-store?key=${encodeURIComponent(key)}`)
        if (!res.ok) return fallback
        const data = await res.json()
        return data.value ?? fallback
    } catch {
        return fallback
    }
}

// Espeja un único valor. Se llama desde cada punto de escritura (save*/set*)
// justo después del localStorage.setItem correspondiente — no desde los
// getters, para no disparar un PUT en cada lectura (algunos getters de
// app/lib/autoTrade.js se llaman por cada símbolo escaneado).
export function mirrorToRemote(key, value) {
    if (typeof window === 'undefined') return
    fetch('/api/local-store', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
    }).catch(() => {})
}

// Migración de una sola vez: sube al servidor lo que ya esté guardado en
// localStorage (de sesiones anteriores a este cambio), para no depender de
// que el usuario vuelva a tocar cada ajuste para que aparezca en el espejo
// remoto. Se llama una vez al montar la app (ver ThemeProvider).
export function migrateAllToRemote() {
    if (typeof window === 'undefined') return
    const entries = {}
    for (const key of KNOWN_LOCAL_STORAGE_KEYS) {
        const raw = localStorage.getItem(key)
        if (raw === null) continue
        try { entries[key] = JSON.parse(raw) }
        catch { entries[key] = raw } // 'theme' no es JSON, es el string 'dark'/'light'
    }
    if (Object.keys(entries).length === 0) return
    fetch('/api/local-store', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
    }).catch(() => {})
}
