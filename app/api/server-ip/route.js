import { NextResponse } from 'next/server'

// Corre en el servidor, así que la IP pública que devuelve ipify es la del
// servidor donde está alojado este proyecto (el Windows Service), no la del
// navegador de quien visita el dashboard — es justo lo que se quiere mostrar
// para confirmar en qué máquina está corriendo.
export async function GET() {
    try {
        const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5_000) })
        const json = await res.json()
        return NextResponse.json({ ip: json.ip ?? null })
    } catch (err) {
        return NextResponse.json({ ip: null, error: err.message }, { status: 502 })
    }
}
