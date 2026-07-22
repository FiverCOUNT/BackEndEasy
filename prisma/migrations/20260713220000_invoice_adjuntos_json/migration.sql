-- Histórico: se añadió `adjuntos` por error. Superesido por
-- 20260714010000_invoice_archivos_unica (solo columna `archivos`).
-- Se mantiene el ADD para no romper el historial de migraciones ya aplicadas.

ALTER TABLE `invoices`
  ADD COLUMN `adjuntos` JSON NULL AFTER `archivos`;
