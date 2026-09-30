const { randomUUID } = require('crypto');
require('../src/config/env');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_RUC = '20100000001';

const IDS = {
  addrCompany: 'a1000001-0001-4000-8000-000000000001',
  addrCliente: 'a1000001-0001-4000-8000-000000000002',
  addrAlmacen: 'a1000001-0001-4000-8000-000000000003',
  almacenPrincipal: 'b1000001-0001-4000-8000-000000000001',
  almacenSecundario: 'b1000001-0001-4000-8000-000000000002',
  almacen03: 'b1000001-0001-4000-8000-000000000003',
  almacen04: 'b1000001-0001-4000-8000-000000000004',
  almacen05: 'b1000001-0001-4000-8000-000000000005',
  almacen06: 'b1000001-0001-4000-8000-000000000006',
  almacen07: 'b1000001-0001-4000-8000-000000000007',
  cliente: 'c1000001-0001-4000-8000-000000000001',
  catalogLaptop: 'd1000001-0001-4000-8000-000000000001',
  catalogServicio: 'd1000001-0001-4000-8000-000000000002',
  catalogMouse: 'd1000001-0001-4000-8000-000000000003',
  catalogTeclado: 'd1000001-0001-4000-8000-000000000004',
  catalogProductoSeries: 'd1000001-0001-4000-8000-000000000005',
  serieLaptop: 'e1000001-0001-4000-8000-000000000001',
  serieLaptop2: 'e1000001-0001-4000-8000-000000000002',
  invMousePrincipal: 'i1000001-0001-4000-8000-000000000001',
  invMouseSecundario: 'i1000001-0001-4000-8000-000000000002',
  invSerieLaptop: 'i1000001-0001-4000-8000-000000000003',
  invTecladoPrincipal: 'i1000001-0001-4000-8000-000000000004',
  invTecladoSecundario: 'i1000001-0001-4000-8000-000000000005',
  invSerieLaptop2: 'i1000001-0001-4000-8000-000000000006',
  invoiceFactura: 'f1000001-0001-4000-8000-000000000001',
  invoiceGuia: 'f1000001-0001-4000-8000-000000000002',
  movimientoEntrada: 'm1000001-0001-4000-8000-000000000001',
};

async function clearDemoData() {
  await prisma.lineaCatalogoItem.deleteMany({
    where: { movimiento: { companyRuc: DEMO_RUC } },
  });
  await prisma.movimiento.deleteMany({ where: { companyRuc: DEMO_RUC } });
  await prisma.legend.deleteMany({
    where: { invoice: { companyRuc: DEMO_RUC } },
  });
  await prisma.saleDetail.deleteMany({
    where: { invoice: { companyRuc: DEMO_RUC } },
  });
  await prisma.inventario.deleteMany({ where: { companyRuc: DEMO_RUC } });
  await prisma.productoSerie.deleteMany({ where: { companyRuc: DEMO_RUC } });
  await prisma.invoice.deleteMany({ where: { companyRuc: DEMO_RUC } });
  await prisma.catalogItem.deleteMany({ where: { companyRuc: DEMO_RUC } });
  await prisma.cliente.deleteMany({ where: { companyRuc: DEMO_RUC } });
  await prisma.almacen.deleteMany({ where: { companyRuc: DEMO_RUC } });

  const company = await prisma.company.findFirst({ where: { ruc: DEMO_RUC } });
  if (company) {
    await prisma.usuario.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }

  await prisma.address.deleteMany({
    where: { id: { in: [IDS.addrCompany, IDS.addrCliente, IDS.addrAlmacen] } },
  });
}

async function main() {
  console.log('Limpiando datos demo anteriores...');
  await clearDemoData();

  const now = BigInt(Date.now());
  const fecha = new Date().toISOString().slice(0, 10);

  console.log('Insertando addresses...');
  await prisma.address.createMany({
    data: [
      {
        id: IDS.addrCompany,
        ubigeo: '150101',
        departamento: 'Lima',
        provincia: 'Lima',
        distrito: 'Lima',
        direccion: 'Av. Demo 123, Lima',
        codLocal: '0000',
      },
      {
        id: IDS.addrCliente,
        ubigeo: '150102',
        departamento: 'Lima',
        provincia: 'Lima',
        distrito: 'San Isidro',
        direccion: 'Calle Cliente 456',
        codLocal: '0000',
      },
      {
        id: IDS.addrAlmacen,
        ubigeo: '150103',
        departamento: 'Lima',
        provincia: 'Lima',
        distrito: 'Ate',
        direccion: 'Jr. Almacén 789',
        codLocal: '0000',
      },
    ],
  });

  console.log('Insertando company...');
  const company = await prisma.company.create({
    data: {
      ruc: DEMO_RUC,
      nombre: 'Empresa Demo SAC',
      nombreComercial: 'Demo Store',
      tipoDoc: '6',
      numeroDoc: DEMO_RUC,
      addressId: IDS.addrCompany,
      email: 'contacto@empresademo.pe',
      telefono: '014567890',
      telefonos: ['014567890', '999888777'],
      activo: true,
      entorno: 'beta',
      plan: 'pro',
      taxRegime: 'RER',
      creadoEn: fecha,
    },
  });

  console.log('Insertando almacenes (7)...');
  await prisma.almacen.createMany({
    data: [
      {
        id: IDS.almacenPrincipal,
        companyRuc: DEMO_RUC,
        codigo: 'ALM01',
        nombre: 'Almacén Principal',
        addressId: IDS.addrAlmacen,
        activo: true,
      },
      {
        id: IDS.almacenSecundario,
        companyRuc: DEMO_RUC,
        codigo: 'ALM02',
        nombre: 'Almacén Secundario',
        activo: true,
      },
      {
        id: IDS.almacen03,
        companyRuc: DEMO_RUC,
        codigo: 'ALM03',
        nombre: 'Bodega Lima Norte',
        activo: true,
      },
      {
        id: IDS.almacen04,
        companyRuc: DEMO_RUC,
        codigo: 'ALM04',
        nombre: 'Bodega Lima Sur',
        activo: true,
      },
      {
        id: IDS.almacen05,
        companyRuc: DEMO_RUC,
        codigo: 'ALM05',
        nombre: 'Centro de distribución Callao',
        activo: true,
      },
      {
        id: IDS.almacen06,
        companyRuc: DEMO_RUC,
        codigo: 'ALM06',
        nombre: 'Sucursal Arequipa',
        activo: true,
      },
      {
        id: IDS.almacen07,
        companyRuc: DEMO_RUC,
        codigo: 'ALM07',
        nombre: 'Sucursal Trujillo',
        activo: false,
      },
    ],
  });

  console.log('Insertando usuario...');
  const contrasenaHash = await bcrypt.hash('demo123', 10);

  // Admin de plataforma (panel web, sin empresa).
  await prisma.usuario.create({
    data: {
      email: 'admin@factapp.local',
      contrasena: await bcrypt.hash('Admin123!', 10),
      lastUpdated: now,
      estado: 'ACTIVO',
      rol: 'ADMIN',
    },
  });

  await prisma.usuario.create({
    data: {
      email: 'demo@empresademo.pe',
      contrasena: contrasenaHash,
      lastUpdated: now,
      estado: 'ACTIVO',
      rol: 'ADMIN',
      companyId: company.id,
      almacenId: IDS.almacenPrincipal,
    },
  });

  await prisma.usuario.create({
    data: {
      email: 'bodega@empresademo.pe',
      contrasena: contrasenaHash,
      lastUpdated: now,
      estado: 'ACTIVO',
      rol: 'USUARIO',
      companyId: company.id,
      almacenId: IDS.almacenPrincipal,
    },
  });

  console.log('Insertando cliente...');
  await prisma.cliente.create({
    data: {
      id: IDS.cliente,
      companyRuc: DEMO_RUC,
      tipoDoc: '6',
      numeroDoc: '20123456789',
      razonSocial: 'Cliente Demo SRL',
      addressId: IDS.addrCliente,
      telefono: '999111222',
      activo: true,
    },
  });

  console.log('Insertando catalog items...');
  await prisma.catalogItem.createMany({
    data: [
      {
        id: IDS.catalogLaptop,
        companyRuc: DEMO_RUC,
        kind: 'PRODUCT',
        nombre: 'Laptop Demo 15"',
        descripcion: 'Equipo portátil demo',
        unidad: 'NIU',
        precioUnitario: 2499.99,
        afectacionIgv: '10',
        activo: true,
        manejaStock: true,
        manejaSerie: true,
        stockActual: null,
      },
      {
        id: IDS.catalogMouse,
        companyRuc: DEMO_RUC,
        kind: 'PRODUCT',
        nombre: 'Mouse inalámbrico',
        unidad: 'NIU',
        precioUnitario: 49.9,
        manejaStock: true,
        stockActual: null,
      },
      {
        id: IDS.catalogServicio,
        companyRuc: DEMO_RUC,
        kind: 'SERVICE',
        nombre: 'Consultoría técnica',
        descripcion: 'Servicio por hora',
        unidad: 'ZZ',
        precioUnitario: 150,
        duracionMinutos: 60,
      },
      {
        id: IDS.catalogTeclado,
        companyRuc: DEMO_RUC,
        kind: 'PRODUCT',
        nombre: 'Teclado USB',
        descripcion: 'Teclado estándar USB',
        unidad: 'NIU',
        precioUnitario: 89.9,
        manejaStock: true,
        stockActual: null,
      },
      {
        id: IDS.catalogProductoSeries,
        companyRuc: DEMO_RUC,
        kind: 'PRODUCT',
        nombre: 'Producto Series',
        descripcion: 'Producto demo con números de serie',
        unidad: 'NIU',
        precioUnitario: 199,
        manejaStock: true,
        manejaSerie: true,
        stockActual: null,
      },
    ],
  });

  console.log('Insertando invoices...');
  await prisma.invoice.createMany({
    data: [
      {
        id: IDS.invoiceFactura,
        companyRuc: DEMO_RUC,
        tipoDoc: '01',
        serie: 'F001',
        correlativo: '00000001',
        fechaEmision: fecha,
        tipoMoneda: 'PEN',
        formaPago: 'Contado',
        mtoOperGravadas: 2118.64,
        mtoIgv: 381.35,
        subTotal: 2118.64,
        mtoImpVenta: 2499.99,
        totalImpuestos: 381.35,
        estado: 'BORRADOR',
        clienteId: IDS.cliente,
        observacion: 'Factura demo',
      },
      {
        id: IDS.invoiceGuia,
        companyRuc: DEMO_RUC,
        tipoDoc: '09',
        serie: 'T001',
        correlativo: '00000001',
        fechaEmision: fecha,
        estado: 'BORRADOR',
        observacion: 'Guía de remisión demo',
      },
    ],
  });

  console.log('Insertando sale details y legends...');
  await prisma.saleDetail.create({
    data: {
      invoiceId: IDS.invoiceFactura,
      catalogItemId: IDS.catalogLaptop,
      descripcion: 'Laptop Demo 15"',
      nombre: 'Laptop Demo 15"',
      cantidad: 1,
      unidad: 'NIU',
      mtoPrecioUnitario: 2499.99,
      tipAfeIgv: '10',
      mtoValorVenta: 2118.64,
      mtoIgv: 381.35,
      totalFactura: 2499.99,
      mtoBaseIgv: 2118.64,
      porcentajeIgv: 18,
    },
  });

  await prisma.legend.createMany({
    data: [
      {
        invoiceId: IDS.invoiceFactura,
        code: '1000',
        value: 'DOS MIL CUATROCIENTOS NOVENTA Y NUEVE CON 99/100 SOLES',
      },
      {
        invoiceId: IDS.invoiceFactura,
        code: '2000',
        value: 'SON DOS MIL CUATROCIENTOS NOVENTA Y NUEVE CON 99/100 SOLES',
      },
    ],
  });

  console.log('Insertando inventario...');
  await prisma.inventario.createMany({
    data: [
      {
        id: IDS.invMousePrincipal,
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogMouse,
        almacenId: IDS.almacenPrincipal,
        saldoKey: `${IDS.catalogMouse}:${IDS.almacenPrincipal}`,
        cantidad: 20,
      },
      {
        id: IDS.invMouseSecundario,
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogMouse,
        almacenId: IDS.almacenSecundario,
        saldoKey: `${IDS.catalogMouse}:${IDS.almacenSecundario}`,
        cantidad: 5,
      },
      {
        id: IDS.invTecladoPrincipal,
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogTeclado,
        almacenId: IDS.almacenPrincipal,
        saldoKey: `${IDS.catalogTeclado}:${IDS.almacenPrincipal}`,
        cantidad: 15,
      },
      {
        id: IDS.invTecladoSecundario,
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogTeclado,
        almacenId: IDS.almacenSecundario,
        saldoKey: `${IDS.catalogTeclado}:${IDS.almacenSecundario}`,
        cantidad: 8,
      },
    ],
  });

  console.log('Insertando producto serie...');
  await prisma.productoSerie.create({
    data: {
      id: IDS.serieLaptop,
      companyRuc: DEMO_RUC,
      catalogItemId: IDS.catalogLaptop,
      numeroSerie: 'SN-DEMO-LAP-001',
      almacenId: IDS.almacenPrincipal,
      estado: 'DISPONIBLE',
      comprobanteId: IDS.invoiceFactura,
    },
  });

  await prisma.inventario.create({
    data: {
      id: IDS.invSerieLaptop,
      companyRuc: DEMO_RUC,
      catalogItemId: IDS.catalogLaptop,
      almacenId: IDS.almacenPrincipal,
      productoSerieId: IDS.serieLaptop,
      cantidad: 1,
    },
  });

  await prisma.productoSerie.create({
    data: {
      id: IDS.serieLaptop2,
      companyRuc: DEMO_RUC,
      catalogItemId: IDS.catalogLaptop,
      numeroSerie: 'SN-DEMO-LAP-002',
      almacenId: IDS.almacenSecundario,
      estado: 'DISPONIBLE',
    },
  });

  await prisma.inventario.create({
    data: {
      id: IDS.invSerieLaptop2,
      companyRuc: DEMO_RUC,
      catalogItemId: IDS.catalogLaptop,
      almacenId: IDS.almacenSecundario,
      productoSerieId: IDS.serieLaptop2,
      cantidad: 1,
    },
  });

  console.log('Insertando 20 series de Producto Series (10 por almacén)...');
  for (let i = 1; i <= 10; i += 1) {
    const serieId = randomUUID();
    const numeroSerie = `PS-SERIES-${String(i).padStart(3, '0')}`;
    await prisma.productoSerie.create({
      data: {
        id: serieId,
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogProductoSeries,
        numeroSerie,
        almacenId: IDS.almacenPrincipal,
        estado: 'DISPONIBLE',
      },
    });
    await prisma.inventario.create({
      data: {
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogProductoSeries,
        almacenId: IDS.almacenPrincipal,
        productoSerieId: serieId,
        cantidad: 1,
      },
    });
  }
  for (let i = 11; i <= 20; i += 1) {
    const serieId = randomUUID();
    const numeroSerie = `PS-SERIES-${String(i).padStart(3, '0')}`;
    await prisma.productoSerie.create({
      data: {
        id: serieId,
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogProductoSeries,
        numeroSerie,
        almacenId: IDS.almacenSecundario,
        estado: 'DISPONIBLE',
      },
    });
    await prisma.inventario.create({
      data: {
        companyRuc: DEMO_RUC,
        catalogItemId: IDS.catalogProductoSeries,
        almacenId: IDS.almacenSecundario,
        productoSerieId: serieId,
        cantidad: 1,
      },
    });
  }

  console.log('Insertando movimiento y líneas...');
  await prisma.movimiento.create({
    data: {
      id: IDS.movimientoEntrada,
      companyRuc: DEMO_RUC,
      almacenId: IDS.almacenPrincipal,
      tipo: 'ENTRADA',
      fecha,
      observaciones: 'Ingreso inicial demo',
      numero: 'MOV-0001',
      estado: 'DESPACHADA',
      comprobanteId: IDS.invoiceFactura,
      guiaRemisionId: IDS.invoiceGuia,
      lineas: {
        create: [
          {
            catalogItemId: IDS.catalogLaptop,
            nombre: 'Laptop Demo 15"',
            codigo: 'LAP-001',
            cantidad: 5,
            unidad: 'NIU',
            precioUnitario: 2499.99,
            afectacionIgv: '10',
            kind: 'PRODUCT',
            manejaStock: true,
            manejaSerie: true,
            almacenId: IDS.almacenPrincipal,
            productoSerieId: IDS.serieLaptop,
          },
          {
            catalogItemId: IDS.catalogMouse,
            nombre: 'Mouse inalámbrico',
            codigo: 'MOU-001',
            cantidad: 20,
            unidad: 'NIU',
            precioUnitario: 49.9,
            kind: 'PRODUCT',
            manejaStock: true,
            almacenId: IDS.almacenPrincipal,
          },
        ],
      },
    },
  });

  console.log('');
  console.log('Seed demo completado.');
  console.log('  Empresa RUC:', DEMO_RUC);
  console.log('  Login admin: demo@empresademo.pe / demo123');
  console.log('  Login bodega (almacén principal): bodega@empresademo.pe / demo123');
  console.log('  Tablas: addresses, companies, usuarios, almacenes, clientes,');
  console.log('          catalog_items, invoices, sale_details, legends,');
  console.log('          inventario, producto_series, movimientos, linea_catalogo_items');
  console.log('  Almacenes: 7 (ALM01–ALM07; ALM07 inactivo)');
  console.log('  Stock demo (inventario):');
  console.log('    Mouse      → Principal=20, Secundario=5');
  console.log('    Teclado    → Principal=15, Secundario=8');
  console.log('    Laptop     → Principal=1 serie, Secundario=1 serie');
  console.log('  API: GET /api/empresas/{ruc}/inventario');
}

main()
  .catch((e) => {
    console.error('Error en seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
