export function formatCsvNumber(value: number) {
  return value.toFixed(2).replace('.', ',');
}

function csvCell(value: string) {
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function buildCsv(rows: string[][]) {
  const content = rows
    .map((row) => row.map((cell) => csvCell(cell)).join(';'))
    .join('\r\n');

  return `\uFEFF${content}\r\n`;
}
