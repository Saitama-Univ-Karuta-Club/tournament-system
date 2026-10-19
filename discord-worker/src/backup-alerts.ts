import {
  type DiscordMessagePayload,
  sendChannelMessage,
} from "./discord-api";

const ALERT_BATCH_SIZE = 5;
const MAX_ALERT_ATTEMPTS = 5;

export interface BackupAlertEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
}

interface FailedBackupRow {
  backup_run_id: string;
  trigger_source: "scheduled" | "manual";
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  alert_attempt_count: number;
}

export function buildBackupFailureMessage(
  backup: FailedBackupRow,
): DiscordMessagePayload {
  const source = backup.trigger_source === "scheduled" ? "定期実行" : "手動実行";
  return {
    content: "⚠️ Google Driveバックアップに失敗しました。",
    embeds: [
      {
        title: "大会システム バックアップエラー",
        color: 0xed4245,
        fields: [
          { name: "実行種別", value: source, inline: true },
          { name: "開始日時", value: backup.started_at, inline: true },
          {
            name: "エラー",
            value: (backup.error_message || "詳細なし").slice(0, 1000),
            inline: false,
          },
          {
            name: "対応",
            value: "CloudflareのバックアップWorkerとGoogle Drive連携を確認し、手動バックアップを再実行してください。",
            inline: false,
          },
        ],
        description: `実行ID: ${backup.backup_run_id}`,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function retryDelayMinutes(attemptCount: number): number {
  return [1, 5, 15, 60][Math.max(0, Math.min(attemptCount - 1, 3))];
}

export async function processBackupFailureAlerts(
  env: BackupAlertEnv,
  batchSize = ALERT_BATCH_SIZE,
): Promise<number> {
  const now = new Date();
  const nowIso = now.toISOString();
  const failed = await env.DB.prepare(
    `SELECT backup_run_id, trigger_source, started_at, completed_at,
      error_message, alert_attempt_count
     FROM backup_runs
     WHERE status = 'failed'
       AND alert_sent_at IS NULL
       AND alert_attempt_count < ?
       AND (alert_next_attempt_at IS NULL OR alert_next_attempt_at <= ?)
     ORDER BY started_at
     LIMIT ?`,
  ).bind(MAX_ALERT_ATTEMPTS, nowIso, batchSize).all<FailedBackupRow>();
  if (failed.results.length === 0) return 0;

  const settings = await env.DB.prepare(
    `SELECT admin_reminder_channel_id
     FROM discord_settings
     WHERE admin_reminder_channel_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).first<{ admin_reminder_channel_id: string | null }>();
  if (!env.DISCORD_BOT_TOKEN || !settings?.admin_reminder_channel_id) {
    return 0;
  }

  let processed = 0;
  for (const backup of failed.results) {
    const claimed = await env.DB.prepare(
      `UPDATE backup_runs
       SET alert_attempt_count = alert_attempt_count + 1,
         alert_last_attempt_at = ?
       WHERE backup_run_id = ?
         AND alert_sent_at IS NULL
         AND alert_attempt_count = ?`,
    ).bind(nowIso, backup.backup_run_id, backup.alert_attempt_count).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;

    processed += 1;
    try {
      await sendChannelMessage(
        env.DISCORD_BOT_TOKEN,
        settings.admin_reminder_channel_id,
        buildBackupFailureMessage(backup),
      );
      await env.DB.prepare(
        `UPDATE backup_runs
         SET alert_sent_at = ?, alert_next_attempt_at = NULL,
           alert_error_message = NULL
         WHERE backup_run_id = ?`,
      ).bind(new Date().toISOString(), backup.backup_run_id).run();
    } catch (error: unknown) {
      const attemptCount = backup.alert_attempt_count + 1;
      const nextAttemptAt = attemptCount < MAX_ALERT_ATTEMPTS
        ? new Date(
            now.getTime() + retryDelayMinutes(attemptCount) * 60 * 1000,
          ).toISOString()
        : null;
      await env.DB.prepare(
        `UPDATE backup_runs
         SET alert_next_attempt_at = ?, alert_error_message = ?
         WHERE backup_run_id = ?`,
      ).bind(
        nextAttemptAt,
        (error instanceof Error ? error.message : String(error)).slice(0, 500),
        backup.backup_run_id,
      ).run();
    }
  }
  return processed;
}
