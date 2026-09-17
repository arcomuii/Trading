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
//
// scripts/forex-bot.mjs (pedido explícito, 2026-09-17): el bot de trading
// REAL de Confluencia Forex — abre operaciones de verdad en Capital.com
// (cuenta LIVE, dinero real) cuando encuentra un setup válido. Mismo motivo
// que el monitor de arriba para vivir en este servicio: "de forma
// independiente", 24/7, sin depender de que alguien deje una terminal
// abierta ni de que el navegador esté abierto.
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

const forexBot = spawn('node', ['scripts/forex-bot.mjs'], {
    cwd: __dirname,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, TRADING_DEV_PORT: PORT },
});

child.on('exit', (code) => {
    monitor.kill();
    forexBot.kill();
    process.exit(code ?? 0);
});
child.on('error', (err) => {
    console.error('[service-runner] Error al arrancar "next dev":', err.message);
    monitor.kill();
    forexBot.kill();
    process.exit(1);
});

// Ni el monitor ni el bot de forex deben tumbar "next dev" si fallan al
// arrancar o se caen — el sitio tiene que seguir funcionando igual; solo se
// pierde ese chequeo/bot hasta que el servicio se reinicie.
monitor.on('error', (err) => {
    console.error('[service-runner] Error al arrancar el monitor de backtesting:', err.message);
});
monitor.on('exit', (code, signal) => {
    if (signal) return; // lo matamos nosotros al cerrar "next dev", no es un fallo
    console.error(`[service-runner] El monitor de backtesting terminó inesperadamente (code ${code}).`);
});

forexBot.on('error', (err) => {
    console.error('[service-runner] Error al arrancar el bot de forex:', err.message);
});
forexBot.on('exit', (code, signal) => {
    if (signal) return; // lo matamos nosotros al cerrar "next dev", no es un fallo
    console.error(`[service-runner] El bot de forex terminó inesperadamente (code ${code}).`);
});

function shutdown(signal) {
    child.kill(signal);
    monitor.kill(signal);
    forexBot.kill(signal);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
