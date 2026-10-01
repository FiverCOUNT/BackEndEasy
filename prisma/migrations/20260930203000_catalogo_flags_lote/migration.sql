-- El producto solo indica si controla lote y vencimiento.
-- El número y la fecha se piden al ingresarlo.

ALTER TABLE `catalog_items`
  ADD COLUMN `maneja_lote` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `maneja_vencimiento` BOOLEAN NOT NULL DEFAULT false;
