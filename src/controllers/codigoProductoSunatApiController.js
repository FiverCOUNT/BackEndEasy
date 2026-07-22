const codigoProductoSunatModel = require('../models/codigoProductoSunatModel');
const { parseListQuery } = require('../utils/pagination');

async function list(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseListQuery({
      ...req.query,
      limit: req.query.limit || req.query.pageSize || 40,
    });

    const { total, items } = await codigoProductoSunatModel.findPaginated({
      q,
      page,
      pageSize,
      skip,
    });

    res.json({
      success: true,
      items,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
