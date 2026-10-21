const textEncoder = new TextEncoder();
const CSV_PAGE_SIZE = 1_000;

interface DatabaseTableRow {
  name: string;
}

interface DatabaseColumnRow {
  cid: number;
  name: string;
}

export interface CsvArchiveFile {
  name: string;
  bytes: Uint8Array;
}

export interface DatabaseCsvArchive {
  bytes: Uint8Array;
  filename: string;
  tableCount: number;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function binaryValue(value: ArrayBuffer | ArrayBufferView): string {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `base64:${btoa(binary)}`;
}

export function csvValue(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) {
    text = "";
  } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    text = binaryValue(value);
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function createCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): Uint8Array {
  const lines = [
    columns.map(csvValue).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ];
  return textEncoder.encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function createStoredZip(files: CsvArchiveFile[], now = new Date()): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const { date, time } = zipDateTime(now);
  let localOffset = 0;

  for (const file of files) {
    const name = textEncoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.bytes.byteLength, true);
    localView.setUint32(22, file.bytes.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, file.bytes.byteLength, true);
    centralView.setUint32(24, file.bytes.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.byteLength + file.bytes.byteLength;
  }

  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  return concatBytes([...localParts, centralDirectory, end]);
}

async function exportTable(db: D1Database, tableName: string): Promise<CsvArchiveFile> {
  const identifier = quoteIdentifier(tableName);
  const columnResult = await db.prepare(`PRAGMA table_info(${identifier})`).all<DatabaseColumnRow>();
  const columns = [...columnResult.results]
    .sort((left, right) => left.cid - right.cid)
    .map((column) => column.name);
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const page = await db.prepare(
      `SELECT * FROM ${identifier} LIMIT ? OFFSET ?`,
    ).bind(CSV_PAGE_SIZE, offset).all<Record<string, unknown>>();
    rows.push(...page.results);
    if (page.results.length < CSV_PAGE_SIZE) break;
    offset += page.results.length;
  }
  return { name: `${tableName}.csv`, bytes: createCsv(columns, rows) };
}

function jstTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}${value("month")}${value("day")}-${value("hour")}${value("minute")}${value("second")}`;
}

export async function createDatabaseCsvArchive(
  db: D1Database,
  now = new Date(),
): Promise<DatabaseCsvArchive> {
  const tableResult = await db.prepare(
    `SELECT name
     FROM sqlite_schema
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%'
       AND name <> 'd1_migrations'
     ORDER BY name`,
  ).all<DatabaseTableRow>();
  const tables = tableResult.results.map((row) => row.name);
  const files: CsvArchiveFile[] = [];
  for (const table of tables) {
    files.push(await exportTable(db, table));
  }
  return {
    bytes: createStoredZip(files, now),
    filename: `sukc-tournament-database-${jstTimestamp(now)}.zip`,
    tableCount: tables.length,
  };
}
