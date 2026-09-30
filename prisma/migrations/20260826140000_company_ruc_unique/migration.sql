-- Evita stubs duplicados de emisores al resincronizar recibidos.
-- Prefijo: dropear índice no-único previo si existe.
DROP INDEX `companies_ruc_idx` ON `companies`;
CREATE UNIQUE INDEX `companies_ruc_key` ON `companies`(`ruc`);
