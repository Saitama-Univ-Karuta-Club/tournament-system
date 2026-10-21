import { describe, expect, it, vi } from "vitest";
import {
  createCsv,
  createDatabaseCsvArchive,
  createStoredZip,
} from "../src/database-export";

function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 4 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    files.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

describe("database CSV export", () => {
  it("creates UTF-8 BOM CSV with quoted values and CRLF rows", () => {
    const bytes = createCsv(
      ["name", "note", "empty"],
      [{ name: "石田,洋音", note: '改行\nと"引用"', empty: null }],
    );
    const csv = new TextDecoder().decode(bytes.subarray(3));

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toBe(
      '"name","note","empty"\r\n' +
      '"石田,洋音","改行\nと""引用""",""\r\n',
    );
  });

  it("packages each CSV as an uncompressed ZIP entry", () => {
    const archive = createStoredZip([
      { name: "members.csv", bytes: new TextEncoder().encode("members") },
      { name: "tournaments.csv", bytes: new TextEncoder().encode("tournaments") },
    ], new Date("2026-10-22T00:00:00Z"));
    const files = readStoredZip(archive);

    expect([...files.keys()]).toEqual(["members.csv", "tournaments.csv"]);
    expect(new TextDecoder().decode(files.get("members.csv"))).toBe("members");
    expect(new DataView(archive.buffer).getUint32(archive.byteLength - 22, true)).toBe(0x06054b50);
  });

  it("exports every application table and excludes D1 internal tables", async () => {
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("FROM sqlite_schema")) {
        return { all: vi.fn().mockResolvedValue({ results: [{ name: "members" }, { name: "tournaments" }] }) };
      }
      if (sql === 'PRAGMA table_info("members")') {
        return { all: vi.fn().mockResolvedValue({ results: [{ cid: 0, name: "member_id" }, { cid: 1, name: "display_name" }] }) };
      }
      if (sql === 'PRAGMA table_info("tournaments")') {
        return { all: vi.fn().mockResolvedValue({ results: [{ cid: 0, name: "tournament_id" }, { cid: 1, name: "title" }] }) };
      }
      if (sql.startsWith('SELECT * FROM "members"')) {
        return { bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: [{ member_id: "M-1", display_name: "石田洋音" }] }) })) };
      }
      if (sql.startsWith('SELECT * FROM "tournaments"')) {
        return { bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: [{ tournament_id: "T-1", title: "大会" }] }) })) };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const archive = await createDatabaseCsvArchive(
      { prepare } as unknown as D1Database,
      new Date("2026-10-22T03:04:05Z"),
    );
    const files = readStoredZip(archive.bytes);

    expect(archive.filename).toBe("sukc-tournament-database-20261022-120405.zip");
    expect(archive.tableCount).toBe(2);
    expect([...files.keys()]).toEqual(["members.csv", "tournaments.csv"]);
    expect(new TextDecoder().decode(files.get("members.csv"))).toContain('"M-1","石田洋音"');
    expect(prepare.mock.calls[0][0]).toContain("name <> 'd1_migrations'");
  });
});
