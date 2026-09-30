-- Varias órdenes pueden reutilizar la misma dirección de envío.
ALTER TABLE `ordenes` DROP FOREIGN KEY `ordenes_address_envio_id_fkey`;
DROP INDEX `ordenes_address_envio_id_key` ON `ordenes`;
CREATE INDEX `ordenes_address_envio_id_idx` ON `ordenes`(`address_envio_id`);
ALTER TABLE `ordenes` ADD CONSTRAINT `ordenes_address_envio_id_fkey` FOREIGN KEY (`address_envio_id`) REFERENCES `addresses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
