-- Dirección de envío de la orden (FK explícita address_envio_id → addresses).
ALTER TABLE `ordenes` ADD COLUMN `address_envio_id` VARCHAR(36) NULL;

CREATE UNIQUE INDEX `ordenes_address_envio_id_key` ON `ordenes`(`address_envio_id`);

ALTER TABLE `ordenes` ADD CONSTRAINT `ordenes_address_envio_id_fkey` FOREIGN KEY (`address_envio_id`) REFERENCES `addresses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
