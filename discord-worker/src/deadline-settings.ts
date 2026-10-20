export interface DeadlineAutomationSettings {
  internalDeadlineDaysBefore: number;
  internalDeadlineTimeMode: "same" | "custom";
  internalDeadlineTime: string;
  organizerPaymentDaysBefore: number;
  organizerPaymentTimeMode: "same" | "custom";
  organizerPaymentTime: string;
  paymentDeadlineDaysBefore: number;
  paymentDeadlineTimeMode: "same" | "custom";
  paymentDeadlineTime: string;
  responseReminderDaysBefore: number;
  responseReminderTimeMode: "same" | "custom";
  responseReminderTime: string;
  customized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_DEADLINE_AUTOMATION_SETTINGS: DeadlineAutomationSettings = {
  internalDeadlineDaysBefore: 3,
  internalDeadlineTimeMode: "custom",
  internalDeadlineTime: "23:59",
  organizerPaymentDaysBefore: 2,
  organizerPaymentTimeMode: "custom",
  organizerPaymentTime: "23:59",
  paymentDeadlineDaysBefore: 1,
  paymentDeadlineTimeMode: "custom",
  paymentDeadlineTime: "23:59",
  responseReminderDaysBefore: 2,
  responseReminderTimeMode: "custom",
  responseReminderTime: "00:00",
  customized: false,
  updatedAt: null,
  updatedBy: null,
};

interface DeadlineAutomationSettingsRow {
  internal_deadline_days_before: number;
  internal_deadline_time_mode: "same" | "custom";
  internal_deadline_time: string;
  organizer_payment_days_before: number;
  organizer_payment_time_mode: "same" | "custom";
  organizer_payment_time: string;
  payment_deadline_days_before: number;
  payment_deadline_time_mode: "same" | "custom";
  payment_deadline_time: string;
  response_reminder_days_before: number;
  response_reminder_time_mode: "same" | "custom";
  response_reminder_time: string;
  updated_at: string;
  updated_by: string;
}

export class DeadlineAutomationSettingError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "DeadlineAutomationSettingError";
  }
}

function viewFromRow(row?: DeadlineAutomationSettingsRow | null): DeadlineAutomationSettings {
  if (!row) return { ...DEFAULT_DEADLINE_AUTOMATION_SETTINGS };
  return {
    internalDeadlineDaysBefore: row.internal_deadline_days_before,
    internalDeadlineTimeMode: row.internal_deadline_time_mode,
    internalDeadlineTime: row.internal_deadline_time,
    organizerPaymentDaysBefore: row.organizer_payment_days_before,
    organizerPaymentTimeMode: row.organizer_payment_time_mode,
    organizerPaymentTime: row.organizer_payment_time,
    paymentDeadlineDaysBefore: row.payment_deadline_days_before,
    paymentDeadlineTimeMode: row.payment_deadline_time_mode,
    paymentDeadlineTime: row.payment_deadline_time,
    responseReminderDaysBefore: row.response_reminder_days_before,
    responseReminderTimeMode: row.response_reminder_time_mode,
    responseReminderTime: row.response_reminder_time,
    customized: true,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getDeadlineAutomationSettings(
  db: D1Database,
): Promise<DeadlineAutomationSettings> {
  const row = await db.prepare(
    `SELECT
       internal_deadline_days_before,
       internal_deadline_time_mode,
       internal_deadline_time,
       organizer_payment_days_before,
       organizer_payment_time_mode,
       organizer_payment_time,
       payment_deadline_days_before,
       payment_deadline_time_mode,
       payment_deadline_time,
       response_reminder_days_before,
       response_reminder_time_mode,
       response_reminder_time,
       updated_at,
       updated_by
     FROM deadline_automation_settings
     WHERE setting_id = 1`,
  ).first<DeadlineAutomationSettingsRow>();
  return viewFromRow(row);
}

function integerSetting(
  value: unknown,
  label: string,
  minimum: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 30) {
    throw new DeadlineAutomationSettingError(
      `${label}は${minimum}〜30日の範囲で入力してください。`,
    );
  }
  return parsed;
}

function timeSetting(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new DeadlineAutomationSettingError(`${label}を入力してください。`);
  }
  return normalized;
}

function timeModeSetting(value: unknown, label: string): "same" | "custom" {
  if (value !== "same" && value !== "custom") {
    throw new DeadlineAutomationSettingError(`${label}を選択してください。`);
  }
  return value;
}

export async function saveDeadlineAutomationSettings(
  db: D1Database,
  input: Record<string, unknown>,
  updatedBy: string,
  now = new Date().toISOString(),
): Promise<DeadlineAutomationSettings> {
  const settings = {
    internalDeadlineDaysBefore: integerSetting(
      input.internalDeadlineDaysBefore,
      "サークル内締切の日数",
      0,
    ),
    internalDeadlineTimeMode: timeModeSetting(
      input.internalDeadlineTimeMode,
      "サークル内締切の時刻設定",
    ),
    internalDeadlineTime: timeSetting(
      input.internalDeadlineTime,
      "サークル内締切の時刻",
    ),
    organizerPaymentDaysBefore: integerSetting(
      input.organizerPaymentDaysBefore,
      "担当者支払日の日数",
      0,
    ),
    organizerPaymentTimeMode: timeModeSetting(
      input.organizerPaymentTimeMode,
      "担当者支払日の時刻設定",
    ),
    organizerPaymentTime: timeSetting(
      input.organizerPaymentTime,
      "担当者支払日の時刻",
    ),
    paymentDeadlineDaysBefore: integerSetting(
      input.paymentDeadlineDaysBefore,
      "サークル内支払期限の日数",
      1,
    ),
    paymentDeadlineTimeMode: timeModeSetting(
      input.paymentDeadlineTimeMode,
      "サークル内支払期限の時刻設定",
    ),
    paymentDeadlineTime: timeSetting(
      input.paymentDeadlineTime,
      "サークル内支払期限の時刻",
    ),
    responseReminderDaysBefore: integerSetting(
      input.responseReminderDaysBefore,
      "未回答リマインダーの日数",
      0,
    ),
    responseReminderTimeMode: timeModeSetting(
      input.responseReminderTimeMode,
      "未回答リマインダーの時刻設定",
    ),
    responseReminderTime: timeSetting(
      input.responseReminderTime,
      "未回答リマインダーの時刻",
    ),
  };
  await db.prepare(
    `INSERT INTO deadline_automation_settings (
       setting_id,
       internal_deadline_days_before,
       internal_deadline_time_mode,
       internal_deadline_time,
       organizer_payment_days_before,
       organizer_payment_time_mode,
       organizer_payment_time,
       payment_deadline_days_before,
       payment_deadline_time_mode,
       payment_deadline_time,
       response_reminder_days_before,
       response_reminder_time_mode,
       response_reminder_time,
       updated_by,
       created_at,
       updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(setting_id) DO UPDATE SET
       internal_deadline_days_before = excluded.internal_deadline_days_before,
       internal_deadline_time_mode = excluded.internal_deadline_time_mode,
       internal_deadline_time = excluded.internal_deadline_time,
       organizer_payment_days_before = excluded.organizer_payment_days_before,
       organizer_payment_time_mode = excluded.organizer_payment_time_mode,
       organizer_payment_time = excluded.organizer_payment_time,
       payment_deadline_days_before = excluded.payment_deadline_days_before,
       payment_deadline_time_mode = excluded.payment_deadline_time_mode,
       payment_deadline_time = excluded.payment_deadline_time,
       response_reminder_days_before = excluded.response_reminder_days_before,
       response_reminder_time_mode = excluded.response_reminder_time_mode,
       response_reminder_time = excluded.response_reminder_time,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(
    settings.internalDeadlineDaysBefore,
    settings.internalDeadlineTimeMode,
    settings.internalDeadlineTime,
    settings.organizerPaymentDaysBefore,
    settings.organizerPaymentTimeMode,
    settings.organizerPaymentTime,
    settings.paymentDeadlineDaysBefore,
    settings.paymentDeadlineTimeMode,
    settings.paymentDeadlineTime,
    settings.responseReminderDaysBefore,
    settings.responseReminderTimeMode,
    settings.responseReminderTime,
    updatedBy,
    now,
    now,
  ).run();
  return {
    ...settings,
    customized: true,
    updatedAt: now,
    updatedBy,
  };
}

export async function resetDeadlineAutomationSettings(
  db: D1Database,
): Promise<DeadlineAutomationSettings> {
  await db.prepare(
    `DELETE FROM deadline_automation_settings WHERE setting_id = 1`,
  ).run();
  return { ...DEFAULT_DEADLINE_AUTOMATION_SETTINGS };
}
