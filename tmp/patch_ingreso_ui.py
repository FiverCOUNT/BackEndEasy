from pathlib import Path

p = Path(r"c:\Users\jhonny\Desktop\AppMobile\app\src\main\java\com\factapp\jhonny\ui\inventario\RegistrarIngresoSheet.kt")
text = p.read_text(encoding="utf-8")
marker = "                Spacer(modifier = Modifier.height(16.dp))\n\n                OutlinedButton(\n                    onClick = { mostrarBuscar = true },"
if marker not in text:
    print("MARKER NOT FOUND")
    raise SystemExit(1)

block = r'''                Spacer(modifier = Modifier.height(16.dp))

                if (compraPrefill != null && !esDevolucion && lineasPendientes.isNotEmpty()) {
                    Text(
                        "Relacionar productos del comprobante",
                        fontWeight = FontWeight.SemiBold,
                        color = C.primary,
                        fontSize = 14.sp,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "El proveedor puede usar otro nombre. Relaciona cada línea con tu producto (o se enlaza solo si coincide el código SUNAT).",
                        fontSize = 12.sp,
                        color = C.textSecondary,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    errorRelacion?.let { msg ->
                        Text(msg, fontSize = 12.sp, color = Color(0xFFC62828))
                        Spacer(modifier = Modifier.height(6.dp))
                    }
                    lineasPendientes.forEach { det ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = C.surface),
                            border = BorderStroke(1.dp, C.border.copy(alpha = 0.5f)),
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Text(
                                    text = det.textoEnComprobante().ifBlank { "Ítem sin nombre" },
                                    fontWeight = FontWeight.SemiBold,
                                    color = C.textPrimary,
                                    fontSize = 14.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = buildString {
                                        append("Cant. ${det.cantidad}")
                                        det.unidad?.takeIf { it.isNotBlank() }?.let { append(" · $it") }
                                        det.codigoSunat?.takeIf { it.isNotBlank() }?.let {
                                            append(" · SUNAT $it")
                                        }
                                    },
                                    fontSize = 12.sp,
                                    color = C.textSecondary,
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                OutlinedButton(
                                    onClick = {
                                        detalleRelacionandoId = det.id
                                        busqueda = ""
                                        mostrarBuscar = true
                                    },
                                    enabled = !relacionando && !det.id.isNullOrBlank() && almacenDestinoEfectivo != null,
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(10.dp),
                                ) {
                                    Text(
                                        if (relacionando && detalleRelacionandoId == det.id) {
                                            "Relacionando…"
                                        } else {
                                            "Relacionar con mi producto"
                                        },
                                        fontWeight = FontWeight.SemiBold,
                                        color = C.accent,
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                OutlinedButton(
                    onClick = {
                        detalleRelacionandoId = null
                        mostrarBuscar = true
                    },'''

# Replace from marker start through the onClick line of OutlinedButton
end_marker = "                OutlinedButton(\n                    onClick = { mostrarBuscar = true },"
idx = text.find(end_marker)
if idx < 0:
    print("END MARKER NOT FOUND")
    raise SystemExit(1)
# Find preceding Spacer
start = text.rfind("                Spacer(modifier = Modifier.height(16.dp))\n\n", 0, idx)
if start < 0:
    print("START NOT FOUND")
    raise SystemExit(1)
text = text[:start] + block + text[idx + len(end_marker):]
p.write_text(text, encoding="utf-8")
print("OK")
