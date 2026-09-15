// Arranca "next dev" (puerto fijo 3001, para no depender de qué puertos
// estén libres al momento de reiniciar) como proceso hijo, y se mantiene
// vivo mientras el hijo viva. Si "next dev" se cae, este proceso también
// termina — y como node-windows administra ESTE script (ver
// install-service.js), Windows lo vuelve a levantar solo.
//
// También arranca scripts/backtest-monitor.js en paralelo: antes el chequeo
// de TP1/SL de las operativas de backtesting solo corría client-side
// (mientras alguien tenía la pestaña de la app abierta), así que operaciones
// ya cerradas en el mercado real se quedaban marcadas "en_proceso" si nadie
// estaba mirando. Al vivir en este mismo servicio, corre 24/7 sin depender
// de ningún navegador.
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.TRADING_DEV_PORT || '3001';

const child = spawn('npx', ['next', 'dev', '-p', PORT], {
    cwd: __dirname,
    shell: true,
    stdio: 'inherit',
});

const monitor = spawn('node', ['scripts/backtest-monitor.js'], {
    cwd: __dirname,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, TRADING_DEV_PORT: PORT },
});

child.on('exit', (code) => {
    monitor.kill();
    process.exit(code ?? 0);
});
child.on('error', (err) => {
    console.error('[service-runner] Error al arrancar "next dev":', err.message);
    monitor.kill();
    process.exit(1);
});

// El monitor no debe tumbar "next dev" si falla al arrancar o se cae — el
// sitio tiene que seguir funcionando igual; solo se pierde el cierre
// automático de operativas hasta que el servicio se reinicie.
monitor.on('error', (err) => {
    console.error('[service-runner] Error al arrancar el monitor de backtesting:', err.message);
});
monitor.on('exit', (code, signal) => {
    if (signal) return; // lo matamos nosotros al cerrar "next dev", no es un fallo
    console.error(`[service-runner] El monitor de backtesting terminó inesperadamente (code ${code}).`);
});

function shutdown(signal) {
    child.kill(signal);
    monitor.kill(signal);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
