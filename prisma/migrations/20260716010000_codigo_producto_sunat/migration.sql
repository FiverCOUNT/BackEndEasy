-- CreateTable
CREATE TABLE `codigo_producto_sunat` (
    `codigo` VARCHAR(8) NOT NULL,
    `nombre` VARCHAR(255) NOT NULL,

    INDEX `codigo_producto_sunat_nombre_idx`(`nombre`),
    PRIMARY KEY (`codigo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
