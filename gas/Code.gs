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
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action || "";

    if (action === "upsert_tournament") {
      const result = upsertTournament(body.tournament || {});
      return jsonOutput({
        ok: true,
        tournament_id: result.tournament_id,
        mode: result.mode,
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
    })
    .filter(function(member) {
      return member.status === "active";
    })
    .map(function(member) {
      return {
        member_id: member.member_id,
        display_name: member.display_name,
        grade: member.grade || "",
      };
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
  }

  return {
    tournament_id: tournamentId,
    mode: mode,
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

function generateTournamentId(eventStartDate) {
  const ymd = normalizeDateKey(eventStartDate);
  return "T" + ymd + "_" + randomString(6);
}

function generateResponseId(now) {
  return "R" + Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMddHHmmss") +
    "_" + randomString(6);
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
