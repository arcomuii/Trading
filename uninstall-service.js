// Quita el Servicio de Windows instalado por install-service.js. Debe
// correrse desde una consola con permisos de Administrador:
// `node uninstall-service.js`.
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
    name: 'TradingDevServer',
    script: path.join(__dirname, 'service-runner.js'),
});

svc.on('uninstall', () => {
    console.log('Servicio desinstalado correctamente.');
});
svc.on('error', err => {
    console.error('Error al desinstalar el servicio:', err);
});

svc.uninstall();
