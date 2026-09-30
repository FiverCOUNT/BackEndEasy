const { randomUUID } = require('crypto');

function parseAddressInput(body) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.address_envio ?? body.addressEnvio ?? body.address ?? body.direccion_envio
    ?? body.direccionEnvio ?? body.direccion;
  if (!raw) return null;
  if (typeof raw === 'string') {
    const linea = raw.trim();
    return linea ? { direccion: linea } : null;
  }
  if (typeof raw === 'object') return raw;
  return null;
}

/** Snapshot JSON normalizado (sin id). null si no hay datos. */
function toAddressSnapshot(body) {
  if (!body || typeof body !== 'object') return null;

  const ubigeo = String(body.ubigeo || '').trim() || null;
  const direccion = String(body.direccion || body.linea || '').trim() || null;
  const departamento = String(body.departamento || '').trim() || null;
  const provincia = String(body.provincia || '').trim() || null;
  const distrito = String(body.distrito || '').trim() || null;
  const urbanizacion = String(body.urbanizacion || '').trim() || null;
  const codLocal = String(body.cod_local || body.codLocal || '0000').trim() || '0000';

  if (!ubigeo && !direccion && !departamento && !provincia && !distrito && !urbanizacion) {
    return null;
  }

  return {
    ubigeo,
    departamento,
    provincia,
    distrito,
    urbanizacion,
    direccion,
    cod_local: codLocal,
  };
}

/** @deprecated usar toAddressSnapshot; se mantiene para create de filas catálogo. */
function buildAddressData(body) {
  const snap = toAddressSnapshot(body);
  if (!snap) return null;
  return {
    id: randomUUID(),
    ubigeo: snap.ubigeo,
    departamento: snap.departamento,
    provincia: snap.provincia,
    distrito: snap.distrito,
    urbanizacion: snap.urbanizacion,
    direccion: snap.direccion,
    codLocal: snap.cod_local,
  };
}

function toAddressApi(address) {
  if (!address) return undefined;
  // Acepta fila Prisma (codLocal) o snapshot JSON (cod_local)
  const cod = address.cod_local ?? address.codLocal ?? '0000';
  return {
    ubigeo: address.ubigeo || null,
    departamento: address.departamento || null,
    provincia: address.provincia || null,
    distrito: address.distrito || null,
    urbanizacion: address.urbanizacion || null,
    direccion: address.direccion || null,
    cod_local: cod,
  };
}

function addressFieldsFromData(addressData) {
  if (!addressData) return null;
  return {
    ubigeo: addressData.ubigeo,
    departamento: addressData.departamento,
    provincia: addressData.provincia,
    distrito: addressData.distrito,
    urbanizacion: addressData.urbanizacion,
    direccion: addressData.direccion,
    codLocal: addressData.codLocal || addressData.cod_local || '0000',
  };
}

/**
 * Registra (o actualiza) en el catálogo `addresses` para el picker de recientes.
 * No enlaza FK: las entidades guardan su propio JSON.
 */
async function registerCatalogAddress(txOrPrisma, { companyRuc, snapshot, etiqueta = null, existingId = null }) {
  const snap = toAddressSnapshot(snapshot);
  if (!snap || !companyRuc) return null;

  const fields = {
    ubigeo: snap.ubigeo,
    departamento: snap.departamento,
    provincia: snap.provincia,
    distrito: snap.distrito,
    urbanizacion: snap.urbanizacion,
    direccion: snap.direccion,
    codLocal: snap.cod_local,
    companyRuc,
    etiqueta: String(etiqueta || '').trim()
      || `${snap.distrito || ''} · ${snap.direccion || ''}`.trim().slice(0, 120)
      || 'Ubicación',
    creadoEn: new Date(),
  };

  if (existingId) {
    const existing = await txOrPrisma.address.findFirst({
      where: { id: existingId, companyRuc },
    });
    if (existing) {
      await txOrPrisma.address.update({ where: { id: existingId }, data: fields });
      return existingId;
    }
  }

  const id = randomUUID();
  await txOrPrisma.address.create({ data: { id, ...fields } });
  return id;
}

/**
 * @deprecated Las entidades ya no enlazan address_id.
 * Se mantiene por compatibilidad temporal; prefiere toAddressSnapshot + registerCatalogAddress.
 */
async function syncLinkedAddress(tx, { existingAddressId, addressInput, companyRuc = null }) {
  if (addressInput === undefined) return existingAddressId ?? null;
  const snap = toAddressSnapshot(addressInput);
  if (!snap) {
    if (existingAddressId) {
      await tx.address.delete({ where: { id: existingAddressId } }).catch(() => {});
    }
    return null;
  }
  return registerCatalogAddress(tx, {
    companyRuc,
    snapshot: snap,
    existingId: existingAddressId,
  });
}

module.exports = {
  parseAddressInput,
  toAddressSnapshot,
  buildAddressData,
  toAddressApi,
  addressFieldsFromData,
  registerCatalogAddress,
  syncLinkedAddress,
};
