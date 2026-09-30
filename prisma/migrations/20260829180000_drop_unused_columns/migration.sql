-- Columnas sin uso en aplicación (companies, compras, invoices, linea_catalogo_items)

ALTER TABLE `companies` DROP INDEX `companies_user_id_idx`;

ALTER TABLE `companies`
  DROP COLUMN `user_id`,
  DROP COLUMN `sire_enabled`,
  DROP COLUMN `sire_last_reconciliation_at`,
  DROP COLUMN `tiene_webhook`,
  DROP COLUMN `api_key`,
  DROP COLUMN `api_secret`,
  DROP COLUMN `max_documents_month`,
  DROP COLUMN `documents_this_month`,
  DROP COLUMN `ai_messages_this_month`,
  DROP COLUMN `usage_reset_month`,
  DROP COLUMN `igv_rate_override`,
  DROP COLUMN `nrus_categoria`;

ALTER TABLE `linea_catalogo_items` DROP COLUMN `id`;

ALTER TABLE `compras`
  DROP COLUMN `sunat_estado`,
  DROP COLUMN `sunat_codigo`,
  DROP COLUMN `sunat_descripcion`;

ALTER TABLE `invoices` DROP COLUMN `enviar_automatico`;
