const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzlYunO5FHWb75UXJCU8opm9nassYo74nQdlSKg-XXTntea6hEzq87konXxHEfzWsvf/exec";

const TOURNAMENT_GRADE_OPTIONS = ["A", "B", "C", "D", "E", "F", "初心者"];

const state = {
  tournaments: [],
  members: [],
  managers: [],
  selectedTournamentId: "",
  selectedMemberId: "",
  primaryTab: "tournaments",
  tournamentMode: "tournament-create",
  memberMode: "member-create",
  isBusy: false,
};

const elements = {
  primaryTabs: document.querySelectorAll(".primary-tab"),
  panels: document.querySelectorAll("[data-panel]"),
  secondaryTabs: document.querySelectorAll(".secondary-tab"),
  subpanels: document.querySelectorAll("[data-subpanel]"),
  tournamentList: document.getElementById("tournament-list"),
  memberList: document.getElementById("member-list"),
  tournamentCreateHost: document.getElementById("tournament-create-host"),
  tournamentDetailHost: document.getElementById("tournament-detail-host"),
  tournamentDetailNote: document.getElementById("tournament-detail-note"),
  memberCreateHost: document.getElementById("member-create-host"),
  memberDetailHost: document.getElementById("member-detail-host"),
  memberDetailNote: document.getElementById("member-detail-note"),
  statusMessage: document.getElementById("status-message"),
  busyOverlay: document.getElementById("busy-overlay"),
  busyMessage: document.getElementById("busy-message"),
  tournamentForm: document.getElementById("tournament-form"),
  memberForm: document.getElementById("member-form"),
  resetTournamentButton: document.getElementById("reset-tournament-button"),
  sendAnnouncementButton: document.getElementById("send-announcement-button"),
  resetMemberButton: document.getElementById("reset-member-button"),
  tournamentId: document.getElementById("tournament-id"),
  tournamentTitle: document.getElementById("tournament-title"),
  eventStartDate: document.getElementById("event-start-date"),
  eventEndDate: document.getElementById("event-end-date"),
  grades: document.getElementById("grades"),
  gradesSelector: document.getElementById("grades-selector"),
  trueDeadline: document.getElementById("true-deadline"),
  internalDeadline: document.getElementById("internal-deadline"),
  venue: document.getElementById("venue"),
  driveUrl: document.getElementById("drive-url"),
  entryPageToken: document.getElementById("entry-page-token"),
  entryUrl: document.getElementById("entry-url"),
  managerName: document.getElementById("manager-name"),
  managerLineUserId: document.getElementById("manager-line-user-id"),
  tournamentStatus: document.getElementById("tournament-status"),
  isOfficial: document.getElementById("is-official"),
  memberId: document.getElementById("member-id"),
  memberDisplayName: document.getElementById("member-display-name"),
  memberGrade: document.getElementById("member-grade"),
  memberStatus: document.getElementById("member-status"),
};

document.addEventListener("DOMContentLoaded", init);

elements.primaryTabs.forEach(function(button) {
  button.addEventListener("click", function() {
    state.primaryTab = button.dataset.primaryTab;
    renderTabs();
  });
});

elements.secondaryTabs.forEach(function(button) {
  button.addEventListener("click", function() {
    const key = button.dataset.secondaryTab;
    if (key.startsWith("tournament-")) {
      state.tournamentMode = key;
      if (key === "tournament-create") {
        resetTournamentForm();
      }
    }
    if (key.startsWith("member-")) {
      state.memberMode = key;
      if (key === "member-create") {
        resetMemberForm();
      }
    }
    renderTabs();
  });
});

elements.resetTournamentButton.addEventListener("click", function() {
  resetTournamentForm();
});

elements.sendAnnouncementButton.addEventListener("click", async function() {
  const tournamentId = elements.tournamentId.value.trim();

  if (!tournamentId) {
    showStatus("LINE通知の前に大会を保存または一覧から選択してください。", "error");
    return;
  }

  try {
    const adminToken = getLineAdminToken();
    await postJson({
      action: "send_announcement",
      admin_token: adminToken,
      tournament_ids: [tournamentId],
    });
    showStatus("LINEグループへ更新通知を送信しました。", "success");
  } catch (error) {
    showStatus(error.message || "LINE通知の送信に失敗しました。", "error");
  }
});

elements.resetMemberButton.addEventListener("click", function() {
  resetMemberForm();
});

elements.eventStartDate.addEventListener("change", function() {
  elements.eventEndDate.value = elements.eventStartDate.value;
});

elements.trueDeadline.addEventListener("change", function() {
  syncInternalDeadlineDefault();
});

elements.managerName.addEventListener("change", function() {
  syncSelectedManagerFields();
});

elements.tournamentForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  const selectedManager = getSelectedManager();

  const payload = {
    tournament_id: elements.tournamentId.value.trim(),
    title: elements.tournamentTitle.value.trim(),
    event_start_date: elements.eventStartDate.value,
    event_end_date: elements.eventStartDate.value,
    grades: getSelectedTournamentGrades().join(","),
    is_official: elements.isOfficial.checked,
    venue: elements.venue.value.trim(),
    true_deadline: toApiEndOfDay(elements.trueDeadline.value),
    internal_deadline: toApiEndOfDay(elements.internalDeadline.value),
    drive_url: elements.driveUrl.value.trim(),
    entry_page_token: elements.entryPageToken.value.trim(),
    entry_url: elements.entryUrl.value.trim(),
    manager_name: selectedManager ? selectedManager.manager_name : "",
    manager_line_user_id: selectedManager ? selectedManager.line_user_id : "",
    status: elements.tournamentStatus.value,
  };

  try {
    setBusyState(true, "大会情報を保存中です...");
    const result = await postJson({
      action: "upsert_tournament",
      tournament: payload,
    });
    showStatus(buildTournamentSaveMessage(result), "success");
    await loadAdminData();
    state.primaryTab = "tournaments";
    state.tournamentMode = "tournament-list";
    selectTournamentById(result.tournament_id);
  } catch (error) {
    showStatus(error.message || "大会情報の保存に失敗しました。", "error");
  } finally {
    setBusyState(false);
  }
});

elements.memberForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  const payload = {
    member_id: elements.memberId.value.trim(),
    display_name: elements.memberDisplayName.value.trim(),
    grade: elements.memberGrade.value.trim(),
    status: elements.memberStatus.value,
  };

  try {
    setBusyState(true, "メンバー情報を保存中です...");
    const result = await postJson({
      action: "upsert_member",
      member: payload,
    });
    showStatus("メンバー情報を保存しました。", "success");
    await loadAdminData();
    state.primaryTab = "members";
    state.memberMode = "member-list";
    selectMemberById(result.member_id);
  } catch (error) {
    showStatus(error.message || "メンバー情報の保存に失敗しました。", "error");
  } finally {
    setBusyState(false);
  }
});

async function init() {
  attachFormsToHosts();
  renderTournamentGradeSelector();
  renderTabs();
  resetTournamentForm();
  resetMemberForm();
  await loadAdminData();
}

async function loadAdminData() {
  showStatus("管理データを読み込んでいます...", "");

  try {
    const [tournamentData, memberData, managerData] = await Promise.all([
      fetchJson("list_tournaments"),
      fetchJson("list_admin_members"),
      fetchJson("list_managers"),
    ]);

    state.tournaments = tournamentData.tournaments || [];
    state.members = memberData.members || [];
    state.managers = managerData.managers || [];

    populateManagerOptions();
    renderTournamentList();
    renderMemberList();
    showStatus("", "");
  } catch (error) {
    showStatus(error.message || "管理データの取得に失敗しました。", "error");
  }
}

function renderTabs() {
  elements.primaryTabs.forEach(function(button) {
    button.classList.toggle("is-active", button.dataset.primaryTab === state.primaryTab);
  });

  elements.panels.forEach(function(panel) {
    panel.classList.toggle("is-hidden", panel.dataset.panel !== state.primaryTab);
  });

  elements.secondaryTabs.forEach(function(button) {
    const target = button.dataset.secondaryTab;
    const isActive =
      target === state.tournamentMode ||
      target === state.memberMode;
    button.classList.toggle("is-active", isActive);
  });

  elements.subpanels.forEach(function(panel) {
    const target = panel.dataset.subpanel;
    const isActive =
      target === state.tournamentMode ||
      target === state.memberMode;
    panel.classList.toggle("is-active", isActive);
  });

  syncFormPlacement();
  syncDetailEditors();
}

function renderTournamentList() {
  if (!state.tournaments.length) {
    elements.tournamentList.innerHTML = '<li class="empty-state">大会がまだありません。</li>';
    return;
  }

  elements.tournamentList.innerHTML = state.tournaments.map(function(item) {
    const activeClass = item.tournament_id === state.selectedTournamentId ? " is-active" : "";
    return (
      '<li><button type="button" class="item-button' + activeClass + '" data-tournament-id="' + escapeHtml(item.tournament_id || "") + '">' +
      '<span class="item-title">' + escapeHtml(item.title || "無題") + "</span>" +
      '<span class="item-meta">' + escapeHtml(formatTournamentListMeta(item)) + "</span>" +
      "</button></li>"
    );
  }).join("");

  elements.tournamentList.querySelectorAll("[data-tournament-id]").forEach(function(button) {
    button.addEventListener("click", function() {
      state.primaryTab = "tournaments";
      state.tournamentMode = "tournament-list";
      selectTournamentById(button.dataset.tournamentId);
    });
  });
}

function renderMemberList() {
  if (!state.members.length) {
    elements.memberList.innerHTML = '<li class="empty-state">メンバーがまだありません。</li>';
    return;
  }

  elements.memberList.innerHTML = state.members.map(function(item) {
    const activeClass = item.member_id === state.selectedMemberId ? " is-active" : "";
    return (
      '<li><button type="button" class="item-button' + activeClass + '" data-member-id="' + escapeHtml(item.member_id || "") + '">' +
      '<span class="item-title">' + escapeHtml(item.display_name || "名称未設定") + "</span>" +
      '<span class="item-meta">' + escapeHtml(formatMemberListMeta(item)) + "</span>" +
      "</button></li>"
    );
  }).join("");

  elements.memberList.querySelectorAll("[data-member-id]").forEach(function(button) {
    button.addEventListener("click", function() {
      state.primaryTab = "members";
      state.memberMode = "member-list";
      selectMemberById(button.dataset.memberId);
    });
  });
}

function formatTournamentListMeta(item) {
  return item.grades ? String(item.grades) : "級制限なし";
}

function formatMemberListMeta(item) {
  return item.grade ? String(item.grade) : "級未設定";
}

function buildTournamentSaveMessage(result) {
  const sync = result && result.calendar_sync;

  if (!sync) {
    return "大会情報を保存しました。";
  }

  if (sync.ok) {
    return "大会情報を保存しました。Google Calendarも同期しました。";
  }

  return "大会情報を保存しました。Google Calendar同期は未完了です: " +
    (sync.message || "設定を確認してください。");
}

function getLineAdminToken() {
  const storageKey = "lineAdminToken";
  const existing = window.localStorage.getItem(storageKey) || "";

  if (existing) {
    return existing;
  }

  const entered = window.prompt(
    "LINE更新通知に admin token が必要な場合は入力してください。不要なら空欄のままで構いません。",
    ""
  );

  if (entered === null) {
    return "";
  }

  window.localStorage.setItem(storageKey, entered);
  return entered;
}

function selectTournamentById(id) {
  const item = state.tournaments.find(function(tournament) {
    return tournament.tournament_id === id;
  });

  if (!item) {
    return;
  }

  state.selectedTournamentId = id;
  renderTabs();
  renderTournamentList();

  elements.tournamentId.value = item.tournament_id || "";
  elements.tournamentTitle.value = item.title || "";
  elements.eventStartDate.value = toDateInputValue(item.event_start_date);
  elements.eventEndDate.value = toDateInputValue(item.event_start_date);
  setSelectedTournamentGrades(item.grades || "");
  elements.trueDeadline.value = toDateInputValue(item.true_deadline);
  elements.internalDeadline.value = toDateInputValue(item.internal_deadline);
  elements.venue.value = item.venue || "";
  elements.driveUrl.value = item.drive_url || "";
  elements.entryPageToken.value = item.entry_page_token || "";
  elements.entryUrl.value = item.entry_url || "";
  setSelectedManager(item.manager_line_user_id || "", item.manager_name || "");
  elements.tournamentStatus.value = item.status || "draft";
  elements.isOfficial.checked = item.is_official === true || item.is_official === "TRUE" || item.is_official === "true";
}

function selectMemberById(id) {
  const item = state.members.find(function(member) {
    return member.member_id === id;
  });

  if (!item) {
    return;
  }

  state.selectedMemberId = id;
  renderTabs();
  renderMemberList();

  elements.memberId.value = item.member_id || "";
  elements.memberDisplayName.value = item.display_name || "";
  elements.memberGrade.value = item.grade || "";
  elements.memberStatus.value = item.status || "active";
}

function resetTournamentForm() {
  state.selectedTournamentId = "";
  elements.tournamentForm.reset();
  elements.tournamentStatus.value = "draft";
  elements.entryPageToken.value = "test-page-token";
  elements.eventEndDate.value = "";
  setSelectedTournamentGrades("");
  populateManagerOptions();
  syncSelectedManagerFields();
  renderTournamentList();
  syncDetailEditors();
}

function resetMemberForm() {
  state.selectedMemberId = "";
  elements.memberForm.reset();
  elements.memberStatus.value = "active";
  renderMemberList();
  syncDetailEditors();
}

function attachFormsToHosts() {
  elements.tournamentForm.hidden = false;
  elements.memberForm.hidden = false;
  elements.tournamentCreateHost.appendChild(elements.tournamentForm);
  elements.memberCreateHost.appendChild(elements.memberForm);
}

function syncFormPlacement() {
  const tournamentTarget = state.tournamentMode === "tournament-list" ?
    elements.tournamentDetailHost :
    elements.tournamentCreateHost;
  const memberTarget = state.memberMode === "member-list" ?
    elements.memberDetailHost :
    elements.memberCreateHost;

  if (elements.tournamentForm.parentElement !== tournamentTarget) {
    tournamentTarget.appendChild(elements.tournamentForm);
  }

  if (elements.memberForm.parentElement !== memberTarget) {
    memberTarget.appendChild(elements.memberForm);
  }
}

function syncDetailEditors() {
  const showTournamentEditor =
    state.tournamentMode === "tournament-list" &&
    Boolean(state.selectedTournamentId);
  const showMemberEditor =
    state.memberMode === "member-list" &&
    Boolean(state.selectedMemberId);

  elements.tournamentDetailNote.classList.toggle("is-hidden", showTournamentEditor);
  elements.tournamentDetailHost.classList.toggle("is-hidden", !showTournamentEditor);
  elements.memberDetailNote.classList.toggle("is-hidden", showMemberEditor);
  elements.memberDetailHost.classList.toggle("is-hidden", !showMemberEditor);
}

async function fetchJson(action) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", action);

  const response = await fetch(url.toString(), { method: "GET" });
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "読み込みに失敗しました。");
  }

  return data;
}

async function postJson(payload) {
  const response = await fetch(API_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "保存に失敗しました。");
  }

  return data;
}

function toApiEndOfDay(value) {
  return value ? value + "T23:59:00+09:00" : "";
}

function toDateInputValue(value) {
  return String(value || "").slice(0, 10);
}

function toDateTimeLocalValue(value) {
  return String(value || "").slice(0, 16);
}

function syncInternalDeadlineDefault() {
  if (!elements.trueDeadline.value) {
    elements.internalDeadline.value = "";
    return;
  }

  elements.internalDeadline.value = shiftDateString(
    elements.trueDeadline.value,
    -3
  );
}

function shiftDateString(value, days) {
  const parts = String(value || "").split("-");
  if (parts.length !== 3) {
    return "";
  }

  const shifted = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );
  shifted.setDate(shifted.getDate() + days);

  return [
    shifted.getFullYear(),
    String(shifted.getMonth() + 1).padStart(2, "0"),
    String(shifted.getDate()).padStart(2, "0"),
  ].join("-");
}

function showStatus(message, type) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = "status-message";

  if (type === "success") {
    elements.statusMessage.classList.add("is-success");
  }

  if (type === "error") {
    elements.statusMessage.classList.add("is-error");
  }
}

function setBusyState(isBusy, message) {
  state.isBusy = isBusy;
  document.body.classList.toggle("is-busy", isBusy);
  elements.busyOverlay.classList.toggle("is-hidden", !isBusy);
  elements.busyMessage.textContent = message || "保存中です...";

  Array.from(document.querySelectorAll("button, input, select, textarea")).forEach(function(element) {
    if (elements.busyMessage.contains(element)) {
      return;
    }
    element.disabled = isBusy;
  });
}

function populateManagerOptions() {
  const currentValue = elements.managerName.value;
  const options = ['<option value="">担当者を選択してください</option>'].concat(
    state.managers.map(function(manager) {
      const lineUserId = escapeHtml(manager.line_user_id || "");
      const managerName = escapeHtml(manager.manager_name || manager.display_name || "");
      const displayLabel = escapeHtml(buildManagerLabel(manager));
      const selected = currentValue && currentValue === (manager.line_user_id || "") ?
        ' selected' :
        "";
      return (
        '<option value="' + lineUserId + '" data-manager-name="' + managerName + '"' +
        selected + ">" + displayLabel + "</option>"
      );
    })
  );

  elements.managerName.innerHTML = options.join("");
}

function getSelectedTournamentGrades() {
  return normalizeGradeValues(elements.grades.value);
}

function setSelectedTournamentGrades(value) {
  const selectedValues = normalizeGradeValues(value);
  elements.grades.value = selectedValues.join(",");
  syncTournamentGradeSelector();
}

function normalizeGradeValues(value) {
  if (Array.isArray(value)) {
    return value
      .map(function(item) {
        return String(item || "").trim();
      })
      .filter(Boolean);
  }

  return String(value || "")
    .replace(/、/g, ",")
    .split(",")
    .map(function(item) {
      return item.trim();
    })
    .filter(function(item) {
      return item && TOURNAMENT_GRADE_OPTIONS.indexOf(item) !== -1;
    });
}

function renderTournamentGradeSelector() {
  elements.gradesSelector.innerHTML = TOURNAMENT_GRADE_OPTIONS.map(function(grade) {
    return (
      '<button type="button" class="chip-button" data-grade="' + escapeHtml(grade) +
      '" aria-pressed="false">○' + escapeHtml(grade) + "</button>"
    );
  }).join("");

  elements.gradesSelector.querySelectorAll("[data-grade]").forEach(function(button) {
    button.addEventListener("click", function() {
      toggleTournamentGrade(button.dataset.grade);
    });
  });
}

function toggleTournamentGrade(grade) {
  const selectedValues = getSelectedTournamentGrades();
  const index = selectedValues.indexOf(grade);

  if (index === -1) {
    selectedValues.push(grade);
  } else {
    selectedValues.splice(index, 1);
  }

  setSelectedTournamentGrades(selectedValues);
}

function syncTournamentGradeSelector() {
  const selectedValues = getSelectedTournamentGrades();

  elements.gradesSelector.querySelectorAll("[data-grade]").forEach(function(button) {
    const isSelected = selectedValues.indexOf(button.dataset.grade) !== -1;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    button.textContent = (isSelected ? "●" : "○") + button.dataset.grade;
  });
}

function buildManagerLabel(manager) {
  const displayName = String(manager.display_name || "").trim();
  const managerName = String(manager.manager_name || "").trim();

  if (displayName && managerName && displayName !== managerName) {
    return displayName + " (" + managerName + ")";
  }

  return displayName || managerName || "名称未設定";
}

function getSelectedManager() {
  const lineUserId = elements.managerName.value;
  if (!lineUserId) {
    return null;
  }

  return state.managers.find(function(manager) {
    return String(manager.line_user_id || "") === lineUserId;
  }) || null;
}

function syncSelectedManagerFields() {
  const selectedManager = getSelectedManager();
  elements.managerLineUserId.value = selectedManager ?
    String(selectedManager.line_user_id || "") :
    "";
}

function setSelectedManager(lineUserId, managerName) {
  let selectedValue = "";

  if (lineUserId) {
    const matchedById = state.managers.find(function(manager) {
      return String(manager.line_user_id || "") === String(lineUserId);
    });
    if (matchedById) {
      selectedValue = String(matchedById.line_user_id || "");
    }
  }

  if (!selectedValue && managerName) {
    const normalizedName = normalizeText(managerName);
    const matchedByName = state.managers.find(function(manager) {
      return [
        normalizeText(manager.manager_name),
        normalizeText(manager.display_name),
      ].indexOf(normalizedName) !== -1;
    });
    if (matchedByName) {
      selectedValue = String(matchedByName.line_user_id || "");
    }
  }

  elements.managerName.value = selectedValue;
  syncSelectedManagerFields();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
