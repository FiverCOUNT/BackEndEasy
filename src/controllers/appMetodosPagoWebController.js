const metodoPagoModel = require('../models/metodoPagoModel');
const { layoutLocals, redirectWithFlash, companyRucOf, parseFlash } = require('../utils/appWebHelpers');
const { appPath } = require('../config/appPanel');

const TIPOS_UI = [
  { value: 'YAPE', label: 'Yape' },
  { value: 'CCI', label: 'CCI' },
  { value: 'PLIN', label: 'Plin' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'EFECTIVO', label: 'Efectivo', sinValor: true },
  { value: 'OTRO', label: 'Otro' },
];

function emptyForm() {
  return {
    nombre: '',
    tipo: 'YAPE',
    valor: '',
    activo: true,
  };
}

async function listar(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const q = String(req.query.q || '').trim();
    const items = await metodoPagoModel.listByCompany(companyRuc, { q });
    res.render('app/metodos-pago/listar', layoutLocals(res, {
      title: 'Métodos de pago',
      active: 'ajustes',
      items,
      q,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

async function crearForm(req, res, next) {
  try {
    res.render('app/metodos-pago/form', layoutLocals(res, {
      title: 'Nuevo método de pago',
      active: 'ajustes',
      mode: 'crear',
      form: emptyForm(),
      tipos: TIPOS_UI,
      error: null,
      flash: null,
    }));
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    await metodoPagoModel.create(companyRuc, req.body || {});
    return redirectWithFlash(res, appPath('/metodos-pago'), 'Método de pago creado.');
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).render('app/metodos-pago/form', layoutLocals(res, {
        title: 'Nuevo método de pago',
        active: 'ajustes',
        mode: 'crear',
        form: {
          nombre: req.body?.nombre || '',
          tipo: req.body?.tipo || 'YAPE',
          valor: req.body?.valor || '',
          activo: req.body?.activo !== '0',
        },
        tipos: TIPOS_UI,
        error: err.message,
        flash: null,
      }));
    }
    next(err);
  }
}

async function editarForm(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const item = await metodoPagoModel.findById(companyRuc, req.params.id);
    if (!item) {
      return redirectWithFlash(res, appPath('/metodos-pago'), 'Método no encontrado.', 'error');
    }
    res.render('app/metodos-pago/form', layoutLocals(res, {
      title: 'Editar método de pago',
      active: 'ajustes',
      mode: 'editar',
      form: {
        id: item.id,
        nombre: item.nombre,
        tipo: item.tipo,
        valor: item.valor,
        activo: item.activo,
      },
      tipos: TIPOS_UI,
      error: null,
      flash: null,
    }));
  } catch (err) {
    next(err);
  }
}

async function editar(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = req.params.id;
    await metodoPagoModel.update(companyRuc, id, {
      ...(req.body || {}),
      activo: req.body?.activo === 'on' || req.body?.activo === '1' || req.body?.activo === true,
    });
    return redirectWithFlash(res, appPath('/metodos-pago'), 'Método de pago actualizado.');
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).render('app/metodos-pago/form', layoutLocals(res, {
        title: 'Editar método de pago',
        active: 'ajustes',
        mode: 'editar',
        form: {
          id: req.params.id,
          nombre: req.body?.nombre || '',
          tipo: req.body?.tipo || 'YAPE',
          valor: req.body?.valor || '',
          activo: req.body?.activo === 'on' || req.body?.activo === '1',
        },
        tipos: TIPOS_UI,
        error: err.message,
        flash: null,
      }));
    }
    next(err);
  }
}

async function desactivar(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    await metodoPagoModel.remove(companyRuc, req.params.id);
    return redirectWithFlash(res, appPath('/metodos-pago'), 'Método de pago desactivado.');
  } catch (err) {
    if (err.status === 404) {
      return redirectWithFlash(res, appPath('/metodos-pago'), err.message, 'error');
    }
    next(err);
  }
}

module.exports = {
  listar,
  crearForm,
  crear,
  editarForm,
  editar,
  desactivar,
};
