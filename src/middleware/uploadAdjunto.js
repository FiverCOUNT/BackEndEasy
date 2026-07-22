const multer = require('multer');

const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|pdf|doc|docx|xls|xlsx|txt|csv|zip)$/i;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const nameOk = ALLOWED_EXT.test(file.originalname || '');
    const mimeOk = ALLOWED_MIME.has(String(file.mimetype || '').toLowerCase());
    if (!nameOk && !mimeOk) {
      return cb(new Error('Tipo de archivo no permitido. Usa imagen, PDF, Word, Excel, TXT o ZIP.'));
    }
    cb(null, true);
  },
});

module.exports = upload;
