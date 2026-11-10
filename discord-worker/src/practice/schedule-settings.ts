export type PracticeDefaultTimeBand = "morning" | "afternoon" | "evening";

export interface PracticeVenueSetting {
  name: string;
  shortName: string;
}

export interface PracticeScheduleSettings {
  morningStartTime: string;
  morningEndTime: string;
  afternoonStartTime: string;
  afternoonEndTime: string;
  eveningStartTime: string;
  eveningEndTime: string;
  defaultTimeBand: PracticeDefaultTimeBand;
  defaultVenue: string;
  venues: PracticeVenueSetting[];
  customized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_PRACTICE_SCHEDULE_SETTINGS: PracticeScheduleSettings = {
  morningStartTime: "09:00",
  morningEndTime: "12:00",
  afternoonStartTime: "13:00",
  afternoonEndTime: "17:00",
  eveningStartTime: "18:00",
  eveningEndTime: "21:30",
  defaultTimeBand: "evening",
  defaultVenue: "大久保東公民館",
  venues: [
    { name: "大久保東公民館", shortName: "大久保東" },
    { name: "栄和公民館", shortName: "栄和" },
  ],
  customized: false,
  updatedAt: null,
  updatedBy: null,
};

interface PracticeScheduleSettingsRow {
  morning_start_time: string;
  morning_end_time: string;
  afternoon_start_time: string;
  afternoon_end_time: string;
  evening_start_time: string;
  evening_end_time: string;
  default_time_band: PracticeDefaultTimeBand;
  default_venue: string;
  venues_json: string;
  updated_at: string;
  updated_by: string;
}

export class PracticeScheduleSettingError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "PracticeScheduleSettingError";
  }
}

function timeSetting(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new PracticeScheduleSettingError(`${label}を入力してください。`);
  }
  return normalized;
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function textSetting(value: unknown, label: string, maximum: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new PracticeScheduleSettingError(`${label}を入力してください。`);
  if ([...normalized].length > maximum) {
    throw new PracticeScheduleSettingError(`${label}は${maximum}文字以内で入力してください。`);
  }
  return normalized;
}

function venueSettings(value: unknown): PracticeVenueSetting[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new PracticeScheduleSettingError("会場を1〜20件登録してください。");
  }
  const venues = value.map((item, index) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      name: textSetting(source.name, `会場${index + 1}の正式名`, 100),
      shortName: textSetting(source.shortName, `会場${index + 1}の略称`, 7),
    };
  });
  if (new Set(venues.map((venue) => venue.name)).size !== venues.length) {
    throw new PracticeScheduleSettingError("同じ会場を重複して登録できません。");
  }
  return venues;
}

function settingsFromRow(row?: PracticeScheduleSettingsRow | null): PracticeScheduleSettings {
  if (!row) return structuredClone(DEFAULT_PRACTICE_SCHEDULE_SETTINGS);
  let venues: PracticeVenueSetting[];
  try {
    venues = venueSettings(JSON.parse(row.venues_json));
  } catch {
    venues = structuredClone(DEFAULT_PRACTICE_SCHEDULE_SETTINGS.venues);
  }
  return {
    morningStartTime: row.morning_start_time,
    morningEndTime: row.morning_end_time,
    afternoonStartTime: row.afternoon_start_time,
    afternoonEndTime: row.afternoon_end_time,
    eveningStartTime: row.evening_start_time,
    eveningEndTime: row.evening_end_time,
    defaultTimeBand: row.default_time_band,
    defaultVenue: venues.some((venue) => venue.name === row.default_venue)
      ? row.default_venue
      : venues[0].name,
    venues,
    customized: true,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getPracticeScheduleSettings(db: D1Database): Promise<PracticeScheduleSettings> {
  const row = await db.prepare(
    `SELECT morning_start_time, morning_end_time,
            afternoon_start_time, afternoon_end_time,
            evening_start_time, evening_end_time,
            default_time_band, default_venue, venues_json,
            updated_at, updated_by
     FROM practice_schedule_settings WHERE setting_id = 1`,
  ).first<PracticeScheduleSettingsRow>();
  return settingsFromRow(row);
}

function normalizedSettings(input: Record<string, unknown>) {
  const settings = {
    morningStartTime: timeSetting(input.morningStartTime, "午前の開始時刻"),
    morningEndTime: timeSetting(input.morningEndTime, "午前の終了時刻"),
    afternoonStartTime: timeSetting(input.afternoonStartTime, "午後の開始時刻"),
    afternoonEndTime: timeSetting(input.afternoonEndTime, "午後の終了時刻"),
    eveningStartTime: timeSetting(input.eveningStartTime, "夜間の開始時刻"),
    eveningEndTime: timeSetting(input.eveningEndTime, "夜間の終了時刻"),
    defaultTimeBand: input.defaultTimeBand as PracticeDefaultTimeBand,
    venues: venueSettings(input.venues),
    defaultVenue: textSetting(input.defaultVenue, "既定の会場", 100),
  };
  if (!["morning", "afternoon", "evening"].includes(settings.defaultTimeBand)) {
    throw new PracticeScheduleSettingError("新規日程の既定時間帯を選択してください。");
  }
  const periods = [
    [settings.morningStartTime, settings.morningEndTime, "午前"],
    [settings.afternoonStartTime, settings.afternoonEndTime, "午後"],
    [settings.eveningStartTime, settings.eveningEndTime, "夜間"],
  ] as const;
  for (const [start, end, label] of periods) {
    if (timeMinutes(start) >= timeMinutes(end)) {
      throw new PracticeScheduleSettingError(`${label}の終了時刻は開始時刻より後にしてください。`);
    }
  }
  if (!(timeMinutes(settings.morningEndTime) <= timeMinutes(settings.afternoonStartTime)
    && timeMinutes(settings.afternoonEndTime) <= timeMinutes(settings.eveningStartTime))) {
    throw new PracticeScheduleSettingError("午前・午後・夜間の時間が重ならないように設定してください。");
  }
  if (!settings.venues.some((venue) => venue.name === settings.defaultVenue)) {
    throw new PracticeScheduleSettingError("既定の会場を登録済み会場から選択してください。");
  }
  return settings;
}

export async function enqueuePracticeCalendarSettingRefreshes(db: D1Database): Promise<void> {
  const refreshId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO practice_schedule_notification_queue (
       idempotency_key, schedule_id, notification_type, target_month
     )
     SELECT 'practice-schedule:' || month || ':settings:' || ?, schedule_id,
            'announcement', month
     FROM (
       SELECT substr(practice_date, 1, 7) AS month, MIN(schedule_id) AS schedule_id
       FROM practice_schedules
       WHERE status <> 'canceled'
         AND practice_date >= date('now', '+9 hours', 'start of month')
       GROUP BY substr(practice_date, 1, 7)
     )`,
  ).bind(refreshId).run();
}

export async function savePracticeScheduleSettings(
  db: D1Database,
  input: Record<string, unknown>,
  updatedBy: string,
  now = new Date().toISOString(),
): Promise<PracticeScheduleSettings> {
  const settings = normalizedSettings(input);
  await db.prepare(
    `INSERT INTO practice_schedule_settings (
       setting_id, morning_start_time, morning_end_time,
       afternoon_start_time, afternoon_end_time,
       evening_start_time, evening_end_time,
       default_time_band, default_venue, venues_json,
       updated_by, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(setting_id) DO UPDATE SET
       morning_start_time = excluded.morning_start_time,
       morning_end_time = excluded.morning_end_time,
       afternoon_start_time = excluded.afternoon_start_time,
       afternoon_end_time = excluded.afternoon_end_time,
       evening_start_time = excluded.evening_start_time,
       evening_end_time = excluded.evening_end_time,
       default_time_band = excluded.default_time_band,
       default_venue = excluded.default_venue,
       venues_json = excluded.venues_json,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(
    settings.morningStartTime,
    settings.morningEndTime,
    settings.afternoonStartTime,
    settings.afternoonEndTime,
    settings.eveningStartTime,
    settings.eveningEndTime,
    settings.defaultTimeBand,
    settings.defaultVenue,
    JSON.stringify(settings.venues),
    updatedBy,
    now,
    now,
  ).run();
  await enqueuePracticeCalendarSettingRefreshes(db);
  return { ...settings, customized: true, updatedAt: now, updatedBy };
}

export async function resetPracticeScheduleSettings(db: D1Database): Promise<PracticeScheduleSettings> {
  await db.prepare("DELETE FROM practice_schedule_settings WHERE setting_id = 1").run();
  await enqueuePracticeCalendarSettingRefreshes(db);
  return structuredClone(DEFAULT_PRACTICE_SCHEDULE_SETTINGS);
}
