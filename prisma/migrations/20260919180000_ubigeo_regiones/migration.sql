-- Catálogo SUNAT 13 (ubigeo INEI): región → provincia → distrito.
-- Ubigeo = region.codigo (2) + provincia.codigo_local (2) + distrito.codigo_local (2).

CREATE TABLE `regiones` (
    `codigo` CHAR(2) NOT NULL,
    `nombre` VARCHAR(80) NOT NULL,
    PRIMARY KEY (`codigo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `provincias` (
    `codigo` CHAR(4) NOT NULL,
    `codigo_local` CHAR(2) NOT NULL,
    `nombre` VARCHAR(100) NOT NULL,
    `region_codigo` CHAR(2) NOT NULL,
    PRIMARY KEY (`codigo`),
    INDEX `provincias_region_codigo_idx`(`region_codigo`),
    CONSTRAINT `provincias_region_codigo_fkey`
      FOREIGN KEY (`region_codigo`) REFERENCES `regiones`(`codigo`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `distritos` (
    `codigo` CHAR(6) NOT NULL,
    `codigo_local` CHAR(2) NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `provincia_codigo` CHAR(4) NOT NULL,
    PRIMARY KEY (`codigo`),
    INDEX `distritos_provincia_codigo_idx`(`provincia_codigo`),
    CONSTRAINT `distritos_provincia_codigo_fkey`
      FOREIGN KEY (`provincia_codigo`) REFERENCES `provincias`(`codigo`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
