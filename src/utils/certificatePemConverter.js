const forge = require('node-forge');

function isPemBuffer(buffer) {
  const text = buffer.toString('utf8');
  return text.includes('BEGIN CERTIFICATE') && text.includes('BEGIN') && text.includes('PRIVATE KEY');
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

    return forge.pki.privateKeyToPem(keyBag.key) + forge.pki.certificateToPem(certBag.cert);
  } catch (err) {
    const msg = String(err.message || err);
    if (/password|mac|decrypt|invalid/i.test(msg)) {
      throw new Error('No se pudo abrir el certificado .pfx: contraseña incorrecta o archivo dañado.');
    }
    throw new Error(`No se pudo convertir el certificado .pfx a PEM: ${msg}`);
  }
}

function toPem(buffer, password) {
  if (isPemBuffer(buffer)) {
    return buffer.toString('utf8');
  }
  return pfxToPem(buffer, password);
}

module.exports = {
  isPemBuffer,
  pfxToPem,
  toPem,
};
