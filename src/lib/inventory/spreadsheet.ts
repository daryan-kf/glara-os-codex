// Minimal dependency-free XLSX/CSV codec for the inventory catalog.
// Writing uses uncompressed (STORE) zip entries with inline strings; reading
// supports STORE and DEFLATE entries (via DecompressionStream), shared and
// inline strings, which covers workbooks produced by Excel, Numbers and this
// module itself. Formulas, styles and dates are out of scope.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function xmlUnescape(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replaceAll("&amp;", "&");
}
function u16(value: number) {
  return [value & 0xff, (value >> 8) & 0xff];
}
function u32(value: number) {
  return [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}
function zipStore(entries: [string, string][]) {
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0,
    count = 0;
  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name),
      data = encoder.encode(text),
      crc = crc32(data);
    const header = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ];
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );
    chunks.push(...header, ...nameBytes);
    for (const byte of data) chunks.push(byte);
    offset += header.length + nameBytes.length + data.length;
    count++;
  }
  const centralOffset = offset;
  chunks.push(...central);
  chunks.push(
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(count),
    ...u16(count),
    ...u32(central.length),
    ...u32(centralOffset),
    ...u16(0),
  );
  return new Uint8Array(chunks);
}
function readU16(bytes: Uint8Array, at: number) {
  return bytes[at] | (bytes[at + 1] << 8);
}
function readU32(bytes: Uint8Array, at: number) {
  return (
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) +
    bytes[at + 3] * 0x1000000
  );
}
async function inflateRaw(data: Uint8Array) {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(bytes: Uint8Array) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65558; i--)
    if (readU32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("Not a spreadsheet file.");
  const count = readU16(bytes, eocd + 10);
  let at = readU32(bytes, eocd + 16);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (readU32(bytes, at) !== 0x02014b50)
      throw new Error("Unreadable spreadsheet file.");
    const method = readU16(bytes, at + 10),
      size = readU32(bytes, at + 20),
      nameLength = readU16(bytes, at + 28),
      extraLength = readU16(bytes, at + 30),
      commentLength = readU16(bytes, at + 32),
      headerOffset = readU32(bytes, at + 42),
      name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const dataStart =
      headerOffset +
      30 +
      readU16(bytes, headerOffset + 26) +
      readU16(bytes, headerOffset + 28);
    const raw = bytes.subarray(dataStart, dataStart + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
    else throw new Error("Unsupported spreadsheet compression.");
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function columnIndex(reference: string) {
  let index = 0;
  for (const char of reference.replace(/\d+$/, ""))
    index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}
export function buildXlsx(rows: readonly (readonly string[])[]) {
  const sheetRows = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">` +
        cells
          .map((value, c) =>
            value === ""
              ? ""
              : `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`,
          )
          .join("") +
        "</row>",
    )
    .join("");
  return zipStore([
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    [
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ]);
}
function textOf(fragment: string) {
  return Array.from(fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
    .map((m) => xmlUnescape(m[1]))
    .join("");
}
export async function parseXlsx(bytes: Uint8Array) {
  const files = await unzip(bytes);
  const sheetName =
    ["xl/worksheets/sheet1.xml", ...files.keys()].find(
      (name) => files.has(name) && /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
    ) ?? null;
  if (!sheetName) throw new Error("No worksheet found in this file.");
  const shared: string[] = [];
  const sharedXml = files.get("xl/sharedStrings.xml");
  if (sharedXml)
    for (const si of decoder
      .decode(sharedXml)
      .matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g))
      shared.push(textOf(si[1]));
  const rows: string[][] = [];
  for (const rowMatch of decoder
    .decode(files.get(sheetName)!)
    .matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of rowMatch[1].matchAll(
      /<c\s([^>]*?)\/>|<c\s([^>]*?)>([\s\S]*?)<\/c>/g,
    )) {
      const attributes = cell[1] ?? cell[2] ?? "",
        body = cell[3] ?? "";
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? "";
      const index = reference ? columnIndex(reference) : cells.length;
      let value = "";
      if (type === "inlineStr") value = textOf(body);
      else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = type === "s" ? (shared[Number(v)] ?? "") : xmlUnescape(v);
      }
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    rows.push(cells);
  }
  return rows;
}
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let cells: string[] = [],
    value = "",
    quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      cells.push(value);
      value = "";
      rows.push(cells);
      cells = [];
    } else value += char;
  }
  if (value !== "" || cells.length) {
    cells.push(value);
    rows.push(cells);
  }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}
