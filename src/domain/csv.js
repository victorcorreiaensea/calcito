export function parseCSV(text, delimiter) {
  if (!delimiter) {
    const header = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
    let quoted = false;
    const counts = { ",": 0, ";": 0, "\t": 0 };
    for (let i = 0; i < header.length; i++) {
      if (header[i] === '"') {
        if (quoted && header[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && header[i] in counts) counts[header[i]]++;
    }
    delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }
  if (![",", ";", "\t"].includes(delimiter))
    throw new Error("Séparateur CSV non pris en charge.");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    afterQuote = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else cell += char;
    } else if (char === '"' && !cell && !afterQuote) quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
      afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
      afterQuote = false;
    } else {
      if (afterQuote && char.trim())
        throw new Error("Caractère après un champ entre guillemets.");
      if (char === '"') throw new Error("Guillemet inattendu dans le CSV.");
      cell += char;
    }
  }
  if (quoted) throw new Error("Champ CSV non fermé.");
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw new Error("En-têtes manquants ou dupliqués.");
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(`Ligne ${index + 2} : nombre de colonnes incorrect.`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}
export function exportCSV(records, headers = Object.keys(records[0] || {})) {
  function cell(value) {
    let text =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text))
      text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  return [
    headers.map(cell).join(","),
    ...records.map((record) =>
      headers.map((key) => cell(record[key])).join(","),
    ),
  ].join("\r\n");
}
export function downloadCSV(name, records, headers) {
  const blob = new Blob(["\uFEFF" + exportCSV(records, headers)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
