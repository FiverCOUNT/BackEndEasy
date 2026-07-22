const objectStorageService = require('../services/objectStorageService');

async function upload(req, res, next) {
  try {
    if (!objectStorageService.isEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'Almacenamiento Cloudflare R2 no configurado.',
      });
    }
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: 'Archivo requerido (campo file).' });
    }
    const adjunto = await objectStorageService.uploadAdjunto(
      req.companyRuc,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return res.status(201).json({
      success: true,
      adjunto,
    });
  } catch (err) {
    if (err.message && /tipo de archivo|file size|File too large/i.test(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const key = String(req.body?.key || req.query?.key || '').trim();
    if (!key) {
      return res.status(400).json({ success: false, message: 'key es obligatorio.' });
    }
    if (!objectStorageService.isAdjuntoKeyForCompany(key, req.companyRuc)) {
      return res.status(403).json({ success: false, message: 'No autorizado a eliminar este archivo.' });
    }
    await objectStorageService.deleteObject(key);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  upload,
  remove,
};
