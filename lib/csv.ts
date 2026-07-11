// Genera y descarga un CSV en el navegador. Usa ";" como separador (lo que
// espera Excel en configuración regional argentina) y un BOM para que los
// acentos se vean bien al abrirlo.
export function descargarCSV(
  nombreArchivo: string,
  encabezados: string[],
  filas: (string | number | null | undefined)[][]
) {
  const escapar = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [encabezados, ...filas].map((f) => f.map(escapar).join(";"));
  const csv = "﻿" + lineas.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}
