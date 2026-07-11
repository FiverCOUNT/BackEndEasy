const express = require('express');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireCompanyRuc } = require('../../middleware/companyAccess');
const { requireAdmin } = require('../../middleware/requireAdmin');
const catalogItemApiController = require('../../controllers/catalogItemApiController');
const inventarioApiController = require('../../controllers/inventarioApiController');
const almacenApiController = require('../../controllers/almacenApiController');
const clienteApiController = require('../../controllers/clienteApiController');
const comprobanteApiController = require('../../controllers/comprobanteApiController');
const empresaAddressApiController = require('../../controllers/empresaAddressApiController');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireCompanyRuc);

router.get('/catalogo', catalogItemApiController.list);
router.get(
  '/catalogo/:catalogItemId/series-disponibles',
  catalogItemApiController.listSeriesDisponibles,
);
router.post('/catalogo', requireAdmin, catalogItemApiController.create);
router.put('/catalogo/:id', requireAdmin, catalogItemApiController.update);
router.patch('/catalogo/:id', requireAdmin, catalogItemApiController.patch);
router.delete('/catalogo/:id', requireAdmin, catalogItemApiController.destroy);

router.get('/almacenes', almacenApiController.list);
router.post('/almacenes', requireAdmin, almacenApiController.create);

router.get('/clientes', clienteApiController.list);
router.post('/clientes', clienteApiController.create);

router.get('/addresses', empresaAddressApiController.list);
router.post('/addresses', empresaAddressApiController.create);
router.put('/addresses/:id', empresaAddressApiController.update);
router.delete('/addresses/:id', empresaAddressApiController.destroy);

router.get('/comprobantes/emisor/health', comprobanteApiController.healthEmisor);
router.get('/comprobantes', comprobanteApiController.list);
router.get('/compras', comprobanteApiController.listCompras);
router.post('/comprobantes', comprobanteApiController.crearYEmitir);
router.post('/comprobantes/resumen', comprobanteApiController.enviarResumen);
router.post('/comprobantes/:id/gre-eventos', comprobanteApiController.registrarGreEvento);
router.post('/comprobantes/:id/gre-baja', comprobanteApiController.comunicarGreBaja);
router.get('/comprobantes/:id/archivos/:tipo', comprobanteApiController.descargarArchivo);
router.get('/comprobantes/:id/series-entregadas', comprobanteApiController.listSeriesEntregadas);
router.get('/comprobantes/:id', comprobanteApiController.getById);
router.post('/comprobantes/:id/emitir', comprobanteApiController.emitir);
router.delete('/comprobantes/:id', comprobanteApiController.eliminar);

router.post('/inventario/movimientos', inventarioApiController.registrarMovimiento);
router.get('/inventario/movimientos', inventarioApiController.listMovimientos);
router.post('/inventario/entradas', inventarioApiController.registrarEntrada);
router.post('/inventario/salidas', inventarioApiController.registrarSalida);
router.get('/entregas', inventarioApiController.listSalidas);
router.post('/entregas', inventarioApiController.registrarSalida);
router.get('/inventario/ubicaciones', inventarioApiController.buscarUbicaciones);
router.get('/inventario/devoluciones', inventarioApiController.listDevolucionesPendientes);
router.get('/inventario', inventarioApiController.list);
router.get('/inventario/:id', inventarioApiController.getById);
router.put('/inventario/saldos', requireAdmin, inventarioApiController.setSaldo);
router.patch('/inventario/saldos', requireAdmin, inventarioApiController.adjustSaldo);

module.exports = router;
