const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzlYunO5FHWb75UXJCU8opm9nassYo74nQdlSKg-XXTntea6hEzq87konXxHEfzWsvf/exec";

const state = {
  tournaments: [],
  members: [],
  selectedTournamentId: "",
  selectedMemberId: "",
  primaryTab: "tournaments",
  tournamentMode: "tournament-create",
  memberMode: "member-create",
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
  tournamentForm: document.getElementById("tournament-form"),
  memberForm: document.getElementById("member-form"),
  resetTournamentButton: document.getElementById("reset-tournament-button"),
  resetMemberButton: document.getElementById("reset-member-button"),
  tournamentId: document.getElementById("tournament-id"),
  tournamentTitle: document.getElementById("tournament-title"),
  eventStartDate: document.getElementById("event-start-date"),
  eventEndDate: document.getElementById("event-end-date"),
  grades: document.getElementById("grades"),
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

elements.resetMemberButton.addEventListener("click", function() {
  resetMemberForm();
});

elements.tournamentForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  const payload = {
    tournament_id: elements.tournamentId.value.trim(),
    title: elements.tournamentTitle.value.trim(),
    event_start_date: elements.eventStartDate.value,
    event_end_date: elements.eventEndDate.value,
    grades: elements.grades.value.trim(),
    is_official: elements.isOfficial.checked,
    venue: elements.venue.value.trim(),
    true_deadline: toApiDateTime(elements.trueDeadline.value),
    internal_deadline: toApiDateTime(elements.internalDeadline.value),
    drive_url: elements.driveUrl.value.trim(),
    entry_page_token: elements.entryPageToken.value.trim(),
    entry_url: elements.entryUrl.value.trim(),
    manager_name: elements.managerName.value.trim(),
    manager_line_user_id: elements.managerLineUserId.value.trim(),
    status: elements.tournamentStatus.value,
  };

  try {
    const result = await postJson({
      action: "upsert_tournament",
      tournament: payload,
    });
    showStatus("大会情報を保存しました。", "success");
    await loadAdminData();
    state.primaryTab = "tournaments";
    state.tournamentMode = "tournament-list";
    selectTournamentById(result.tournament_id);
  } catch (error) {
    showStatus(error.message || "大会情報の保存に失敗しました。", "error");
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
  }
});

async function init() {
  attachFormsToHosts();
  renderTabs();
  resetTournamentForm();
  resetMemberForm();
  await loadAdminData();
}

async function loadAdminData() {
  showStatus("管理データを読み込んでいます...", "");

  try {
    const [tournamentData, memberData] = await Promise.all([
      fetchJson("list_tournaments"),
      fetchJson("list_admin_members"),
    ]);

    state.tournaments = tournamentData.tournaments || [];
    state.members = memberData.members || [];

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
  elements.eventEndDate.value = toDateInputValue(item.event_end_date);
  elements.grades.value = item.grades || "";
  elements.trueDeadline.value = toDateTimeLocalValue(item.true_deadline);
  elements.internalDeadline.value = toDateTimeLocalValue(item.internal_deadline);
  elements.venue.value = item.venue || "";
  elements.driveUrl.value = item.drive_url || "";
  elements.entryPageToken.value = item.entry_page_token || "";
  elements.entryUrl.value = item.entry_url || "";
  elements.managerName.value = item.manager_name || "";
  elements.managerLineUserId.value = item.manager_line_user_id || "";
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

function toApiDateTime(value) {
  return value ? value + ":00+09:00" : "";
}

function toDateInputValue(value) {
  return String(value || "").slice(0, 10);
}

function toDateTimeLocalValue(value) {
  return String(value || "").slice(0, 16);
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

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
