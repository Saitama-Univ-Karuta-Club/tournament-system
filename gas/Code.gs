function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : "";

  try {
    if (action === "list_tournaments") {
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
        members: listMembers(),
        tournaments: listPublicTournaments(pageToken),
      });
    }

    if (action === "list_members") {
      return jsonOutput({
        ok: true,
        members: listMembers(),
      });
    }

    if (action === "list_admin_members") {
      return jsonOutput({
        ok: true,
        members: listAdminMembers(),
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
      const result = upsertTournament(body.tournament || {});
      return jsonOutput({
        ok: true,
        tournament_id: result.tournament_id,
        mode: result.mode,
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
      const result = upsertMember(body.member || {});
      return jsonOutput({
        ok: true,
        member_id: result.member_id,
        mode: result.mode,
      });
    }

    if (action === "send_announcement") {
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

function getSpreadsheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!sheetId) {
    throw new Error("SHEET_ID is not set");
  }
  return SpreadsheetApp.openById(sheetId);
}

function getSheetByName(name) {
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error("Sheet not found: " + name);
  }
  return sheet;
}

function listTournaments() {
  const sheet = getSheetByName("Tournaments");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);

  return rows
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== "";
      });
    })
    .map(function(row) {
      return rowToObject(headers, row);
    });
}

function listPublicTournaments(pageToken) {
  if (!pageToken) {
    throw new Error("Missing page_token");
  }

  const sheet = getSheetByName("Tournaments");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);

  return rows
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== "";
      });
    })
    .map(function(row) {
      return rowToObject(headers, row);
    })
    .filter(function(tournament) {
      return tournament.status === "active" &&
        tournament.entry_page_token === pageToken;
    })
    .map(function(tournament) {
      return {
        tournament_id: tournament.tournament_id,
        title: tournament.title,
        event_date_label: buildEventDateLabel(
          tournament.event_start_date,
          tournament.event_end_date
        ),
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
      display_name: member.display_name,
      grade: member.grade || "",
    };
  });
}

function listAdminMembers() {
  const sheet = getSheetByName("Members");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);

  return rows
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== "";
      });
    })
    .map(function(row) {
      return rowToObject(headers, row);
    });
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
  const sheet = getSheetByName("Responses");
  const values = sheet.getDataRange().getValues();
  const normalizedMemberName = normalizeMemberName(memberName);

  publicTournaments.forEach(function(tournament) {
    allowedTournamentIds[tournament.tournament_id] = true;
  });

  if (values.length <= 1) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);

  return rows
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== "";
      });
    })
    .map(function(row) {
      return rowToObject(headers, row);
    })
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

function getEntryPage(pageToken) {
  if (!pageToken) {
    throw new Error("Missing page_token");
  }

  const sheet = getSheetByName("EntryPages");
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    throw new Error("Entry page not found");
  }

  const headers = values[0];
  const rows = values.slice(1);

  for (let i = 0; i < rows.length; i += 1) {
    if (!rows[i].some(function(cell) { return cell !== ""; })) {
      continue;
    }

    const page = rowToObject(headers, rows[i]);
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

  return {
    tournament_id: tournamentId,
    mode: mode,
    calendar_sync: calendarSync,
  };
}

function upsertResponses(pageToken, memberName, responses) {
  validateResponseRequest(pageToken, memberName, responses);
  getEntryPage(pageToken);

  const tournaments = listPublicTournaments(pageToken);
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

  return {
    updated_count: updatedCount,
  };
}

function upsertMember(member) {
  validateMember(member);

  const sheet = getSheetByName("Members");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
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

  return {
    member_id: memberId,
    mode: mode,
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
  record.updated_at = nowIso;

  if (!existing.created_at) {
    record.created_at = nowIso;
  }

  if (!record.status) {
    record.status = "draft";
  }

  return record;
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
    "参加意思確認URL: " + (tournament.entry_url || "-"),
  ];

  return lines.join("\n");
}

function buildInternalDeadlineDescription(tournament) {
  return [
    "この日までに参加意思確認ページへ回答。",
    "参加意思確認URL: " + (tournament.entry_url || "-"),
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
}

function sendAnnouncement(adminToken, tournamentIds) {
  validateAdminToken(adminToken);

  if (!Array.isArray(tournamentIds) || tournamentIds.length === 0) {
    throw new Error("tournament_ids must be a non-empty array");
  }

  const groupId = getLineGroupId();
  const tournaments = listTournaments().filter(function(tournament) {
    return tournamentIds.indexOf(tournament.tournament_id) !== -1;
  });

  if (!tournaments.length) {
    throw new Error("No tournaments found for announcement");
  }

  const message = buildAnnouncementMessage(tournaments);
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

  return {
    sent: true,
    group_id: groupId,
    tournament_ids: tournaments.map(function(tournament) {
      return tournament.tournament_id;
    }),
  };
}

function buildAnnouncementMessage(tournaments) {
  const first = tournaments[0];
  const lines = [
    "【大会情報更新】",
    "大会情報を更新しました。",
    "案内は下記Google Driveから閲覧可能です。",
    "",
    "【更新内容】",
  ];

  tournaments.forEach(function(tournament) {
    const officialLabel =
      tournament.is_official === true ||
      tournament.is_official === "TRUE" ||
      tournament.is_official === "true" ?
        "（公認）" :
        "";
    lines.push(
      buildEventDateLabel(
        tournament.event_start_date,
        tournament.event_end_date
      ) + " " + tournament.title + officialLabel
    );
  });

  lines.push("");
  lines.push("【Google Drive】");
  lines.push(first.drive_url || "-");
  lines.push("");
  lines.push("【大会申し込み方法】");
  lines.push("参加希望者は、下記URLから出たい大会の日程に○をつけてください。");
  lines.push("各日程にサークル内締切を併記しています。");
  lines.push("締切までの回答にご協力お願いします。");
  lines.push("");
  lines.push(first.entry_url || "-");

  return lines.join("\n");
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
}

function getLineGroupId() {
  const groupId =
    PropertiesService.getScriptProperties().getProperty("LINE_GROUP_ID");

  if (!groupId) {
    throw new Error("LINE_GROUP_ID is not set");
  }

  return groupId;
}

function validateAdminToken(adminToken) {
  const expected =
    PropertiesService.getScriptProperties().getProperty("LINE_ADMIN_TOKEN");

  if (expected && adminToken !== expected) {
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
  record.display_name = normalizeMemberName(member.display_name);
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
    "status",
  ];

  requiredFields.forEach(function(field) {
    if (!tournament[field]) {
      throw new Error("Missing required field: " + field);
    }
  });
}

function validateMember(member) {
  if (!normalizeMemberName(member.display_name)) {
    throw new Error("Missing display_name");
  }
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

function testUpsertTournament() {
  const result = upsertTournament({
    title: "テスト大会D級",
    event_start_date: "2026-06-27",
    event_end_date: "2026-06-27",
    grades: "D",
    is_official: true,
    venue: "テスト会場",
    true_deadline: "2026-06-23T23:59:00+09:00",
    internal_deadline: "2026-06-20T23:59:00+09:00",
    drive_url: "https://drive.google.com/",
    entry_page_token: "test-page-token",
    entry_url: "https://example.com/entry/?page_token=test-page-token",
    manager_name: "your-name",
    manager_line_user_id: "dummy",
    status: "draft",
  });

  Logger.log(result);
}

function testUpsertResponses() {
  const result = upsertResponses("test-page-token", "テスト太郎", [
    {
      tournament_id: "T20260627_KA59R2",
      response: "yes",
      comment: "参加希望です",
    },
  ]);

  Logger.log(result);
}

function seedAdditionalTestTournaments() {
  const tournaments = [
    {
      title: "テスト大会C級",
      event_start_date: "2026-07-04",
      event_end_date: "2026-07-04",
      grades: "C",
      is_official: true,
      venue: "テスト会場C",
      true_deadline: "2026-06-30T23:59:00+09:00",
      internal_deadline: "2026-06-27T23:59:00+09:00",
      drive_url: "https://drive.google.com/",
      entry_page_token: "test-page-token",
      entry_url: "https://example.com/entry/?page_token=test-page-token",
      manager_name: "your-name",
      manager_line_user_id: "dummy",
      status: "active",
    },
    {
      title: "テスト大会級制限なし",
      event_start_date: "2026-07-12",
      event_end_date: "2026-07-12",
      grades: "",
      is_official: false,
      venue: "テスト会場フリー",
      true_deadline: "2026-07-08T23:59:00+09:00",
      internal_deadline: "2026-07-05T23:59:00+09:00",
      drive_url: "https://drive.google.com/",
      entry_page_token: "test-page-token",
      entry_url: "https://example.com/entry/?page_token=test-page-token",
      manager_name: "your-name",
      manager_line_user_id: "dummy",
      status: "active",
    },
  ];

  const results = tournaments.map(function(tournament) {
    return upsertTournament(tournament);
  });

  Logger.log(results);
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

function testSendAnnouncement() {
  const tournaments = listTournaments();
  if (!tournaments.length) {
    throw new Error("No tournaments available");
  }

  const result = sendAnnouncement("", [tournaments[0].tournament_id]);
  Logger.log(result);
}
