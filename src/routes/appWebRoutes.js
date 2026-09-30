const express = require('express');
const appModulesWebController = require('../controllers/appModulesWebController');
const appCatalogWebController = require('../controllers/appCatalogWebController');
const appAjustesWebController = require('../controllers/appAjustesWebController');
const appMetodosPagoWebController = require('../controllers/appMetodosPagoWebController');
const appUsuariosWebController = require('../controllers/appUsuariosWebController');
const appEmitirWebController = require('../controllers/appEmitirWebController');
const appOrdenesWebController = require('../controllers/appOrdenesWebController');
const appUbigeoWebController = require('../controllers/appUbigeoWebController');
const webAuthController = require('../controllers/webAuthController');
const uploadAdjunto = require('../middleware/uploadAdjunto');
const uploadEasyLogo = require('../middleware/uploadEasyLogo');
const { requireWebApp } = require('../middleware/webAuth');
const { requireWebAppAdmin } = require('../middleware/webAppPrivileges');
const { APP_BASE } = require('../config/appPanel');

const router = express.Router();

router.use((req, res, next) => {
  res.locals.appBase = APP_BASE;
  next();
});

router.post('/logout', requireWebApp, webAuthController.logout);

router.use(requireWebApp);

router.get('/', appModulesWebController.dashboard);
router.get('/emitir', appEmitirWebController.menu);
router.get('/emitir/datos', appEmitirWebController.datosSunat);
router.post('/emitir/datos', appEmitirWebController.guardarDatosSunat);
router.get('/emitir/tipos', appEmitirWebController.menu);
router.get('/emitir/guia', appEmitirWebController.guiaMenu);
router.get('/emitir/guia/eventos', appEmitirWebController.eventosMenu);
router.get('/emitir/guia/eventos/guias', appEmitirWebController.guiasEventoJson);
router.get('/emitir/guia/eventos/guias/:id', appEmitirWebController.guiaEventoDetalleJson);
router.get('/emitir/guia/eventos/GRE_POR_EVENTO', appEmitirWebController.showGreEventoWizard);
router.post('/emitir/guia/eventos/GRE_POR_EVENTO', appEmitirWebController.submitGreEvento);
router.get('/emitir/guia/eventos/:modo', appEmitirWebController.showEventoForm);
router.post('/emitir/guia/eventos/:modo', appEmitirWebController.submitEvento);
router.get('/emitir/catalogo-stock', appEmitirWebController.catalogoStockJson);
router.get('/emitir/documentos-afectados', appEmitirWebController.documentosAfectadosJson);
router.get('/emitir/documento-afectado/:id/lineas', appEmitirWebController.documentoAfectadoLineasJson);
router.get('/emitir/gre-remitente-recibidas', appEmitirWebController.greRemitenteRecibidasJson);
router.get('/emitir/movimientos-traslado', appEmitirWebController.movimientosTrasladoJson);
router.get('/emitir/movimientos-traslado/:id', appEmitirWebController.movimientoTrasladoDetalleJson);
router.get('/emitir/vehiculos', appEmitirWebController.listVehiculosJson);
router.post('/emitir/vehiculos', appEmitirWebController.createVehiculoJson);
router.put('/emitir/vehiculos/:id', appEmitirWebController.updateVehiculoJson);
router.delete('/emitir/vehiculos/:id', appEmitirWebController.destroyVehiculoJson);
router.get('/emitir/conductores', appEmitirWebController.listConductoresJson);
router.post('/emitir/conductores', appEmitirWebController.createConductorJson);
router.put('/emitir/conductores/:id', appEmitirWebController.updateConductorJson);
router.delete('/emitir/conductores/:id', appEmitirWebController.destroyConductorJson);
router.get('/emitir/transportistas', appEmitirWebController.listTransportistasJson);
router.post('/emitir/transportistas', appEmitirWebController.createTransportistaJson);
router.put('/emitir/transportistas/:id', appEmitirWebController.updateTransportistaJson);
router.delete('/emitir/transportistas/:id', appEmitirWebController.destroyTransportistaJson);
router.post(
  '/emitir/adjuntos',
  uploadAdjunto.single('file'),
  appEmitirWebController.uploadAdjuntoWeb,
);
router.get('/emitir/:tipo', appEmitirWebController.showForm);
router.post('/emitir/:tipo', appEmitirWebController.submitForm);
router.get('/comprobantes', appModulesWebController.comprobantes);
router.post('/comprobantes/eliminar', requireWebAppAdmin, appModulesWebController.eliminarComprobantes);
router.post('/comprobantes/:id/reenviar', appModulesWebController.reenviarComprobante);
router.get('/comprobantes/:id/archivos/:tipo', appModulesWebController.comprobanteArchivo);
router.get('/comprobantes/:id', appModulesWebController.comprobanteDetalleJson);

router.get('/ubigeo/regiones', appUbigeoWebController.regionesJson);
router.get('/ubigeo/regiones/:regionCodigo/provincias', appUbigeoWebController.provinciasJson);
router.get('/ubigeo/provincias/:provinciaCodigo/distritos', appUbigeoWebController.distritosJson);
router.get('/ubigeo/lookup/:ubigeo', appUbigeoWebController.lookupUbigeoJson);

router.get('/ubicaciones', appUbigeoWebController.ubicacionesRecientesJson);
router.post('/ubicaciones', appUbigeoWebController.crearUbicacionJson);
router.put('/ubicaciones/:id', appUbigeoWebController.actualizarUbicacionJson);
router.post('/ubicaciones/:id/tocar', appUbigeoWebController.tocarUbicacionJson);
router.delete('/ubicaciones/:id', appUbigeoWebController.eliminarUbicacionJson);

router.get('/ordenes', appOrdenesWebController.list);
router.get('/ordenes/direcciones-envio', appOrdenesWebController.direccionesEnvioJson);
router.post('/ordenes/direcciones-envio', appOrdenesWebController.crearDireccionEnvioJson);
router.put('/ordenes/direcciones-envio/:addrId', appOrdenesWebController.actualizarDireccionEnvioJson);
router.delete('/ordenes/direcciones-envio/:addrId', appOrdenesWebController.eliminarDireccionEnvioJson);
router.get('/ordenes/catalogo/:catalogItemId/series', appOrdenesWebController.seriesDisponiblesJson);
router.get('/ordenes/crear', appOrdenesWebController.showCreate);
router.post('/ordenes', appOrdenesWebController.create);
router.get('/ordenes/:id', appOrdenesWebController.showDetail);
router.get('/ordenes/:id/editar', appOrdenesWebController.showEdit);
router.post('/ordenes/:id', appOrdenesWebController.update);
router.post('/ordenes/:id/anular', appOrdenesWebController.anular);
router.post('/ordenes/:id/eliminar', appOrdenesWebController.destroy);

router.get('/clientes', appModulesWebController.clientes);
router.get('/clientes/crear', appModulesWebController.showClienteCreate);
router.post('/clientes', appModulesWebController.createCliente);
router.get('/clientes/:id/editar', appModulesWebController.showClienteEdit);
router.post('/clientes/:id', appModulesWebController.updateCliente);
router.get('/clientes/:id', appModulesWebController.showClienteDetail);

router.get('/catalogo/series/buscar', appCatalogWebController.buscarSerieJson);
router.get('/catalogo', appCatalogWebController.list);
router.get('/catalogo/codigos-sunat', appCatalogWebController.searchCodigosSunat);
router.get('/catalogo/crear', requireWebAppAdmin, appCatalogWebController.showCreateForm);
router.post('/catalogo', requireWebAppAdmin, appCatalogWebController.create);
router.get('/catalogo/:id/series', appCatalogWebController.seriesJson);
router.get('/catalogo/:id/editar', requireWebAppAdmin, appCatalogWebController.showEditForm);
router.post('/catalogo/:id', requireWebAppAdmin, appCatalogWebController.update);
router.post('/catalogo/:id/activar', requireWebAppAdmin, appCatalogWebController.activate);
router.post('/catalogo/:id/desactivar', requireWebAppAdmin, appCatalogWebController.deactivate);
router.post('/catalogo/:id/eliminar', requireWebAppAdmin, appCatalogWebController.destroy);

router.get('/compras', requireWebAppAdmin, appModulesWebController.compras);
router.post('/compras/sync', requireWebAppAdmin, appModulesWebController.sincronizarCompras);
router.post('/compras/sincronizar', requireWebAppAdmin, appModulesWebController.sincronizarCompras);
router.post('/compras/eliminar', requireWebAppAdmin, appModulesWebController.eliminarCompras);
router.get('/compras/sync', requireWebAppAdmin, (req, res) => {
  res.redirect(`${APP_BASE}/compras?msg=${encodeURIComponent('Usa el botón Sync / Forzar sync')}&tipo=error`);
});
router.get('/compras/sincronizar', requireWebAppAdmin, (req, res) => {
  res.redirect(`${APP_BASE}/compras?msg=${encodeURIComponent('Usa el botón Sync / Forzar sync')}&tipo=error`);
});
router.get('/compras/:id/pdf', requireWebAppAdmin, appModulesWebController.compraPdf);
router.get('/compras/:id', requireWebAppAdmin, appModulesWebController.compraDetalleJson);

router.get('/salidas', appModulesWebController.salidas);
router.get('/salidas/crear', appModulesWebController.showSalidaCreate);
router.post('/salidas', appModulesWebController.createSalida);
router.post('/salidas/:id/regresar', appModulesWebController.regresarSalida);
router.get('/ingresos', requireWebAppAdmin, appModulesWebController.ingresos);
router.get('/ingresos/crear', requireWebAppAdmin, appModulesWebController.showIngresoCreate);
router.post('/ingresos', requireWebAppAdmin, appModulesWebController.createIngreso);
router.get('/historial', appModulesWebController.historial);

router.get('/almacenes', requireWebAppAdmin, appModulesWebController.almacenes);
router.get('/almacenes/crear', requireWebAppAdmin, appModulesWebController.showAlmacenCreate);
router.post('/almacenes', requireWebAppAdmin, appModulesWebController.createAlmacen);
router.get('/almacenes/:id/editar', requireWebAppAdmin, appModulesWebController.showAlmacenEdit);
router.post('/almacenes/:id', requireWebAppAdmin, appModulesWebController.updateAlmacen);
router.post('/almacenes/:id/activar', requireWebAppAdmin, appModulesWebController.activarAlmacen);
router.post('/almacenes/:id/desactivar', requireWebAppAdmin, appModulesWebController.desactivarAlmacen);
router.post('/almacenes/:id/eliminar', requireWebAppAdmin, appModulesWebController.eliminarAlmacen);

router.get('/ajustes', appAjustesWebController.show);
router.post(
  '/ajustes/logo',
  requireWebAppAdmin,
  uploadEasyLogo.single('logoEmpresa'),
  appAjustesWebController.uploadLogo,
);
router.post('/ajustes/mtc', requireWebAppAdmin, appAjustesWebController.updateMtc);

router.get('/metodos-pago', requireWebAppAdmin, appMetodosPagoWebController.listar);
router.get('/metodos-pago/crear', requireWebAppAdmin, appMetodosPagoWebController.crearForm);
router.post('/metodos-pago', requireWebAppAdmin, appMetodosPagoWebController.crear);
router.get('/metodos-pago/:id/editar', requireWebAppAdmin, appMetodosPagoWebController.editarForm);
router.post('/metodos-pago/:id', requireWebAppAdmin, appMetodosPagoWebController.editar);
router.post('/metodos-pago/:id/desactivar', requireWebAppAdmin, appMetodosPagoWebController.desactivar);

router.get('/usuarios', requireWebAppAdmin, appUsuariosWebController.listar);
router.get('/usuarios/crear', requireWebAppAdmin, appUsuariosWebController.crearForm);
router.post('/usuarios', requireWebAppAdmin, appUsuariosWebController.crear);
router.get('/usuarios/:id/editar', requireWebAppAdmin, appUsuariosWebController.editarForm);
router.post('/usuarios/:id', requireWebAppAdmin, appUsuariosWebController.editar);
router.post('/usuarios/:id/activar', requireWebAppAdmin, appUsuariosWebController.activar);
router.post('/usuarios/:id/desactivar', requireWebAppAdmin, appUsuariosWebController.desactivar);
router.post('/usuarios/:id/eliminar', requireWebAppAdmin, appUsuariosWebController.destroy);

module.exports = router;
