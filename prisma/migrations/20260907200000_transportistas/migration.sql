-- Catálogo de empresas transportistas para GRE (transporte público).
CREATE TABLE IF NOT EXISTS `transportistas` (
  `id` VARCHAR(36) NOT NULL,
  `ruc` VARCHAR(11) NOT NULL,
  `razon_social` VARCHAR(255) NOT NULL,
  `nro_mtc` VARCHAR(40) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transportistas_ruc_key` (`ruc`),
  KEY `transportistas_razon_social_idx` (`razon_social`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
