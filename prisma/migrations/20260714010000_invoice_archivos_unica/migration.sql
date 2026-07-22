-- Una sola columna JSON `archivos` (clave → valor). Quita `adjuntos`.

UPDATE `invoices`
SET `archivos` = `adjuntos`
WHERE `adjuntos` IS NOT NULL
  AND (`archivos` IS NULL OR JSON_TYPE(`archivos`) = 'NULL' OR JSON_LENGTH(`archivos`) = 0);

ALTER TABLE `invoices` DROP COLUMN `adjuntos`;
