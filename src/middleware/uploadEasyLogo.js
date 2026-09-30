const multer = require('multer');

const ALLOWED = /\.(png|jpe?g|webp|svg|gif)$/i;
const ALLOWED_MIME = /^(image\/(png|jpeg|webp|gif|svg\+xml))$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const okName = ALLOWED.test(file.originalname || '');
    const okMime = ALLOWED_MIME.test(file.mimetype || '');
    if (!okName && !okMime) {
      return cb(new Error('El logo Easy debe ser PNG, JPG, WEBP, SVG o GIF (máx. 2 MB).'));
    }
    cb(null, true);
  },
});

module.exports = upload;
