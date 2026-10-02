/**
 * RFC 4180 compliant CSV export utility.
 */
function toCsv(columns, rows) {
  const escapeCell = (val) => {
    if (val === null || val === undefined) return '""';
    if (typeof val === "object") {
      try { val = JSON.stringify(val); } catch { val = String(val); }
    }
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = columns.map(c => escapeCell(typeof c === "object" ? c.label : c)).join(",");
  const keys = columns.map(c => typeof c === "object" ? c.key : c);
  const dataLines = rows.map((r) => keys.map((k) => escapeCell(r[k])).join(","));
  return [headerLine, ...dataLines].join("\r\n");
}

module.exports = { toCsv };
