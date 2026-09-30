const clienteModel = require('../models/clienteModel');
const { parseMobileListQuery, sendMobilePage } = require('../utils/pagination');

async function list(req, res, next) {
  try {
    const soloActivos = req.query.solo_activos !== 'false';
    const { q, page, pageSize, skip } = parseMobileListQuery(req.query);
    const { items, total } = await clienteModel.findByCompanyPaginated(req.companyRuc, {
      soloActivos,
      q,
      skip,
      take: pageSize,
    });
    return sendMobilePage(res, { items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const parsed = clienteModel.parseCreateBody(req.body);

    if (!parsed.numeroDoc) {
      return res.status(400).json({ success: false, message: 'numero_doc es obligatorio' });
    }
    if (!parsed.razonSocial) {
      return res.status(400).json({ success: false, message: 'razon_social es obligatoria' });
    }

    const duplicado = await clienteModel.findByDocumento(
      req.companyRuc,
      parsed.tipoDoc,
      parsed.numeroDoc,
    );
    if (duplicado) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un cliente con ese documento',
      });
    }

    const { addressInput, ...clienteData } = parsed;
    const row = await clienteModel.create({
      companyRuc: req.companyRuc,
      ...clienteData,
      addressInput,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = clienteModel.parseUpdateBody(req.body);

    if (parsed.razonSocial !== undefined && !parsed.razonSocial) {
      return res.status(400).json({ success: false, message: 'razon_social es obligatoria' });
    }

    const row = await clienteModel.update(id, req.companyRuc, parsed);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update };
