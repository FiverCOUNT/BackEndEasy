DROP TABLE IF EXISTS `invoice_documentos_relacionados`;

CREATE TABLE `invoice_documentos_relacionados` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(36) NOT NULL,
    `invoice_relacionado_id` VARCHAR(36) NOT NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `inv_docs_rel_unique`(`invoice_id`, `invoice_relacionado_id`),
    INDEX `inv_docs_rel_invoice_idx`(`invoice_id`),
    INDEX `inv_docs_rel_relacionado_idx`(`invoice_relacionado_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `invoice_documentos_relacionados`
  ADD CONSTRAINT `inv_docs_rel_invoice_fkey`
    FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `inv_docs_rel_relacionado_fkey`
    FOREIGN KEY (`invoice_relacionado_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
