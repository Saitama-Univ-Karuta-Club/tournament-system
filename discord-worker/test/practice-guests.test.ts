import { describe, expect, it } from "vitest";
import {
  listReusableGuestProfiles,
  normalizeGuestName,
  replaceMemberGuestProfileLinks,
} from "../src/practice/guests";

const memberId = "M-11111111-1111-4111-8111-111111111111";
const profile1 = "GP-22222222-2222-4222-8222-222222222222";
const profile2 = "GP-33333333-3333-4333-8333-333333333333";

describe("practice guest identities", () => {
  it("normalizes full-width characters and whitespace for suggestions", () => {
    expect(normalizeGuestName(" 石田　洋音 ")).toBe("石田洋音");
    expect(normalizeGuestName("ＩＳＨＩＤＡ 洋音")).toBe("ishida洋音");
  });

  it("lists only reusable guest profiles", async () => {
    const db = {
      prepare(sql: string) {
        return {
          async all() {
            expect(sql).toContain("practice_guest_member_links.guest_profile_id IS NULL");
            return { results: [{
              guest_profile_id: profile1,
              display_name: "過去ゲスト",
              normalized_name: "過去ゲスト",
              last_used_at: "2026-11-01T00:00:00.000Z",
              participation_count: 2,
              last_grade: "C",
              linked_member_id: null,
              linked_member_name: null,
              linked_at: null,
            }] };
          },
        };
      },
    };

    const profiles = await listReusableGuestProfiles({ DB: db as unknown as D1Database });
    expect(profiles).toEqual([{
      guestProfileId: profile1,
      displayName: "過去ゲスト",
      lastUsedAt: "2026-11-01T00:00:00.000Z",
      participationCount: 2,
      lastGrade: "C",
    }]);
  });

  it("links multiple duplicate guest profiles to one member and records audit events", async () => {
    type Statement = {
      sql: string;
      values: unknown[];
      first: () => Promise<unknown>;
      all: () => Promise<{ results: unknown[] }>;
    };
    const batched: Statement[] = [];
    const db = {
      prepare(sql: string) {
        const make = (values: unknown[] = []): Statement => ({
          sql,
          values,
          async first() {
            if (sql.includes("SELECT member_id FROM members")) return { member_id: memberId };
            if (sql.includes("SELECT display_name, display_name_kana")) {
              return { display_name: "同一人物", display_name_kana: "どういつじんぶつ" };
            }
            return null;
          },
          async all() {
            if (sql.includes("WHERE practice_guest_profiles.status = 'active'") && sql.includes(" IN (")) {
              return { results: [
                { guest_profile_id: profile1, linked_member_id: null },
                { guest_profile_id: profile2, linked_member_id: null },
              ] };
            }
            if (sql.includes("FROM practice_guest_member_links WHERE member_id")) return { results: [] };
            if (sql.includes("COUNT(practice_guests.guest_id)")) return { results: [] };
            return { results: [] };
          },
        });
        const statement = make();
        return {
          ...statement,
          bind(...values: unknown[]) {
            return make(values);
          },
        };
      },
      async batch(statements: Statement[]) {
        batched.push(...statements);
        return statements.map(() => ({ success: true }));
      },
    };

    await replaceMemberGuestProfileLinks(
      { DB: db as unknown as D1Database },
      memberId,
      [profile1, profile2],
      "manager@example.com",
    );

    expect(batched.filter((item) => item.sql.includes("INSERT INTO practice_guest_member_links")))
      .toHaveLength(2);
    expect(batched.filter((item) => item.sql.includes("INSERT INTO practice_guest_member_link_events")))
      .toHaveLength(2);
    expect(batched.every((item) => item.values.includes("manager@example.com"))).toBe(true);
  });
});
