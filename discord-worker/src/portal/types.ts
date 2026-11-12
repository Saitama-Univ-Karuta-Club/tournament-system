export interface PortalEnv {
  DB: D1Database;
  DOCUMENTS?: R2Bucket;
  ENVIRONMENT?: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
}

export interface SessionPayload {
  memberId: string;
  discordUserId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface PortalMemberRow {
  member_id: string;
  discord_user_id: string;
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  rank: number;
  status: string;
}

export type ResponseValue = "yes" | "maybe" | "no";
