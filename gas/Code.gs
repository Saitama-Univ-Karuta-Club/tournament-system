const SHEET_CACHE_TTL_SECONDS = 180;
const RESPONSE_CACHE_TTL_SECONDS = 60;
const TOURNAMENT_GRADE_DISPLAY_ORDER = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "初心者",
];
const SPREADSHEET_CACHE = {
  spreadsheet: null,
  sheets: {},
};

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : "";
  const adminToken = e && e.parameter ? e.parameter.admin_token || "" : "";

  try {
    if (action === "list_tournaments") {
      validateAdminToken(adminToken);
      return jsonOutput({
        ok: true,
        tournaments: listTournaments(),
      });
    }

    if (action === "list_public_tournaments") {
      const pageToken = e.parameter.page_token || "";
      return jsonOutput({
        ok: true,
        page: getEntryPage(pageToken),
        settings: getPublicPageSettings_(),
        members: listMembers(),
        tournaments: listPublicTournaments(pageToken),
        tournament_response_overview: listPublicTournamentResponseOverview(pageToken),
      });
    }

    if (action === "list_members") {
      return jsonOutput({
        ok: true,
        members: listMembers(),
      });
    }

    if (action === "admin_bootstrap") {
      validateAdminToken(adminToken);
      return jsonOutput({
        ok: true,
        settings: getAdminSettings_(),
        tournaments: listTournaments(),
        members: listAdminMembers(),
        managers: listManagers().filter(function(manager) {
          return manager.status === "active";
        }),
        tournament_response_overview: listTournamentResponseOverview(),
      });
    }

    if (action === "list_admin_settings") {
      validateAdminToken(adminToken);
      return jsonOutput({
        ok: true,
        settings: getAdminSettings_(),
      });
    }

    if (action === "list_admin_members") {
      validateAdminToken(adminToken);
      return jsonOutput({
        ok: true,
        members: listAdminMembers(),
      });
    }

    if (action === "list_managers") {
      validateAdminToken(adminToken);
      return jsonOutput({
        ok: true,
        managers: listManagers().filter(function(manager) {
          return manager.status === "active";
        }),
      });
    }

    if (action === "list_member_responses") {
      return jsonOutput({
        ok: true,
        responses: listMemberResponses(
          e.parameter.page_token || "",
          e.parameter.member_name || ""
        ),
      });
    }

    if (action === "list_tournament_responses") {
      validateAdminToken(adminToken);
      return jsonOutput({
        ok: true,
        responses: listTournamentResponses(e.parameter.tournament_id || ""),
      });
    }

    if (action === "list_tournament_response_overview") {
      validateAdminToken(adminToken);
      return jsonOutput({
        ok: true,
        overview: listTournamentResponseOverview(),
      });
    }

    return jsonOutput({
      ok: false,
      error: "Unknown action",
    });
  } catch (error) {
    return jsonOutput({
      ok: false,
      error: String(error),
    });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (body.events && Array.isArray(body.events)) {
      handleLineWebhook(body);
      return ContentService.createTextOutput("OK");
    }

    const action = body.action || "";

    if (action === "upsert_tournament") {
      validateAdminToken(body.admin_token || "");
      const result = upsertTournament(body.tournament || {});
      return jsonOutput({
        ok: true,
        tournament_id: result.tournament_id,
        mode: result.mode,
        calendar_sync: result.calendar_sync,
      });
    }

    if (action === "upsert_tournament_batch") {
      validateAdminToken(body.admin_token || "");
      const result = upsertTournamentBatch(
        body.tournament || {},
        body.grade_configs || []
      );
      return jsonOutput({
        ok: true,
        count: result.count,
        tournament_ids: result.tournament_ids,
        results: result.results,
      });
    }

    if (action === "update_tournament_status") {
      validateAdminToken(body.admin_token || "");
      const result = updateTournamentStatus(
        body.tournament_id || "",
        body.status || ""
      );
      return jsonOutput({
        ok: true,
        tournament_id: result.tournament_id,
        status: result.status,
        calendar_sync: result.calendar_sync,
      });
    }

    if (action === "upsert_response") {
      const result = upsertResponses(
        body.page_token || "",
        body.member_name || "",
        body.responses || []
      );
      return jsonOutput({
        ok: true,
        updated_count: result.updated_count,
      });
    }

    if (action === "upsert_member") {
      validateAdminToken(body.admin_token || "");
      const result = upsertMember(body.member || {});
      return jsonOutput({
        ok: true,
        member_id: result.member_id,
        mode: result.mode,
      });
    }

    if (action === "request_member_registration") {
      const result = requestMemberRegistration(body.member || {});
      return jsonOutput({
        ok: true,
        member_id: result.member_id,
        mode: result.mode,
        status: result.status,
        notification: result.notification || null,
      });
    }

    if (action === "upload_brief_file") {
      validateAdminToken(body.admin_token || "");
      const result = uploadBriefFile(
        body.file_name || "",
        body.mime_type || "",
        body.content_base64 || "",
        body.tournament || {}
      );
      return jsonOutput({
        ok: true,
        drive_url: result.drive_url,
        file_id: result.file_id,
        file_name: result.file_name,
        reused_existing: result.reused_existing === true,
      });
    }

    if (action === "send_announcement") {
      validateAdminToken(body.admin_token || "");
      const result = sendAnnouncement(
        body.admin_token || "",
        body.tournament_ids || []
      );
      return jsonOutput({
        ok: true,
        sent: result.sent,
        group_id: result.group_id,
        tournament_ids: result.tournament_ids,
      });
    }

    if (action === "send_scheduled_daily_announcements") {
      validateAdminToken(body.admin_token || "");
      const result = sendScheduledDailyAnnouncements();
      return jsonOutput({
        ok: true,
        sent: result.sent,
        reason: result.reason || "",
        group_id: result.group_id || "",
        tournament_ids: result.tournament_ids || [],
        announcement_tournament_ids: result.announcement_tournament_ids || [],
        reminder_tournament_ids: result.reminder_tournament_ids || [],
        manager_backup: result.manager_backup || null,
      });
    }

    if (action === "send_group_reminder") {
      validateAdminToken(body.admin_token || "");
      const result = sendGroupReminder(
        body.admin_token || "",
        body.tournament_ids || [],
        body.notification_type || ""
      );
      return jsonOutput({
        ok: true,
        sent: result.sent,
        group_id: result.group_id,
        tournament_ids: result.tournament_ids,
        notification_type: result.notification_type,
      });
    }

    if (action === "send_manager_reminder") {
      validateAdminToken(body.admin_token || "");
      const result = sendManagerReminder(
        body.admin_token || "",
        body.tournament_ids || [],
        body.notification_type || ""
      );
      return jsonOutput({
        ok: true,
        sent: result.sent,
        manager_count: result.manager_count,
        tournament_ids: result.tournament_ids,
        notification_type: result.notification_type,
      });
    }

    if (action === "send_line_template_test") {
      validateAdminToken(body.admin_token || "");
      const result = sendLineTemplateTest_(body.template_key || "");
      return jsonOutput({
        ok: true,
        sent: result.sent,
        group_id: result.group_id,
        template_key: result.template_key,
      });
    }

    if (action === "update_admin_settings") {
      validateAdminToken(body.admin_token || "");
      return jsonOutput({
        ok: true,
        settings: updateAdminSettings_(body.settings || {}),
      });
    }

    if (action === "install_scheduled_triggers") {
      validateAdminToken(body.admin_token || "");
      return jsonOutput({
        ok: true,
        triggers: installScheduledTriggersFromAdmin_(),
      });
    }

    return jsonOutput({
      ok: false,
      error: "Unknown action",
    });
  } catch (error) {
    return jsonOutput({
      ok: false,
      error: String(error),
    });
  }
}

function handleLineWebhook(body) {
  body.events.forEach(function(event) {
    handleSingleLineEvent(event);
  });
}

function handleSingleLineEvent(event) {
  if (!event || event.type !== "message" || !event.message) {
    return;
  }

  if (event.message.type !== "text") {
    return;
  }

  const text = String(event.message.text || "").trim();

  if (text === "/groupid") {
    replyLineMessage(event.replyToken, [{
      type: "text",
      text: registerLineGroup(event),
    }]);
    return;
  }

  if (text === "/testgroupid") {
    replyLineMessage(event.replyToken, [{
      type: "text",
      text: registerLineTestGroup(event),
    }]);
    return;
  }

  if (text === "/担当者登録") {
    replyLineMessage(event.replyToken, [{
      type: "text",
      text: registerManagerFromLine(event),
    }]);
  }
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getAdminSettings_() {
  const properties = PropertiesService.getScriptProperties();
  const driveFolderId = String(
    properties.getProperty("DRIVE_FOLDER_ID") || ""
  ).trim();

  return {
    drive_folder_url: driveFolderId ?
      "https://drive.google.com/drive/folders/" + driveFolderId :
      "",
    annual_schedule_preview_url: String(
      properties.getProperty("ANNUAL_SCHEDULE_PREVIEW_URL") || ""
    ).trim(),
    annual_schedule_view_url: String(
      properties.getProperty("ANNUAL_SCHEDULE_VIEW_URL") || ""
    ).trim(),
    web_base_url: String(
      properties.getProperty("WEB_BASE_URL") || ""
    ).trim(),
    admin_page_url: String(
      properties.getProperty("ADMIN_PAGE_URL") || ""
    ).trim(),
    default_entry_page_token: String(
      properties.getProperty("DEFAULT_ENTRY_PAGE_TOKEN") || ""
    ).trim() || "2026-entry",
    calendar_id: String(
      properties.getProperty("CALENDAR_ID") || ""
    ).trim(),
    calendar_embed_url: String(
      properties.getProperty("CALENDAR_EMBED_URL") || ""
    ).trim() || buildGoogleCalendarEmbedUrl_(
      String(properties.getProperty("CALENDAR_ID") || "").trim()
    ),
    calendar_view_url: String(
      properties.getProperty("CALENDAR_VIEW_URL") || ""
    ).trim() || buildGoogleCalendarViewUrl_(
      String(properties.getProperty("CALENDAR_ID") || "").trim()
    ),
    line_group_id: String(
      properties.getProperty("LINE_GROUP_ID") || ""
    ).trim(),
    line_test_group_id: String(
      properties.getProperty("LINE_TEST_GROUP_ID") || ""
    ).trim(),
    daily_announcement_time: getScriptTimeSetting_(
      properties,
      "DAILY_ANNOUNCEMENT_TIME",
      "17:00"
    ),
    tournament_reminder_time: getScriptTimeSetting_(
      properties,
      "TOURNAMENT_REMINDER_TIME",
      "10:00"
    ),
    pending_member_summary_time: getScriptTimeSetting_(
      properties,
      "PENDING_MEMBER_SUMMARY_TIME",
      "07:00"
    ),
    nightly_automation_time: getScriptTimeSetting_(
      properties,
      "NIGHTLY_AUTOMATION_TIME",
      "00:00"
    ),
    line_message_templates: getLineMessageTemplates_(),
  };
}

function getPublicPageSettings_() {
  const settings = getAdminSettings_();
  return {
    drive_folder_url: settings.drive_folder_url || "",
    annual_schedule_preview_url: settings.annual_schedule_preview_url || "",
    annual_schedule_view_url: settings.annual_schedule_view_url || "",
    calendar_embed_url: settings.calendar_embed_url || "",
    calendar_view_url: settings.calendar_view_url || "",
  };
}

function buildGoogleCalendarEmbedUrl_(calendarId) {
  const normalizedCalendarId = String(calendarId || "").trim();
  if (!normalizedCalendarId) {
    return "";
  }
  return "https://calendar.google.com/calendar/embed?src=" +
    encodeURIComponent(normalizedCalendarId) +
    "&ctz=Asia%2FTokyo";
}

function buildGoogleCalendarViewUrl_(calendarId) {
  const normalizedCalendarId = String(calendarId || "").trim();
  if (!normalizedCalendarId) {
    return "";
  }
  return "https://calendar.google.com/calendar/u/0?cid=" +
    encodeURIComponent(normalizedCalendarId);
}

function updateAdminSettings_(input) {
  const properties = PropertiesService.getScriptProperties();
  const source = input || {};
  const normalized = normalizeAdminSettingsInput_(source);

  if (hasOwnProperty_(source, "annual_schedule_preview_url")) {
    setOrDeleteScriptProperty_(properties, "ANNUAL_SCHEDULE_PREVIEW_URL", normalized.annual_schedule_preview_url);
  }
  if (hasOwnProperty_(source, "annual_schedule_view_url")) {
    setOrDeleteScriptProperty_(properties, "ANNUAL_SCHEDULE_VIEW_URL", normalized.annual_schedule_view_url);
  }
  if (hasOwnProperty_(source, "web_base_url")) {
    setOrDeleteScriptProperty_(properties, "WEB_BASE_URL", normalized.web_base_url);
  }
  if (hasOwnProperty_(source, "admin_page_url")) {
    setOrDeleteScriptProperty_(properties, "ADMIN_PAGE_URL", normalized.admin_page_url);
  }
  if (hasOwnProperty_(source, "default_entry_page_token")) {
    setOrDeleteScriptProperty_(properties, "DEFAULT_ENTRY_PAGE_TOKEN", normalized.default_entry_page_token);
  }
  if (hasOwnProperty_(source, "calendar_id")) {
    setOrDeleteScriptProperty_(properties, "CALENDAR_ID", normalized.calendar_id);
  }
  if (hasOwnProperty_(source, "calendar_embed_url")) {
    setOrDeleteScriptProperty_(properties, "CALENDAR_EMBED_URL", normalized.calendar_embed_url);
  }
  if (hasOwnProperty_(source, "calendar_view_url")) {
    setOrDeleteScriptProperty_(properties, "CALENDAR_VIEW_URL", normalized.calendar_view_url);
  }
  if (hasOwnProperty_(source, "line_group_id")) {
    setOrDeleteScriptProperty_(properties, "LINE_GROUP_ID", normalized.line_group_id);
  }
  if (hasOwnProperty_(source, "line_test_group_id")) {
    setOrDeleteScriptProperty_(properties, "LINE_TEST_GROUP_ID", normalized.line_test_group_id);
  }
  if (hasOwnProperty_(source, "daily_announcement_time")) {
    setOrDeleteScriptProperty_(properties, "DAILY_ANNOUNCEMENT_TIME", normalized.daily_announcement_time);
  }
  if (hasOwnProperty_(source, "tournament_reminder_time")) {
    setOrDeleteScriptProperty_(properties, "TOURNAMENT_REMINDER_TIME", normalized.tournament_reminder_time);
  }
  if (hasOwnProperty_(source, "pending_member_summary_time")) {
    setOrDeleteScriptProperty_(properties, "PENDING_MEMBER_SUMMARY_TIME", normalized.pending_member_summary_time);
  }
  if (hasOwnProperty_(source, "nightly_automation_time")) {
    setOrDeleteScriptProperty_(properties, "NIGHTLY_AUTOMATION_TIME", normalized.nightly_automation_time);
  }
  if (hasOwnProperty_(source, "drive_folder_url")) {
    if (normalized.drive_folder_id) {
      properties.setProperty("DRIVE_FOLDER_ID", normalized.drive_folder_id);
    } else {
      properties.deleteProperty("DRIVE_FOLDER_ID");
    }
  }
  if (hasOwnProperty_(source, "line_message_templates")) {
    updateLineMessageTemplates_(properties, normalized.line_message_templates);
  }

  return getAdminSettings_();
}

function normalizeAdminSettingsInput_(input) {
  return {
    drive_folder_id: extractDriveFolderId_(input.drive_folder_url),
    annual_schedule_preview_url: String(input.annual_schedule_preview_url || "").trim(),
    annual_schedule_view_url: String(input.annual_schedule_view_url || "").trim(),
    web_base_url: String(input.web_base_url || "").trim(),
    admin_page_url: String(input.admin_page_url || "").trim(),
    default_entry_page_token: String(input.default_entry_page_token || "").trim(),
    calendar_id: String(input.calendar_id || "").trim(),
    calendar_embed_url: String(input.calendar_embed_url || "").trim(),
    calendar_view_url: String(input.calendar_view_url || "").trim(),
    line_group_id: String(input.line_group_id || "").trim(),
    line_test_group_id: String(input.line_test_group_id || "").trim(),
    daily_announcement_time: normalizeTimeSetting_(
      input.daily_announcement_time,
      "17:00"
    ),
    tournament_reminder_time: normalizeTimeSetting_(
      input.tournament_reminder_time,
      "10:00"
    ),
    pending_member_summary_time: normalizeTimeSetting_(
      input.pending_member_summary_time,
      "07:00"
    ),
    nightly_automation_time: normalizeTimeSetting_(
      input.nightly_automation_time,
      "00:00"
    ),
    line_message_templates: normalizeLineMessageTemplatesInput_(
      input.line_message_templates || {}
    ),
  };
}

function getLineMessageTemplates_() {
  const properties = PropertiesService.getScriptProperties();
  const defaults = getDefaultLineMessageTemplates_();
  const templates = {};
  const definitions = getLineMessageTemplateDefinitions_();

  Object.keys(definitions).forEach(function(key) {
    const propertyKey = definitions[key].property_key;
    const stored = properties.getProperty(propertyKey);

    templates[key] = stored !== null ? stored : defaults[key];
  });

  return templates;
}

function getDefaultLineMessageTemplates_() {
  return {
    announcement: [
      "【大会情報更新】",
      "大会情報を更新しました。",
      "参加希望者は、下記の大会一覧を確認してください。",
      "",
      "【今回の更新】",
      "{{TOURNAMENT_LINES}}",
      "",
      "【参加回答】",
      "参加希望者は以下のページから回答してください。",
      "各日程にサークル内締切を併記しています。",
      "締切までの回答にご協力をお願いします。",
      "",
      "{{ENTRY_URL}}",
      "",
      "【要項・案内】",
      "大会要項や案内文書は以下のDriveから確認してください。",
      "{{DRIVE_FOLDER_URL}}",
      "",
      "※サークル内限定の案内です。URLの外部共有はしないでください。",
    ].join("\n"),
    group_reminder: [
      "＝＝＝＝＝＝＝＝＝＝＝",
      "【回答締切リマインド】",
      "＝＝＝＝＝＝＝＝＝＝＝",
      "",
      "以下の大会のサークル内締切が2日後に迫っています。",
      "参加を考えている方は、忘れずに回答してください。",
      "",
      "【対象大会】",
      "{{TOURNAMENT_LINES}}",
      "",
      "【回答ページ】",
      "{{ENTRY_URL}}",
      "",
      "【要項・案内】",
      "{{DRIVE_FOLDER_URL}}",
      "",
      "※サークル内限定の案内です。URLの外部共有はしないでください。",
    ].join("\n"),
    manager_internal_deadline: [
      "【申込対応リマインド】",
      "サークル内締切を過ぎました。",
      "以下の大会について申込対応をお願いします。",
      "{{TOURNAMENT_BLOCKS}}",
      "",
      "【要項】",
      "{{DRIVE_FOLDER_URL}}",
      "",
      "【管理画面】",
      "{{ADMIN_PAGE_URL}}",
      "",
      "必要に応じて、級や段位を確認してから申込してください。",
      "申込対応後は、申込完了処理を忘れずに行ってください。",
    ].join("\n"),
    manager_true_deadline: [
      "【最終リマインド】",
      "本日が主催締切日です。",
      "以下の大会について、申込漏れがないか確認してください。",
      "{{TOURNAMENT_BLOCKS}}",
      "",
      "【要項】",
      "{{DRIVE_FOLDER_URL}}",
      "",
      "【管理画面】",
      "{{ADMIN_PAGE_URL}}",
      "",
      "申込対応後は、申込完了処理を忘れずに行ってください。",
    ].join("\n"),
    applied_notification: [
      "【申込完了】",
      "以下の大会について申込が完了しました。",
      "{{TOURNAMENT_BLOCKS}}",
    ].join("\n"),
    member_registration_request: [
      "【メンバー追加申請】",
      "新しいメンバー追加申請が届きました。",
      "",
      "氏名: {{MEMBER_NAME}}",
      "ふりがな: {{MEMBER_KANA}}",
      "段位: {{MEMBER_RANK}}",
      "級: {{MEMBER_GRADE}}",
      "",
      "【管理画面】",
      "{{ADMIN_PAGE_URL}}",
      "",
      "内容を確認し、承認または却下を行ってください。",
    ].join("\n"),
    pending_member_summary: [
      "【未処理のメンバー追加申請】",
      "未処理のメンバー追加申請があります。",
      "内容を確認し、承認または却下を行ってください。",
      "{{MEMBER_BLOCKS}}",
      "",
      "【管理画面】",
      "{{ADMIN_PAGE_URL}}",
    ].join("\n"),
  };
}

function getLineMessageTemplateDefinitions_() {
  return {
    announcement: {
      property_key: "LINE_TEMPLATE_ANNOUNCEMENT",
    },
    group_reminder: {
      property_key: "LINE_TEMPLATE_GROUP_REMINDER",
    },
    manager_internal_deadline: {
      property_key: "LINE_TEMPLATE_MANAGER_INTERNAL_DEADLINE",
    },
    manager_true_deadline: {
      property_key: "LINE_TEMPLATE_MANAGER_TRUE_DEADLINE",
    },
    applied_notification: {
      property_key: "LINE_TEMPLATE_APPLIED_NOTIFICATION",
    },
    member_registration_request: {
      property_key: "LINE_TEMPLATE_MEMBER_REGISTRATION_REQUEST",
    },
    pending_member_summary: {
      property_key: "LINE_TEMPLATE_PENDING_MEMBER_SUMMARY",
    },
  };
}

function normalizeLineMessageTemplatesInput_(input) {
  const normalized = {};
  const definitions = getLineMessageTemplateDefinitions_();

  Object.keys(definitions).forEach(function(key) {
    normalized[key] = normalizeMultilineSetting_(input[key]);
  });

  return normalized;
}

function normalizeMultilineSetting_(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function updateLineMessageTemplates_(properties, templates) {
  const definitions = getLineMessageTemplateDefinitions_();

  Object.keys(definitions).forEach(function(key) {
    if (!hasOwnProperty_(templates, key)) {
      return;
    }

    const propertyKey = definitions[key].property_key;
    const value = String(templates[key] || "");

    if (value) {
      properties.setProperty(propertyKey, value);
      return;
    }

    properties.deleteProperty(propertyKey);
  });
}

function hasOwnProperty_(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function getScriptTimeSetting_(properties, key, fallback) {
  return normalizeTimeSetting_(properties.getProperty(key), fallback);
}

function normalizeTimeSetting_(value, fallback) {
  const normalized = String(value || "").trim();
  const defaultValue = String(fallback || "00:00").trim();
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!normalized) {
    return defaultValue;
  }

  if (!match) {
    throw new Error("時刻は HH:mm 形式で入力してください: " + normalized);
  }

  return match[1] + ":" + match[2];
}

function getTimeSettingParts_(key, fallback) {
  const time = getScriptTimeSetting_(
    PropertiesService.getScriptProperties(),
    key,
    fallback
  );
  const parts = time.split(":");

  return {
    hour: Number(parts[0]),
    minute: Number(parts[1]),
  };
}

function getAnnualScheduleUrls_() {
  try {
    const file = getAnnualScheduleFileFromDrive_();

    if (!file) {
      return {
        preview_url: "",
        view_url: "",
      };
    }

    const fileId = file.getId();
    return {
      preview_url: "https://drive.google.com/file/d/" + fileId + "/preview",
      view_url: file.getUrl(),
    };
  } catch (error) {
    return {
      preview_url: "",
      view_url: "",
    };
  }
}

function getAnnualScheduleFileFromDrive_() {
  const folder = getBriefUploadFolder_();
  const files = folder.getFiles();
  let bestFile = null;
  let bestScore = -1;

  while (files.hasNext()) {
    const file = files.next();
    const mimeType = String(file.getMimeType() || "").trim();
    const name = String(file.getName() || "").trim();
    const score = getAnnualScheduleFileScore_(name, mimeType);

    if (score > bestScore) {
      bestFile = file;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestFile : null;
}

function getAnnualScheduleFileScore_(name, mimeType) {
  const normalizedName = String(name || "").trim();

  if (mimeType !== MimeType.PDF || !normalizedName) {
    return -1;
  }

  let score = 0;

  if (normalizedName.indexOf("年間大会予定表") !== -1) {
    score += 10;
  }

  if (normalizedName.indexOf("年間予定表") !== -1) {
    score += 8;
  }

  if (normalizedName.indexOf("年間") !== -1) {
    score += 4;
  }

  if (normalizedName.indexOf("予定表") !== -1) {
    score += 4;
  }

  if (normalizedName.indexOf("大会") !== -1) {
    score += 2;
  }

  return score;
}

function setOrDeleteScriptProperty_(properties, key, value) {
  const normalized = String(value || "").trim();
  if (normalized) {
    properties.setProperty(key, normalized);
    return;
  }

  properties.deleteProperty(key);
}

function extractDriveFolderId_(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  const folderMatch = normalized.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch) {
    return folderMatch[1];
  }

  if (/^[A-Za-z0-9_-]{10,}$/.test(normalized)) {
    return normalized;
  }

  throw new Error("Drive フォルダURLまたはフォルダIDを入力してください。");
}

function getSpreadsheet() {
  if (SPREADSHEET_CACHE.spreadsheet) {
    return SPREADSHEET_CACHE.spreadsheet;
  }

  const sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!sheetId) {
    throw new Error("SHEET_ID is not set");
  }

  SPREADSHEET_CACHE.spreadsheet = SpreadsheetApp.openById(sheetId);
  return SPREADSHEET_CACHE.spreadsheet;
}

function getSheetByName(name) {
  if (SPREADSHEET_CACHE.sheets[name]) {
    return SPREADSHEET_CACHE.sheets[name];
  }

  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error("Sheet not found: " + name);
  }

  SPREADSHEET_CACHE.sheets[name] = sheet;
  return sheet;
}

function listTournaments() {
  return listSheetObjectsCached_(
    "Tournaments",
    "sheet:Tournaments",
    SHEET_CACHE_TTL_SECONDS
  );
}

function listPublicTournaments(pageToken) {
  if (!pageToken) {
    throw new Error("Missing page_token");
  }

  return listTournaments()
    .filter(function(tournament) {
      return (
        tournament.status === "active" ||
        tournament.status === "applied"
      ) &&
        tournament.entry_page_token === pageToken;
    })
    .map(function(tournament) {
      return {
        tournament_id: tournament.tournament_id,
        title: tournament.title,
        status: tournament.status || "",
        event_date_label: buildEventDateLabel(
          tournament.event_start_date,
          tournament.event_end_date
        ),
        event_start_date: tournament.event_start_date || "",
        event_end_date: tournament.event_end_date || tournament.event_start_date || "",
        grades: tournament.grades,
        internal_deadline: tournament.internal_deadline,
        drive_url: tournament.drive_url,
      };
    });
}

function listMembers() {
  return listAdminMembers().filter(function(member) {
    return member.status === "active";
  }).map(function(member) {
    return {
      member_id: member.member_id,
      display_name: getMemberDisplayName_(member),
      grade: member.grade || "",
    };
  });
}

function listAdminMembers() {
  return listSheetObjectsCached_(
    "Members",
    "sheet:Members",
    SHEET_CACHE_TTL_SECONDS
  );
}

function listMemberResponses(pageToken, memberName) {
  if (!pageToken) {
    throw new Error("Missing page_token");
  }

  if (!memberName) {
    throw new Error("Missing member_name");
  }

  const publicTournaments = listPublicTournaments(pageToken);
  const allowedTournamentIds = {};
  const responses = listSheetObjectsCached_(
    "Responses",
    "sheet:Responses",
    RESPONSE_CACHE_TTL_SECONDS
  );
  const normalizedMemberName = normalizeMemberName(memberName);

  publicTournaments.forEach(function(tournament) {
    allowedTournamentIds[tournament.tournament_id] = true;
  });

  return responses
    .filter(function(response) {
      return normalizeMemberName(response.member_name) === normalizedMemberName &&
        allowedTournamentIds[response.tournament_id];
    })
    .map(function(response) {
      return {
        tournament_id: response.tournament_id,
        response: response.response,
        comment: response.comment || "",
        updated_at: response.updated_at || "",
      };
    });
}

function listTournamentResponses(tournamentId) {
  if (!tournamentId) {
    throw new Error("Missing tournament_id");
  }

  const tournaments = listTournaments();
  const tournamentExists = tournaments.some(function(tournament) {
    return tournament.tournament_id === tournamentId;
  });

  if (!tournamentExists) {
    throw new Error("Tournament not found");
  }

  const members = listMembers();
  const responses = listSheetObjectsCached_(
    "Responses",
    "sheet:Responses",
    RESPONSE_CACHE_TTL_SECONDS
  );
  const responseMap = {};
  const memberNames = {};

  responses.forEach(function(response) {
    if (response.tournament_id !== tournamentId) {
      return;
    }

    const normalizedName = normalizeMemberName(response.member_name);
    if (!normalizedName) {
      return;
    }

    responseMap[normalizedName] = {
      response: response.response || "",
      comment: response.comment || "",
      updated_at: response.updated_at || "",
      member_name: normalizedName,
    };
  });

  const result = members.map(function(member) {
    const normalizedName = normalizeMemberName(getMemberDisplayName_(member));
    const response = responseMap[normalizedName] || {};
    memberNames[normalizedName] = true;

    return {
      member_id: member.member_id,
      display_name: getMemberDisplayName_(member),
      grade: member.grade || "",
      response: response.response || "",
      comment: response.comment || "",
      updated_at: response.updated_at || "",
      is_member_missing: false,
    };
  });

  Object.keys(responseMap).forEach(function(normalizedName) {
    if (memberNames[normalizedName]) {
      return;
    }

    result.push({
      member_id: "",
      display_name: responseMap[normalizedName].member_name,
      grade: "",
      response: responseMap[normalizedName].response || "",
      comment: responseMap[normalizedName].comment || "",
      updated_at: responseMap[normalizedName].updated_at || "",
      is_member_missing: true,
    });
  });

  return result;
}

function listTournamentResponseOverview() {
  const tournaments = listTournaments().slice().sort(function(a, b) {
    return String(a.event_start_date || "").localeCompare(
      String(b.event_start_date || "")
    );
  });
  const members = listMembers();
  const responses = listSheetObjectsCached_(
    "Responses",
    "sheet:Responses",
    RESPONSE_CACHE_TTL_SECONDS
  );
  const memberByName = {};
  const tournamentMap = {};
  const groupedApplicants = {};

  members.forEach(function(member) {
    memberByName[normalizeMemberName(getMemberDisplayName_(member))] = member;
  });

  tournaments.forEach(function(tournament) {
    tournamentMap[tournament.tournament_id] = tournament;
    groupedApplicants[tournament.tournament_id] = {};
  });

  responses.forEach(function(response) {
    if (response.response !== "yes") {
      return;
    }

    const tournament = tournamentMap[response.tournament_id];
    if (!tournament) {
      return;
    }

    const normalizedName = normalizeMemberName(response.member_name);
    if (!normalizedName) {
      return;
    }

    const member = memberByName[normalizedName];
    const grade = member && member.grade ? String(member.grade) : "未登録";
    const gradeBucket = groupedApplicants[response.tournament_id][grade] || [];

    if (gradeBucket.indexOf(normalizedName) === -1) {
      gradeBucket.push(normalizedName);
    }

    groupedApplicants[response.tournament_id][grade] = gradeBucket;
  });

  return tournaments.map(function(tournament) {
    const applicantGroups = Object.keys(groupedApplicants[tournament.tournament_id] || {})
      .sort(function(a, b) {
        return String(a).localeCompare(String(b), "ja");
      })
      .map(function(grade) {
        return {
          grade: grade,
          names: groupedApplicants[tournament.tournament_id][grade].slice().sort(function(a, b) {
            return String(a).localeCompare(String(b), "ja");
          }),
        };
      });

    return {
      tournament_id: tournament.tournament_id,
      title: tournament.title || "",
      status: tournament.status || "",
      event_start_date: tournament.event_start_date || "",
      event_end_date: tournament.event_end_date || tournament.event_start_date || "",
      internal_deadline: tournament.internal_deadline || "",
      event_date_label: buildEventDateLabel(
        tournament.event_start_date,
        tournament.event_end_date
      ),
      internal_deadline_label: tournament.internal_deadline ?
        formatDateTimeLabel(tournament.internal_deadline) :
        "-",
      grades: tournament.grades || "",
      applicant_groups: applicantGroups,
      applicant_count: applicantGroups.reduce(function(total, group) {
        return total + group.names.length;
      }, 0),
    };
  });
}

function listPublicTournamentResponseOverview(pageToken) {
  if (!pageToken) {
    throw new Error("Missing page_token");
  }

  const publicTournaments = listPublicTournaments(pageToken);
  const members = listMembers();
  const responses = listSheetObjectsCached_(
    "Responses",
    "sheet:Responses",
    RESPONSE_CACHE_TTL_SECONDS
  );
  const memberByName = {};
  const tournamentMap = {};
  const groupedApplicants = {};

  members.forEach(function(member) {
    memberByName[normalizeMemberName(getMemberDisplayName_(member))] = member;
  });

  publicTournaments.forEach(function(tournament) {
    tournamentMap[tournament.tournament_id] = tournament;
    groupedApplicants[tournament.tournament_id] = {};
  });

  responses.forEach(function(response) {
    if (response.response !== "yes") {
      return;
    }

    const tournament = tournamentMap[response.tournament_id];
    if (!tournament) {
      return;
    }

    const normalizedName = normalizeMemberName(response.member_name);
    if (!normalizedName) {
      return;
    }

    const member = memberByName[normalizedName];
    const grade = member && member.grade ? String(member.grade) : "未登録";
    const gradeBucket = groupedApplicants[response.tournament_id][grade] || [];

    if (gradeBucket.indexOf(normalizedName) === -1) {
      gradeBucket.push(normalizedName);
    }

    groupedApplicants[response.tournament_id][grade] = gradeBucket;
  });

  return publicTournaments.map(function(tournament) {
    const applicantGroups = Object.keys(groupedApplicants[tournament.tournament_id] || {})
      .sort(function(a, b) {
        return String(a).localeCompare(String(b), "ja");
      })
      .map(function(grade) {
        return {
          grade: grade,
          names: groupedApplicants[tournament.tournament_id][grade].slice().sort(function(a, b) {
            return String(a).localeCompare(String(b), "ja");
          }),
        };
      });

    return {
      tournament_id: tournament.tournament_id,
      title: tournament.title || "",
      status: tournament.status || "",
      event_start_date: tournament.event_start_date || "",
      event_end_date: tournament.event_end_date || tournament.event_start_date || "",
      event_date_label: tournament.event_date_label || "",
      internal_deadline: tournament.internal_deadline || "",
      grades: tournament.grades || "",
      applicant_groups: applicantGroups,
      applicant_count: applicantGroups.reduce(function(total, group) {
        return total + group.names.length;
      }, 0),
    };
  });
}

function getEntryPage(pageToken) {
  if (!pageToken) {
    throw new Error("Missing page_token");
  }

  const pages = listSheetObjectsCached_(
    "EntryPages",
    "sheet:EntryPages",
    SHEET_CACHE_TTL_SECONDS
  );

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (page.page_token === pageToken && page.status === "active") {
      return {
        title: page.title,
        description: page.description,
      };
    }
  }

  throw new Error("Entry page not found");
}

function upsertTournament(tournament) {
  validateTournament(tournament);

  const sheet = getSheetByName("Tournaments");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  ensureRequiredTournamentHeaders_(headers);
  const idIndex = headers.indexOf("tournament_id");
  const now = new Date();

  let tournamentId = tournament.tournament_id;
  let rowIndex = -1;
  let mode = "created";

  if (!tournamentId) {
    tournamentId = generateTournamentId(tournament.event_start_date);
  } else {
    for (let i = 1; i < values.length; i += 1) {
      if (values[i][idIndex] === tournamentId) {
        rowIndex = i + 1;
        mode = "updated";
        break;
      }
    }
  }

  const existing = rowIndex > 0 ? rowToObject(headers, values[rowIndex - 1]) : {};
  const record = buildTournamentRecord(headers, existing, tournament, tournamentId, now);
  const row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : "";
  });

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    rowIndex = sheet.getLastRow();
  }

  const calendarSync = syncTournamentCalendarForRow(
    sheet,
    headers,
    rowIndex,
    record
  );

  invalidateSheetCaches_(["Tournaments", "NotificationLogs"]);

  return {
    tournament_id: tournamentId,
    mode: mode,
    calendar_sync: calendarSync,
  };
}

function upsertResponses(pageToken, memberName, responses) {
  validateResponseRequest(pageToken, memberName, responses);
  getEntryPage(pageToken);

  const tournaments = listPublicTournaments(pageToken).filter(function(tournament) {
    return String(tournament.status || "").trim() === "active";
  });
  const allowedTournamentIds = {};
  const sheet = getSheetByName("Responses");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const now = new Date();
  let updatedCount = 0;

  tournaments.forEach(function(tournament) {
    allowedTournamentIds[tournament.tournament_id] = true;
  });

  responses.forEach(function(responseInput) {
    validateSingleResponse(responseInput, allowedTournamentIds);

    const existingRowIndex = findResponseRowIndex(
      values,
      headers,
      responseInput.tournament_id,
      memberName
    );
    const existing = existingRowIndex > 0 ?
      rowToObject(headers, values[existingRowIndex - 1]) :
      {};
    const record = buildResponseRecord(
      headers,
      existing,
      responseInput,
      memberName,
      now
    );
    const row = headers.map(function(header) {
      return record[header] !== undefined ? record[header] : "";
    });

    if (existingRowIndex > 0) {
      sheet.getRange(existingRowIndex, 1, 1, row.length).setValues([row]);
      values[existingRowIndex - 1] = row;
    } else {
      sheet.appendRow(row);
      values.push(row);
    }

    updatedCount += 1;
  });

  invalidateSheetCaches_(["Responses"]);

  return {
    updated_count: updatedCount,
  };
}

function upsertMember(member) {
  validateMember(member);

  const sheet = getSheetByName("Members");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  ensureRequiredMemberHeaders_(headers);
  const idIndex = headers.indexOf("member_id");
  const now = new Date();

  let memberId = member.member_id;
  let rowIndex = -1;
  let mode = "created";

  if (!memberId) {
    memberId = generateMemberId(values.length);
  } else {
    for (let i = 1; i < values.length; i += 1) {
      if (values[i][idIndex] === memberId) {
        rowIndex = i + 1;
        mode = "updated";
        break;
      }
    }
  }

  const existing = rowIndex > 0 ? rowToObject(headers, values[rowIndex - 1]) : {};
  const record = buildMemberRecord(headers, existing, member, memberId, now);
  const row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : "";
  });

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  invalidateSheetCaches_(["Members"]);

  return {
    member_id: memberId,
    mode: mode,
    status: record.status || "",
  };
}

function requestMemberRegistration(member) {
  const requestMember = cloneObject(member);
  requestMember.status = "pending";
  validateMember(requestMember);
  ensureMemberRegistrationNotDuplicated_(requestMember);
  const result = upsertMember(requestMember);
  const savedMember = cloneObject(requestMember);

  savedMember.member_id = result.member_id;
  savedMember.status = "pending";
  savedMember.display_name = buildMemberDisplayName_(savedMember);
  savedMember.display_name_kana = buildMemberDisplayNameKana_(savedMember);

  try {
    result.notification = notifyManagersAboutMemberRegistration(savedMember);
  } catch (error) {
    result.notification = {
      sent: false,
      skipped: false,
      message: String(error),
    };
    appendNotificationLog({
      tournament_id: "",
      notification_type: "member_registration_request_error",
      sent_to_type: "manager",
      sent_to_id: "",
      message: String(error),
    });
  }

  return result;
}

function notifyManagersAboutMemberRegistration(member) {
  const managerResolution = getActiveManagerLineUserIds_();
  const invalidManagerIds = managerResolution.invalid_manager_ids;
  const managerIds = managerResolution.manager_ids;

  if (invalidManagerIds.length) {
    appendNotificationLog({
      tournament_id: "",
      notification_type: "member_registration_request_skipped",
      sent_to_type: "manager",
      sent_to_id: "",
      message: "Invalid LINE user IDs in Managers: " + invalidManagerIds.join(", "),
    });
  }

  if (!managerIds.length) {
    appendNotificationLog({
      tournament_id: "",
      notification_type: "member_registration_request_skipped",
      sent_to_type: "manager",
      sent_to_id: "",
      message: "No active managers with valid LINE user ID.",
    });
    return {
      sent: false,
      skipped: true,
      manager_count: 0,
      message: "No active managers with valid LINE user ID.",
    };
  }

  const message = buildMemberRegistrationRequestMessage_(member);

  managerIds.forEach(function(managerId) {
    pushLineMessage(managerId, [{
      type: "text",
      text: message,
    }]);

    appendNotificationLog({
      tournament_id: "",
      notification_type: "member_registration_request",
      sent_to_type: "manager",
      sent_to_id: managerId,
      message: message,
    });
  });

  return {
    sent: true,
    skipped: false,
    manager_count: managerIds.length,
  };
}

function buildMemberRegistrationRequestMessage_(member) {
  return renderLineMessageTemplate_("member_registration_request", {
    MEMBER_NAME: buildMemberFullName_(member) || "-",
    MEMBER_KANA: buildMemberDisplayNameKana_(member) || "-",
    MEMBER_RANK: formatMemberRankLabel_(member.rank),
    MEMBER_GRADE: formatMemberGradeLabelForLine_(member.grade),
    ADMIN_PAGE_URL: getAdminPageUrl_(""),
  });
}

function sendPendingMemberRegistrationSummary() {
  const pendingMembers = listAdminMembers().filter(function(member) {
    return String(member.status || "").trim() === "pending";
  });

  if (!pendingMembers.length) {
    return {
      sent: false,
      skipped: true,
      manager_count: 0,
      pending_count: 0,
      message: "No pending member registrations.",
    };
  }

  const managerResolution = getActiveManagerLineUserIds_();
  const invalidManagerIds = managerResolution.invalid_manager_ids;
  const managerIds = managerResolution.manager_ids;

  if (invalidManagerIds.length) {
    appendNotificationLog({
      tournament_id: "",
      notification_type: "member_registration_pending_summary_skipped",
      sent_to_type: "manager",
      sent_to_id: "",
      message: "Invalid LINE user IDs in Managers: " + invalidManagerIds.join(", "),
    });
  }

  if (!managerIds.length) {
    appendNotificationLog({
      tournament_id: "",
      notification_type: "member_registration_pending_summary_skipped",
      sent_to_type: "manager",
      sent_to_id: "",
      message: "No active managers with valid LINE user ID.",
    });
    return {
      sent: false,
      skipped: true,
      manager_count: 0,
      pending_count: pendingMembers.length,
      message: "No active managers with valid LINE user ID.",
    };
  }

  const message = buildPendingMemberRegistrationSummaryMessage_(pendingMembers);

  managerIds.forEach(function(managerId) {
    pushLineMessage(managerId, [{
      type: "text",
      text: message,
    }]);

    appendNotificationLog({
      tournament_id: "",
      notification_type: "member_registration_pending_summary",
      sent_to_type: "manager",
      sent_to_id: managerId,
      message: message,
    });
  });

  return {
    sent: true,
    skipped: false,
    manager_count: managerIds.length,
    pending_count: pendingMembers.length,
  };
}

function buildPendingMemberRegistrationSummaryMessage_(members) {
  return renderLineMessageTemplate_("pending_member_summary", {
    MEMBER_BLOCKS: buildPendingMemberRegistrationBlocksText_(members),
    ADMIN_PAGE_URL: getAdminPageUrl_(""),
  });
}

function upsertTournamentBatch(commonTournament, gradeConfigs) {
  validateTournamentBatchRequest_(commonTournament, gradeConfigs);
  const normalizedGradeConfigs = assignTournamentIdsToGradeConfigs_(
    commonTournament,
    gradeConfigs
  );

  const results = normalizedGradeConfigs.map(function(gradeConfig) {
    return upsertTournament(buildTournamentFromGradeConfig_(
      commonTournament,
      gradeConfig
    ));
  });

  return {
    count: results.length,
    tournament_ids: results.map(function(result) {
      return result.tournament_id;
    }),
    results: results,
  };
}

function updateTournamentStatus(tournamentId, status) {
  if (!tournamentId) {
    throw new Error("Missing tournament_id");
  }

  validateTournamentStatusForUpdate_(status);

  const sheet = getSheetByName("Tournaments");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  ensureRequiredTournamentHeaders_(headers);
  const idIndex = headers.indexOf("tournament_id");
  const now = new Date();
  let rowIndex = -1;

  for (let i = 1; i < values.length; i += 1) {
    if (values[i][idIndex] === tournamentId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex <= 0) {
    throw new Error("Tournament not found");
  }

  const existing = rowToObject(headers, values[rowIndex - 1]);
  const record = buildTournamentRecord(
    headers,
    existing,
    { status: status },
    tournamentId,
    now
  );
  const row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : "";
  });

  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);

  const calendarSync = syncTournamentCalendarForRow(
    sheet,
    headers,
    rowIndex,
    record
  );

  invalidateSheetCaches_(["Tournaments", "NotificationLogs"]);

  return {
    tournament_id: tournamentId,
    status: record.status || "",
    calendar_sync: calendarSync,
  };
}

function buildTournamentRecord(headers, existing, tournament, tournamentId, now) {
  const record = {};
  const nowIso = toIsoString(now);

  headers.forEach(function(header) {
    if (existing[header] !== undefined) {
      record[header] = existing[header];
    }
  });

  Object.keys(tournament).forEach(function(key) {
    record[key] = tournament[key];
  });

  record.tournament_id = tournamentId;
  record.tournament_type = normalizeTournamentType_(record.tournament_type);
  record.is_official = record.tournament_type === "official";
  record.updated_at = nowIso;
  applyTournamentAppliedAt_(headers, existing, record, nowIso);

  if (!existing.created_at) {
    record.created_at = nowIso;
  }

  if (!record.status) {
    record.status = "active";
  }

  return record;
}

function applyTournamentAppliedAt_(headers, existing, record, nowIso) {
  if ((headers || []).indexOf("applied_at") === -1) {
    return;
  }

  const nextStatus = String(record.status || "").trim();
  const previousStatus = String(existing.status || "").trim();

  if (nextStatus === "applied") {
    record.applied_at = previousStatus === "applied" && existing.applied_at ?
      existing.applied_at :
      nowIso;
    return;
  }

  if (
    nextStatus === "closed" &&
    previousStatus === "applied" &&
    existing.applied_at
  ) {
    record.applied_at = existing.applied_at;
    return;
  }

  record.applied_at = "";
}

function syncTournamentCalendarForRow(sheet, headers, rowIndex, tournament) {
  const calendarHeaders = [
    "calendar_event_id_event",
    "calendar_event_id_internal_deadline",
    "calendar_event_id_true_deadline",
  ];
  const missingHeaders = calendarHeaders.filter(function(header) {
    return headers.indexOf(header) === -1;
  });

  if (missingHeaders.length > 0) {
    return {
      ok: false,
      skipped: true,
      message: "Calendar columns are missing: " + missingHeaders.join(", "),
    };
  }

  try {
    const syncResult = syncTournamentCalendarRecord(tournament);
    const updatedRow = headers.map(function(header) {
      return syncResult.record[header] !== undefined ?
        syncResult.record[header] :
        "";
    });

    sheet.getRange(rowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);

    return {
      ok: true,
      action: syncResult.action,
      message: syncResult.message,
      event_ids: {
        event: syncResult.record.calendar_event_id_event || "",
        internal_deadline:
          syncResult.record.calendar_event_id_internal_deadline || "",
        true_deadline:
          syncResult.record.calendar_event_id_true_deadline || "",
      },
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      message: String(error),
    };
  }
}

function syncTournamentCalendarRecord(tournament) {
  const record = cloneObject(tournament);
  const status = String(record.status || "").trim();

  if (status === "draft" || status === "deleted") {
    deleteCalendarEventIfExists(record.calendar_event_id_event);
    deleteCalendarEventIfExists(record.calendar_event_id_internal_deadline);
    deleteCalendarEventIfExists(record.calendar_event_id_true_deadline);

    record.calendar_event_id_event = "";
    record.calendar_event_id_internal_deadline = "";
    record.calendar_event_id_true_deadline = "";

    return {
      action: "cleared",
      message: "Draft/deleted tournament is not synced to Calendar.",
      record: record,
    };
  }

  const calendar = getTournamentCalendar();
  const titlePrefix = status === "canceled" ? "[中止] " : "";
  const eventDateStart = parseDateOnly(record.event_start_date);
  const eventDateEnd = addDays(
    parseDateOnly(record.event_end_date || record.event_start_date),
    1
  );

  record.calendar_event_id_event = upsertAllDayCalendarEvent(
    calendar,
    record.calendar_event_id_event,
    titlePrefix + "【大会】" + record.title,
    eventDateStart,
    eventDateEnd,
    buildCalendarEventDescription(record)
  );

  record.calendar_event_id_internal_deadline = upsertTimedCalendarEvent(
    calendar,
    record.calendar_event_id_internal_deadline,
    titlePrefix + "【サークル内締切】" + record.title,
    parseDateTimeValue(record.internal_deadline),
    addMinutes(parseDateTimeValue(record.internal_deadline), 30),
    buildInternalDeadlineDescription(record)
  );

  record.calendar_event_id_true_deadline = upsertTimedCalendarEvent(
    calendar,
    record.calendar_event_id_true_deadline,
    titlePrefix + "【真の申込締切】" + record.title,
    parseDateTimeValue(record.true_deadline),
    addMinutes(parseDateTimeValue(record.true_deadline), 30),
    buildTrueDeadlineDescription(record)
  );

  return {
    action: "synced",
    message: "Google Calendar synced.",
    record: record,
  };
}

function getTournamentCalendar() {
  const calendarId =
    PropertiesService.getScriptProperties().getProperty("CALENDAR_ID");

  if (!calendarId) {
    throw new Error("CALENDAR_ID is not set");
  }

  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    throw new Error("Calendar not found: " + calendarId);
  }

  return calendar;
}

function upsertAllDayCalendarEvent(
  calendar,
  eventId,
  title,
  startDate,
  endDateExclusive,
  description
) {
  const event = getCalendarEventById(eventId);

  if (event) {
    event.setTitle(title);
    event.setDescription(description);
    event.setAllDayDates(startDate, endDateExclusive);
    return event.getId();
  }

  return calendar.createAllDayEvent(title, startDate, endDateExclusive, {
    description: description,
  }).getId();
}

function upsertTimedCalendarEvent(
  calendar,
  eventId,
  title,
  startTime,
  endTime,
  description
) {
  const event = getCalendarEventById(eventId);

  if (event) {
    event.setTitle(title);
    event.setDescription(description);
    event.setTime(startTime, endTime);
    return event.getId();
  }

  return calendar.createEvent(title, startTime, endTime, {
    description: description,
  }).getId();
}

function getCalendarEventById(eventId) {
  if (!eventId) {
    return null;
  }

  try {
    return CalendarApp.getEventById(eventId);
  } catch (error) {
    return null;
  }
}

function deleteCalendarEventIfExists(eventId) {
  const event = getCalendarEventById(eventId);
  if (event) {
    event.deleteEvent();
  }
}

function buildCalendarEventDescription(tournament) {
  const lines = [
    "開催級: " + (tournament.grades || "級制限なし"),
    "会場: " + (tournament.venue || "-"),
    "要項URL: " + (tournament.drive_url || "-"),
    "参加意思確認URL: " + getTournamentEntryUrlForLine_(tournament),
  ];

  return lines.join("\n");
}

function buildInternalDeadlineDescription(tournament) {
  return [
    "この日までに参加意思確認ページへ回答。",
    "参加意思確認URL: " + getTournamentEntryUrlForLine_(tournament),
  ].join("\n");
}

function buildTrueDeadlineDescription(tournament) {
  return [
    "申込担当者が主催者へ申込を行う最終締切。",
    "要項URL: " + (tournament.drive_url || "-"),
    "担当者: " + (tournament.manager_name || "-"),
  ].join("\n");
}

function registerLineGroup(event) {
  const source = event && event.source ? event.source : {};
  const groupId = source.groupId || "";

  if (!groupId) {
    return "このコマンドはLINEグループ内で実行してください。";
  }

  PropertiesService.getScriptProperties().setProperty("LINE_GROUP_ID", groupId);
  return "groupId を登録しました。\n" + groupId;
}

function registerLineTestGroup(event) {
  const source = event && event.source ? event.source : {};
  const groupId = source.groupId || "";

  if (!groupId) {
    return "このコマンドはLINEグループ内で実行してください。";
  }

  PropertiesService.getScriptProperties().setProperty("LINE_TEST_GROUP_ID", groupId);
  return "テスト用 groupId を登録しました。\n" + groupId;
}

function registerManagerFromLine(event) {
  const source = event && event.source ? event.source : {};
  const userId = source.userId || "";

  if (!userId) {
    return "userId を取得できませんでした。";
  }

  const profile = getLineUserProfile(userId);
  upsertManagerFromLineProfile(userId, profile.displayName || "LINE担当者");

  return "担当者を登録しました。\n" +
    "表示名: " + (profile.displayName || "LINE担当者") + "\n" +
    "userId: " + userId;
}

function upsertManagerFromLineProfile(userId, displayName) {
  const sheet = getSheetByName("Managers");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const now = new Date();
  const lineUserIdIndex = headers.indexOf("line_user_id");
  let rowIndex = -1;

  for (let i = 1; i < values.length; i += 1) {
    if (values[i][lineUserIdIndex] === userId) {
      rowIndex = i + 1;
      break;
    }
  }

  const existing = rowIndex > 0 ? rowToObject(headers, values[rowIndex - 1]) : {};
  const record = {};
  const nowIso = toIsoString(now);

  headers.forEach(function(header) {
    if (existing[header] !== undefined) {
      record[header] = existing[header];
    }
  });

  record.manager_name = existing.manager_name || displayName;
  record.line_user_id = userId;
  record.display_name = displayName;
  record.status = "active";
  record.updated_at = nowIso;

  if (!existing.created_at) {
    record.created_at = nowIso;
  }

  const row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : "";
  });

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  invalidateSheetCaches_(["Managers"]);
}

function sendAnnouncement(adminToken, tournamentIds) {
  validateAdminToken(adminToken);

  if (!Array.isArray(tournamentIds) || tournamentIds.length === 0) {
    throw new Error("tournament_ids must be a non-empty array");
  }

  const tournaments = listTournaments().filter(function(tournament) {
    return tournamentIds.indexOf(tournament.tournament_id) !== -1;
  });

  if (!tournaments.length) {
    throw new Error("No tournaments found for announcement");
  }

  return sendAnnouncementForTournaments(tournaments);
}

function sendAnnouncementForTournaments(tournaments) {
  const groupId = getLineGroupId();
  const message = buildAnnouncementMessage(tournaments);
  const sentAt = toIsoString(new Date());
  const managerBackup = sendManagerBackupForGroupMessage_(
    message,
    "announcement",
    tournaments
  );
  pushLineMessage(groupId, [{
    type: "text",
    text: message,
  }]);

  tournaments.forEach(function(tournament) {
    appendNotificationLog({
      tournament_id: tournament.tournament_id,
      notification_type: "announcement",
      sent_to_type: "group",
      sent_to_id: groupId,
      message: message,
    });
  });
  markTournamentNotificationSent_(
    tournaments,
    "announcement_sent_at",
    sentAt
  );

  return {
    sent: true,
    group_id: groupId,
    tournament_ids: tournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
    manager_backup: managerBackup,
  };
}

function sendScheduledDailyAnnouncements() {
  const result = sendScheduledWeeklyAnnouncementDigest_();

  Logger.log(result);
  return result;
}

function sendScheduledWeeklyAnnouncementDigest_() {
  const announcementTournaments = getPendingAnnouncementTournaments();
  const reminderTournaments = getPendingWeeklyGroupReminderTournaments_();
  const messages = [];
  const sentAt = toIsoString(new Date());

  if (announcementTournaments.length) {
    messages.push({
      type: "text",
      text: buildAnnouncementMessage(announcementTournaments),
    });
  }

  if (reminderTournaments.length) {
    messages.push({
      type: "text",
      text: buildWeeklyGroupReminderMessage_(reminderTournaments),
    });
  }

  if (!messages.length) {
    return {
      sent: false,
      skipped: true,
      reason: "no_pending_tournaments_or_reminders",
      tournament_ids: [],
      announcement_tournament_ids: [],
      reminder_tournament_ids: [],
    };
  }

  const groupId = getLineGroupId();
  const allTournaments = mergeTournamentsById_(
    announcementTournaments,
    reminderTournaments
  );
  const managerBackup = sendManagerBackupForGroupMessages_(
    messages,
    "weekly_digest",
    allTournaments
  );

  pushLineMessage(groupId, messages);

  if (announcementTournaments.length) {
    appendGroupNotificationLogs_(
      announcementTournaments,
      "announcement",
      groupId,
      messages[0].text
    );
    markTournamentNotificationSent_(
      announcementTournaments,
      "announcement_sent_at",
      sentAt
    );
  }

  if (reminderTournaments.length) {
    appendGroupNotificationLogs_(
      reminderTournaments,
      "weekly_internal_deadline_reminder",
      groupId,
      messages[messages.length - 1].text
    );
    markTournamentNotificationSent_(
      reminderTournaments,
      "internal_deadline_reminder_sent_at",
      sentAt
    );
  }

  return {
    sent: true,
    skipped: false,
    notification_type: "weekly_digest",
    group_id: groupId,
    tournament_ids: allTournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
    announcement_tournament_ids: announcementTournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
    reminder_tournament_ids: reminderTournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
    message_count: messages.length,
    manager_backup: managerBackup,
  };
}

function sendScheduledAppliedNotifications() {
  const tournaments = getPendingAppliedNotificationTournaments_();

  if (!tournaments.length) {
    Logger.log("No pending tournaments for applied notification.");
    return {
      sent: false,
      reason: "no_pending_tournaments",
      tournament_ids: [],
    };
  }

  const result = sendAppliedNotificationForTournaments_(tournaments);
  Logger.log(result);
  return result;
}

function getPendingAnnouncementTournaments() {
  return listTournaments().filter(function(tournament) {
    if (String(tournament.status || "").trim() !== "active") {
      return false;
    }

    return !hasNotificationSentAt_(tournament, "announcement_sent_at");
  }).sort(function(a, b) {
    return String(a.event_start_date || "").localeCompare(
      String(b.event_start_date || "")
    );
  });
}

function getAnnouncedTournamentIdMap() {
  const logs = listNotificationLogs().filter(function(log) {
    return log.notification_type === "announcement" &&
      log.sent_to_type === "group" &&
      log.tournament_id;
  });
  const announced = {};

  logs.forEach(function(log) {
    announced[String(log.tournament_id)] = true;
  });

  return announced;
}

function getLastNotificationSentAt_(notificationType) {
  const logs = listNotificationLogs()
    .filter(function(log) {
      return log.notification_type === notificationType &&
        log.sent_to_type === "group" &&
        log.sent_at;
    })
    .sort(function(a, b) {
      return String(a.sent_at || "").localeCompare(String(b.sent_at || ""));
    });

  if (!logs.length) {
    return null;
  }

  return parseOptionalDateTime_(logs[logs.length - 1].sent_at);
}

function getPendingAppliedNotificationTournaments_() {
  return listTournaments().filter(function(tournament) {
    if (String(tournament.status || "").trim() !== "applied") {
      return false;
    }

    if (hasNotificationSentAt_(tournament, "application_completed_sent_at")) {
      return false;
    }

    return true;
  }).sort(function(a, b) {
    return String(a.applied_at || "").localeCompare(String(b.applied_at || "")) ||
      String(a.event_start_date || "").localeCompare(String(b.event_start_date || "")) ||
      String(a.title || "").localeCompare(String(b.title || ""), "ja");
  });
}

function getNotifiedTournamentIdMap_(notificationType, sentToType) {
  const logs = listNotificationLogs().filter(function(log) {
    return log.notification_type === notificationType &&
      (!sentToType || log.sent_to_type === sentToType) &&
      log.tournament_id;
  });
  const notified = {};

  logs.forEach(function(log) {
    notified[String(log.tournament_id)] = true;
  });

  return notified;
}

function hasNotificationSentAt_(tournament, fieldName) {
  return Boolean(String(tournament && tournament[fieldName] || "").trim());
}

function getTournamentNotificationSentAtField_(notificationType) {
  const fields = {
    announcement: "announcement_sent_at",
    internal_deadline_2days_before: "internal_deadline_reminder_sent_at",
    internal_deadline_next_day_manager: "manager_internal_deadline_reminder_sent_at",
    true_deadline_morning_manager: "manager_true_deadline_reminder_sent_at",
    application_completed: "application_completed_sent_at",
  };

  return fields[String(notificationType || "").trim()] || "";
}

function markTournamentNotificationSent_(tournaments, fieldName, sentAt) {
  const normalizedFieldName = String(fieldName || "").trim();
  const timestamp = String(sentAt || "").trim() || toIsoString(new Date());

  if (!normalizedFieldName || !Array.isArray(tournaments) || !tournaments.length) {
    return {
      updated_count: 0,
      missing_field: !normalizedFieldName,
    };
  }

  const tournamentIds = {};
  tournaments.forEach(function(tournament) {
    const tournamentId = String(tournament && tournament.tournament_id || "").trim();
    if (tournamentId) {
      tournamentIds[tournamentId] = true;
    }
  });

  if (!Object.keys(tournamentIds).length) {
    return {
      updated_count: 0,
    };
  }

  const sheet = getSheetByName("Tournaments");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return {
      updated_count: 0,
    };
  }

  const headers = values[0];
  const idIndex = headers.indexOf("tournament_id");
  const fieldIndex = headers.indexOf(normalizedFieldName);

  if (idIndex === -1) {
    throw new Error("Tournamentsシートに tournament_id 列がありません。");
  }

  if (fieldIndex === -1) {
    throw new Error("Tournamentsシートに列を追加してください: " + normalizedFieldName);
  }

  let updatedCount = 0;
  for (let i = 1; i < values.length; i += 1) {
    const tournamentId = String(values[i][idIndex] || "").trim();

    if (!tournamentIds[tournamentId]) {
      continue;
    }

    sheet.getRange(i + 1, fieldIndex + 1).setValue(timestamp);
    updatedCount += 1;
  }

  if (updatedCount) {
    invalidateSheetCaches_(["Tournaments"]);
  }

  return {
    updated_count: updatedCount,
  };
}

function appendGroupNotificationLogs_(tournaments, notificationType, groupId, message) {
  (tournaments || []).forEach(function(tournament) {
    appendNotificationLog({
      tournament_id: tournament.tournament_id,
      notification_type: notificationType,
      sent_to_type: "group",
      sent_to_id: groupId,
      message: message,
    });
  });
}

function mergeTournamentsById_() {
  const merged = [];
  const seen = {};

  Array.prototype.slice.call(arguments).forEach(function(tournaments) {
    (tournaments || []).forEach(function(tournament) {
      const tournamentId = String(tournament.tournament_id || "").trim();

      if (!tournamentId || seen[tournamentId]) {
        return;
      }

      seen[tournamentId] = true;
      merged.push(tournament);
    });
  });

  return merged;
}

function getCurrentWeekDateRange_() {
  const today = parseDateOnly(
    Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd")
  );
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const start = addDays(today, mondayOffset);
  const end = addDays(start, 6);

  return {
    start_key: normalizeDateKey(start),
    end_key: normalizeDateKey(end),
  };
}

function sendScheduledTournamentReminders() {
  const groupResult = {
    sent: false,
    skipped: true,
    reason: "handled_by_weekly_digest",
    notification_type: "internal_deadline_2days_before",
    tournament_ids: [],
  };
  const managerInternalResult = sendScheduledManagerInternalDeadlineReminders_();
  const managerTrueDeadlineResult = sendScheduledManagerTrueDeadlineReminders_();
  const result = {
    group_internal_deadline_2days_before: groupResult,
    manager_internal_deadline_next_day: managerInternalResult,
    manager_true_deadline_morning: managerTrueDeadlineResult,
  };

  Logger.log(result);
  return result;
}

function sendScheduledGroupReminders_() {
  const tournaments = getPendingGroupReminderTournaments_();

  if (!tournaments.length) {
    return {
      sent: false,
      skipped: true,
      reason: "no_pending_tournaments",
      notification_type: "internal_deadline_2days_before",
      tournament_ids: [],
    };
  }

  const groupId = getLineGroupId();
  const message = buildGroupReminderMessage(
    tournaments,
    "internal_deadline_2days_before"
  );
  const sentAt = toIsoString(new Date());
  const managerBackup = sendManagerBackupForGroupMessage_(
    message,
    "internal_deadline_2days_before",
    tournaments
  );

  pushLineMessage(groupId, [{
    type: "text",
    text: message,
  }]);

  tournaments.forEach(function(tournament) {
    appendNotificationLog({
      tournament_id: tournament.tournament_id,
      notification_type: "internal_deadline_2days_before",
      sent_to_type: "group",
      sent_to_id: groupId,
      message: message,
    });
  });
  markTournamentNotificationSent_(
    tournaments,
    "internal_deadline_reminder_sent_at",
    sentAt
  );

  return {
    sent: true,
    skipped: false,
    notification_type: "internal_deadline_2days_before",
    group_id: groupId,
    tournament_ids: tournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
    manager_backup: managerBackup,
  };
}

function getPendingGroupReminderTournaments_() {
  return getPendingReminderTournamentsByDateOffset_({
    notification_type: "internal_deadline_2days_before",
    sent_to_type: "group",
    date_field: "internal_deadline",
    days_offset: 2,
    sent_at_field: "internal_deadline_reminder_sent_at",
  });
}

function getPendingWeeklyGroupReminderTournaments_() {
  const range = getCurrentWeekDateRange_();

  return listTournaments().filter(function(tournament) {
    const tournamentId = String(tournament.tournament_id || "").trim();
    const deadlineKey = normalizeDateKey(tournament.internal_deadline);

    if (String(tournament.status || "").trim() !== "active") {
      return false;
    }

    if (!tournamentId || !deadlineKey) {
      return false;
    }

    if (hasNotificationSentAt_(tournament, "internal_deadline_reminder_sent_at")) {
      return false;
    }

    return deadlineKey >= range.start_key && deadlineKey <= range.end_key;
  }).sort(function(a, b) {
    return String(a.internal_deadline || "").localeCompare(String(b.internal_deadline || "")) ||
      String(a.event_start_date || "").localeCompare(String(b.event_start_date || "")) ||
      String(a.title || "").localeCompare(String(b.title || ""), "ja");
  });
}

function sendScheduledManagerInternalDeadlineReminders_() {
  const tournaments = getPendingManagerInternalDeadlineReminderTournaments_();

  return sendScheduledManagerRemindersForTournaments_(
    tournaments,
    "internal_deadline_next_day_manager"
  );
}

function getPendingManagerInternalDeadlineReminderTournaments_() {
  return getPendingReminderTournamentsByDateOffset_({
    notification_type: "internal_deadline_next_day_manager",
    sent_to_type: "manager",
    date_field: "internal_deadline",
    days_offset: -1,
    sent_at_field: "manager_internal_deadline_reminder_sent_at",
  });
}

function sendScheduledManagerTrueDeadlineReminders_() {
  const tournaments = getPendingManagerTrueDeadlineReminderTournaments_();

  return sendScheduledManagerRemindersForTournaments_(
    tournaments,
    "true_deadline_morning_manager"
  );
}

function getPendingManagerTrueDeadlineReminderTournaments_() {
  return getPendingReminderTournamentsByDateOffset_({
    notification_type: "true_deadline_morning_manager",
    sent_to_type: "manager",
    date_field: "true_deadline",
    days_offset: 0,
    sent_at_field: "manager_true_deadline_reminder_sent_at",
  });
}

function getPendingReminderTournamentsByDateOffset_(options) {
  const dateField = String(options.date_field || "").trim();
  const daysOffset = Number(options.days_offset || 0);
  const sentAtField = String(options.sent_at_field || "").trim();
  const targetDateKey = Utilities.formatDate(
    addDays(new Date(), daysOffset),
    "Asia/Tokyo",
    "yyyy-MM-dd"
  );

  return listTournaments().filter(function(tournament) {
    const tournamentId = String(tournament.tournament_id || "").trim();

    if (String(tournament.status || "").trim() !== "active") {
      return false;
    }

    if (!tournamentId) {
      return false;
    }

    if (sentAtField && hasNotificationSentAt_(tournament, sentAtField)) {
      return false;
    }

    return normalizeDateKey(tournament[dateField]) === targetDateKey;
  }).sort(function(a, b) {
    return String(a.event_start_date || "").localeCompare(
      String(b.event_start_date || "")
    ) || String(a.title || "").localeCompare(String(b.title || ""), "ja");
  });
}

function runNightlyTournamentAutomation() {
  const syncResult = syncAutomaticTournamentStatuses_();
  const notificationResult = sendScheduledAppliedNotifications();
  const result = {
    status_sync: syncResult,
    applied_notification: notificationResult,
  };

  Logger.log(result);
  return result;
}

function syncAutomaticTournamentStatuses_() {
  const sheet = getSheetByName("Tournaments");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return {
      updated_count: 0,
      updates: [],
    };
  }

  const headers = values[0];
  ensureRequiredTournamentHeaders_(headers);
  const now = new Date();
  const applicantCountMap = buildTournamentApplicantCountMap_();
  const updates = [];

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];

    if (!row.some(function(cell) { return cell !== ""; })) {
      continue;
    }

    const existing = rowToObject(headers, row);
    const tournamentId = String(existing.tournament_id || "").trim();

    if (!tournamentId) {
      continue;
    }

    const nextStatus = getAutomaticTournamentStatus_(
      existing,
      Number(applicantCountMap[tournamentId] || 0),
      now
    );
    const currentStatus = String(existing.status || "").trim();

    if (!nextStatus || nextStatus === currentStatus) {
      continue;
    }

    const record = buildTournamentRecord(
      headers,
      existing,
      { status: nextStatus },
      tournamentId,
      now
    );
    const nextRow = headers.map(function(header) {
      return record[header] !== undefined ? record[header] : "";
    });

    sheet.getRange(i + 1, 1, 1, nextRow.length).setValues([nextRow]);
    values[i] = nextRow;
    updates.push({
      tournament_id: tournamentId,
      previous_status: currentStatus,
      next_status: nextStatus,
      applicant_count: Number(applicantCountMap[tournamentId] || 0),
    });
  }

  if (updates.length) {
    invalidateSheetCaches_(["Tournaments"]);
  }

  return {
    updated_count: updates.length,
    updates: updates,
  };
}

function buildTournamentApplicantCountMap_() {
  const responses = listSheetObjectsCached_(
    "Responses",
    "sheet:Responses",
    RESPONSE_CACHE_TTL_SECONDS
  );
  const seen = {};
  const counts = {};

  responses.forEach(function(response) {
    if (String(response.response || "").trim() !== "yes") {
      return;
    }

    const tournamentId = String(response.tournament_id || "").trim();
    const memberName = normalizeMemberName(response.member_name);

    if (!tournamentId || !memberName) {
      return;
    }

    const key = tournamentId + "::" + memberName;
    if (seen[key]) {
      return;
    }

    seen[key] = true;
    counts[tournamentId] = Number(counts[tournamentId] || 0) + 1;
  });

  return counts;
}

function getAutomaticTournamentStatus_(tournament, applicantCount, now) {
  const currentStatus = String(tournament.status || "").trim();

  if (
    currentStatus === "draft" ||
    currentStatus === "deleted" ||
    currentStatus === "canceled" ||
    currentStatus === "closed"
  ) {
    return currentStatus;
  }

  const eventCloseAt = buildTournamentStatusCheckpoint_(
    tournament.event_end_date || tournament.event_start_date,
    1
  );

  if (eventCloseAt && now.getTime() >= eventCloseAt.getTime()) {
    return "closed";
  }

  const noApplicantCloseAt = buildStartOfDateCheckpoint_(
    tournament.true_deadline,
    1
  );

  if (
    applicantCount <= 0 &&
    noApplicantCloseAt &&
    now.getTime() >= noApplicantCloseAt.getTime()
  ) {
    return "closed";
  }

  return currentStatus;
}

function buildTournamentStatusCheckpoint_(value, daysToAdd) {
  const baseDateKey = normalizeDateKey(value);

  if (!baseDateKey) {
    return null;
  }

  const date = addDays(parseDateOnly(baseDateKey), Number(daysToAdd || 0));
  date.setHours(23, 59, 0, 0);
  return date;
}

function buildStartOfDateCheckpoint_(value, daysToAdd) {
  const baseDateKey = normalizeDateKey(value);

  if (!baseDateKey) {
    return null;
  }

  const date = addDays(parseDateOnly(baseDateKey), Number(daysToAdd || 0));
  date.setHours(0, 0, 0, 0);
  return date;
}

function sendGroupReminder(adminToken, tournamentIds, notificationType) {
  validateAdminToken(adminToken);

  if (!Array.isArray(tournamentIds) || tournamentIds.length === 0) {
    throw new Error("tournament_ids must be a non-empty array");
  }

  if (notificationType !== "internal_deadline_2days_before") {
    throw new Error("Invalid notification_type for group reminder");
  }

  const groupId = getLineGroupId();
  const tournaments = getTournamentsByIdsForReminder(tournamentIds);

  if (!tournaments.length) {
    throw new Error("No tournaments found for reminder");
  }

  const message = buildGroupReminderMessage(tournaments, notificationType);
  const sentAt = toIsoString(new Date());
  const managerBackup = sendManagerBackupForGroupMessage_(
    message,
    notificationType,
    tournaments
  );
  pushLineMessage(groupId, [{
    type: "text",
    text: message,
  }]);

  tournaments.forEach(function(tournament) {
    appendNotificationLog({
      tournament_id: tournament.tournament_id,
      notification_type: notificationType,
      sent_to_type: "group",
      sent_to_id: groupId,
      message: message,
    });
  });
  markTournamentNotificationSent_(
    tournaments,
    "internal_deadline_reminder_sent_at",
    sentAt
  );

  return {
    sent: true,
    group_id: groupId,
    tournament_ids: tournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
    notification_type: notificationType,
    manager_backup: managerBackup,
  };
}

function sendAppliedNotificationForTournaments_(tournaments) {
  const groupId = getLineGroupId();
  const message = buildAppliedNotificationMessage_(tournaments);
  const sentAt = toIsoString(new Date());
  const managerBackup = sendManagerBackupForGroupMessage_(
    message,
    "application_completed",
    tournaments
  );

  pushLineMessage(groupId, [{
    type: "text",
    text: message,
  }]);

  tournaments.forEach(function(tournament) {
    appendNotificationLog({
      tournament_id: tournament.tournament_id,
      notification_type: "application_completed",
      sent_to_type: "group",
      sent_to_id: groupId,
      message: message,
    });
  });
  markTournamentNotificationSent_(
    tournaments,
    "application_completed_sent_at",
    sentAt
  );

  return {
    sent: true,
    group_id: groupId,
    tournament_ids: tournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
    manager_backup: managerBackup,
  };
}

function sendManagerBackupForGroupMessage_(message, notificationType, tournaments) {
  return sendManagerBackupForGroupMessages_(
    [{
      type: "text",
      text: message,
    }],
    notificationType,
    tournaments
  );
}

function sendManagerBackupForGroupMessages_(messages, notificationType, tournaments) {
  const lineMessages = normalizeLineMessageObjects_(messages);
  const messageLogText = buildLineMessagesLogText_(lineMessages);
  const managerResolution = getActiveManagerLineUserIds_();
  const invalidManagerIds = managerResolution.invalid_manager_ids;
  const managerIds = managerResolution.manager_ids;
  const tournamentIds = (tournaments || []).map(function(tournament) {
    return String(tournament.tournament_id || "").trim();
  }).filter(Boolean);
  const sentManagerIds = [];
  const failedManagerIds = [];

  if (!lineMessages.length) {
    return {
      sent: false,
      skipped: true,
      manager_count: 0,
      failed_manager_ids: [],
    };
  }

  if (invalidManagerIds.length) {
    appendNotificationLog({
      tournament_id: tournamentIds.join(", "),
      notification_type: notificationType + "_manager_backup_skipped",
      sent_to_type: "manager",
      sent_to_id: "",
      message: "Invalid LINE user IDs in Managers: " + invalidManagerIds.join(", "),
    });
  }

  if (!managerIds.length) {
    appendNotificationLog({
      tournament_id: tournamentIds.join(", "),
      notification_type: notificationType + "_manager_backup_skipped",
      sent_to_type: "manager",
      sent_to_id: "",
      message: "No active managers with valid LINE user ID.",
    });
    return {
      sent: false,
      skipped: true,
      manager_count: 0,
      failed_manager_ids: [],
    };
  }

  managerIds.forEach(function(managerId) {
    try {
      pushLineMessage(managerId, lineMessages);
      sentManagerIds.push(managerId);
      appendManagerBackupNotificationLogs_(
        tournamentIds,
        notificationType,
        managerId,
        messageLogText
      );
    } catch (error) {
      failedManagerIds.push(managerId);
      appendNotificationLog({
        tournament_id: tournamentIds.join(", "),
        notification_type: notificationType + "_manager_backup_error",
        sent_to_type: "manager",
        sent_to_id: managerId,
        message: String(error),
      });
    }
  });

  return {
    sent: sentManagerIds.length > 0,
    skipped: false,
    manager_count: sentManagerIds.length,
    failed_manager_ids: failedManagerIds,
  };
}

function normalizeLineMessageObjects_(messages) {
  if (!Array.isArray(messages)) {
    return [{
      type: "text",
      text: String(messages || ""),
    }];
  }

  return messages.filter(function(message) {
    return message && message.type;
  });
}

function buildLineMessagesLogText_(messages) {
  return (messages || []).map(function(message) {
    if (message.type === "text") {
      return String(message.text || "");
    }

    return JSON.stringify(message);
  }).join("\n\n---\n\n");
}

function appendManagerBackupNotificationLogs_(
  tournamentIds,
  notificationType,
  managerId,
  message
) {
  const ids = tournamentIds && tournamentIds.length ? tournamentIds : [""];

  ids.forEach(function(tournamentId) {
    appendNotificationLog({
      tournament_id: tournamentId,
      notification_type: notificationType + "_manager_backup",
      sent_to_type: "manager",
      sent_to_id: managerId,
      message: message,
    });
  });
}

function sendManagerReminder(adminToken, tournamentIds, notificationType) {
  validateAdminToken(adminToken);

  if (!Array.isArray(tournamentIds) || tournamentIds.length === 0) {
    throw new Error("tournament_ids must be a non-empty array");
  }

  if (
    notificationType !== "internal_deadline_next_day_manager" &&
    notificationType !== "true_deadline_morning_manager"
  ) {
    throw new Error("Invalid notification_type for manager reminder");
  }

  const tournaments = getTournamentsByIdsForReminder(tournamentIds);

  if (!tournaments.length) {
    throw new Error("No tournaments found for reminder");
  }

  return sendManagerReminderForTournaments_(
    tournaments,
    notificationType,
    { strict_missing_manager: true }
  );
}

function sendManagerReminderForTournaments_(tournaments, notificationType, options) {
  const strictMissingManager = !options ||
    options.strict_missing_manager !== false;
  const groupedTargets = {};
  const skipped = [];
  const sentAt = toIsoString(new Date());

  (tournaments || []).forEach(function(tournament) {
    const managerLineUserId = resolveManagerLineUserId(tournament);

    if (!managerLineUserId) {
      const message =
        "manager_line_user_id is missing for tournament and could not be resolved from Managers: " +
        tournament.tournament_id;

      if (strictMissingManager) {
        throw new Error(message);
      }

      skipped.push({
        tournament_id: String(tournament.tournament_id || "").trim(),
        message: message,
      });
      appendNotificationLog({
        tournament_id: tournament.tournament_id || "",
        notification_type: notificationType + "_skipped",
        sent_to_type: "manager",
        sent_to_id: "",
        message: message,
      });
      return;
    }

    if (!groupedTargets[managerLineUserId]) {
      groupedTargets[managerLineUserId] = [];
    }

    groupedTargets[managerLineUserId].push(tournament);
  });

  Object.keys(groupedTargets).forEach(function(managerLineUserId) {
    const managedTournaments = groupedTargets[managerLineUserId];
    const message = notificationType === "internal_deadline_next_day_manager" ?
      buildManagerInternalDeadlineReminderMessage(managedTournaments) :
      buildManagerTrueDeadlineReminderMessage(managedTournaments);

    pushLineMessage(managerLineUserId, [{
      type: "text",
      text: message,
    }]);

    managedTournaments.forEach(function(tournament) {
      appendNotificationLog({
        tournament_id: tournament.tournament_id,
        notification_type: notificationType,
        sent_to_type: "manager",
        sent_to_id: managerLineUserId,
        message: message,
      });
    });
    markTournamentNotificationSent_(
      managedTournaments,
      getTournamentNotificationSentAtField_(notificationType),
      sentAt
    );
  });

  if (!Object.keys(groupedTargets).length) {
    return {
      sent: false,
      skipped: true,
      manager_count: 0,
      tournament_ids: [],
      notification_type: notificationType,
      skipped_tournaments: skipped,
      message: skipped.length ?
        "No manager reminders were sent because no valid manager LINE user IDs were found." :
        "No tournaments found for reminder",
    };
  }

  return {
    sent: true,
    skipped: skipped.length > 0,
    manager_count: Object.keys(groupedTargets).length,
    tournament_ids: (tournaments || []).filter(function(tournament) {
      return skipped.every(function(item) {
        return item.tournament_id !== String(tournament.tournament_id || "").trim();
      });
    }).map(function(tournament) {
      return tournament.tournament_id;
    }),
    notification_type: notificationType,
    skipped_tournaments: skipped,
  };
}

function sendScheduledManagerRemindersForTournaments_(tournaments, notificationType) {
  if (!tournaments.length) {
    return {
      sent: false,
      skipped: true,
      manager_count: 0,
      notification_type: notificationType,
      tournament_ids: [],
      reason: "no_pending_tournaments",
    };
  }

  return sendManagerReminderForTournaments_(
    tournaments,
    notificationType,
    { strict_missing_manager: false }
  );
}

function sendLineTemplateTest_(templateKey) {
  validateLineMessageTemplateKey_(templateKey);

  const groupId = getLineTestGroupId_();
  const message = buildLineTemplateTestMessage_(templateKey);

  pushLineMessage(groupId, [{
    type: "text",
    text: message,
  }]);

  appendNotificationLog({
    tournament_id: "",
    notification_type: "line_template_test",
    sent_to_type: "test_group",
    sent_to_id: groupId,
    message: message,
  });

  return {
    sent: true,
    group_id: groupId,
    template_key: templateKey,
  };
}

function validateLineMessageTemplateKey_(templateKey) {
  const key = String(templateKey || "").trim();
  const definitions = getLineMessageTemplateDefinitions_();

  if (!key || !definitions[key]) {
    throw new Error("Invalid line message template key");
  }
}

function buildLineTemplateTestMessage_(templateKey) {
  const key = String(templateKey || "").trim();
  const rendered = renderLineMessageTemplate_(
    key,
    getLineTemplateTestReplacements_()
  );

  if (!rendered) {
    throw new Error("LINE template is empty");
  }

  return [
    "【テスト送信】",
    "テンプレート: " + getLineTemplateTestLabel_(key),
    "本番グループには送信されていません。",
    "",
    rendered,
  ].join("\n");
}

function getLineTemplateTestLabel_(templateKey) {
  const labels = {
    announcement: "大会情報更新通知",
    group_reminder: "回答締切リマインド",
    manager_internal_deadline: "担当者向け 申込対応リマインド",
    manager_true_deadline: "担当者向け 最終リマインド",
    applied_notification: "申込完了通知",
    member_registration_request: "メンバー追加申請通知",
    pending_member_summary: "未処理メンバー追加申請まとめ通知",
  };

  return labels[templateKey] || templateKey;
}

function getLineTemplateTestReplacements_() {
  return {
    TOURNAMENT_LINES: [
      "6月1日 テスト大会A級（公認）",
      "6月2日 テスト大会B級（後援）",
    ].join("\n"),
    TOURNAMENT_BLOCKS: [
      "",
      "==テスト大会A級==",
      "主催締切日: 6月5日 23:59",
      "山田太郎 A級",
      "佐藤花子 B級",
    ].join("\n"),
    ENTRY_URL: "https://example.com/entry/?page_token=test",
    DRIVE_FOLDER_URL: "https://drive.google.com/drive/folders/TEST_FOLDER_ID",
    ADMIN_PAGE_URL: "https://example.com/board-c7k2m9q4/",
    MEMBER_NAME: "山田太郎",
    MEMBER_KANA: "やまだ たろう",
    MEMBER_RANK: "初段",
    MEMBER_GRADE: "A級",
    MEMBER_BLOCKS: [
      "",
      "山田太郎",
      "ふりがな: やまだ たろう",
      "段位: 初段",
      "級: A級",
    ].join("\n"),
  };
}

function buildAnnouncementMessage(tournaments) {
  const first = tournaments[0];
  const entryUrl = getTournamentEntryUrlForLine_(first);
  return renderLineMessageTemplate_("announcement", {
    TOURNAMENT_LINES: buildGroupedTournamentSummaryLines_(tournaments).join("\n"),
    ENTRY_URL: entryUrl,
    DRIVE_FOLDER_URL: getDriveFolderUrlForLine_(),
  });
}

function buildGroupReminderMessage(tournaments, notificationType) {
  const first = tournaments[0];
  const entryUrl = getTournamentEntryUrlForLine_(first);
  return renderLineMessageTemplate_("group_reminder", {
    TOURNAMENT_LINES: buildGroupedTournamentSummaryLines_(tournaments).join("\n"),
    ENTRY_URL: entryUrl,
    DRIVE_FOLDER_URL: getDriveFolderUrlForLine_(),
  });
}

function buildWeeklyGroupReminderMessage_(tournaments) {
  const first = tournaments[0];

  return [
    "＝＝＝＝＝＝＝＝＝＝＝",
    "【今週の回答締切リマインド】",
    "＝＝＝＝＝＝＝＝＝＝＝",
    "",
    "今週中にサークル内締切がある大会です。",
    "参加を考えている方は、忘れずに回答してください。",
    "",
    "【対象大会】",
    buildWeeklyDeadlineTournamentLines_(tournaments).join("\n"),
    "",
    "【回答ページ】",
    getTournamentEntryUrlForLine_(first),
    "",
    "【要項・案内】",
    getDriveFolderUrlForLine_(),
    "",
    "※サークル内限定の案内です。URLの外部共有はしないでください。",
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildWeeklyDeadlineTournamentLines_(tournaments) {
  return (tournaments || []).map(function(tournament) {
    return (
      formatDateTimeLabel(tournament.internal_deadline) + "締切 " +
      formatDateLabel(normalizeDateKey(tournament.event_start_date)) + " " +
      buildTournamentHeadlineLabel_(tournament) +
      buildTournamentTypeLabel_(tournament)
    ).trim();
  });
}

function buildManagerInternalDeadlineReminderMessage(tournaments) {
  return renderLineMessageTemplate_("manager_internal_deadline", {
    TOURNAMENT_BLOCKS: buildManagerReminderTournamentBlocksText_(tournaments),
    DRIVE_FOLDER_URL: getDriveFolderUrlForLine_(),
    ADMIN_PAGE_URL: getAdminPageUrl_(""),
  });
}

function buildManagerTrueDeadlineReminderMessage(tournaments) {
  return renderLineMessageTemplate_("manager_true_deadline", {
    TOURNAMENT_BLOCKS: buildManagerReminderTournamentBlocksText_(tournaments),
    DRIVE_FOLDER_URL: getDriveFolderUrlForLine_(),
    ADMIN_PAGE_URL: getAdminPageUrl_(""),
  });
}

function buildAppliedNotificationMessage_(tournaments) {
  return renderLineMessageTemplate_("applied_notification", {
    TOURNAMENT_BLOCKS: buildAppliedNotificationBlocksText_(tournaments),
  });
}

function buildAppliedNotificationBlocksText_(tournaments) {
  const lines = [
  ];

  (tournaments || []).forEach(function(tournament) {
    const applicants = listTournamentApplicantMembers_(tournament.tournament_id);
    lines.push("");
    lines.push("==" + buildTournamentHeadlineLabel_(tournament) + "==");

    if (!applicants.length) {
      lines.push("申込者なし");
      return;
    }

    applicants.forEach(function(applicant) {
      lines.push(
        buildMemberFullName_(applicant) + " " +
        formatMemberGradeLabelForLine_(applicant.grade)
      );
    });
  });

  return lines.join("\n");
}

function appendManagerReminderTournamentBlocks_(lines, tournaments) {
  (tournaments || []).forEach(function(tournament) {
    const applicants = listTournamentApplicantMembers_(tournament.tournament_id);
    lines.push("");
    lines.push("==" + buildTournamentHeadlineLabel_(tournament) + "==");
    lines.push("主催締切日: " + formatDateTimeLabel(tournament.true_deadline));

    if (!applicants.length) {
      lines.push("申込希望者なし");
      return;
    }

    applicants.forEach(function(applicant) {
      lines.push(
        buildMemberFullName_(applicant) + " " +
        formatMemberGradeLabelForLine_(applicant.grade)
      );
    });
  });
}

function buildManagerReminderTournamentBlocksText_(tournaments) {
  const lines = [];
  appendManagerReminderTournamentBlocks_(lines, tournaments || []);
  return lines.join("\n");
}

function buildPendingMemberRegistrationBlocksText_(members) {
  const sortedMembers = (members || []).slice().sort(function(a, b) {
    return String(a.member_id || "").localeCompare(String(b.member_id || ""), "ja");
  });
  const lines = [];

  sortedMembers.forEach(function(member) {
    lines.push("");
    lines.push(buildMemberFullName_(member) || "-");
    lines.push("ふりがな: " + (buildMemberDisplayNameKana_(member) || "-"));
    lines.push("段位: " + formatMemberRankLabel_(member.rank));
    lines.push("級: " + formatMemberGradeLabelForLine_(member.grade));
  });

  return lines.join("\n");
}

function renderLineMessageTemplate_(templateKey, replacements) {
  const templates = getLineMessageTemplates_();
  const template = String(templates[templateKey] || "").trim();

  return template ?
    replaceLineTemplatePlaceholders_(template, replacements) :
    "";
}

function replaceLineTemplatePlaceholders_(template, replacements) {
  let result = String(template || "");

  Object.keys(replacements || {}).forEach(function(key) {
    const pattern = new RegExp("\\{\\{" + escapeRegExp_(key) + "\\}\\}", "g");
    result = result.replace(pattern, String(replacements[key] || ""));
  });

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function listTournamentApplicantMembers_(tournamentId) {
  const memberByName = {};
  const responses = listSheetObjectsCached_(
    "Responses",
    "sheet:Responses",
    RESPONSE_CACHE_TTL_SECONDS
  );
  const applicants = [];

  listAdminMembers().forEach(function(member) {
    memberByName[normalizeMemberName(getMemberDisplayName_(member))] = member;
  });

  responses.forEach(function(response) {
    if (
      response.tournament_id !== tournamentId ||
      response.response !== "yes"
    ) {
      return;
    }

    const normalizedName = normalizeMemberName(response.member_name);
    const member = memberByName[normalizedName];

    if (member) {
      applicants.push(member);
      return;
    }

    applicants.push({
      member_id: "ZZZ_" + normalizedName,
      last_name: normalizedName,
      first_name: "",
      grade: "",
    });
  });

  return uniqueApplicantMembers_(applicants).sort(compareApplicantMembers_);
}

function listTournamentApplicants(tournamentId) {
  const sheet = getSheetByName("Responses");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);
  const applicants = rows
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== "";
      });
    })
    .map(function(row) {
      return rowToObject(headers, row);
    })
    .filter(function(response) {
      return response.tournament_id === tournamentId &&
        response.response === "yes";
    })
    .map(function(response) {
      return normalizeMemberName(response.member_name);
    });

  return uniqueStrings(applicants);
}

function resolveManagerLineUserId(tournament) {
  if (tournament.manager_line_user_id) {
    const directId = String(tournament.manager_line_user_id).trim();
    return isValidLineUserId_(directId) ? directId : "";
  }

  const managerName = normalizeMemberName(tournament.manager_name);
  if (!managerName) {
    return "";
  }

  const managers = listManagers();

  for (let i = 0; i < managers.length; i += 1) {
    const manager = managers[i];
    const managerNames = [
      normalizeMemberName(manager.manager_name),
      normalizeMemberName(manager.display_name),
    ];

    if (
      manager.status === "active" &&
      manager.line_user_id &&
      managerNames.indexOf(managerName) !== -1
    ) {
      const managerId = String(manager.line_user_id).trim();
      return isValidLineUserId_(managerId) ? managerId : "";
    }
  }

  return "";
}

function listManagers() {
  return listSheetObjectsCached_(
    "Managers",
    "sheet:Managers",
    SHEET_CACHE_TTL_SECONDS
  );
}

function getTournamentsByIdsForReminder(tournamentIds) {
  return listTournaments().filter(function(tournament) {
    return tournamentIds.indexOf(tournament.tournament_id) !== -1 &&
      tournament.status === "active";
  });
}

function uniqueStrings(values) {
  const seen = {};
  return values.filter(function(value) {
    if (!value || seen[value]) {
      return false;
    }
    seen[value] = true;
    return true;
  });
}

function uniqueApplicantMembers_(members) {
  const seen = {};

  return (members || []).filter(function(member) {
    const key = String(member.member_id || "") + "::" + buildMemberFullName_(member);

    if (seen[key]) {
      return false;
    }

    seen[key] = true;
    return true;
  });
}

function compareApplicantMembers_(a, b) {
  const gradeDiff = getTournamentGradeSortIndex_(a.grade) - getTournamentGradeSortIndex_(b.grade);

  if (gradeDiff !== 0) {
    return gradeDiff;
  }

  return String(a.member_id || "").localeCompare(String(b.member_id || ""), "ja");
}

function getTournamentGradeSortIndex_(grade) {
  const normalized = getMemberGradeLabel_(grade);
  const index = TOURNAMENT_GRADE_DISPLAY_ORDER.indexOf(normalized);
  return index === -1 ? TOURNAMENT_GRADE_DISPLAY_ORDER.length : index;
}

function getActiveManagerLineUserIds_() {
  const invalidManagerIds = [];
  const managerIds = uniqueStrings(
    listManagers()
      .filter(function(manager) {
        return manager.status === "active" && manager.line_user_id;
      })
      .map(function(manager) {
        const managerId = String(manager.line_user_id || "").trim();

        if (!isValidLineUserId_(managerId)) {
          invalidManagerIds.push(managerId);
          return "";
        }

        return managerId;
      })
      .filter(Boolean)
  );

  return {
    invalid_manager_ids: invalidManagerIds,
    manager_ids: managerIds,
  };
}

function formatDateTimeLabel(value) {
  const date = parseDateTimeValue(value);
  return Utilities.formatDate(date, "Asia/Tokyo", "M月d日 HH:mm");
}

function parseOptionalDateTime_(value) {
  try {
    return parseDateTimeValue(value);
  } catch (error) {
    return null;
  }
}

function buildGroupedTournamentSummaryLines_(tournaments) {
  const groups = {};

  (tournaments || []).forEach(function(tournament) {
    const dateKey = normalizeDateKey(tournament.event_start_date);
    const baseTitle = buildTournamentBaseTitleForLine_(tournament);
    const typeLabel = buildTournamentTypeLabel_(tournament);
    const groupKey = [dateKey, baseTitle, typeLabel].join("::");

    if (!groups[groupKey]) {
      groups[groupKey] = {
        date_key: dateKey,
        base_title: baseTitle,
        type_label: typeLabel,
        grades: [],
      };
    }

    normalizeTournamentGradeList_(tournament.grades).forEach(function(grade) {
      if (groups[groupKey].grades.indexOf(grade) === -1) {
        groups[groupKey].grades.push(grade);
      }
    });
  });

  return Object.keys(groups).sort().map(function(groupKey) {
    const group = groups[groupKey];
    const gradeLabel = buildTournamentGradeSuffixForLine_(group.grades);

    return (
      formatDateLabel(group.date_key) + " " +
      group.base_title +
      gradeLabel +
      group.type_label
    ).trim();
  });
}

function buildTournamentBaseTitleForLine_(tournament) {
  const title = String(tournament && tournament.title ? tournament.title : "").trim();
  const gradeLabel = buildTournamentGradeCompactLabel_(
    normalizeTournamentGradeList_(tournament && tournament.grades)
  );

  if (!gradeLabel) {
    return title;
  }

  return title
    .replace(new RegExp(escapeRegExp_(gradeLabel) + "級$"), "")
    .replace(new RegExp(escapeRegExp_(gradeLabel) + "$"), "")
    .trim();
}

function buildTournamentGradeCompactLabel_(grades) {
  return (grades || []).map(function(grade) {
    return String(grade || "").replace(/級$/g, "").trim();
  }).filter(Boolean).join("");
}

function buildTournamentGradeSuffixForLine_(grades) {
  const compact = buildTournamentGradeCompactLabel_(
    (grades || []).slice().sort(function(a, b) {
      return getTournamentGradeSortIndex_(a) - getTournamentGradeSortIndex_(b);
    })
  );

  return compact ? compact + "級" : "";
}

function buildTournamentHeadlineLabel_(tournament) {
  const baseTitle = buildTournamentBaseTitleForLine_(tournament);
  const gradeLabel = buildTournamentGradeSuffixForLine_(
    normalizeTournamentGradeList_(tournament.grades)
  );

  return (baseTitle + gradeLabel).trim() || (tournament.title || "大会");
}

function buildMemberFullName_(member) {
  return normalizeMemberName(
    String(member && member.last_name ? member.last_name : "") +
    String(member && member.first_name ? member.first_name : "")
  );
}

function formatMemberGradeLabelForLine_(grade) {
  const label = getMemberGradeLabel_(grade);
  return label ? label + "級" : "-";
}

function getDriveFolderUrlForLine_() {
  try {
    return getBriefUploadFolder_().getUrl();
  } catch (error) {
    return "-";
  }
}

function getTournamentEntryUrlForLine_(tournament) {
  const fallbackUrl = String(
    tournament && tournament.entry_url ? tournament.entry_url : ""
  ).trim();
  const entryPageToken = String(
    tournament && tournament.entry_page_token ? tournament.entry_page_token : ""
  ).trim();
  const generatedUrl = buildEntryPageUrlForLine_(entryPageToken, fallbackUrl);

  return generatedUrl || fallbackUrl || "-";
}

function buildEntryPageUrlForLine_(entryPageToken, referenceUrl) {
  const normalizedToken = String(entryPageToken || "").trim();
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = String(
    properties.getProperty("WEB_BASE_URL") || inferBaseUrlFromEntryUrl_(referenceUrl)
  ).trim();

  if (!normalizedToken || !baseUrl) {
    return "";
  }

  return baseUrl.replace(/\/+$/g, "") +
    "/entry/?page_token=" + encodeURIComponent(normalizedToken);
}

function appendAdminPageLink_(lines, referenceUrl) {
  lines.push("【管理画面】");
  lines.push(getAdminPageUrl_(referenceUrl));
}

function getAdminPageUrl_(referenceUrl) {
  const properties = PropertiesService.getScriptProperties();
  const explicitUrl = String(
    properties.getProperty("ADMIN_PAGE_URL") || ""
  ).trim();

  if (explicitUrl) {
    return stripAdminTokenFromUrl_(explicitUrl);
  }

  const baseUrl = String(
    properties.getProperty("WEB_BASE_URL") || inferBaseUrlFromEntryUrl_(referenceUrl)
  ).trim();

  if (!baseUrl) {
    return "-";
  }

  return baseUrl.replace(/\/+$/g, "") + "/board-c7k2m9q4/";
}

function stripAdminTokenFromUrl_(url) {
  const normalized = String(url || "").trim();

  if (!normalized) {
    return "";
  }

  const hashIndex = normalized.indexOf("#");
  const hash = hashIndex >= 0 ? normalized.slice(hashIndex) : "";
  const baseWithQuery = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const parts = baseWithQuery.split("?");
  const base = parts[0];
  const query = parts.length > 1 ? parts.slice(1).join("?") : "";

  if (!query) {
    return normalized;
  }

  const filteredPairs = query.split("&").filter(function(pair) {
    const key = pair.split("=")[0];
    return key && decodeURIComponent(key) !== "admin_token";
  });

  return base + (filteredPairs.length ? "?" + filteredPairs.join("&") : "") + hash;
}

function inferBaseUrlFromEntryUrl_(entryUrl) {
  const normalized = String(entryUrl || "").trim();
  const match = normalized.match(/^(https:\/\/[^/]+\/[^/]+)/);
  return match ? match[1] : "";
}

function appendNotificationLog(input) {
  const sheet = getSheetByName("NotificationLogs");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const nowIso = toIsoString(new Date());
  const record = {
    log_id: generateNotificationLogId(),
    tournament_id: input.tournament_id || "",
    notification_type: input.notification_type || "",
    sent_to_type: input.sent_to_type || "",
    sent_to_id: input.sent_to_id || "",
    sent_at: nowIso,
    message: input.message || "",
  };
  const row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : "";
  });

  sheet.appendRow(row);
  invalidateSheetCaches_(["NotificationLogs"]);
}

function uploadBriefFile(fileName, mimeType, contentBase64, tournament) {
  if (!fileName) {
    throw new Error("Missing file_name");
  }

  if (!mimeType) {
    throw new Error("Missing mime_type");
  }

  if (!contentBase64) {
    throw new Error("Missing content_base64");
  }

  if (mimeType !== "application/pdf") {
    throw new Error("Only PDF upload is supported right now");
  }

  validateBriefUploadTournament_(tournament);

  const targetFileName = buildBriefFileName_(tournament, fileName, mimeType);
  const folder = getBriefUploadFolder_();
  const existingFile = findFileByNameInFolder_(folder, targetFileName);

  if (existingFile) {
    return {
      drive_url: existingFile.getUrl(),
      file_id: existingFile.getId(),
      file_name: existingFile.getName(),
      reused_existing: true,
    };
  }

  const blob = Utilities.newBlob(
    Utilities.base64Decode(contentBase64),
    mimeType,
    targetFileName
  );
  const file = folder.createFile(blob);

  return {
    drive_url: file.getUrl(),
    file_id: file.getId(),
    file_name: file.getName(),
    reused_existing: false,
  };
}

function findFileByNameInFolder_(folder, fileName) {
  if (!folder || !fileName) {
    return null;
  }

  const files = folder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : null;
}

function listNotificationLogs() {
  return listSheetObjectsCached_(
    "NotificationLogs",
    "sheet:NotificationLogs",
    SHEET_CACHE_TTL_SECONDS
  );
}

function listSheetObjectsCached_(sheetName, cacheKey, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);

  if (cached) {
    return deserializeCachedObjects_(JSON.parse(cached));
  }

  const sheet = getSheetByName(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    putCacheSafely_(cache, cacheKey, "[]", ttlSeconds);
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);
  const result = rows
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== "";
      });
    })
    .map(function(row) {
      return rowToObject(headers, row);
    });

  putCacheSafely_(cache, cacheKey, JSON.stringify(serializeCachedObjects_(result)), ttlSeconds);
  return result;
}

function invalidateSheetCaches_(sheetNames) {
  const cache = CacheService.getScriptCache();
  const keys = (sheetNames || []).map(function(sheetName) {
    return "sheet:" + sheetName;
  });

  if (keys.length) {
    cache.removeAll(keys);
  }
}

function serializeCachedObjects_(items) {
  return (items || []).map(function(item) {
    const serialized = {};

    Object.keys(item || {}).forEach(function(key) {
      serialized[key] = serializeCachedValue_(item[key]);
    });

    return serialized;
  });
}

function deserializeCachedObjects_(items) {
  return (items || []).map(function(item) {
    const deserialized = {};

    Object.keys(item || {}).forEach(function(key) {
      deserialized[key] = deserializeCachedValue_(item[key]);
    });

    return deserialized;
  });
}

function serializeCachedValue_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return {
      __type: "date",
      value: value.getTime(),
    };
  }

  return value;
}

function deserializeCachedValue_(value) {
  if (
    value &&
    typeof value === "object" &&
    value.__type === "date" &&
    value.value !== undefined
  ) {
    return new Date(Number(value.value));
  }

  return value;
}

function putCacheSafely_(cache, key, value, ttlSeconds) {
  try {
    cache.put(key, value, ttlSeconds);
  } catch (error) {
    // Ignore cache write failures so the main request still succeeds.
  }
}

function getLineGroupId() {
  const groupId =
    PropertiesService.getScriptProperties().getProperty("LINE_GROUP_ID");

  if (!groupId) {
    throw new Error("LINE_GROUP_ID is not set");
  }

  return groupId;
}

function getLineTestGroupId_() {
  const groupId =
    PropertiesService.getScriptProperties().getProperty("LINE_TEST_GROUP_ID");

  if (!groupId) {
    throw new Error("LINE_TEST_GROUP_ID is not set");
  }

  return groupId;
}

function validateAdminToken(adminToken) {
  const expected =
    PropertiesService.getScriptProperties().getProperty("ADMIN_CONSOLE_TOKEN");

  if (!expected) {
    throw new Error("ADMIN_CONSOLE_TOKEN is not set");
  }

  if (adminToken !== expected) {
    throw new Error("Invalid admin_token");
  }
}

function getLineChannelAccessToken() {
  const token =
    PropertiesService.getScriptProperties().getProperty(
      "LINE_CHANNEL_ACCESS_TOKEN"
    );

  if (!token) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  }

  return token;
}

function isValidLineUserId_(value) {
  return /^U[0-9a-f]{32}$/i.test(String(value || "").trim());
}

function getLineUserProfile(userId) {
  const response = UrlFetchApp.fetch(
    "https://api.line.me/v2/bot/profile/" + encodeURIComponent(userId),
    {
      method: "get",
      headers: {
        Authorization: "Bearer " + getLineChannelAccessToken(),
      },
      muteHttpExceptions: true,
    }
  );
  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("Failed to fetch LINE profile: " + body);
  }

  return JSON.parse(body);
}

function replyLineMessage(replyToken, messages) {
  if (!replyToken) {
    return;
  }

  callLineMessagingApi("https://api.line.me/v2/bot/message/reply", {
    replyToken: replyToken,
    messages: messages,
  });
}

function pushLineMessage(to, messages) {
  callLineMessagingApi("https://api.line.me/v2/bot/message/push", {
    to: to,
    messages: messages,
  });
}

function callLineMessagingApi(url, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    headers: {
      Authorization: "Bearer " + getLineChannelAccessToken(),
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("LINE API request failed: " + body);
  }
}

function buildMemberRecord(headers, existing, member, memberId, now) {
  const record = {};
  const nowIso = toIsoString(now);

  headers.forEach(function(header) {
    if (existing[header] !== undefined) {
      record[header] = existing[header];
    }
  });

  Object.keys(member).forEach(function(key) {
    record[key] = member[key];
  });

  record.member_id = memberId;
  record.last_name = normalizeMemberName(record.last_name);
  record.last_name_kana = normalizeKanaText_(record.last_name_kana);
  record.first_name = normalizeMemberName(record.first_name);
  record.first_name_kana = normalizeKanaText_(record.first_name_kana);
  record.rank = String(record.rank || "").trim();
  record.grade = String(record.grade || "").trim();
  record.display_name = buildMemberDisplayName_(record);
  record.display_name_kana = buildMemberDisplayNameKana_(record);
  record.normalized_name = buildNormalizedMemberName_(record);
  record.normalized_kana = buildNormalizedMemberKana_(record);
  record.updated_at = nowIso;

  if (!existing.created_at) {
    record.created_at = nowIso;
  }

  if (!record.status) {
    record.status = "active";
  }

  return record;
}

function validateTournament(tournament) {
  const requiredFields = [
    "title",
    "event_start_date",
    "event_end_date",
    "true_deadline",
    "internal_deadline",
    "manager_name",
    "tournament_type",
    "status",
  ];

  requiredFields.forEach(function(field) {
    if (!tournament[field]) {
      throw new Error("Missing required field: " + field);
    }
  });

  validateSingleTournamentGrade_(tournament.grades);
  validateTournamentType_(tournament.tournament_type);
}

function validateMember(member) {
  if (!normalizeMemberName(member.last_name)) {
    throw new Error("Missing last_name");
  }

  if (!normalizeKanaText_(member.last_name_kana)) {
    throw new Error("Missing last_name_kana");
  }

  if (!normalizeMemberName(member.first_name)) {
    throw new Error("Missing first_name");
  }

  if (!normalizeKanaText_(member.first_name_kana)) {
    throw new Error("Missing first_name_kana");
  }

  if (!String(member.rank || "").trim()) {
    throw new Error("Missing rank");
  }

  if (!String(member.grade || "").trim()) {
    throw new Error("Missing grade");
  }
}

function ensureMemberRegistrationNotDuplicated_(member) {
  const requestedName = buildNormalizedMemberName_(member);
  const requestedKana = buildNormalizedMemberKana_(member);
  const members = listAdminMembers();

  for (let i = 0; i < members.length; i += 1) {
    const existing = members[i];
    const existingName = String(
      existing.normalized_name || buildNormalizedMemberName_(existing)
    ).trim();
    const existingKana = String(
      existing.normalized_kana || buildNormalizedMemberKana_(existing)
    ).trim();

    const isNameMatched = requestedName && existingName === requestedName;
    const isKanaMatched = requestedKana && existingKana === requestedKana;

    if (!isNameMatched && !isKanaMatched) {
      continue;
    }

    if (String(existing.status || "").trim() === "pending") {
      throw new Error("このメンバーはすでに登録申請中です。");
    }

    throw new Error("同じメンバーがすでに登録されています。");
  }
}

function ensureRequiredMemberHeaders_(headers) {
  const requiredHeaders = [
    "last_name",
    "last_name_kana",
    "first_name",
    "first_name_kana",
    "rank",
    "grade",
    "display_name",
    "display_name_kana",
    "normalized_name",
    "normalized_kana",
  ];

  const missing = requiredHeaders.filter(function(header) {
    return (headers || []).indexOf(header) === -1;
  });

  if (missing.length) {
    throw new Error("Membersシートに列を追加してください: " + missing.join(", "));
  }
}

function getMemberDisplayName_(member) {
  return normalizeMemberName(member.display_name) || buildMemberDisplayName_(member);
}

function buildMemberDisplayName_(member) {
  const fullName = normalizeMemberName(
    String(member.last_name || "") + String(member.first_name || "")
  );
  const grade = getMemberGradeLabel_(member.grade);

  if (!fullName) {
    return "";
  }

  return grade ? fullName + " (" + grade + ")" : fullName;
}

function buildMemberDisplayNameKana_(member) {
  const lastNameKana = normalizeKanaText_(member.last_name_kana);
  const firstNameKana = normalizeKanaText_(member.first_name_kana);
  return [lastNameKana, firstNameKana].filter(Boolean).join(" ");
}

function buildNormalizedMemberName_(member) {
  return normalizeMemberName(
    String(member.last_name || "") + String(member.first_name || "")
  ).replace(/\s+/g, "");
}

function buildNormalizedMemberKana_(member) {
  return normalizeKanaText_(
    String(member.last_name_kana || "") + String(member.first_name_kana || "")
  ).replace(/\s+/g, "");
}

function getMemberGradeLabel_(grade) {
  const normalized = String(grade || "").trim();

  if (normalized === "beginner" || normalized === "初心者") {
    return "初心者";
  }

  return normalized;
}

function formatMemberRankLabel_(rank) {
  const rankValue = rank === undefined || rank === null ? "" : String(rank).trim();
  const labels = {
    "0": "無段",
    "1": "初段",
    "2": "二段",
    "3": "三段",
    "4": "四段",
    "5": "五段",
    "6": "六段",
    "7": "七段",
    "8": "八段",
    "9": "九段",
    "10": "十段",
  };

  return labels[rankValue] || rankValue || "-";
}

function normalizeKanaText_(value) {
  return String(value || "")
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[ァ-ヶ]/g, function(match) {
      return String.fromCharCode(match.charCodeAt(0) - 0x60);
    });
}

function validateBriefUploadTournament_(tournament) {
  if (!tournament || !String(tournament.title || "").trim()) {
    throw new Error("Tournament title is required before upload");
  }

  if (!normalizeTournamentGradeList_(tournament.grades).length) {
    throw new Error("Tournament grades are required before upload");
  }

  validateTournamentBatchGradeConfigs_(tournament);
}

function validateTournamentBatchRequest_(commonTournament, gradeConfigs) {
  const requiredFields = [
    "title",
    "manager_name",
    "tournament_type",
    "status",
  ];

  requiredFields.forEach(function(field) {
    if (!commonTournament[field]) {
      throw new Error("Missing required field: " + field);
    }
  });

  validateTournamentType_(commonTournament.tournament_type);

  if (!Array.isArray(gradeConfigs) || gradeConfigs.length === 0) {
    throw new Error("grade_configs must be a non-empty array");
  }

  const seenGrades = {};

  gradeConfigs.forEach(function(gradeConfig) {
    const grade = String(gradeConfig.grade || "").trim();

    if (!grade) {
      throw new Error("Each grade_config requires grade");
    }

    if (seenGrades[grade]) {
      throw new Error("Duplicate grade in grade_configs: " + grade);
    }
    seenGrades[grade] = true;

    if (!String(gradeConfig.event_start_date || "").trim()) {
      throw new Error("Each grade_config requires event_start_date");
    }

    if (!String(gradeConfig.true_deadline || "").trim()) {
      throw new Error("Each grade_config requires true_deadline");
    }

    if (!String(gradeConfig.internal_deadline || "").trim()) {
      throw new Error("Each grade_config requires internal_deadline");
    }
  });
}

function ensureRequiredTournamentHeaders_(headers) {
  const requiredHeaders = [
    "tournament_type",
    "applied_at",
  ];
  const missing = requiredHeaders.filter(function(header) {
    return (headers || []).indexOf(header) === -1;
  });

  if (missing.length) {
    throw new Error(
      "Tournamentsシートに列を追加してください: " + missing.join(", ")
    );
  }
}

function validateTournamentBatchGradeConfigs_(tournament) {
  const gradeConfigs = Array.isArray(tournament.grade_configs) ?
    tournament.grade_configs :
    [];

  if (!gradeConfigs.length) {
    if (!String(tournament.event_start_date || "").trim()) {
      throw new Error("Tournament event_start_date is required before upload");
    }
    return;
  }

  gradeConfigs.forEach(function(gradeConfig) {
    if (!String(gradeConfig.event_start_date || "").trim()) {
      throw new Error("Each grade_config requires event_start_date before upload");
    }
  });
}

function buildTournamentFromGradeConfig_(commonTournament, gradeConfig) {
  const tournament = cloneObject(commonTournament);

  tournament.tournament_id = gradeConfig.tournament_id || "";
  tournament.event_start_date = gradeConfig.event_start_date;
  tournament.event_end_date = gradeConfig.event_start_date;
  tournament.grades = String(gradeConfig.grade || "").trim();
  tournament.true_deadline = gradeConfig.true_deadline;
  tournament.internal_deadline = gradeConfig.internal_deadline;

  return tournament;
}

function assignTournamentIdsToGradeConfigs_(commonTournament, gradeConfigs) {
  const items = (gradeConfigs || []).map(function(gradeConfig) {
    return cloneObject(gradeConfig);
  });
  const needsGeneratedId = items.some(function(gradeConfig) {
    return !String(gradeConfig.tournament_id || "").trim();
  });

  if (!needsGeneratedId) {
    return items;
  }

  const parentTournamentId = buildBatchTournamentParentId_(
    commonTournament,
    items
  );

  return items.map(function(gradeConfig) {
    if (String(gradeConfig.tournament_id || "").trim()) {
      return gradeConfig;
    }

    gradeConfig.tournament_id = parentTournamentId + "_" +
      buildTournamentGradeIdSuffix_(gradeConfig.grade);
    return gradeConfig;
  });
}

function buildBatchTournamentParentId_(commonTournament, gradeConfigs) {
  const explicitId = String(commonTournament.tournament_id || "").trim();

  if (explicitId) {
    return stripTournamentGradeSuffix_(explicitId);
  }

  const firstGradeConfig = (gradeConfigs || [])[0] || {};
  return generateTournamentId(
    firstGradeConfig.event_start_date || commonTournament.event_start_date
  );
}

function buildTournamentGradeIdSuffix_(grade) {
  const normalized = String(grade || "").trim().toUpperCase();

  if (!normalized || normalized === "BEGINNER" || normalized === "初心者") {
    return "BEGINNER";
  }

  return normalized.replace(/[^A-Z0-9]+/g, "_");
}

function stripTournamentGradeSuffix_(tournamentId) {
  const normalized = String(tournamentId || "").trim();
  const match = normalized.match(/^(T\d{4}-\d{2}-\d{2}_[A-Z0-9]+)_[A-Z0-9_]+$/);

  return match ? match[1] : normalized;
}

function validateSingleTournamentGrade_(grades) {
  const normalized = String(grades || "")
    .replace(/、/g, ",")
    .split(",")
    .map(function(value) {
      return String(value || "").trim();
    })
    .filter(Boolean);

  if (normalized.length !== 1) {
    throw new Error(
      "1回の大会登録では1級だけ指定してください。級ごとに日程や締切が異なる場合は、同じ要項URLを使って別登録してください。"
    );
  }
}

function validateTournamentType_(tournamentType) {
  if (!normalizeTournamentType_(tournamentType)) {
    throw new Error(
      "tournament_type must be one of official, support, or event"
    );
  }
}

function validateTournamentStatusForUpdate_(status) {
  const normalized = String(status || "").trim();
  const allowed = {
    active: true,
    applied: true,
    no_applicants: true,
    closed: true,
    canceled: true,
    draft: true,
    deleted: true,
  };

  if (!allowed[normalized]) {
    throw new Error("Invalid tournament status");
  }
}

function normalizeTournamentType_(tournamentType) {
  const normalized = String(tournamentType || "").trim();

  if (
    normalized === "official" ||
    normalized === "support" ||
    normalized === "event"
  ) {
    return normalized;
  }

  return "";
}

function buildTournamentTypeLabel_(tournament) {
  const tournamentType = normalizeTournamentType_(tournament.tournament_type);

  if (tournamentType === "official") {
    return "（公認）";
  }

  if (tournamentType === "support") {
    return "（後援）";
  }

  if (tournamentType === "event") {
    return "（イベント）";
  }

  if (
    tournament.is_official === true ||
    tournament.is_official === "TRUE" ||
    tournament.is_official === "true"
  ) {
    return "（公認）";
  }

  return "";
}

function validateResponseRequest(pageToken, memberName, responses) {
  if (!pageToken) {
    throw new Error("Missing page_token");
  }

  if (!normalizeMemberName(memberName)) {
    throw new Error("Missing member_name");
  }

  if (!Array.isArray(responses) || responses.length === 0) {
    throw new Error("Responses must be a non-empty array");
  }
}

function validateSingleResponse(responseInput, allowedTournamentIds) {
  const allowedResponses = {
    yes: true,
    maybe: true,
    no: true,
  };

  if (!responseInput.tournament_id) {
    throw new Error("Missing tournament_id");
  }

  if (!allowedTournamentIds[responseInput.tournament_id]) {
    throw new Error("Tournament is not available for this page_token");
  }

  if (!allowedResponses[responseInput.response]) {
    throw new Error("Invalid response value");
  }
}

function findResponseRowIndex(values, headers, tournamentId, memberName) {
  const tournamentIdIndex = headers.indexOf("tournament_id");
  const memberNameIndex = headers.indexOf("member_name");
  const normalizedMemberName = normalizeMemberName(memberName);

  for (let i = 1; i < values.length; i += 1) {
    if (
      values[i][tournamentIdIndex] === tournamentId &&
      normalizeMemberName(values[i][memberNameIndex]) === normalizedMemberName
    ) {
      return i + 1;
    }
  }

  return -1;
}

function buildResponseRecord(headers, existing, responseInput, memberName, now) {
  const record = {};
  const nowIso = toIsoString(now);
  const normalizedMemberName = normalizeMemberName(memberName);

  headers.forEach(function(header) {
    if (existing[header] !== undefined) {
      record[header] = existing[header];
    }
  });

  record.response_id = existing.response_id || generateResponseId(now);
  record.tournament_id = responseInput.tournament_id;
  record.member_name = normalizedMemberName;
  record.response = responseInput.response;
  record.comment = responseInput.comment || "";
  record.updated_at = nowIso;

  if (!existing.created_at) {
    record.created_at = nowIso;
  }

  return record;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach(function(header, index) {
    obj[header] = row[index];
  });
  return obj;
}

function cloneObject(source) {
  const clone = {};
  Object.keys(source || {}).forEach(function(key) {
    clone[key] = source[key];
  });
  return clone;
}

function generateTournamentId(eventStartDate) {
  const ymd = normalizeDateKey(eventStartDate);
  return "T" + ymd + "_" + randomString(6);
}

function generateResponseId(now) {
  return "R" + Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMddHHmmss") +
    "_" + randomString(6);
}

function generateMemberId(rowCount) {
  const next = Math.max(1, rowCount);
  return "M" + String(next).padStart(3, "0");
}

function generateNotificationLogId() {
  return "N" + Utilities.formatDate(
    new Date(),
    "Asia/Tokyo",
    "yyyyMMddHHmmss"
  ) + "_" + randomString(6);
}

function randomString(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

function buildEventDateLabel(startDate, endDate) {
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);

  if (!start) {
    return "";
  }

  if (!end || start === end) {
    return formatDateLabel(start);
  }

  const startParts = start.split("-");
  const endParts = end.split("-");
  return Number(startParts[1]) + "月" + Number(startParts[2]) + "日 - " +
    Number(endParts[1]) + "月" + Number(endParts[2]) + "日";
}

function formatDateLabel(dateString) {
  const parts = String(dateString).split("-");
  if (parts.length !== 3 && /^\d{8}$/.test(String(dateString))) {
    return Number(String(dateString).slice(4, 6)) + "月" +
      Number(String(dateString).slice(6, 8)) + "日";
  }

  if (parts.length !== 3) {
    return String(dateString);
  }

  return Number(parts[1]) + "月" + Number(parts[2]) + "日";
}

function normalizeDateKey(value) {
  if (!value) {
    return "";
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd");
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(text)) {
    return text.slice(0, 10);
  }

  if (/^\d{8}$/.test(text)) {
    return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
  }

  return text;
}

function parseDateOnly(value) {
  const normalized = normalizeDateKey(value);
  const parts = normalized.split("-");

  if (parts.length !== 3) {
    throw new Error("Invalid date value: " + value);
  }

  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );
}

function parseDateTimeValue(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return new Date(value.getTime());
  }

  const text = String(value || "").trim();
  if (!text) {
    throw new Error("Invalid datetime value");
  }

  const date = new Date(text);
  if (isNaN(date.getTime())) {
    throw new Error("Invalid datetime value: " + value);
  }

  return date;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function normalizeMemberName(value) {
  return String(value || "")
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ");
}

function toIsoString(date) {
  return Utilities.formatDate(date, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function getBriefUploadFolder_() {
  const folderId =
    PropertiesService.getScriptProperties().getProperty("DRIVE_FOLDER_ID");

  if (!folderId) {
    throw new Error("DRIVE_FOLDER_ID is not set");
  }

  return DriveApp.getFolderById(folderId);
}

function buildBriefFileName_(tournament, originalFileName, mimeType) {
  const eventMonth = buildBriefMonthLabel_(tournament);
  const gradeLabel = buildBriefGradeLabel_(tournament.grades);
  const normalizedTitle = buildBriefTitleLabel_(tournament.title, gradeLabel);
  const extension = detectFileExtension_(originalFileName, mimeType);

  return eventMonth + normalizedTitle + gradeLabel + extension;
}

function buildBriefMonthLabel_(tournament) {
  const months = getBriefEventMonths_(tournament);

  if (!months.length) {
    throw new Error("Invalid event_start_date for file naming");
  }

  return months.map(function(month) {
    return month + "月";
  }).join("");
}

function getBriefEventMonths_(tournament) {
  const gradeConfigs = Array.isArray(tournament.grade_configs) ?
    tournament.grade_configs :
    [];
  const seen = {};
  const months = [];
  const values = gradeConfigs.length ?
    gradeConfigs.map(function(gradeConfig) {
      return gradeConfig.event_start_date;
    }) :
    [tournament.event_start_date];

  values.forEach(function(eventStartDate) {
    const normalized = normalizeDateKey(eventStartDate);
    const parts = normalized.split("-");

    if (parts.length !== 3) {
      return;
    }

    const month = String(Number(parts[1]));
    if (!seen[month]) {
      seen[month] = true;
      months.push(month);
    }
  });

  return months.sort(function(a, b) {
    return Number(a) - Number(b);
  });
}

function buildBriefGradeLabel_(grades) {
  return normalizeTournamentGradeList_(grades)
    .map(function(value) {
      return value.replace(/級$/g, "");
    })
    .join("");
}

function normalizeTournamentGradeList_(grades) {
  return String(grades || "")
    .replace(/、/g, ",")
    .split(",")
    .map(function(value) {
      return String(value || "")
        .trim()
        .replace(/\s+/g, "");
    })
    .filter(Boolean);
}

function buildBriefTitleLabel_(title, gradeLabel) {
  let normalized = String(title || "")
    .trim()
    .replace(/\s+/g, "");

  if (!normalized) {
    throw new Error("Invalid tournament title for file naming");
  }

  if (!gradeLabel) {
    return normalized;
  }

  const escapedGrade = escapeRegExp_(gradeLabel);
  normalized = normalized
    .replace(new RegExp(escapedGrade + "級$"), "")
    .replace(new RegExp(escapedGrade + "$"), "");

  return normalized;
}

function detectFileExtension_(fileName, mimeType) {
  const lowerName = String(fileName || "").toLowerCase();

  if (lowerName.endsWith(".pdf") || mimeType === "application/pdf") {
    return ".pdf";
  }

  return "";
}

function escapeRegExp_(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncAllTournamentCalendars() {
  const sheet = getSheetByName("Tournaments");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];
  const results = [];

  for (let i = 1; i < values.length; i += 1) {
    if (!values[i].some(function(cell) { return cell !== ""; })) {
      continue;
    }

    results.push(syncTournamentCalendarForRow(
      sheet,
      headers,
      i + 1,
      rowToObject(headers, values[i])
    ));
  }

  Logger.log(results);
  return results;
}

function installScheduledTriggersFromAdmin_() {
  return {
    daily_announcement: installDailyAnnouncementTrigger(),
    pending_member_registration_summary:
      installPendingMemberRegistrationSummaryTrigger(),
    applied_notification: installAppliedNotificationTrigger(),
    tournament_reminder: installTournamentReminderTrigger(),
  };
}

function installDailyAnnouncementTrigger() {
  deleteTriggersByHandler_("sendScheduledDailyAnnouncements");

  const trigger = ScriptApp.newTrigger("sendScheduledDailyAnnouncements")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(17)
    .nearMinute(0)
    .create();

  Logger.log(trigger.getUniqueId());
  return trigger.getUniqueId();
}

function installPendingMemberRegistrationSummaryTrigger() {
  deleteTriggersByHandler_("sendPendingMemberRegistrationSummary");
  const time = getTimeSettingParts_("PENDING_MEMBER_SUMMARY_TIME", "07:00");

  const trigger = ScriptApp.newTrigger("sendPendingMemberRegistrationSummary")
    .timeBased()
    .everyDays(1)
    .atHour(time.hour)
    .nearMinute(time.minute)
    .create();

  Logger.log(trigger.getUniqueId());
  return trigger.getUniqueId();
}

function installAppliedNotificationTrigger() {
  deleteTriggersByHandler_("sendScheduledAppliedNotifications");
  deleteTriggersByHandler_("runNightlyTournamentAutomation");
  const time = getTimeSettingParts_("NIGHTLY_AUTOMATION_TIME", "00:00");

  const trigger = ScriptApp.newTrigger("runNightlyTournamentAutomation")
    .timeBased()
    .everyDays(1)
    .atHour(time.hour)
    .nearMinute(time.minute)
    .create();

  Logger.log(trigger.getUniqueId());
  return trigger.getUniqueId();
}

function installTournamentReminderTrigger() {
  deleteTriggersByHandler_("sendScheduledTournamentReminders");
  const time = getTimeSettingParts_("TOURNAMENT_REMINDER_TIME", "10:00");

  const trigger = ScriptApp.newTrigger("sendScheduledTournamentReminders")
    .timeBased()
    .everyDays(1)
    .atHour(time.hour)
    .nearMinute(time.minute)
    .create();

  Logger.log(trigger.getUniqueId());
  return trigger.getUniqueId();
}

function deleteDailyAnnouncementTrigger() {
  deleteTriggersByHandler_("sendScheduledDailyAnnouncements");
}

function deletePendingMemberRegistrationSummaryTrigger() {
  deleteTriggersByHandler_("sendPendingMemberRegistrationSummary");
}

function deleteAppliedNotificationTrigger() {
  deleteTriggersByHandler_("sendScheduledAppliedNotifications");
  deleteTriggersByHandler_("runNightlyTournamentAutomation");
}

function deleteTournamentReminderTrigger() {
  deleteTriggersByHandler_("sendScheduledTournamentReminders");
}

function deleteTriggersByHandler_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
