import { describe, expect, it, vi } from "vitest";
import {
  normalizeMemberRegistration,
  submitMemberRegistrationRequest,
} from "../src/members";

function registrationDatabase(options: {
  existing?: {
    member_id: string;
    last_name: string;
    first_name: string;
    last_name_kana: string;
    first_name_kana: string;
    display_name: string;
    display_name_kana: string;
    grade: string;
    rank: number;
  };
  pendingRequestId?: string;
}) {
  const sqlStatements: string[] = [];
  const run = vi.fn().mockResolvedValue({ success: true });
  const prepare = vi.fn((sql: string) => {
    sqlStatements.push(sql);
    return {
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(
          sql.includes("FROM members")
            ? options.existing ?? null
            : sql.includes("FROM member_registration_requests")
              ? options.pendingRequestId
                ? { request_id: options.pendingRequestId }
                : null
              : null,
        ),
        run,
      })),
    };
  });
  return {
    db: { prepare } as unknown as D1Database,
    run,
    sqlStatements,
  };
}

describe("member registration requests", () => {
  it("姓・名と各よみがなを必須にする", () => {
    expect(() =>
      normalizeMemberRegistration({
        discordUserId: "discord-ishida",
        lastName: "石田",
        firstName: "洋音",
        lastNameKana: "いしだ",
        firstNameKana: "",
        grade: "C",
        rank: 2,
      }),
    ).toThrow("名前よみがなは1〜100文字");
  });

  it("recognizes an existing Discord ID as a registration update", async () => {
    const database = registrationDatabase({
      existing: {
        member_id: "M-existing",
        last_name: "石田",
        first_name: "洋音",
        last_name_kana: "いしだ",
        first_name_kana: "ひろね",
        display_name: "石田洋音",
        display_name_kana: "いしだ ようおん",
        grade: "C",
        rank: 2,
      },
    });

    const result = await submitMemberRegistrationRequest(database.db, {
      discordUserId: "discord-ishida",
      lastName: "石田",
      firstName: "洋音",
      lastNameKana: "いしだ",
      firstNameKana: "ひろね",
      grade: "B",
      rank: 3,
    });

    expect(result).toMatchObject({
      requestType: "update",
      currentDisplayName: "石田洋音",
      currentDisplayNameKana: "いしだ ようおん",
      currentGrade: "C",
      currentRank: 2,
      displayName: "石田洋音",
      grade: "B",
      rank: 3,
    });
    expect(database.sqlStatements.some((sql) => sql.includes("UPDATE members\n")))
      .toBe(false);
  });

  it("recognizes an unknown Discord ID as a new registration", async () => {
    const database = registrationDatabase({});

    const result = await submitMemberRegistrationRequest(database.db, {
      discordUserId: "discord-new",
      lastName: "埼玉",
      firstName: "花子",
      lastNameKana: "さいたま",
      firstNameKana: "はなこ",
      grade: "D",
      rank: 1,
    });

    expect(result.requestType).toBe("new");
    expect(result.requestId).toMatch(/^MR-/);
  });

  it("replaces an existing pending request instead of creating another", async () => {
    const database = registrationDatabase({
      existing: {
        member_id: "M-existing",
        last_name: "石田",
        first_name: "洋音",
        last_name_kana: "いしだ",
        first_name_kana: "ひろね",
        display_name: "石田洋音",
        display_name_kana: "いしだ ようおん",
        grade: "C",
        rank: 2,
      },
      pendingRequestId: "MR-pending",
    });

    const result = await submitMemberRegistrationRequest(database.db, {
      discordUserId: "discord-ishida",
      lastName: "石田",
      firstName: "洋音",
      lastNameKana: "いしだ",
      firstNameKana: "ひろね",
      grade: "B",
      rank: 3,
    });

    expect(result.requestId).toBe("MR-pending");
    expect(database.sqlStatements.some((sql) =>
      sql.includes("UPDATE member_registration_requests"),
    )).toBe(true);
  });
});
