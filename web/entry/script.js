const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzlYunO5FHWb75UXJCU8opm9nassYo74nQdlSKg-XXTntea6hEzq87konXxHEfzWsvf/exec";

const state = {
  pageToken: "",
  members: [],
  tournaments: [],
  filteredTournaments: [],
};

const elements = {
  form: document.getElementById("entry-form"),
  memberName: document.getElementById("member-name"),
  pageTitle: document.getElementById("page-title"),
  pageDescription: document.getElementById("page-description"),
  tournamentList: document.getElementById("tournament-list"),
  statusMessage: document.getElementById("status-message"),
  submitButton: document.getElementById("submit-button"),
  tournamentTemplate: document.getElementById("tournament-template"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const url = new URL(window.location.href);
  const pageToken = url.searchParams.get("page_token") || "";
  state.pageToken = pageToken;

  if (!pageToken) {
    showStatus("page_token が指定されていません。", "error");
    renderEmptyState("URL が正しいか確認してください。");
    disableForm();
    return;
  }

  showStatus("大会情報を読み込んでいます...", "");
  disableForm();

  try {
    const data = await fetchPublicTournaments(pageToken);
    state.members = data.members || [];
    state.tournaments = data.tournaments || [];
    renderPage(data.page || {});
    renderMemberOptions(state.members);
    state.filteredTournaments = [];
    renderEmptyState("名前を選ぶと、対象の大会だけ表示されます。");
    showStatus("名前を選択してください。", "");
    enableForm();
  } catch (error) {
    renderEmptyState("大会情報を取得できませんでした。");
    showStatus(error.message || "読み込みに失敗しました。", "error");
    disableForm();
  }
}

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

  disableForm();
  showStatus("回答を送信しています...", "");

  try {
    const result = await submitResponses({
      page_token: state.pageToken,
      member_name: memberName,
      responses: responses,
    });

    showStatus(
      result.updated_count + " 件の回答を保存しました。",
      "success"
    );
  } catch (error) {
    showStatus(error.message || "送信に失敗しました。", "error");
  } finally {
    enableForm();
  }
});

elements.memberName.addEventListener("change", function() {
  const selectedMember = getSelectedMember();

  if (!selectedMember) {
    state.filteredTournaments = [];
    renderEmptyState("名前を選ぶと、対象の大会だけ表示されます。");
    showStatus("名前を選択してください。", "");
    return;
  }

  state.filteredTournaments = filterTournamentsForMember(
    state.tournaments,
    selectedMember
  );
  renderTournaments(state.filteredTournaments);

  if (state.filteredTournaments.length === 0) {
    showStatus("該当する大会はありません。", "");
  } else {
    showStatus("", "");
  }
});

async function fetchPublicTournaments(pageToken) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", "list_public_tournaments");
  url.searchParams.set("page_token", pageToken);

  const response = await fetch(url.toString(), {
    method: "GET",
  });
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "大会情報の取得に失敗しました。");
  }

  return data;
}

async function submitResponses(payload) {
  const response = await fetch(API_BASE_URL, {
    method: "POST",
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
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "回答の保存に失敗しました。");
  }

  return data;
}

function renderPage(page) {
  if (page.title) {
    elements.pageTitle.textContent = page.title;
  }

  if (page.description) {
    elements.pageDescription.textContent = page.description;
  }
}

function renderMemberOptions(members) {
  elements.memberName.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選択してください";
  elements.memberName.appendChild(placeholder);

  members.forEach(function(member) {
    const option = document.createElement("option");
    option.value = member.display_name;
    option.textContent = member.grade ?
      member.display_name + " (" + member.grade + ")" :
      member.display_name;
    elements.memberName.appendChild(option);
  });
}

function renderTournaments(tournaments) {
  elements.tournamentList.innerHTML = "";

  if (!tournaments.length) {
    renderEmptyState("現在回答対象の大会はありません。");
    return;
  }

  tournaments.forEach(function(tournament) {
    const fragment = elements.tournamentTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".tournament-card");

    fragment.querySelector(".tournament-title").textContent = tournament.title;
    fragment.querySelector(".tournament-meta").textContent =
      "締切までの回答にご協力ください";
    fragment.querySelector(".event-date").textContent =
      tournament.event_date_label || "-";
    fragment.querySelector(".grades").textContent =
      tournament.grades || "-";
    fragment.querySelector(".internal-deadline").textContent =
      formatDateTime(tournament.internal_deadline);

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
    });

    const textarea = fragment.querySelector("textarea");
    textarea.dataset.tournamentId = tournament.tournament_id;

    card.dataset.tournamentId = tournament.tournament_id;
    elements.tournamentList.appendChild(fragment);
  });
}

function collectResponses() {
  return state.filteredTournaments.reduce(function(result, tournament) {
    const selected = document.querySelector(
      'input[name="response-' + tournament.tournament_id + '"]:checked'
    );

    if (!selected) {
      return result;
    }

    const commentField = document.querySelector(
      'textarea[data-tournament-id="' + tournament.tournament_id + '"]'
    );

    result.push({
      tournament_id: tournament.tournament_id,
      response: selected.value,
      comment: commentField ? commentField.value.trim() : "",
    });

    return result;
  }, []);
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

function disableForm() {
  elements.memberName.disabled = true;
  elements.submitButton.disabled = true;
  toggleTournamentInputs(true);
}

function enableForm() {
  elements.memberName.disabled = false;
  elements.submitButton.disabled = false;
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

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
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

function normalizeGradeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/級$/, "")
    .toUpperCase();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
