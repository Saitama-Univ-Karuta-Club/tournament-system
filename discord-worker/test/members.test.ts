import { describe, expect, it, vi } from "vitest";
import {
  normalizeMemberRegistration,
  submitMemberRegistrationRequest,
} from "../src/members";

function registrationDatabase(options: {
  existing?: {
    member_id: string;
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
  it("氏名のよみがなを必須にする", () => {
    expect(() =>
      normalizeMemberRegistration({
        discordUserId: "discord-ishida",
        displayName: "石田洋音",
        displayNameKana: "",
        grade: "C",
        rank: 2,
      }),
    ).toThrow("よみがなは1〜100文字");
  });

  it("recognizes an existing Discord ID as a registration update", async () => {
    const database = registrationDatabase({
      existing: {
        member_id: "M-existing",
        display_name: "石田洋音",
        display_name_kana: "いしだ ようおん",
        grade: "C",
        rank: 2,
      },
    });

    const result = await submitMemberRegistrationRequest(database.db, {
      discordUserId: "discord-ishida",
      displayName: "石田洋音",
      displayNameKana: "いしだ ようおん",
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
      displayName: "埼玉花子",
      displayNameKana: "さいたま はなこ",
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
        display_name: "石田洋音",
        display_name_kana: "いしだ ようおん",
        grade: "C",
        rank: 2,
      },
      pendingRequestId: "MR-pending",
    });

    const result = await submitMemberRegistrationRequest(database.db, {
      discordUserId: "discord-ishida",
      displayName: "石田洋音",
      displayNameKana: "いしだ ようおん",
      grade: "B",
      rank: 3,
    });

    expect(result.requestId).toBe("MR-pending");
    expect(database.sqlStatements.some((sql) =>
      sql.includes("UPDATE member_registration_requests"),
    )).toBe(true);
  });
});
