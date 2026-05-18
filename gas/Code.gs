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
        tournaments: listPublicTournaments(pageToken),
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

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach(function(header, index) {
    obj[header] = row[index];
  });
  return obj;
}

function generateTournamentId(eventStartDate) {
  const ymd = String(eventStartDate).replace(/-/g, "");
  return "T" + ymd + "_" + randomString(6);
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
  const start = String(startDate);
  const end = String(endDate);

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
  if (parts.length !== 3) {
    return String(dateString);
  }

  return Number(parts[1]) + "月" + Number(parts[2]) + "日";
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
