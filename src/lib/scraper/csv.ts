// RFC 4180 CSV, parse and serialize. No dependency, because there is no CSV library in this repo
// and one row of an Apollo export is not worth adding one.
//
// ‼️ A SPLIT ON COMMAS IS NOT A CSV PARSER, and an Apollo export is exactly the file that proves
// it. Company names carry commas ("Baker, Donelson & Co"), job titles carry commas, and the
// `technologies` column is a comma-separated list INSIDE one quoted field. A naive split shifts
// every column right of the first comma, so the email column stops being the email column and the
// whole run junks itself as `bad_syntax`. Quoted fields also legally contain newlines, which is why
// this is a character scanner rather than a line loop.

export interface ParsedCsv {
  headers: string[];
  /** One object per data row, keyed by header. Short rows are padded, long rows are truncated. */
  rows: Array<Record<string, string>>;
}

/**
 * Split a CSV document into rows of raw cells.
 *
 * Handles quoted fields, `""` escapes, embedded commas and newlines, CRLF, and a UTF-8 BOM.
 * A trailing newline does not produce a phantom empty row.
 */
export function parseCsvRows(text: string): string[][] {
  // Excel writes a BOM. Left in place it becomes part of the FIRST HEADER's name, so `email`
  // arrives as `﻿email` and the column resolver misses it on a file that looks correct.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      sawAnyChar = true;
      continue;
    }
    if (ch === "\r") {
      // CRLF: the \n does the work. A lone \r (old Mac) also ends the row.
      if (src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyChar = false;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyChar = false;
      continue;
    }

    field += ch;
    sawAnyChar = true;
  }

  // Flush the last row unless the file simply ended with a newline.
  if (sawAnyChar || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Parse into header-keyed objects. An empty document yields no headers and no rows. */
export function parseCsv(text: string): ParsedCsv {
  const raw = parseCsvRows(text);
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = raw[0].map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];

  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    // A blank line inside the file is not a row. Apollo puts one at the end often enough.
    if (cells.length === 1 && cells[0].trim() === "") continue;

    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = cells[c] ?? "";
    rows.push(obj);
  }

  return { headers, rows };
}

/** Quote a single cell the way Excel does: only when it has to be quoted. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize header-keyed rows back to a CSV document, columns in `headers` order. */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(","));
  // Trailing newline: some importers drop the final row without it.
  return lines.join("\r\n") + "\r\n";
}
