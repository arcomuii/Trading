// Instala service-runner.js (que a su vez levanta "next dev") como un
// Servicio de Windows real (Servicios ⇒ Automático), para que arranque solo
// cuando prenda la máquina y se reinicie solo si el proceso llega a caerse.
// Debe correrse UNA VEZ desde una consola con permisos de Administrador:
// `node install-service.js`.
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
    name: 'TradingDevServer',
    description: 'Levanta "next dev" del proyecto Trading (puerto 3001), con arranque automático al prender la máquina y reinicio si el proceso se cae.',
    script: path.join(__dirname, 'service-runner.js'),
});

svc.on('install', () => {
    console.log('Servicio instalado correctamente. Iniciando...');
    svc.start();
});
svc.on('alreadyinstalled', () => {
    console.log('El servicio ya estaba instalado.');
});
svc.on('start', () => {
    console.log('Servicio iniciado. Revisa "Servicios" de Windows (TradingDevServer) para confirmarlo.');
});
svc.on('error', err => {
    console.error('Error al instalar/iniciar el servicio:', err);
});

svc.install();
