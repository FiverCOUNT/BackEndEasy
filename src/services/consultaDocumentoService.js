const prisma = require('../config/prisma');
const clienteModel = require('../models/clienteModel');

/**
 * Consulta razón social por RUC:
 * 1) Clientes de la empresa
 * 2) Empresas registradas en el sistema
 * 3) API externa (apis.net.pe / apisperu) si hay token en .env
 */
async function consultarRuc(companyRuc, numeroRaw) {
  const numero = String(numeroRaw || '').replace(/\D/g, '');
  if (numero.length !== 11) {
    const err = new Error('El RUC debe tener 11 dígitos');
    err.status = 400;
    throw err;
  }

  const local = await buscarEnBaseLocal(companyRuc, numero);
  if (local) return local;

  const externo = await buscarEnSunatExterno(numero);
  if (externo) return externo;

  return {
    encontrado: false,
    fuente: null,
    tipo_doc: '6',
    numero_doc: numero,
    razon_social: null,
    nombre_comercial: null,
    mensaje: 'No se encontró en tu base ni en SUNAT. Escribe el nombre manualmente.',
  };
}

async function buscarEnBaseLocal(companyRuc, numero) {
  const cliente = await clienteModel.findByDocumento(companyRuc, '6', numero);
  if (cliente?.razonSocial) {
    return {
      encontrado: true,
      fuente: 'db',
      tipo_doc: '6',
      numero_doc: numero,
      razon_social: cliente.razonSocial,
      nombre_comercial: null,
      mensaje: 'Encontrado en tus clientes',
    };
  }

  // También busca DNI/RUC sin forzar tipo 6 por si está guardado distinto
  const porNumero = await prisma.cliente.findFirst({
    where: { companyRuc, numeroDoc: numero },
  });
  if (porNumero?.razonSocial) {
    return {
      encontrado: true,
      fuente: 'db',
      tipo_doc: porNumero.tipoDoc || '6',
      numero_doc: numero,
      razon_social: porNumero.razonSocial,
      nombre_comercial: null,
      mensaje: 'Encontrado en tus clientes',
    };
  }

  const company = await prisma.company.findFirst({
    where: { ruc: numero },
    select: { ruc: true, nombre: true, nombreComercial: true, nroMtc: true },
  });
  if (company?.nombre) {
    return {
      encontrado: true,
      fuente: 'db',
      tipo_doc: '6',
      numero_doc: numero,
      razon_social: company.nombre,
      nombre_comercial: company.nombreComercial || null,
      nro_mtc: company.nroMtc || null,
      mensaje: 'Encontrado en empresas del sistema',
    };
  }

  return null;
}

async function buscarEnSunatExterno(numero) {
  const apisNetToken = String(process.env.APIS_NET_TOKEN || process.env.APISNET_TOKEN || '').trim();
  if (apisNetToken) {
    try {
      const res = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${numero}`, {
        headers: {
          Authorization: `Bearer ${apisNetToken}`,
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const razon = data.razonSocial || data.nombre || data.nombreORazonSocial;
        if (razon) {
          return {
            encontrado: true,
            fuente: 'sunat',
            tipo_doc: '6',
            numero_doc: numero,
            razon_social: String(razon).trim(),
            nombre_comercial: data.nombreComercial || null,
            mensaje: 'Encontrado en padrón SUNAT',
          };
        }
      }
    } catch (_) {
      /* sigue con otros proveedores */
    }
  }

  const decolectaToken = String(process.env.DECOLECTA_TOKEN || '').trim();
  if (decolectaToken) {
    try {
      const res = await fetch(`https://api.decolecta.com/v1/sunat/ruc?numero=${numero}`, {
        headers: {
          Authorization: `Bearer ${decolectaToken}`,
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const razon = data.razon_social || data.razonSocial || data.nombre;
        if (razon) {
          return {
            encontrado: true,
            fuente: 'sunat',
            tipo_doc: '6',
            numero_doc: numero,
            razon_social: String(razon).trim(),
            nombre_comercial: data.nombre_comercial || data.nombreComercial || null,
            mensaje: 'Encontrado en padrón SUNAT',
          };
        }
      }
    } catch (_) {
      /* sigue */
    }
  }

  const apisperuToken = String(process.env.APISPERU_TOKEN || process.env.APIS_PERU_TOKEN || '').trim();
  if (apisperuToken) {
    try {
      const res = await fetch(
        `https://dniruc.apisperu.com/api/v1/ruc/${numero}?token=${encodeURIComponent(apisperuToken)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        const data = await res.json();
        const razon = data.razonSocial || data.nombre;
        if (razon) {
          return {
            encontrado: true,
            fuente: 'sunat',
            tipo_doc: '6',
            numero_doc: numero,
            razon_social: String(razon).trim(),
            nombre_comercial: data.nombreComercial || null,
            mensaje: 'Encontrado en padrón SUNAT',
          };
        }
      }
    } catch (_) {
      /* sin resultado externo */
    }
  }

  return null;
}

module.exports = {
  consultarRuc,
};
