const forge = require('node-forge');

function normalizePemText(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim() + '\n';
}

function isPemBuffer(buffer) {
  const text = buffer.toString('utf8');
  return text.includes('BEGIN CERTIFICATE') && text.includes('PRIVATE KEY');
}

/**
 * Convierte PEM a formato estable para Greenter/OpenSSL 3:
 * -----BEGIN RSA PRIVATE KEY----- + -----BEGIN CERTIFICATE-----
 * (sin CRLF; evita error DECODER routines::unsupported al firmar).
 */
function normalizePemForSigning(pemText) {
  const pem = normalizePemText(pemText);
  const certMatch = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  const keyMatch = pem.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/);
  if (!certMatch || !keyMatch) {
    throw new Error('El certificado PEM debe incluir PRIVATE KEY y CERTIFICATE.');
  }

  let privateKey;
  try {
    privateKey = forge.pki.privateKeyFromPem(keyMatch[0]);
  } catch (err) {
    throw new Error(`No se pudo leer la clave privada del PEM: ${err.message || err}`);
  }

  try {
    forge.pki.certificateFromPem(certMatch[0]);
  } catch (err) {
    throw new Error(`No se pudo leer el certificado del PEM: ${err.message || err}`);
  }

  return normalizePemText(
    forge.pki.privateKeyToPem(privateKey) + certMatch[0] + '\n',
  );
}

function pfxToPem(buffer, password) {
  if (!password) {
    throw new Error('La contraseña del certificado es obligatoria para archivos .pfx / .p12.');
  }

  try {
    const asn1 = forge.asn1.fromDer(buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });

    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    const certBag = certBags[forge.pki.oids.certBag]?.[0];

    if (!keyBag?.key || !certBag?.cert) {
      throw new Error('El archivo .pfx no contiene clave privada y certificado.');
    }

    return normalizePemText(
      forge.pki.privateKeyToPem(keyBag.key) + forge.pki.certificateToPem(certBag.cert),
    );
  } catch (err) {
    const msg = String(err.message || err);
    if (/password|mac|decrypt|invalid/i.test(msg)) {
      throw new Error('No se pudo abrir el certificado .pfx: contraseña incorrecta o archivo dañado.');
    }
    if (/No se pudo leer|PEM debe incluir/.test(msg)) {
      throw err;
    }
    throw new Error(`No se pudo convertir el certificado .pfx a PEM: ${msg}`);
  }
}

function toPem(buffer, password) {
  if (isPemBuffer(buffer)) {
    return normalizePemForSigning(buffer.toString('utf8'));
  }
  return normalizePemForSigning(pfxToPem(buffer, password));
}

module.exports = {
  isPemBuffer,
  pfxToPem,
  toPem,
  normalizePemText,
  normalizePemForSigning,
};
