const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzlYunO5FHWb75UXJCU8opm9nassYo74nQdlSKg-XXTntea6hEzq87konXxHEfzWsvf/exec";

const TOURNAMENT_GRADE_OPTIONS = ["A", "B", "C", "D", "E", "F", "初心者"];
const MEMBER_GRADE_OPTIONS = ["A", "B", "C", "D", "E", "F", "beginner"];
const MEMBER_REQUEST_RANK_OPTIONS = [
  { value: "6", label: "六段" },
  { value: "5", label: "五段" },
  { value: "4", label: "四段" },
  { value: "3", label: "三段" },
  { value: "2", label: "二段" },
  { value: "1", label: "初段" },
  { value: "0", label: "無段" },
];
const MEMBER_REQUEST_GRADE_OPTIONS = [
  { value: "A", label: "A級" },
  { value: "B", label: "B級" },
  { value: "C", label: "C級" },
  { value: "D", label: "D級" },
  { value: "E", label: "E級" },
  { value: "F", label: "F級" },
  { value: "beginner", label: "初心者" },
];

const state = {
  pageToken: "",
  members: [],
  settings: {},
  savedResponsesByTournament: {},
  draftResponsesByTournament: {},
  tournaments: [],
  tournamentResponseOverview: [],
  filteredTournaments: [],
  visibilityFilter: "unanswered",
  currentView: "entry",
  isBusy: false,
  submitConfirmResolver: null,
  resultOverlayOnClose: null,
};

const elements = {
  form: document.getElementById("entry-form"),
  memberRequestForm: document.getElementById("member-request-form"),
  memberName: document.getElementById("member-name"),
  selectedMemberNotice: document.getElementById("selected-member-notice"),
  pageTitle: document.getElementById("page-title"),
  pageDescription: document.getElementById("page-description"),
  entryView: document.getElementById("entry-view"),
  overviewView: document.getElementById("overview-view"),
  annualScheduleView: document.getElementById("annual-schedule-view"),
  annualScheduleFrame: document.getElementById("annual-schedule-frame"),
  annualScheduleLink: document.getElementById("annual-schedule-link"),
  calendarView: document.getElementById("calendar-view"),
  calendarFrame: document.getElementById("calendar-frame"),
  calendarLink: document.getElementById("calendar-link"),
  openDriveFolderLink: document.getElementById("open-drive-folder-link"),
  memberRequestView: document.getElementById("member-request-view"),
  openOverviewButton: document.getElementById("open-overview-button"),
  openAnnualScheduleButton: document.getElementById("open-annual-schedule-button"),
  openCalendarButton: document.getElementById("open-calendar-button"),
  openGuideLink: document.getElementById("open-guide-link"),
  openMemberRequestLink: document.getElementById("open-member-request-link"),
  closeOverviewButton: document.getElementById("close-overview-button"),
  closeAnnualScheduleButton: document.getElementById("close-annual-schedule-button"),
  closeCalendarButton: document.getElementById("close-calendar-button"),
  closeMemberRequestButton: document.getElementById("close-member-request-button"),
  requestLastName: document.getElementById("request-last-name"),
  requestLastNameKana: document.getElementById("request-last-name-kana"),
  requestFirstName: document.getElementById("request-first-name"),
  requestFirstNameKana: document.getElementById("request-first-name-kana"),
  requestRank: document.getElementById("request-rank"),
  requestGrade: document.getElementById("request-grade"),
  requestRankChips: document.getElementById("request-rank-chips"),
  requestGradeChips: document.getElementById("request-grade-chips"),
  memberRequestStatus: document.getElementById("member-request-status"),
  submitMemberRequestButton: document.getElementById("submit-member-request-button"),
  tournamentList: document.getElementById("tournament-list"),
  tournamentOverviewList: document.getElementById("tournament-overview-list"),
  statusMessage: document.getElementById("status-message"),
  submitButton: document.getElementById("submit-button"),
  tournamentTemplate: document.getElementById("tournament-template"),
  filterButtons: document.querySelectorAll(".filter-button"),
  busyOverlay: document.getElementById("busy-overlay"),
  busyMessage: document.getElementById("busy-message"),
  resultOverlay: document.getElementById("result-overlay"),
  resultTitle: document.getElementById("result-title"),
  resultMessage: document.getElementById("result-message"),
  resultCloseButton: document.getElementById("result-close-button"),
  confirmOverlay: document.getElementById("confirm-overlay"),
  confirmSummary: document.getElementById("confirm-summary"),
  confirmCancelButton: document.getElementById("confirm-cancel-button"),
  confirmSubmitButton: document.getElementById("confirm-submit-button"),
};

document.addEventListener("DOMContentLoaded", init);

elements.openOverviewButton.addEventListener("click", function() {
  setCurrentView("overview");
});

elements.openAnnualScheduleButton.addEventListener("click", function() {
  setCurrentView("annual-schedule");
});

elements.openCalendarButton.addEventListener("click", function() {
  setCurrentView("calendar");
});

elements.openMemberRequestLink.addEventListener("click", function() {
  setCurrentView("member-request");
});

elements.closeOverviewButton.addEventListener("click", function() {
  setCurrentView("entry");
});

elements.closeAnnualScheduleButton.addEventListener("click", function() {
  setCurrentView("entry");
});

elements.closeCalendarButton.addEventListener("click", function() {
  setCurrentView("entry");
});

elements.closeMemberRequestButton.addEventListener("click", function() {
  setCurrentView("entry");
});

elements.confirmCancelButton.addEventListener("click", function() {
  resolveSubmitConfirm(false);
});

elements.confirmSubmitButton.addEventListener("click", function() {
  resolveSubmitConfirm(true);
});

elements.resultCloseButton.addEventListener("click", function() {
  closeResultOverlay_();
});

async function init() {
  const url = new URL(window.location.href);
  const pageToken = url.searchParams.get("page_token") || "";
  state.pageToken = pageToken;
  syncGuideLinkPageToken_(pageToken);

  if (!pageToken) {
    showStatus("page_token が指定されていません。", "error");
    renderEmptyState("URL が正しいか確認してください。");
    disableForm();
    return;
  }

  setBusyState(true, "大会情報を読み込んでいます...");
  showStatus("大会情報を読み込んでいます...", "");
  disableForm();
  renderMemberRequestChoiceChips_();

  try {
    const data = await fetchPublicTournaments(pageToken);
    state.settings = data.settings || {};
    state.members = data.members || [];
    state.tournaments = data.tournaments || [];
    state.tournamentResponseOverview = data.tournament_response_overview || [];
    renderPage(data.page || {});
    renderMemberOptions(state.members);
    renderTournamentOverview();
    renderSelectedMemberNotice_();
    syncMemberRequestLinkVisibility_();
    setCurrentView("entry");
    state.filteredTournaments = [];
    renderEmptyState("名前を選ぶと、対象の大会だけ表示されます。");
    showStatus("", "");
    enableForm();
  } catch (error) {
    renderEmptyState("大会情報を取得できませんでした。");
    showStatus(error.message || "読み込みに失敗しました。", "error");
    disableForm();
  } finally {
    setBusyState(false);
  }
}

elements.submitMemberRequestButton.addEventListener("click", async function() {
  const requestInputs = [
    elements.requestLastName,
    elements.requestLastNameKana,
    elements.requestFirstName,
    elements.requestFirstNameKana,
  ];
  const isValid = Array.from(requestInputs).every(function(input) {
    return input.reportValidity();
  });

  if (!isValid) {
    return;
  }

  if (!elements.requestRank.value) {
    setMemberRequestStatus("段位を選択してください。", "error");
    return;
  }

  if (!elements.requestGrade.value) {
    setMemberRequestStatus("出場級を選択してください。", "error");
    return;
  }

  const payload = {
    last_name: elements.requestLastName.value.trim(),
    last_name_kana: elements.requestLastNameKana.value.trim(),
    first_name: elements.requestFirstName.value.trim(),
    first_name_kana: elements.requestFirstNameKana.value.trim(),
    rank: elements.requestRank.value,
    grade: elements.requestGrade.value,
  };

  setMemberRequestStatus("", "");

  try {
    setBusyState(true, "メンバー追加申請を送信しています...");
    await submitMemberRequest(payload);
    elements.memberRequestForm.reset();
    syncMemberRequestChoiceValue_("rank", "");
    syncMemberRequestChoiceValue_("grade", "");
    setBusyState(false);
    setMemberRequestStatus(
      "登録申請を受け付けました。承認されると名前一覧に表示されます。",
      "success"
    );
    showResultOverlay_(
      "申請しました",
      buildMemberRequestResultMessage_(payload),
      function() {
        setCurrentView("member-request");
        elements.requestLastName.focus();
      }
    );
  } catch (error) {
    setMemberRequestStatus(error.message || "登録申請に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_(
      "申請できませんでした",
      error.message || "登録申請に失敗しました。"
    );
  }
});

elements.form.addEventListener("submit", async function(event) {
  event.preventDefault();

  const memberName = elements.memberName.value.trim();
  const responses = collectResponses();

  if (!memberName) {
    showStatus("名前を入力してください。", "error");
    elements.memberName.focus();
    return;
  }

  if (responses.length === 0) {
    showStatus("少なくとも1件は回答を選択してください。", "error");
    return;
  }

  const confirmed = await openSubmitConfirmDialog(responses);

  if (!confirmed) {
    showStatus("送信をキャンセルしました。", "");
    return;
  }

  disableForm();
  setBusyState(true, "回答を保存しています...");
  showStatus("回答を送信しています...", "");

  try {
    const result = await submitResponses({
      page_token: state.pageToken,
      member_name: memberName,
      responses: responses,
    });
    let resultMessage = result.updated_count + " 件の回答を保存しました。";

    try {
      await refreshResponsesAndOverview(memberName);
    } catch (refreshError) {
      resultMessage =
        result.updated_count +
        " 件の回答を保存しました。画面の再読込に失敗したため、必要なら再読込してください。";
    }
    setBusyState(false);
    enableForm();
    showStatus(resultMessage, "success");
    showResultOverlay_("送信しました", resultMessage);
  } catch (error) {
    showStatus(error.message || "送信に失敗しました。", "error");
    setBusyState(false);
    enableForm();
    showResultOverlay_("送信できませんでした", error.message || "送信に失敗しました。");
  }
});

elements.memberName.addEventListener("change", function() {
  handleMemberChange();
});

elements.filterButtons.forEach(function(button) {
  button.addEventListener("click", function() {
    state.visibilityFilter = button.dataset.filter;
    updateFilterButtons();
    renderCurrentTournamentView();
  });
});

elements.form.addEventListener("change", function(event) {
  syncTournamentDraft(event.target);
});

elements.form.addEventListener("input", function(event) {
  syncTournamentDraft(event.target);
});

async function handleMemberChange() {
  const selectedMember = getSelectedMember();

  if (!selectedMember) {
    state.savedResponsesByTournament = {};
    state.draftResponsesByTournament = {};
    state.filteredTournaments = [];
    renderSelectedMemberNotice_();
    syncMemberRequestLinkVisibility_();
    renderEmptyState("名前を選ぶと、対象の大会だけ表示されます。");
    showStatus("", "");
    return;
  }

  state.filteredTournaments = filterTournamentsForMember(
    state.tournaments,
    selectedMember
  );
  renderSelectedMemberNotice_();
  syncMemberRequestLinkVisibility_();
  setBusyState(true, "既存の回答を読み込んでいます...");
  disableForm();
  showStatus("回答状況を読み込んでいます...", "");

  try {
    state.savedResponsesByTournament = await fetchMemberResponses(
      state.pageToken,
      selectedMember.display_name
    );
    state.draftResponsesByTournament = cloneResponseMap_(
      state.savedResponsesByTournament
    );
  } catch (error) {
    state.savedResponsesByTournament = {};
    state.draftResponsesByTournament = {};
    showStatus(error.message || "既存回答の取得に失敗しました。", "error");
  } finally {
    setBusyState(false);
    enableForm();
  }

  renderCurrentTournamentView();
}

async function fetchPublicTournaments(pageToken) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", "list_public_tournaments");
  url.searchParams.set("page_token", pageToken);
  url.searchParams.set("cache_bust", buildCacheBustValue_());

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });
  const data = await readJsonResponse(response, "大会情報の取得");

  if (!data.ok) {
    throw new Error(data.error || "大会情報の取得に失敗しました。");
  }

  return data;
}

async function fetchMemberResponses(pageToken, memberName) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", "list_member_responses");
  url.searchParams.set("page_token", pageToken);
  url.searchParams.set("member_name", memberName);
  url.searchParams.set("cache_bust", buildCacheBustValue_());

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });
  const data = await readJsonResponse(response, "既存回答の取得");

  if (!data.ok) {
    throw new Error(data.error || "既存回答の取得に失敗しました。");
  }

  return (data.responses || []).reduce(function(result, item) {
    result[item.tournament_id] = {
      response: item.response,
      comment: item.comment || "",
      updated_at: item.updated_at || "",
    };
    return result;
  }, {});
}

async function submitResponses(payload) {
  const response = await fetch(API_BASE_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "upsert_response",
      page_token: payload.page_token,
      member_name: payload.member_name,
      responses: payload.responses,
    }),
  });
  const data = await readJsonResponse(response, "回答の保存");

  if (!data.ok) {
    throw new Error(data.error || "回答の保存に失敗しました。");
  }

  return data;
}

async function submitMemberRequest(member) {
  const response = await fetch(API_BASE_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action: "request_member_registration",
      member: member,
    }),
  });
  const data = await readJsonResponse(response, "メンバー追加申請");

  if (!data.ok) {
    throw new Error(data.error || "メンバー追加申請に失敗しました。");
  }

  return data;
}

function buildCacheBustValue_() {
  return String(Date.now()) + "_" + Math.random().toString(36).slice(2);
}

async function readJsonResponse(response, actionLabel) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch (error) {
    const trimmed = String(text || "").trim();
    const responseUrl = response && response.url ? response.url : "";
    const debugParts = [
      "HTTP " + response.status,
      responseUrl ? "URL: " + responseUrl : "",
      trimmed ? "先頭: " + trimmed.slice(0, 160).replace(/\s+/g, " ") : "",
    ].filter(Boolean);

    if (/^<!DOCTYPE html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      throw new Error(
        actionLabel +
        "先の Apps Script が JSON ではなく HTML を返しました。Webアプリの再デプロイ、公開権限、API URL を確認してください。" +
        (debugParts.length ? " " + debugParts.join(" / ") : "")
      );
    }

    throw new Error(
      actionLabel +
      "先の応答を解釈できませんでした。先頭: " +
      trimmed.slice(0, 120)
    );
  }
}

function renderPage(page) {
  if (page.title) {
    elements.pageTitle.textContent = page.title;
  }

  if (page.description) {
    elements.pageDescription.textContent = page.description;
    elements.pageDescription.classList.remove("is-hidden");
  } else {
    elements.pageDescription.textContent = "";
    elements.pageDescription.classList.add("is-hidden");
  }

  applyPublicSettings_();
}

function setCurrentView(viewName) {
  if (
    viewName !== "overview" &&
    viewName !== "annual-schedule" &&
    viewName !== "calendar" &&
    viewName !== "member-request"
  ) {
    state.currentView = "entry";
  } else {
    state.currentView = viewName;
  }

  const isEntry = state.currentView === "entry";
  const isOverview = state.currentView === "overview";
  const isAnnualSchedule = state.currentView === "annual-schedule";
  const isCalendar = state.currentView === "calendar";
  const isMemberRequest = state.currentView === "member-request";

  elements.entryView.classList.toggle("is-hidden", !isEntry);
  elements.overviewView.classList.toggle("is-hidden", !isOverview);
  elements.annualScheduleView.classList.toggle("is-hidden", !isAnnualSchedule);
  elements.calendarView.classList.toggle("is-hidden", !isCalendar);
  elements.memberRequestView.classList.toggle("is-hidden", !isMemberRequest);
  elements.openOverviewButton.classList.toggle("is-hidden", !isEntry);
  elements.openAnnualScheduleButton.classList.toggle("is-hidden", !isEntry);
  elements.openCalendarButton.classList.toggle(
    "is-hidden",
    !isEntry || !hasCalendarUrl_()
  );
  if (elements.openDriveFolderLink) {
    const hasDriveFolderUrl = Boolean(
      String(state.settings.drive_folder_url || "").trim()
    );
    elements.openDriveFolderLink.classList.toggle(
      "is-hidden",
      !isEntry || !hasDriveFolderUrl
    );
  }
  elements.openMemberRequestLink.classList.toggle("is-hidden", !isEntry);
}

function renderTournamentOverview() {
  if (!elements.tournamentOverviewList) {
    return;
  }

  const overviewItems = getGroupedTournamentOverviewItems_();
  const upcomingItems = overviewItems
    .filter(function(item) {
      return !isPastTournament_(item);
    })
    .sort(compareUpcomingOverviewItems_);
  const pastItems = overviewItems
    .filter(function(item) {
      return isPastTournament_(item) && Number(item.applicant_count || 0) > 0;
    })
    .sort(comparePastOverviewItems_);

  if (!upcomingItems.length && !pastItems.length) {
    elements.tournamentOverviewList.innerHTML =
      '<div class="empty-state">申込状況を表示できる大会はまだありません。</div>';
    return;
  }

  elements.tournamentOverviewList.innerHTML =
    renderOverviewSection_("これからの大会", upcomingItems, {
      emptyMessage: "これから開催される大会はありません。",
      includeStatusBadge: true,
    }) +
    renderPastOverviewSection_(pastItems);
}

function renderOverviewSection_(title, items, options) {
  const settings = options || {};

  if (!items.length) {
    return (
      '<section class="overview-section">' +
        '<h3 class="overview-section-title">' + escapeHtml(title) + "</h3>" +
        '<div class="empty-state">' + escapeHtml(settings.emptyMessage || "表示できる大会はありません。") + "</div>" +
      "</section>"
    );
  }

  return (
    '<section class="overview-section">' +
      '<h3 class="overview-section-title">' + escapeHtml(title) + "</h3>" +
      '<div class="overview-card-list">' +
        items.map(function(item) {
          return renderOverviewCard_(item, settings);
        }).join("") +
      "</div>" +
    "</section>"
  );
}

function renderPastOverviewSection_(items) {
  if (!items.length) {
    return "";
  }

  return (
    '<details class="overview-past-section">' +
      '<summary>' +
        '<span>過去の大会</span>' +
        '<span class="overview-past-count">' + escapeHtml(String(items.length)) + "件</span>" +
      "</summary>" +
      '<div class="overview-card-list overview-card-list-past">' +
        items.map(function(item) {
          return renderOverviewCard_(item, { includeStatusBadge: false });
        }).join("") +
      "</div>" +
    "</details>"
  );
}

function renderOverviewCard_(item, options) {
  const applicantGroups = Array.isArray(item.applicant_groups) ? item.applicant_groups : [];
  const applicantBody = applicantGroups.length ?
    applicantGroups.map(function(group) {
      return (
        '<div class="overview-grade-row">' +
          '<div class="overview-grade-label">' +
            escapeHtml(formatOverviewGradeLabel(group.grade)) +
          "</div>" +
          '<div class="overview-grade-names">' +
            escapeHtml((group.names || []).join("、")) +
          "</div>" +
        "</div>"
      );
    }).join("") :
    '<p class="overview-empty">まだ参加希望者はいません。</p>';
  const statusBadge = options && options.includeStatusBadge ?
    renderOverviewStatusBadge_(item) :
    "";

  return (
    '<section class="overview-card">' +
      '<div class="overview-card-header">' +
        '<div class="overview-card-title-row">' +
          '<h3>' + escapeHtml(item.title || "無題") + "</h3>" +
          statusBadge +
        "</div>" +
        '<span class="overview-count">' + escapeHtml(String(item.applicant_count || 0)) + "名</span>" +
      "</div>" +
      '<div class="overview-meta">' +
        '<span>大会日: ' + escapeHtml(item.event_date_label || "-") + "</span>" +
        '<span>締切: ' + escapeHtml(formatDateTime(item.internal_deadline)) + "</span>" +
        '<span>開催級: ' + escapeHtml(item.grades || "級制限なし") + "</span>" +
      "</div>" +
      '<div class="overview-body">' + applicantBody + "</div>" +
    "</section>"
  );
}

function renderOverviewStatusBadge_(item) {
  const status = String(item.status || "").trim();

  if (status === "active") {
    return '<span class="overview-status-badge is-open">申込受付中</span>';
  }

  if (status === "applied") {
    return '<span class="overview-status-badge is-closed">申込締切済</span>';
  }

  return "";
}

function renderMemberOptions(members) {
  elements.memberName.innerHTML = "";
  const sortedMembers = (members || []).slice().sort(function(a, b) {
    const gradeDiff =
      getMemberGradeSortIndex_(a.grade) - getMemberGradeSortIndex_(b.grade);

    if (gradeDiff !== 0) {
      return gradeDiff;
    }

    return String(a.display_name || "").localeCompare(
      String(b.display_name || ""),
      "ja"
    );
  });

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選択してください";
  elements.memberName.appendChild(placeholder);

  sortedMembers.forEach(function(member) {
    const option = document.createElement("option");
    option.value = member.display_name;
    option.textContent = member.display_name || "";
    elements.memberName.appendChild(option);
  });
}

function applyPublicSettings_() {
  const driveFolderUrl = String(state.settings.drive_folder_url || "").trim();
  const previewUrl = String(state.settings.annual_schedule_preview_url || "").trim();
  const viewUrl = String(state.settings.annual_schedule_view_url || "").trim();
  const calendarEmbedUrl = String(state.settings.calendar_embed_url || "").trim();
  const calendarViewUrl = String(state.settings.calendar_view_url || "").trim();

  if (elements.annualScheduleFrame) {
    elements.annualScheduleFrame.src = previewUrl || "about:blank";
  }

  if (elements.annualScheduleLink) {
    elements.annualScheduleLink.href = viewUrl || "#";
  }

  if (elements.openDriveFolderLink) {
    elements.openDriveFolderLink.href = driveFolderUrl || "#";
  }

  if (elements.calendarFrame) {
    elements.calendarFrame.src = calendarEmbedUrl || "about:blank";
  }

  if (elements.calendarLink) {
    elements.calendarLink.href = calendarViewUrl || "#";
  }
}

function hasCalendarUrl_() {
  return Boolean(
    String(state.settings.calendar_embed_url || "").trim() ||
    String(state.settings.calendar_view_url || "").trim()
  );
}

function renderTournaments(tournaments) {
  elements.tournamentList.innerHTML = "";

  if (!tournaments.length) {
    renderEmptyState("現在表示できる大会はありません。");
    return;
  }

  tournaments.forEach(function(tournament) {
    const fragment = elements.tournamentTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".tournament-card");
    const displayTournament = getGroupedTournamentDisplayItem_(tournament);
    const savedResponse = state.savedResponsesByTournament[tournament.tournament_id] || null;
    const draftResponse = state.draftResponsesByTournament[tournament.tournament_id] || null;
    const canSubmitResponse = canSubmitTournamentResponse_(tournament);

    fragment.querySelector(".tournament-title").textContent =
      displayTournament.title || tournament.title;
    fragment.querySelector(".tournament-meta").textContent = "";
    fragment.querySelector(".response-state").textContent =
      canSubmitResponse ?
        (savedResponse ? "回答済み" : "未回答") :
        "申込済み";
    fragment.querySelector(".event-date").textContent =
      displayTournament.event_date_label || tournament.event_date_label || "-";
    fragment.querySelector(".grades").textContent =
      displayTournament.grades || tournament.grades || "-";
    fragment.querySelector(".internal-deadline").textContent =
      formatDateTime(displayTournament.internal_deadline || tournament.internal_deadline);

    const driveLink = fragment.querySelector(".drive-link");
    driveLink.href = tournament.drive_url || "#";
    if (!tournament.drive_url) {
      driveLink.removeAttribute("href");
      driveLink.textContent = "未設定";
    }

    const radioInputs = fragment.querySelectorAll('input[type="radio"]');
    radioInputs.forEach(function(input) {
      input.name = "response-" + tournament.tournament_id;
      input.dataset.tournamentId = tournament.tournament_id;
      input.disabled = !canSubmitResponse;
      if (draftResponse && draftResponse.response === input.value) {
        input.checked = true;
      }
    });

    const textarea = fragment.querySelector("textarea");
    textarea.dataset.tournamentId = tournament.tournament_id;
    textarea.value = draftResponse ? draftResponse.comment || "" : "";
    textarea.disabled = !canSubmitResponse;
    textarea.placeholder = canSubmitResponse ?
      "任意" :
      "申込済みのため回答は締め切られています。";

    card.dataset.tournamentId = tournament.tournament_id;
    card.classList.toggle("is-applied", !canSubmitResponse);
    updateResponseOptionStyles_(card);
    elements.tournamentList.appendChild(fragment);
  });
}

function collectResponses() {
  return state.filteredTournaments.reduce(function(result, tournament) {
    if (!canSubmitTournamentResponse_(tournament)) {
      return result;
    }

    const draftResponse = state.draftResponsesByTournament[tournament.tournament_id];

    if (!draftResponse || !draftResponse.response) {
      return result;
    }

    result.push({
      tournament_id: tournament.tournament_id,
      response: draftResponse.response,
      comment: draftResponse.comment || "",
    });

    return result;
  }, []);
}

function canSubmitTournamentResponse_(tournament) {
  return String(tournament && tournament.status || "").trim() === "active";
}

function getSelectedMember() {
  const selectedName = elements.memberName.value;

  if (!selectedName) {
    return null;
  }

  return state.members.find(function(member) {
    return member.display_name === selectedName;
  }) || null;
}

function filterTournamentsForMember(tournaments, member) {
  const memberGrade = normalizeGradeLabel(member.grade);

  return tournaments.filter(function(tournament) {
    if (!tournament.grades) {
      return true;
    }

    if (!memberGrade) {
      return false;
    }

    const tournamentGrades = String(tournament.grades)
      .split(",")
      .map(function(grade) {
        return normalizeGradeLabel(grade);
      })
      .filter(Boolean);

    return tournamentGrades.includes(memberGrade);
  });
}

function renderCurrentTournamentView() {
  const visibleTournaments = state.filteredTournaments.filter(function(tournament) {
    return matchesVisibilityFilter(tournament);
  });

  renderSelectedMemberNotice_();
  renderTournaments(visibleTournaments);

  if (!state.filteredTournaments.length) {
    showStatus("該当する大会はありません。", "");
    return;
  }

  if (!visibleTournaments.length) {
    if (state.visibilityFilter === "answered") {
      renderEmptyState("回答済みの大会はありません。");
    } else if (state.visibilityFilter === "planned") {
      renderEmptyState("出場予定の大会はありません。");
    } else if (state.visibilityFilter === "unanswered") {
      renderEmptyState("未回答の大会はありません。");
    }
  }

  if (visibleTournaments.length) {
    showStatus("", "");
  }
}

function renderSelectedMemberNotice_() {
  if (!elements.selectedMemberNotice) {
    return;
  }

  const selectedMember = getSelectedMember();

  if (!selectedMember) {
    elements.selectedMemberNotice.textContent = "";
    return;
  }

  if (!state.filteredTournaments.length) {
    elements.selectedMemberNotice.textContent =
      selectedMember.display_name + "さんが申し込みできる大会は現在ありません。";
    return;
  }

  elements.selectedMemberNotice.textContent =
    selectedMember.display_name + "さんの対象大会を表示しています。";
}

function syncMemberRequestLinkVisibility_() {
  if (!elements.openMemberRequestLink) {
    return;
  }

  elements.openMemberRequestLink.classList.toggle(
    "is-hidden",
    Boolean(getSelectedMember())
  );
}

function syncGuideLinkPageToken_(pageToken) {
  if (!elements.openGuideLink || !pageToken) {
    return;
  }

  const url = new URL(elements.openGuideLink.getAttribute("href"), window.location.href);
  url.searchParams.set("page_token", pageToken);
  elements.openGuideLink.href = url.toString();
}

function getGroupedTournamentDisplayItem_(tournament) {
  const items = getGroupedPublicTournamentItems_();
  const groupKey = buildPublicTournamentGroupKey_(tournament);

  return items.find(function(item) {
    return item.group_key === groupKey;
  }) || tournament;
}

function getGroupedTournamentOverviewItems_() {
  const groups = {};

  (state.tournamentResponseOverview || []).forEach(function(item) {
    const groupKey = buildPublicTournamentGroupKey_(item);

    if (!groups[groupKey]) {
      groups[groupKey] = {
        group_key: groupKey,
        title: buildTournamentDisplayTitleForGrouping_(item.title, []),
        status: item.status || "",
        event_start_date: item.event_start_date || "",
        event_end_date: item.event_end_date || item.event_start_date || "",
        event_date_label: item.event_date_label || "",
        internal_deadline: item.internal_deadline || "",
        grades: [],
        applicant_groups: [],
        applicant_count: 0,
      };
    }

    groups[groupKey].grades = sortTournamentGrades_(
      groups[groupKey].grades.concat(normalizeTournamentGradeValues_(item.grades))
    );
    groups[groupKey].status = mergeOverviewStatus_(
      groups[groupKey].status,
      item.status
    );
    groups[groupKey].applicant_groups = mergeApplicantGroups_(
      groups[groupKey].applicant_groups,
      item.applicant_groups
    );
    groups[groupKey].applicant_count += Number(item.applicant_count || 0);
  });

  return Object.keys(groups).map(function(groupKey) {
    const item = groups[groupKey];
    item.grades = item.grades.join(",");
    item.title = buildTournamentDisplayTitleForGrouping_(item.title, item.grades);
    item.applicant_count = item.applicant_groups.reduce(function(total, group) {
      return total + (group.names || []).length;
    }, 0);
    return item;
  });
}

function getGroupedPublicTournamentItems_() {
  const groups = {};

  (state.tournaments || []).forEach(function(item) {
    const groupKey = buildPublicTournamentGroupKey_(item);

    if (!groups[groupKey]) {
      groups[groupKey] = {
        group_key: groupKey,
        title: buildTournamentDisplayTitleForGrouping_(item.title, []),
        status: item.status || "",
        event_start_date: item.event_start_date || "",
        event_end_date: item.event_end_date || item.event_start_date || "",
        event_date_label: item.event_date_label || "",
        internal_deadline: item.internal_deadline || "",
        grades: [],
        drive_url: item.drive_url || "",
      };
    }

    groups[groupKey].grades = sortTournamentGrades_(
      groups[groupKey].grades.concat(normalizeTournamentGradeValues_(item.grades))
    );
    groups[groupKey].status = mergeOverviewStatus_(
      groups[groupKey].status,
      item.status
    );
  });

  return Object.keys(groups).map(function(groupKey) {
    const item = groups[groupKey];
    item.grades = item.grades.join(",");
    item.title = buildTournamentDisplayTitleForGrouping_(item.title, item.grades);
    return item;
  });
}

function buildPublicTournamentGroupKey_(item) {
  return [
    buildTournamentBaseTitleForGrouping_(item.title, item.grades),
    normalizeDateKey_(item.event_start_date) || String(item.event_date_label || "").trim(),
    normalizeDateKey_(item.event_end_date || item.event_start_date),
    String(item.internal_deadline || "").trim(),
    String(item.drive_url || "").trim(),
  ].join("::");
}

function buildTournamentBaseTitleForGrouping_(title, grades) {
  const normalizedTitle = String(title || "").trim();
  const compactGradeLabel = normalizeTournamentGradeValues_(grades)
    .map(function(grade) {
      return String(grade || "").replace(/級$/g, "").trim();
    })
    .filter(Boolean)
    .join("");

  if (!compactGradeLabel) {
    return normalizedTitle;
  }

  return normalizedTitle
    .replace(new RegExp(escapeRegExpForGrouping_(compactGradeLabel) + "級$"), "")
    .replace(new RegExp(escapeRegExpForGrouping_(compactGradeLabel) + "$"), "")
    .trim();
}

function buildTournamentDisplayTitleForGrouping_(title, grades) {
  const baseTitle = buildTournamentBaseTitleForGrouping_(title, grades);
  const compactGradeLabel = buildTournamentDisplayGradeLabelForGrouping_(grades);

  return compactGradeLabel ? baseTitle + compactGradeLabel : baseTitle;
}

function buildTournamentDisplayGradeLabelForGrouping_(grades) {
  const normalizedGrades = normalizeTournamentGradeValues_(grades).filter(function(grade) {
    const normalized = String(grade || "").trim();
    return normalized && normalized !== "初心者";
  });

  if (!normalizedGrades.length) {
    return "";
  }

  return sortTournamentGrades_(normalizedGrades)
    .map(function(grade) {
      return String(grade || "").replace(/級$/g, "").trim();
    })
    .join("");
}

function escapeRegExpForGrouping_(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTournamentGradeValues_(value) {
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
      return String(item || "").trim();
    })
    .filter(function(item) {
      return item && TOURNAMENT_GRADE_OPTIONS.indexOf(item) !== -1;
    });
}

function sortTournamentGrades_(grades) {
  return uniqueStrings((grades || []).slice()).sort(function(a, b) {
    return TOURNAMENT_GRADE_OPTIONS.indexOf(a) - TOURNAMENT_GRADE_OPTIONS.indexOf(b);
  });
}

function mergeApplicantGroups_(leftGroups, rightGroups) {
  const grouped = {};

  (leftGroups || []).concat(rightGroups || []).forEach(function(group) {
    const grade = String(group && group.grade ? group.grade : "").trim() || "未登録";
    const names = Array.isArray(group && group.names) ? group.names : [];

    if (!grouped[grade]) {
      grouped[grade] = [];
    }

    names.forEach(function(name) {
      if (grouped[grade].indexOf(name) === -1) {
        grouped[grade].push(name);
      }
    });
  });

  return Object.keys(grouped).sort(function(a, b) {
    return String(a).localeCompare(String(b), "ja");
  }).map(function(grade) {
    return {
      grade: grade,
      names: grouped[grade].slice().sort(function(a, b) {
        return String(a).localeCompare(String(b), "ja");
      }),
    };
  });
}

function mergeOverviewStatus_(leftStatus, rightStatus) {
  const left = String(leftStatus || "").trim();
  const right = String(rightStatus || "").trim();

  if (left === "active" || right === "active") {
    return "active";
  }

  return left || right;
}

function isPastTournament_(item) {
  const endDate = parseOverviewDateOnly_(
    item && (item.event_end_date || item.event_start_date)
  );

  if (Number.isNaN(endDate.getTime())) {
    return false;
  }

  endDate.setHours(23, 59, 59, 999);
  return endDate < getTodayStart_();
}

function compareUpcomingOverviewItems_(a, b) {
  return compareOverviewDateValues_(a.event_start_date, b.event_start_date) ||
    compareOverviewDateValues_(a.internal_deadline, b.internal_deadline) ||
    String(a.title || "").localeCompare(String(b.title || ""), "ja");
}

function comparePastOverviewItems_(a, b) {
  return compareOverviewDateValues_(b.event_start_date, a.event_start_date) ||
    compareOverviewDateValues_(b.internal_deadline, a.internal_deadline) ||
    String(a.title || "").localeCompare(String(b.title || ""), "ja");
}

function compareOverviewDateValues_(leftValue, rightValue) {
  const leftDate = parseDateValue_(leftValue);
  const rightDate = parseDateValue_(rightValue);
  const leftTime = leftDate.getTime();
  const rightTime = rightDate.getTime();
  const leftValid = !Number.isNaN(leftTime);
  const rightValid = !Number.isNaN(rightTime);

  if (leftValid && rightValid) {
    return leftTime - rightTime;
  }

  if (leftValid) {
    return -1;
  }

  if (rightValid) {
    return 1;
  }

  return 0;
}

function normalizeDateKey_(value) {
  const date = parseOverviewDateOnly_(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function parseOverviewDateOnly_(value) {
  const text = String(value || "").trim();

  if (!text) {
    return new Date("");
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const datePart = text.slice(0, 10);
    const parts = datePart.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  return parseDateValue_(text);
}

function getTodayStart_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function matchesVisibilityFilter(tournament) {
  const tournamentId = tournament.tournament_id;
  const canSubmitResponse = canSubmitTournamentResponse_(tournament);
  const savedResponse = state.savedResponsesByTournament[tournamentId] || {};
  const hasResponse = Boolean(savedResponse.response);
  const isApplied = String(tournament.status || "").trim() === "applied";

  if (state.visibilityFilter === "answered") {
    return canSubmitResponse && hasResponse;
  }

  if (state.visibilityFilter === "planned") {
    return isApplied && savedResponse.response === "yes";
  }

  if (state.visibilityFilter === "unanswered") {
    return canSubmitResponse && !hasResponse;
  }

  return true;
}

function uniqueStrings(values) {
  const seen = {};

  return (values || []).filter(function(value) {
    const normalized = String(value || "").trim();

    if (!normalized || seen[normalized]) {
      return false;
    }

    seen[normalized] = true;
    return true;
  });
}

function updateFilterButtons() {
  elements.filterButtons.forEach(function(button) {
    button.classList.toggle(
      "is-active",
      button.dataset.filter === state.visibilityFilter
    );
  });
}

function syncTournamentDraft(target) {
  const tournamentId = target.dataset.tournamentId;

  if (!tournamentId) {
    return;
  }

  const tournament = state.tournaments.find(function(item) {
    return item.tournament_id === tournamentId;
  });

  if (!canSubmitTournamentResponse_(tournament)) {
    return;
  }

  const current = state.draftResponsesByTournament[tournamentId] || {
    response: "",
    comment: "",
  };

  if (target.type === "radio") {
    current.response = target.value;
  }

  if (target.tagName === "TEXTAREA") {
    current.comment = target.value.trim();
  }

  state.draftResponsesByTournament[tournamentId] = current;

  if (target.type === "radio") {
    updateResponseOptionStyles_(target.closest(".tournament-card"));
  }
}

function renderEmptyState(message) {
  elements.tournamentList.innerHTML =
    '<div class="empty-state">' + escapeHtml(message) + "</div>";
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

function setMemberRequestStatus(message, type) {
  elements.memberRequestStatus.textContent = message;
  elements.memberRequestStatus.className = "member-request-status";

  if (type === "success") {
    elements.memberRequestStatus.classList.add("is-success");
  }

  if (type === "error") {
    elements.memberRequestStatus.classList.add("is-error");
  }
}

function disableForm() {
  elements.memberName.disabled = true;
  elements.submitButton.disabled = true;
  elements.submitMemberRequestButton.disabled = true;
  toggleTournamentInputs(true);
}

function enableForm() {
  elements.memberName.disabled = false;
  elements.submitButton.disabled = false;
  elements.submitMemberRequestButton.disabled = false;
  toggleTournamentInputs(false);
}

function toggleTournamentInputs(disabled) {
  const inputs = elements.form.querySelectorAll("input, textarea, button");
  inputs.forEach(function(input) {
    if (input.id !== "member-name" && input.id !== "submit-button") {
      input.disabled = disabled;
    }
  });
}

function setBusyState(isBusy, message) {
  state.isBusy = isBusy;
  syncBodyBusyState_();
  elements.busyOverlay.classList.toggle("is-hidden", !isBusy);
  elements.busyMessage.textContent = message || "読み込み中です...";
}

async function refreshResponsesAndOverview(memberName) {
  const selectedMemberName = memberName || elements.memberName.value.trim();

  if (!selectedMemberName) {
    return;
  }

  const publicData = await fetchPublicTournaments(state.pageToken);
  state.tournaments = publicData.tournaments || [];
  state.tournamentResponseOverview = publicData.tournament_response_overview || [];
  renderTournamentOverview();

  const selectedMember = getSelectedMember();
  if (selectedMember) {
    state.filteredTournaments = filterTournamentsForMember(
      state.tournaments,
      selectedMember
    );
  }

  state.savedResponsesByTournament = await fetchMemberResponses(
    state.pageToken,
    selectedMemberName
  );
  state.draftResponsesByTournament = cloneResponseMap_(
    state.savedResponsesByTournament
  );
  renderCurrentTournamentView();
}

function openSubmitConfirmDialog(responses) {
  const summaryHtml = responses.map(function(response) {
    const tournament = findTournamentById_(response.tournament_id);
    return (
      '<div class="confirm-summary-row">' +
        '<span class="confirm-summary-title">' +
          escapeHtml(tournament ? tournament.title || "無題" : response.tournament_id) +
        "</span>" +
        '<span class="confirm-summary-response">' +
          escapeHtml(formatResponseLabel_(response.response)) +
        "</span>" +
      "</div>"
    );
  }).join("");

  elements.confirmSummary.innerHTML = summaryHtml;
  elements.confirmOverlay.classList.remove("is-hidden");
  syncBodyBusyState_();

  return new Promise(function(resolve) {
    state.submitConfirmResolver = resolve;
  });
}

function resolveSubmitConfirm(confirmed) {
  if (!state.submitConfirmResolver) {
    return;
  }

  elements.confirmOverlay.classList.add("is-hidden");
  syncBodyBusyState_();
  const resolver = state.submitConfirmResolver;
  state.submitConfirmResolver = null;
  resolver(Boolean(confirmed));
}

function showResultOverlay_(title, message, onClose) {
  elements.resultTitle.textContent = title || "処理結果";
  elements.resultMessage.textContent = message || "";
  state.resultOverlayOnClose = typeof onClose === "function" ? onClose : null;
  elements.resultOverlay.classList.remove("is-hidden");
  syncBodyBusyState_();
}

function closeResultOverlay_() {
  const onClose = state.resultOverlayOnClose;
  state.resultOverlayOnClose = null;
  elements.resultOverlay.classList.add("is-hidden");
  syncBodyBusyState_();

  if (typeof onClose === "function") {
    onClose();
  }
}

function syncBodyBusyState_() {
  document.body.classList.toggle(
    "is-busy",
    Boolean(state.isBusy) ||
    isOverlayOpen_(elements.confirmOverlay) ||
    isOverlayOpen_(elements.resultOverlay)
  );
}

function isOverlayOpen_(element) {
  return Boolean(element) && !element.classList.contains("is-hidden");
}

function findTournamentById_(tournamentId) {
  return state.tournaments.find(function(tournament) {
    return tournament.tournament_id === tournamentId;
  }) || null;
}

function formatResponseLabel_(response) {
  if (response === "yes") {
    return "参加";
  }

  if (response === "maybe") {
    return "未定";
  }

  if (response === "no") {
    return "不参加";
  }

  return response || "";
}

function buildMemberRequestResultMessage_(payload) {
  const memberName = [
    String(payload.last_name || "").trim(),
    String(payload.first_name || "").trim(),
  ].join("");

  return memberName ?
    memberName + " の追加申請を受け付けました。" :
    "メンバー追加申請を受け付けました。";
}

function cloneResponseMap_(source) {
  return Object.keys(source || {}).reduce(function(result, key) {
    result[key] = {
      response: source[key].response || "",
      comment: source[key].comment || "",
      updated_at: source[key].updated_at || "",
    };
    return result;
  }, {});
}

function updateResponseOptionStyles_(card) {
  if (!card) {
    return;
  }

  const options = card.querySelectorAll(".response-option");
  options.forEach(function(option) {
    const input = option.querySelector('input[type="radio"]');
    option.classList.toggle("is-selected", Boolean(input && input.checked));
  });
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = parseDateValue_(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function parseDateValue_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return new Date(value.getTime());
  }

  const text = String(value || "").trim();
  if (!text) {
    return new Date("");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts = text.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  return new Date(text);
}

function renderMemberRequestChoiceChips_() {
  renderChoiceChipGroup_(
    elements.requestRankChips,
    "rank",
    MEMBER_REQUEST_RANK_OPTIONS
  );
  renderChoiceChipGroup_(
    elements.requestGradeChips,
    "grade",
    MEMBER_REQUEST_GRADE_OPTIONS
  );
}

function renderChoiceChipGroup_(container, type, options) {
  if (!container) {
    return;
  }

  container.innerHTML = (options || []).map(function(option) {
    return (
      '<button type="button" class="choice-chip" data-choice-type="' +
      escapeHtml(type) + '" data-choice-value="' + escapeHtml(option.value) + '">' +
      escapeHtml(option.label) +
      "</button>"
    );
  }).join("");

  container.querySelectorAll(".choice-chip").forEach(function(button) {
    button.addEventListener("click", function() {
      syncMemberRequestChoiceValue_(
        button.dataset.choiceType || "",
        button.dataset.choiceValue || ""
      );
    });
  });

  syncChoiceChipSelection_(type);
}

function syncMemberRequestChoiceValue_(type, value) {
  if (type === "rank" && elements.requestRank) {
    elements.requestRank.value = value || "";
  }

  if (type === "grade" && elements.requestGrade) {
    elements.requestGrade.value = value || "";
  }

  syncChoiceChipSelection_(type);
}

function syncChoiceChipSelection_(type) {
  const container = type === "rank" ?
    elements.requestRankChips :
    elements.requestGradeChips;
  const currentValue = type === "rank" ?
    String(elements.requestRank.value || "") :
    String(elements.requestGrade.value || "");

  if (!container) {
    return;
  }

  container.querySelectorAll(".choice-chip").forEach(function(button) {
    button.classList.toggle(
      "is-selected",
      String(button.dataset.choiceValue || "") === currentValue
    );
  });
}

function normalizeGradeLabel(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/級$/, "")
    .toUpperCase();

  if (normalized === "BEGINNER" || normalized === "初心者") {
    return "BEGINNER";
  }

  return normalized;
}

function getMemberGradeSortIndex_(grade) {
  const normalized = normalizeMemberGradeValue_(grade);
  const index = MEMBER_GRADE_OPTIONS.indexOf(normalized);
  return index === -1 ? MEMBER_GRADE_OPTIONS.length : index;
}

function normalizeMemberGradeValue_(grade) {
  const normalized = String(grade || "").trim();
  return normalized === "初心者" ? "beginner" : normalized;
}

function formatOverviewGradeLabel(grade) {
  if (!grade || grade === "未登録") {
    return "未登録";
  }

  return String(grade).endsWith("級") ? String(grade) : String(grade) + "級";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
