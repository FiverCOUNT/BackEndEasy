require('../src/config/env');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQL = `
CREATE TABLE IF NOT EXISTS compras (
  id VARCHAR(36) NOT NULL,
  company_ruc VARCHAR(11) NOT NULL,
  tipo_doc VARCHAR(4) NOT NULL DEFAULT '01',
  serie VARCHAR(10) NOT NULL,
  correlativo VARCHAR(20) NOT NULL,
  fecha_emision VARCHAR(30) NULL,
  tipo_moneda VARCHAR(3) NOT NULL DEFAULT 'PEN',
  proveedor_tipo_doc VARCHAR(2) NOT NULL DEFAULT '6',
  proveedor_numero_doc VARCHAR(15) NOT NULL,
  proveedor_razon_social VARCHAR(255) NOT NULL,
  sub_total DECIMAL(14,4) NULL,
  mto_igv DECIMAL(14,4) NULL,
  mto_imp_venta DECIMAL(14,4) NULL,
  lineas JSON NOT NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'OCR',
  imagen_url VARCHAR(500) NULL,
  observacion TEXT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY compras_company_doc_unique (company_ruc, tipo_doc, serie, correlativo, proveedor_numero_doc),
  KEY compras_company_ruc_idx (company_ruc),
  KEY compras_proveedor_idx (proveedor_numero_doc)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

async function main() {
  await prisma.$executeRawUnsafe(SQL);
  console.log('OK: tabla compras lista');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
