const express = require('express');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireCompanyRuc } = require('../../middleware/companyAccess');
const { requireAdmin } = require('../../middleware/requireAdmin');
const catalogItemApiController = require('../../controllers/catalogItemApiController');
const inventarioApiController = require('../../controllers/inventarioApiController');
const almacenApiController = require('../../controllers/almacenApiController');
const clienteApiController = require('../../controllers/clienteApiController');
const ordenApiController = require('../../controllers/ordenApiController');
const comprobanteApiController = require('../../controllers/comprobanteApiController');
const empresaAddressApiController = require('../../controllers/empresaAddressApiController');
const empresaVehiculoApiController = require('../../controllers/empresaVehiculoApiController');
const empresaConductorApiController = require('../../controllers/empresaConductorApiController');
const empresaTransporteApiController = require('../../controllers/empresaTransporteApiController');
const consultaDocumentoApiController = require('../../controllers/consultaDocumentoApiController');
const empresaPerfilApiController = require('../../controllers/empresaPerfilApiController');
const compraApiController = require('../../controllers/compraApiController');
const adjuntoApiController = require('../../controllers/adjuntoApiController');
const codigoProductoSunatApiController = require('../../controllers/codigoProductoSunatApiController');
const usuarioEmpresaApiController = require('../../controllers/usuarioEmpresaApiController');
const metodoPagoApiController = require('../../controllers/metodoPagoApiController');
const appUbigeoWebController = require('../../controllers/appUbigeoWebController');
const uploadAdjunto = require('../../middleware/uploadAdjunto');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireCompanyRuc);

router.post(
  '/uploads/adjuntos',
  uploadAdjunto.single('file'),
  (err, req, res, next) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Error al subir archivo' });
    }
    next();
  },
  adjuntoApiController.upload,
);
router.delete('/uploads/adjuntos', adjuntoApiController.remove);

router.get('/', empresaPerfilApiController.getPerfil);
router.patch('/mtc', empresaPerfilApiController.patchMtc);
router.put('/mtc', empresaPerfilApiController.patchMtc);

router.get('/consulta-ruc', consultaDocumentoApiController.consultarRuc);

router.get('/catalogo', catalogItemApiController.list);
router.get(
  '/catalogo/:catalogItemId/series-disponibles',
  catalogItemApiController.listSeriesDisponibles,
);
router.post('/catalogo', requireAdmin, catalogItemApiController.create);
router.put('/catalogo/:id', requireAdmin, catalogItemApiController.update);
router.patch('/catalogo/:id', requireAdmin, catalogItemApiController.patch);
router.delete('/catalogo/:id', requireAdmin, catalogItemApiController.destroy);

router.get('/codigos-producto-sunat', codigoProductoSunatApiController.list);

router.get('/almacenes', almacenApiController.list);
router.post('/almacenes', requireAdmin, almacenApiController.create);

router.get('/usuarios', requireAdmin, usuarioEmpresaApiController.list);
router.post('/usuarios', requireAdmin, usuarioEmpresaApiController.create);
router.put('/usuarios/:id', requireAdmin, usuarioEmpresaApiController.update);
router.patch('/usuarios/:id', requireAdmin, usuarioEmpresaApiController.update);
router.post('/usuarios/:id/activar', requireAdmin, usuarioEmpresaApiController.activar);
router.post('/usuarios/:id/desactivar', requireAdmin, usuarioEmpresaApiController.desactivar);
router.delete('/usuarios/:id', requireAdmin, usuarioEmpresaApiController.destroy);

router.get('/clientes', clienteApiController.list);
router.post('/clientes', clienteApiController.create);
router.patch('/clientes/:id', clienteApiController.update);

router.get('/ordenes/no-vistas', ordenApiController.countNoVistas);
router.get('/ordenes/direcciones-envio', ordenApiController.direccionesEnvioRecientes);
router.post('/ordenes/direcciones-envio', ordenApiController.crearDireccionEnvio);
router.put('/ordenes/direcciones-envio/:id', ordenApiController.actualizarDireccionEnvio);
router.get('/ordenes', ordenApiController.list);
router.post('/ordenes', ordenApiController.create);
router.post('/ordenes/:id/visto', ordenApiController.marcarVista);
router.get('/ordenes/:id', ordenApiController.getById);
router.put('/ordenes/:id', ordenApiController.update);
router.patch('/ordenes/:id', ordenApiController.update);
router.post('/ordenes/:id/anular', ordenApiController.anular);
router.delete('/ordenes/:id', ordenApiController.destroy);

router.get('/addresses', empresaAddressApiController.list);
router.post('/addresses', empresaAddressApiController.create);
router.put('/addresses/:id', empresaAddressApiController.update);
router.delete('/addresses/:id', empresaAddressApiController.destroy);

/** Catálogo INEI (región → provincia → distrito) para selects de ubicación. */
router.get('/ubigeo/regiones', appUbigeoWebController.regionesJson);
router.get('/ubigeo/regiones/:regionCodigo/provincias', appUbigeoWebController.provinciasJson);
router.get('/ubigeo/provincias/:provinciaCodigo/distritos', appUbigeoWebController.distritosJson);
router.get('/ubigeo/lookup/:ubigeo', appUbigeoWebController.lookupUbigeoJson);

/** Medios de cobro (Yape, CCI, …) — tabla metodos_pago. */
router.get('/metodos-pago', metodoPagoApiController.list);
router.get('/metodos-pago/:id', metodoPagoApiController.getById);
router.post('/metodos-pago', requireAdmin, metodoPagoApiController.create);
router.put('/metodos-pago/:id', requireAdmin, metodoPagoApiController.update);
router.patch('/metodos-pago/:id', requireAdmin, metodoPagoApiController.update);
router.delete('/metodos-pago/:id', requireAdmin, metodoPagoApiController.destroy);

router.get('/vehiculos', empresaVehiculoApiController.list);
router.post('/vehiculos', empresaVehiculoApiController.create);
router.put('/vehiculos/:id', empresaVehiculoApiController.update);
router.delete('/vehiculos/:id', empresaVehiculoApiController.destroy);

router.get('/conductores', empresaConductorApiController.list);
router.get('/conductores/lookup', empresaConductorApiController.lookup);
router.post('/conductores', empresaConductorApiController.create);
router.put('/conductores/:id', empresaConductorApiController.update);
router.delete('/conductores/:id', empresaConductorApiController.destroy);

/** Empresas (tabla companies) usadas como transportista en GRE. */
router.get('/empresas-transporte', empresaTransporteApiController.list);
router.post('/empresas-transporte', empresaTransporteApiController.create);
router.put('/empresas-transporte/:id', empresaTransporteApiController.update);
router.delete('/empresas-transporte/:id', empresaTransporteApiController.destroy);

router.get('/comprobantes/emisor/health', comprobanteApiController.healthEmisor);
router.get('/comprobantes', comprobanteApiController.list);
router.get('/compras', compraApiController.list);
router.post('/compras', compraApiController.create);
/** Sync recibidos desde SUNAT (SIRE+SSPP+scraper) → compras + XML/PDF. Usado por la app al abrir Compras. */
router.post('/compras/sincronizar', compraApiController.sincronizar);
router.post('/compras/sspp/traer', requireAdmin, compraApiController.traerSspp);
router.post('/compras/sire/traer-mes', requireAdmin, compraApiController.traerMesSire);
router.patch('/compras/:id/lineas/:detailId', requireAdmin, compraApiController.relacionarLinea);
router.get('/compras/:id', compraApiController.getById);
router.post('/comprobantes', comprobanteApiController.crearYEmitir);
router.post('/comprobantes/resumen', comprobanteApiController.enviarResumen);
router.post('/comprobantes/:id/gre-eventos', comprobanteApiController.registrarGreEvento);
router.post('/comprobantes/:id/gre-baja', comprobanteApiController.comunicarGreBaja);
router.get('/comprobantes/:id/archivos/:tipo', comprobanteApiController.descargarArchivo);
router.get('/comprobantes/:id/series-entregadas', comprobanteApiController.listSeriesEntregadas);
router.get('/comprobantes/:id', comprobanteApiController.getById);
router.post('/comprobantes/:id/emitir', comprobanteApiController.emitir);
router.post('/comprobantes/:id/restar-almacen', comprobanteApiController.restarAlmacen);
router.delete('/comprobantes/:id', comprobanteApiController.eliminar);

router.post('/inventario/movimientos', inventarioApiController.registrarMovimiento);
router.get('/inventario/movimientos', inventarioApiController.listMovimientos);
router.get('/inventario/movimientos/:id', inventarioApiController.getMovimientoById);
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
