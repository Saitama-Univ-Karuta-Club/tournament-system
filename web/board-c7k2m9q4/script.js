const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzlYunO5FHWb75UXJCU8opm9nassYo74nQdlSKg-XXTntea6hEzq87konXxHEfzWsvf/exec";

const DEFAULT_ENTRY_PAGE_TOKEN = "2026-entry";
const TOURNAMENT_GRADE_OPTIONS = ["A", "B", "C", "D", "E", "F", "初心者"];
const MEMBER_GRADE_OPTIONS = ["A", "B", "C", "D", "E", "F", "beginner"];

const state = {
  adminToken: "",
  isAuthorized: false,
  tournaments: [],
  members: [],
  managers: [],
  settings: {},
  tournamentResponseOverview: [],
  tournamentResponseSort: "internal_deadline",
  tournamentListFilters: {
    open: true,
    applied: false,
    closed: false,
  },
  memberListFilters: {
    active: true,
    inactive: false,
    pending: false,
    rejected: false,
  },
  selectedTournamentId: "",
  isTournamentEditModalOpen: false,
  editingMemberId: "",
  primaryTab: "tournaments",
  settingsMode: "settings-links",
  tournamentMode: "tournament-create",
  memberMode: "member-create",
  isBusy: false,
  isAuthBusy: false,
  internalDeadlineManuallyEdited: false,
  gradeScheduleOverrides: {},
  resultOverlayOnClose: null,
};

const elements = {
  primaryTabs: document.querySelectorAll(".primary-tab"),
  panels: document.querySelectorAll("[data-panel]"),
  secondaryTabs: document.querySelectorAll(".secondary-tab"),
  subpanels: document.querySelectorAll("[data-subpanel]"),
  tournamentList: document.getElementById("tournament-list"),
  tournamentFollowupList: document.getElementById("tournament-followup-list"),
  tournamentFollowupCount: document.getElementById("tournament-followup-count"),
  memberList: document.getElementById("member-list"),
  pendingMemberPanel: document.getElementById("pending-member-panel"),
  pendingMemberCount: document.getElementById("pending-member-count"),
  pendingMemberList: document.getElementById("pending-member-list"),
  tournamentCreateHost: document.getElementById("tournament-create-host"),
  tournamentDetailHost: document.getElementById("tournament-detail-host"),
  tournamentDetailNote: document.getElementById("tournament-detail-note"),
  tournamentListFilters: document.querySelectorAll("[data-tournament-list-filter]"),
  memberListFilters: document.querySelectorAll("[data-member-list-filter]"),
  tournamentResponseOverviewHost: document.getElementById("tournament-response-overview-host"),
  tournamentResponseSort: document.getElementById("tournament-response-sort"),
  memberCreateHost: document.getElementById("member-create-host"),
  statusMessage: document.getElementById("status-message"),
  busyOverlay: document.getElementById("busy-overlay"),
  busyMessage: document.getElementById("busy-message"),
  authOverlay: document.getElementById("auth-overlay"),
  authForm: document.getElementById("auth-form"),
  authTokenInput: document.getElementById("auth-token-input"),
  authMessage: document.getElementById("auth-message"),
  authBusyIndicator: document.getElementById("auth-busy-indicator"),
  authBusyMessage: document.getElementById("auth-busy-message"),
  authSubmitButton: document.getElementById("auth-submit-button"),
  resultOverlay: document.getElementById("result-overlay"),
  resultTitle: document.getElementById("result-title"),
  resultMessage: document.getElementById("result-message"),
  resultCloseButton: document.getElementById("result-close-button"),
  tournamentEditOverlay: document.getElementById("tournament-edit-overlay"),
  tournamentEditHost: document.getElementById("tournament-edit-host"),
  tournamentEditCloseButton: document.getElementById("tournament-edit-close-button"),
  tournamentEditCancelButton: document.getElementById("tournament-edit-cancel-button"),
  memberEditOverlay: document.getElementById("member-edit-overlay"),
  memberEditForm: document.getElementById("member-edit-form"),
  memberEditCloseButton: document.getElementById("member-edit-close-button"),
  memberEditCancelButton: document.getElementById("member-edit-cancel-button"),
  tournamentForm: document.getElementById("tournament-form"),
  memberForm: document.getElementById("member-form"),
  resetTournamentButton: document.getElementById("reset-tournament-button"),
  sendAnnouncementButton: document.getElementById("send-announcement-button"),
  resetMemberButton: document.getElementById("reset-member-button"),
  briefUploadDropzone: document.getElementById("brief-upload-dropzone"),
  briefUploadInput: document.getElementById("brief-upload-input"),
  briefUploadStatus: document.getElementById("brief-upload-status"),
  tournamentId: document.getElementById("tournament-id"),
  tournamentTitle: document.getElementById("tournament-title"),
  eventStartDate: document.getElementById("event-start-date"),
  eventEndDate: document.getElementById("event-end-date"),
  grades: document.getElementById("grades"),
  gradesSelector: document.getElementById("grades-selector"),
  trueDeadlineDate: document.getElementById("true-deadline-date"),
  trueDeadlineTime: document.getElementById("true-deadline-time"),
  internalDeadlineDate: document.getElementById("internal-deadline-date"),
  internalDeadlineTime: document.getElementById("internal-deadline-time"),
  gradeScheduleSettings: document.getElementById("grade-schedule-settings"),
  venue: document.getElementById("venue"),
  driveUrl: document.getElementById("drive-url"),
  entryPageToken: document.getElementById("entry-page-token"),
  entryUrl: document.getElementById("entry-url"),
  managerName: document.getElementById("manager-name"),
  managerLineUserId: document.getElementById("manager-line-user-id"),
  tournamentType: document.getElementById("tournament-type"),
  tournamentStatus: document.getElementById("tournament-status"),
  memberId: document.getElementById("member-id"),
  memberLastName: document.getElementById("member-last-name"),
  memberLastNameKana: document.getElementById("member-last-name-kana"),
  memberFirstName: document.getElementById("member-first-name"),
  memberFirstNameKana: document.getElementById("member-first-name-kana"),
  memberRank: document.getElementById("member-rank"),
  memberGrade: document.getElementById("member-grade"),
  memberStatus: document.getElementById("member-status"),
  memberEditId: document.getElementById("member-edit-id"),
  memberEditLastName: document.getElementById("member-edit-last-name"),
  memberEditLastNameKana: document.getElementById("member-edit-last-name-kana"),
  memberEditFirstName: document.getElementById("member-edit-first-name"),
  memberEditFirstNameKana: document.getElementById("member-edit-first-name-kana"),
  memberEditRank: document.getElementById("member-edit-rank"),
  memberEditGrade: document.getElementById("member-edit-grade"),
  memberEditStatus: document.getElementById("member-edit-status"),
  settingsForm: document.getElementById("settings-form"),
  lineBotSettingsForm: document.getElementById("line-bot-settings-form"),
  lineMessageSettingsForm: document.getElementById("line-message-settings-form"),
  resetSettingsButton: document.getElementById("reset-settings-button"),
  resetLineBotSettingsButton: document.getElementById("reset-line-bot-settings-button"),
  resetLineMessageSettingsButton: document.getElementById("reset-line-message-settings-button"),
  saveAndSendAnnouncementButton: document.getElementById("save-and-send-announcement-button"),
  sendLineTemplateTestButton: document.getElementById("send-line-template-test-button"),
  reloadAdminSettingsButton: document.getElementById("reload-admin-settings-button"),
  installScheduledTriggersButton: document.getElementById("install-scheduled-triggers-button"),
  linePlaceholderButtons: document.querySelectorAll("[data-line-placeholder]"),
  settingsDriveFolderUrl: document.getElementById("settings-drive-folder-url"),
  settingsAnnualSchedulePreviewUrl: document.getElementById("settings-annual-schedule-preview-url"),
  settingsAnnualScheduleViewUrl: document.getElementById("settings-annual-schedule-view-url"),
  settingsWebBaseUrl: document.getElementById("settings-web-base-url"),
  settingsAdminPageUrl: document.getElementById("settings-admin-page-url"),
  settingsDefaultEntryPageToken: document.getElementById("settings-default-entry-page-token"),
  settingsLineGroupId: document.getElementById("settings-line-group-id"),
  settingsLineTestGroupId: document.getElementById("settings-line-test-group-id"),
  settingsCalendarId: document.getElementById("settings-calendar-id"),
  settingsCalendarEmbedUrl: document.getElementById("settings-calendar-embed-url"),
  settingsCalendarViewUrl: document.getElementById("settings-calendar-view-url"),
  calendarFrame: document.getElementById("calendar-frame"),
  calendarLink: document.getElementById("calendar-link"),
  calendarSettingsButton: document.getElementById("calendar-settings-button"),
  settingsDailyAnnouncementTime: document.getElementById("settings-daily-announcement-time"),
  settingsTournamentReminderTime: document.getElementById("settings-tournament-reminder-time"),
  settingsPendingMemberSummaryTime: document.getElementById("settings-pending-member-summary-time"),
  settingsNightlyAutomationTime: document.getElementById("settings-nightly-automation-time"),
  lineTemplateAnnouncement: document.getElementById("line-template-announcement"),
  lineTemplateGroupReminder: document.getElementById("line-template-group-reminder"),
  lineTemplateManagerInternalDeadline: document.getElementById("line-template-manager-internal-deadline"),
  lineTemplateManagerTrueDeadline: document.getElementById("line-template-manager-true-deadline"),
  lineTemplateAppliedNotification: document.getElementById("line-template-applied-notification"),
  lineTemplateMemberRegistrationRequest: document.getElementById("line-template-member-registration-request"),
  lineTemplatePendingMemberSummary: document.getElementById("line-template-pending-member-summary"),
  lineTemplateTestKey: document.getElementById("line-template-test-key"),
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
    if (key.startsWith("settings-")) {
      state.settingsMode = key;
    }
    renderTabs();
  });
});

if (elements.tournamentResponseSort) {
  elements.tournamentResponseSort.addEventListener("change", function() {
    state.tournamentResponseSort = elements.tournamentResponseSort.value || "internal_deadline";
    renderTournamentResponseOverview();
  });
}

elements.tournamentListFilters.forEach(function(input) {
  input.addEventListener("change", function() {
    state.tournamentListFilters[input.dataset.tournamentListFilter] = input.checked;
    renderTournamentList();
  });
});

elements.memberListFilters.forEach(function(input) {
  input.addEventListener("change", function() {
    state.memberListFilters[input.dataset.memberListFilter] = input.checked;
    renderMemberList();
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
    setBusyState(true, "LINE通知を送信しています...");
    const adminToken = getLineAdminToken();
    await postJson({
      action: "send_announcement",
      admin_token: adminToken,
      tournament_ids: [tournamentId],
    });
    showStatus("LINEグループへ更新通知を送信しました。", "success");
    setBusyState(false);
    showResultOverlay_("送信しました", "LINEグループへ更新通知を送信しました。");
  } catch (error) {
    showStatus(error.message || "LINE通知の送信に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("送信できませんでした", error.message || "LINE通知の送信に失敗しました。");
  }
});

elements.resetMemberButton.addEventListener("click", function() {
  resetMemberForm();
});

elements.calendarSettingsButton.addEventListener("click", function() {
  state.primaryTab = "settings";
  state.settingsMode = "settings-links";
  renderTabs();
  elements.settingsCalendarId.focus();
});

elements.resetSettingsButton.addEventListener("click", function() {
  populateSettingsForm();
});

elements.resetLineBotSettingsButton.addEventListener("click", function() {
  populateLineBotSettingsForm_();
});

elements.resetLineMessageSettingsButton.addEventListener("click", function() {
  populateLineMessageSettingsForm_();
});

elements.linePlaceholderButtons.forEach(function(button) {
  button.addEventListener("click", function() {
    insertLinePlaceholder_(button.dataset.linePlaceholder || "");
  });
});

elements.reloadAdminSettingsButton.addEventListener("click", async function() {
  try {
    setBusyState(true, "設定を再読み込みしています...");
    await loadAdminData();
    state.primaryTab = "settings";
    state.settingsMode = "settings-admin-ops";
    renderTabs();
    showStatus("設定を再読み込みしました。", "success");
    setBusyState(false);
    showResultOverlay_("再読み込みしました", "Apps Script 側の最新設定を読み込みました。");
  } catch (error) {
    showStatus(error.message || "設定の再読み込みに失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("再読み込みできませんでした", error.message || "設定の再読み込みに失敗しました。");
  }
});

elements.installScheduledTriggersButton.addEventListener("click", async function() {
  try {
    setBusyState(true, "定期トリガーを再作成しています...");
    const result = await postJson({
      action: "install_scheduled_triggers",
    });
    await loadAdminData();
    state.primaryTab = "settings";
    state.settingsMode = "settings-admin-ops";
    renderTabs();
    showStatus("定期トリガーを再作成しました。", "success");
    setBusyState(false);
    showResultOverlay_(
      "再作成しました",
      buildScheduledTriggerResultMessage_(result.triggers || {})
    );
  } catch (error) {
    showStatus(error.message || "定期トリガーの再作成に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("再作成できませんでした", error.message || "定期トリガーの再作成に失敗しました。");
  }
});

elements.authForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  await authorizeAdminAccess_(elements.authTokenInput.value.trim());
});

elements.resultCloseButton.addEventListener("click", function() {
  closeResultOverlay_();
});

elements.tournamentEditCloseButton.addEventListener("click", function() {
  closeTournamentEditModal_();
});

elements.tournamentEditCancelButton.addEventListener("click", function() {
  closeTournamentEditModal_();
});

elements.memberEditCloseButton.addEventListener("click", function() {
  closeMemberEditModal_();
});

elements.memberEditCancelButton.addEventListener("click", function() {
  closeMemberEditModal_();
});

elements.briefUploadDropzone.addEventListener("click", function() {
  elements.briefUploadInput.click();
});

elements.briefUploadDropzone.addEventListener("keydown", function(event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.briefUploadInput.click();
  }
});

elements.briefUploadDropzone.addEventListener("dragover", function(event) {
  event.preventDefault();
  elements.briefUploadDropzone.classList.add("is-dragover");
});

elements.briefUploadDropzone.addEventListener("dragleave", function() {
  elements.briefUploadDropzone.classList.remove("is-dragover");
});

elements.briefUploadDropzone.addEventListener("drop", function(event) {
  event.preventDefault();
  elements.briefUploadDropzone.classList.remove("is-dragover");

  const files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length) {
    handleBriefFile(files[0]);
  }
});

elements.briefUploadInput.addEventListener("change", function() {
  if (elements.briefUploadInput.files && elements.briefUploadInput.files.length) {
    handleBriefFile(elements.briefUploadInput.files[0]);
  }
});

elements.eventStartDate.addEventListener("change", function() {
  elements.eventEndDate.value = elements.eventStartDate.value;
  renderGradeScheduleSettings();
});

elements.trueDeadlineDate.addEventListener("change", function() {
  syncInternalDeadlineDefault();
  renderGradeScheduleSettings();
});

elements.trueDeadlineTime.addEventListener("change", function() {
  syncInternalDeadlineDefault();
  renderGradeScheduleSettings();
});

elements.internalDeadlineDate.addEventListener("input", function() {
  state.internalDeadlineManuallyEdited = true;
});

elements.internalDeadlineTime.addEventListener("input", function() {
  state.internalDeadlineManuallyEdited = true;
});

elements.internalDeadlineDate.addEventListener("change", function() {
  state.internalDeadlineManuallyEdited = true;
  renderGradeScheduleSettings();
});

elements.internalDeadlineTime.addEventListener("change", function() {
  state.internalDeadlineManuallyEdited = true;
  renderGradeScheduleSettings();
});

elements.managerName.addEventListener("change", function() {
  syncSelectedManagerFields();
});

elements.entryPageToken.addEventListener("input", function() {
  syncEntryUrlField_();
});

elements.tournamentForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  const wasEditingInModal = state.isTournamentEditModalOpen;

  const selectedManager = getSelectedManager();

  const payload = {
    title: elements.tournamentTitle.value.trim(),
    event_start_date: elements.eventStartDate.value,
    event_end_date: elements.eventStartDate.value,
    grades: getSelectedTournamentGrades().join(","),
    tournament_type: elements.tournamentType.value,
    is_official: elements.tournamentType.value === "official",
    venue: elements.venue.value.trim(),
    true_deadline: toApiDateTimeValue(
      elements.trueDeadlineDate.value,
      elements.trueDeadlineTime.value
    ),
    internal_deadline: toApiDateTimeValue(
      elements.internalDeadlineDate.value,
      elements.internalDeadlineTime.value
    ),
    drive_url: elements.driveUrl.value.trim(),
    entry_page_token: elements.entryPageToken.value.trim(),
    entry_url: elements.entryUrl.value.trim(),
    manager_name: selectedManager ? selectedManager.manager_name : "",
    manager_line_user_id: selectedManager ? selectedManager.line_user_id : "",
    status: elements.tournamentStatus.value,
  };
  const gradeConfigs = buildTournamentGradeConfigsPayload();

  if (wasEditingInModal) {
    closeTournamentEditModal_(true);
  }

  try {
    setBusyState(true, "大会情報を保存中です...");
    const result = await postJson({
      action: "upsert_tournament_batch",
      tournament: payload,
      grade_configs: gradeConfigs,
    });
    await loadAdminData();
    if (!wasEditingInModal) {
      state.primaryTab = "tournaments";
      state.tournamentMode = "tournament-create";
      resetTournamentForm();
      renderTabs();
    }
    const successMessage = buildTournamentSaveMessage(result);
    showStatus(successMessage, "success");
    setBusyState(false);
    showResultOverlay_("保存しました", successMessage, function() {
      if (!wasEditingInModal) {
        elements.tournamentTitle.focus();
      }
    });
  } catch (error) {
    showStatus(error.message || "大会情報の保存に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_(
      "保存できませんでした",
      error.message || "大会情報の保存に失敗しました。",
      function() {
        if (wasEditingInModal) {
          reopenTournamentEditModal_();
          elements.tournamentTitle.focus();
        }
      }
    );
  }
});

elements.memberForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  const payload = {
    member_id: elements.memberId.value.trim(),
    last_name: elements.memberLastName.value.trim(),
    last_name_kana: elements.memberLastNameKana.value.trim(),
    first_name: elements.memberFirstName.value.trim(),
    first_name_kana: elements.memberFirstNameKana.value.trim(),
    rank: elements.memberRank.value.trim(),
    grade: getSelectedMemberGrade(),
    status: elements.memberStatus.value,
  };

  try {
    setBusyState(true, "メンバー情報を保存中です...");
    await postJson({
      action: "upsert_member",
      member: payload,
    });
    await loadAdminData();
    state.primaryTab = "members";
    state.memberMode = "member-create";
    resetMemberForm();
    renderTabs();
    showStatus("メンバー情報を保存しました。", "success");
    setBusyState(false);
    showResultOverlay_(
      "保存しました",
      buildMemberSavedMessage_(payload, "を追加しました。"),
      function() {
        state.primaryTab = "members";
        state.memberMode = "member-create";
        renderTabs();
        elements.memberLastName.focus();
      }
    );
  } catch (error) {
    showStatus(error.message || "メンバー情報の保存に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("保存できませんでした", error.message || "メンバー情報の保存に失敗しました。");
  }
});

elements.memberEditForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  const payload = buildMemberEditPayload_();
  closeMemberEditModal_(true);

  try {
    setBusyState(true, "メンバー情報を保存中です...");
    await postJson({
      action: "upsert_member",
      member: payload,
    });
    await loadAdminData();
    showStatus("メンバー情報を更新しました。", "success");
    setBusyState(false);
    showResultOverlay_(
      "保存しました",
      buildMemberSavedMessage_(payload, "を更新しました。"),
      function() {
        state.editingMemberId = "";
      }
    );
  } catch (error) {
    showStatus(error.message || "メンバー情報の保存に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_(
      "保存できませんでした",
      error.message || "メンバー情報の保存に失敗しました。",
      function() {
        reopenMemberEditModal_();
        elements.memberEditLastName.focus();
      }
    );
  }
});

elements.settingsForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  const payload = {
    drive_folder_url: elements.settingsDriveFolderUrl.value.trim(),
    annual_schedule_preview_url: elements.settingsAnnualSchedulePreviewUrl.value.trim(),
    annual_schedule_view_url: elements.settingsAnnualScheduleViewUrl.value.trim(),
    web_base_url: elements.settingsWebBaseUrl.value.trim(),
    admin_page_url: elements.settingsAdminPageUrl.value.trim(),
    default_entry_page_token: elements.settingsDefaultEntryPageToken.value.trim(),
    calendar_id: elements.settingsCalendarId.value.trim(),
    calendar_embed_url: elements.settingsCalendarEmbedUrl.value.trim(),
    calendar_view_url: elements.settingsCalendarViewUrl.value.trim(),
  };

  try {
    setBusyState(true, "設定を保存中です...");
    await postJson({
      action: "update_admin_settings",
      settings: payload,
    });
    await loadAdminData();
    state.primaryTab = "settings";
    renderTabs();
    showStatus("設定を保存しました。", "success");
    setBusyState(false);
    showResultOverlay_("保存しました", "設定を保存しました。", function() {
      elements.settingsDriveFolderUrl.focus();
    });
  } catch (error) {
    showStatus(error.message || "設定の保存に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("保存できませんでした", error.message || "設定の保存に失敗しました。");
  }
});

elements.lineBotSettingsForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  const payload = {
    line_group_id: elements.settingsLineGroupId.value.trim(),
    line_test_group_id: elements.settingsLineTestGroupId.value.trim(),
    daily_announcement_time: elements.settingsDailyAnnouncementTime.value.trim(),
    tournament_reminder_time: elements.settingsTournamentReminderTime.value.trim(),
    pending_member_summary_time: elements.settingsPendingMemberSummaryTime.value.trim(),
    nightly_automation_time: elements.settingsNightlyAutomationTime.value.trim(),
  };

  try {
    setBusyState(true, "LINE bot設定を保存中です...");
    await postJson({
      action: "update_admin_settings",
      settings: payload,
    });
    await loadAdminData();
    state.primaryTab = "settings";
    state.settingsMode = "settings-line-bot";
    renderTabs();
    showStatus("LINE bot設定を保存しました。", "success");
    setBusyState(false);
    showResultOverlay_("保存しました", "LINE bot設定を保存しました。トリガー時刻を変えた場合は、管理者操作から定期トリガーを再作成してください。", function() {
      elements.settingsLineGroupId.focus();
    });
  } catch (error) {
    showStatus(error.message || "LINE bot設定の保存に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("保存できませんでした", error.message || "LINE bot設定の保存に失敗しました。");
  }
});

elements.lineMessageSettingsForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  try {
    setBusyState(true, "LINE配信文面を保存中です...");
    await saveLineMessageTemplates_();
    await loadAdminData();
    state.primaryTab = "settings";
    state.settingsMode = "settings-line-messages";
    renderTabs();
    showStatus("LINE配信文面を保存しました。", "success");
    setBusyState(false);
    showResultOverlay_("保存しました", "LINE配信文面を保存しました。", function() {
      elements.lineTemplateAnnouncement.focus();
    });
  } catch (error) {
    showStatus(error.message || "LINE配信文面の保存に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("保存できませんでした", error.message || "LINE配信文面の保存に失敗しました。");
  }
});

elements.saveAndSendAnnouncementButton.addEventListener("click", async function() {
  try {
    setBusyState(true, "LINE配信文面を保存して更新通知を送信しています...");
    await saveLineMessageTemplates_();
    const result = await postJson({
      action: "send_scheduled_daily_announcements",
    });
    await loadAdminData();
    state.primaryTab = "settings";
    state.settingsMode = "settings-line-messages";
    renderTabs();

    if (result.sent) {
      const count = (result.tournament_ids || []).length;
      showStatus("LINE配信文面を保存し、大会情報更新通知を送信しました。", "success");
      setBusyState(false);
      showResultOverlay_(
        "送信しました",
        "LINE配信文面を保存し、大会情報更新通知を送信しました。対象大会: " + count + "件"
      );
      return;
    }

    showStatus("LINE配信文面を保存しました。送信対象の大会はありませんでした。", "success");
    setBusyState(false);
    showResultOverlay_(
      "保存しました",
      "LINE配信文面を保存しました。送信対象の大会はありませんでした。"
    );
  } catch (error) {
    showStatus(error.message || "LINE配信文面の保存または送信に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("処理できませんでした", error.message || "LINE配信文面の保存または送信に失敗しました。");
  }
});

elements.sendLineTemplateTestButton.addEventListener("click", async function() {
  const templateKey = elements.lineTemplateTestKey.value;

  try {
    setBusyState(true, "LINE配信文面を保存してテストグループへ送信しています...");
    await saveLineMessageTemplates_();
    const result = await postJson({
      action: "send_line_template_test",
      template_key: templateKey,
    });
    await loadAdminData();
    state.primaryTab = "settings";
    state.settingsMode = "settings-line-messages";
    renderTabs();
    showStatus("テストグループへLINE配信文面を送信しました。", "success");
    setBusyState(false);
    showResultOverlay_(
      "テスト送信しました",
      "テストグループへ送信しました。\n送信先: " + (result.group_id || "-")
    );
  } catch (error) {
    showStatus(error.message || "テスト送信に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("テスト送信できませんでした", error.message || "テスト送信に失敗しました。");
  }
});

async function init() {
  attachFormsToHosts();
  renderTournamentGradeSelector();
  renderTabs();
  resetTournamentForm();
  resetMemberForm();
  openAuthOverlay_();
  const initialAdminToken = getInitialAdminToken_();

  if (initialAdminToken) {
    elements.authTokenInput.value = initialAdminToken;
    await authorizeAdminAccess_(initialAdminToken);
    return;
  }

  elements.authTokenInput.focus();
}

async function loadAdminData() {
  if (!state.adminToken) {
    throw new Error("管理用 token を入力してください。");
  }

  setBusyState(true, "管理データを読み込んでいます...");
  showStatus("管理データを読み込んでいます...", "");

  try {
    const data = await fetchJson("admin_bootstrap");

    state.settings = data.settings || {};
    state.tournaments = data.tournaments || [];
    state.members = data.members || [];
    state.managers = data.managers || [];
    state.tournamentResponseOverview = data.tournament_response_overview || [];

    populateManagerOptions();
    populateSettingsForm();
    applyTournamentDefaultsIfNeeded_();
    renderTournamentList();
    renderTournamentFollowupList_();
    renderTournamentResponseOverview();
    renderPendingMemberRequests();
    renderMemberList();
    renderCalendarEmbed_();
    showStatus("", "");
  } catch (error) {
    showStatus(error.message || "管理データの取得に失敗しました。", "error");
    throw error;
  } finally {
    setBusyState(false);
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
      target === state.memberMode ||
      target === state.settingsMode;
    button.classList.toggle("is-active", isActive);
  });

  elements.subpanels.forEach(function(panel) {
    const target = panel.dataset.subpanel;
    const isActive =
      target === state.tournamentMode ||
      target === state.memberMode ||
      target === state.settingsMode;
    panel.classList.toggle("is-active", isActive);
  });

  syncFormPlacement();
  syncDetailEditors();
}

function renderTournamentList() {
  const visibleTournaments = getGroupedTournamentListItems_();

  if (!visibleTournaments.length) {
    elements.tournamentList.innerHTML = '<p class="empty-state">表示対象の大会がありません。</p>';
    return;
  }

  elements.tournamentList.innerHTML = visibleTournaments.map(function(item) {
    const statusTag = getTournamentStatusTag_(item.status);
    const applicantGroups = Array.isArray(item.applicant_groups) ?
      item.applicant_groups :
      [];
    const applicantCount = Number(item.applicant_count || 0);
    const isApplied = String(item.status || "").trim() === "applied";
    const applicantBody = applicantGroups.length ?
      applicantGroups.map(function(group) {
        return (
          '<div class="response-overview-grade-row">' +
            '<div class="response-overview-grade-label">' +
              escapeHtml(formatOverviewGradeLabel(group.grade)) +
            "</div>" +
            '<div class="response-overview-grade-names">' +
              escapeHtml((group.names || []).join("、")) +
            "</div>" +
          "</div>"
        );
      }).join("") :
      '<p class="response-overview-empty">申込希望者はいません。</p>';

    return (
      '<section class="response-overview-card">' +
        '<div class="response-overview-card-header">' +
          '<h4>' + escapeHtml(item.title || "無題") + "</h4>" +
          '<div class="response-overview-tag-row">' +
            '<span class="response-overview-status-tag is-' + escapeHtml(statusTag.key) + '">' +
              escapeHtml(statusTag.label) +
            "</span>" +
            '<span class="response-overview-count">' +
              escapeHtml(String(applicantCount)) + "名" +
            "</span>" +
          "</div>" +
        "</div>" +
        '<div class="response-overview-meta">' +
          '<span>大会日: ' + escapeHtml(buildEventDateLabel_(item)) + "</span>" +
          '<span>締切日: ' + escapeHtml(formatDateTimeLabel_(item.internal_deadline)) + "</span>" +
          '<span>開催級: ' + escapeHtml(item.grades || "級制限なし") + "</span>" +
        "</div>" +
        '<div class="response-overview-content">' +
          '<div class="response-overview-body">' +
            applicantBody +
          "</div>" +
          '<div class="response-overview-actions response-overview-actions-side">' +
            '<button type="button" class="response-toggle-button' +
              (isApplied ? " is-active" : "") +
              '" data-applied-toggle-ids="' +
                escapeHtml((item.tournament_ids || []).join(",")) +
              '" aria-pressed="' + escapeHtml(String(isApplied)) + '">' +
              '<span class="response-toggle-track">' +
                '<span class="response-toggle-thumb"></span>' +
              "</span>" +
              '<span class="response-toggle-label">' +
                escapeHtml(isApplied ? "申込済" : "未申込") +
              "</span>" +
            "</button>" +
            '<button type="button" class="response-overview-edit-button" data-edit-tournament-ids="' +
              escapeHtml((item.tournament_ids || []).join(",")) +
              '">情報を編集する</button>' +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }).join("");

  elements.tournamentList.querySelectorAll("[data-applied-toggle-ids]").forEach(function(button) {
    button.addEventListener("click", async function() {
      await updateTournamentAppliedStatusForIds_(
        parseTournamentIds_(button.dataset.appliedToggleIds),
        !button.classList.contains("is-active")
      );
    });
  });

  elements.tournamentList.querySelectorAll("[data-edit-tournament-ids]").forEach(function(button) {
    button.addEventListener("click", function() {
      state.primaryTab = "tournaments";
      state.tournamentMode = "tournament-list";
      renderTabs();
      openTournamentEditModalForIds_(
        parseTournamentIds_(button.dataset.editTournamentIds)
      );
      showStatus("大会情報を編集できます。申込情報は保持されます。", "");
    });
  });
}

function renderTournamentFollowupList_() {
  if (!elements.tournamentFollowupList) {
    return;
  }

  const followupItems = getTournamentFollowupItems_();

  if (elements.tournamentFollowupCount) {
    elements.tournamentFollowupCount.textContent =
      String(followupItems.length) + "件";
  }

  if (!followupItems.length) {
    elements.tournamentFollowupList.innerHTML =
      '<p class="empty-state">申込後フォローが必要な大会はありません。</p>';
    return;
  }

  elements.tournamentFollowupList.innerHTML = followupItems.map(function(item) {
    const applicantBody = item.applicant_groups.length ?
      item.applicant_groups.map(function(group) {
        return (
          '<div class="response-overview-grade-row">' +
            '<div class="response-overview-grade-label">' +
              escapeHtml(formatOverviewGradeLabel(group.grade)) +
            "</div>" +
            '<div class="response-overview-grade-names">' +
              escapeHtml((group.names || []).join("、")) +
            "</div>" +
          "</div>"
        );
      }).join("") :
      '<p class="response-overview-empty">申込希望者はいません。</p>';
    const driveLink = item.drive_url ?
      '<a href="' + escapeHtml(item.drive_url) + '" target="_blank" rel="noopener noreferrer">要項を開く</a>' :
      "要項未設定";

    return (
      '<section class="response-overview-card">' +
        '<div class="response-overview-card-header">' +
          '<h4>' + escapeHtml(item.title || "無題") + "</h4>" +
          '<div class="response-overview-tag-row">' +
            '<span class="response-overview-status-tag is-applied">申込済</span>' +
            '<span class="response-overview-count">' +
              escapeHtml(String(item.applicant_count || 0)) + "名" +
            "</span>" +
          "</div>" +
        "</div>" +
        '<div class="response-overview-meta">' +
          '<span>大会日: ' + escapeHtml(buildEventDateLabel_(item)) + "</span>" +
          '<span>' + escapeHtml(buildDaysUntilEventLabel_(item.event_start_date)) + "</span>" +
          '<span>開催級: ' + escapeHtml(item.grades || "級制限なし") + "</span>" +
          '<span>会場: ' + escapeHtml(item.venue || "-") + "</span>" +
          '<span>担当: ' + escapeHtml(item.manager_name || "-") + "</span>" +
          '<span>' + driveLink + "</span>" +
        "</div>" +
        '<div class="response-overview-content">' +
          '<div class="response-overview-body">' +
            '<div class="followup-check-list" aria-label="確認観点">' +
              '<span>抽選結果</span>' +
              '<span>参加者名簿</span>' +
              '<span>参加費支払い</span>' +
            "</div>" +
            applicantBody +
          "</div>" +
          '<div class="response-overview-actions response-overview-actions-side">' +
            '<button type="button" class="response-overview-edit-button" data-edit-followup-tournament-ids="' +
              escapeHtml((item.tournament_ids || []).join(",")) +
              '">情報を編集する</button>' +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }).join("");

  elements.tournamentFollowupList
    .querySelectorAll("[data-edit-followup-tournament-ids]")
    .forEach(function(button) {
      button.addEventListener("click", function() {
        state.primaryTab = "tournaments";
        state.tournamentMode = "tournament-followup";
        renderTabs();
        openTournamentEditModalForIds_(
          parseTournamentIds_(button.dataset.editFollowupTournamentIds)
        );
        showStatus("申込後フォロー対象の大会情報を編集できます。", "");
      });
    });
}

function renderMemberList() {
  const visibleMembers = getFilteredMemberListItems_();

  if (!visibleMembers.length) {
    elements.memberList.innerHTML = '<p class="empty-state">表示対象のメンバーがありません。</p>';
    return;
  }

  elements.memberList.innerHTML = visibleMembers.map(function(item) {
    const statusTag = getMemberStatusTag_(item.status);

    return (
      '<section class="response-overview-card member-card">' +
        '<div class="response-overview-card-header">' +
          '<div>' +
            '<h4>' + escapeHtml(item.display_name || buildMemberDisplayName_(item) || "名称未設定") + "</h4>" +
            '<div class="response-overview-meta member-card-meta">' +
              '<span>' + escapeHtml(formatMemberListMeta(item)) + "</span>" +
              '<span>ふりがな: ' + escapeHtml(buildMemberKanaLabel_(item) || "-") + "</span>" +
              '<span>ID: ' + escapeHtml(item.member_id || "-") + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="member-card-actions">' +
            '<span class="response-overview-status-tag is-' + escapeHtml(statusTag.key) + '">' +
              escapeHtml(statusTag.label) +
            "</span>" +
            '<button type="button" class="secondary-button response-overview-edit-button" data-edit-member-id="' +
              escapeHtml(item.member_id || "") + '">編集する</button>' +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }).join("");

  elements.memberList.querySelectorAll("[data-edit-member-id]").forEach(function(button) {
    button.addEventListener("click", function() {
      state.primaryTab = "members";
      state.memberMode = "member-list";
      renderTabs();
      openMemberEditModal_(button.dataset.editMemberId);
    });
  });
}

function renderPendingMemberRequests() {
  const pendingMembers = getPendingMembers_();

  elements.pendingMemberPanel.classList.toggle("is-hidden", !pendingMembers.length);
  elements.pendingMemberCount.textContent = pendingMembers.length + "件";

  if (!pendingMembers.length) {
    elements.pendingMemberList.innerHTML = "";
    return;
  }

  elements.pendingMemberList.innerHTML = pendingMembers.map(function(item) {
    return (
      '<section class="response-overview-card">' +
        '<div class="response-overview-card-header">' +
          '<h4>' + escapeHtml(item.display_name || buildMemberDisplayName_(item) || "名称未設定") + "</h4>" +
          '<div class="response-overview-actions pending-member-actions">' +
            '<button type="button" class="secondary-button" data-review-member-id="' + escapeHtml(item.member_id || "") + '">内容を確認</button>' +
            '<button type="button" class="secondary-button pending-member-reject-button" data-reject-member-id="' + escapeHtml(item.member_id || "") + '">却下</button>' +
            '<button type="button" data-approve-member-id="' + escapeHtml(item.member_id || "") + '">承認</button>' +
          "</div>" +
        "</div>" +
        '<div class="response-overview-meta">' +
          '<span>ふりがな: ' + escapeHtml(buildMemberKanaLabel_(item) || "-") + "</span>" +
          '<span>段位: ' + escapeHtml(formatRankLabel_(item.rank)) + "</span>" +
          '<span>級: ' + escapeHtml(formatMemberGradeLabel_(item.grade)) + "</span>" +
        "</div>" +
      "</section>"
    );
  }).join("");

  elements.pendingMemberList.querySelectorAll("[data-review-member-id]").forEach(function(button) {
    button.addEventListener("click", function() {
      state.primaryTab = "members";
      state.memberMode = "member-list";
      renderTabs();
      openMemberEditModal_(button.dataset.reviewMemberId);
      showStatus("申請内容を編集できます。確認後にステータスを変更してください。", "");
    });
  });

  elements.pendingMemberList.querySelectorAll("[data-approve-member-id]").forEach(function(button) {
    button.addEventListener("click", async function() {
      await updateMemberStatus_(button.dataset.approveMemberId, "active", "申請を承認しました。");
    });
  });

  elements.pendingMemberList.querySelectorAll("[data-reject-member-id]").forEach(function(button) {
    button.addEventListener("click", async function() {
      const confirmed = window.confirm("本当に却下してもよいですか？");
      if (!confirmed) {
        return;
      }
      await updateMemberStatus_(button.dataset.rejectMemberId, "rejected", "申請を却下しました。");
    });
  });
}

function formatTournamentListMeta(item) {
  return item.grades ? String(item.grades) : "級制限なし";
}

function formatMemberListMeta(item) {
  const meta = [];

  if (String(item.rank || "").trim() !== "") {
    meta.push(formatRankLabel_(item.rank));
  }

  meta.push(item.grade ? formatMemberGradeLabel_(item.grade) : "級未設定");
  return meta.join(" / ");
}

function buildTournamentSaveMessage(result) {
  const results = result && Array.isArray(result.results) ? result.results : [];
  const count = result && result.count ? result.count : Math.max(results.length, 1);
  const baseMessage = count > 1 ?
    count + "件の大会情報を保存しました。" :
    "大会情報を保存しました。";

  if (!results.length) {
    return baseMessage;
  }

  const failed = results.filter(function(item) {
    return !item.calendar_sync || !item.calendar_sync.ok;
  });

  if (!failed.length) {
    return baseMessage + " Google Calendarも同期しました。";
  }

  return baseMessage + " Google Calendar同期は一部未完了です。";
}

function getLineAdminToken() {
  return String(state.adminToken || "").trim();
}

function selectTournamentById(id) {
  const item = state.tournaments.find(function(tournament) {
    return tournament.tournament_id === id;
  });

  if (!item) {
    return;
  }

  populateTournamentFormFromItems_([item]);
}

function populateTournamentFormFromItems_(items) {
  const tournaments = (items || []).filter(Boolean).slice().sort(function(a, b) {
    return TOURNAMENT_GRADE_OPTIONS.indexOf(String(a.grades || "").trim()) -
      TOURNAMENT_GRADE_OPTIONS.indexOf(String(b.grades || "").trim());
  });

  if (!tournaments.length) {
    return;
  }

  const first = tournaments[0];
  const commonTrueDeadline = buildDateTimeKey_(
    toDateInputValue(first.true_deadline),
    getTimePart_(first.true_deadline)
  );
  const commonInternalDeadline = buildDateTimeKey_(
    toDateInputValue(first.internal_deadline),
    getTimePart_(first.internal_deadline)
  );

  state.selectedTournamentId = first.tournament_id || "";
  renderTabs();
  renderTournamentList();

  elements.tournamentId.value = tournaments.length === 1 ? (first.tournament_id || "") : "";
  elements.tournamentTitle.value = first.title || "";
  elements.eventStartDate.value = toDateInputValue(first.event_start_date);
  elements.eventEndDate.value = toDateInputValue(
    first.event_end_date || first.event_start_date
  );
  setSelectedTournamentGrades(tournaments.map(function(item) {
    return String(item.grades || "").trim();
  }).filter(Boolean));
  setDateTimeFields_(
    elements.trueDeadlineDate,
    elements.trueDeadlineTime,
    first.true_deadline
  );
  setDateTimeFields_(
    elements.internalDeadlineDate,
    elements.internalDeadlineTime,
    first.internal_deadline
  );
  state.internalDeadlineManuallyEdited =
    buildDateTimeKey_(
      elements.internalDeadlineDate.value,
      elements.internalDeadlineTime.value
    ) !== getSuggestedInternalDeadline_();
  elements.venue.value = first.venue || "";
  elements.driveUrl.value = first.drive_url || "";
  elements.entryPageToken.value = first.entry_page_token || "";
  elements.entryUrl.value = first.entry_url || "";
  syncEntryUrlPlaceholder_();
  setSelectedManager(first.manager_line_user_id || "", first.manager_name || "");
  elements.tournamentType.value = getTournamentTypeValue(first);
  elements.tournamentStatus.value = first.status || "draft";
  state.gradeScheduleOverrides = {};

  tournaments.forEach(function(item) {
    const grade = String(item.grades || "").trim();
    const itemTrueDeadline = buildDateTimeKey_(
      toDateInputValue(item.true_deadline),
      getTimePart_(item.true_deadline)
    );
    const itemInternalDeadline = buildDateTimeKey_(
      toDateInputValue(item.internal_deadline),
      getTimePart_(item.internal_deadline)
    );

    if (!grade) {
      return;
    }

    state.gradeScheduleOverrides[grade] = {
      tournamentId: item.tournament_id || "",
      useCommon:
        toDateInputValue(item.event_start_date) === elements.eventStartDate.value &&
        itemTrueDeadline === commonTrueDeadline &&
        itemInternalDeadline === commonInternalDeadline,
      eventStartDate: toDateInputValue(item.event_start_date),
      trueDeadline: itemTrueDeadline,
      internalDeadline: itemInternalDeadline,
    };
  });

  renderGradeScheduleSettings();
}

async function updateMemberStatus_(memberId, nextStatus, successMessage) {
  const item = state.members.find(function(member) {
    return member.member_id === memberId;
  });

  if (!item) {
    showStatus("対象メンバーが見つかりませんでした。", "error");
    return;
  }

  try {
    setBusyState(true, "メンバー申請を処理しています...");
    await postJson({
      action: "upsert_member",
      member: {
        member_id: item.member_id || "",
        last_name: item.last_name || "",
        last_name_kana: item.last_name_kana || "",
        first_name: item.first_name || "",
        first_name_kana: item.first_name_kana || "",
        rank: String(item.rank || "0"),
        grade: normalizeMemberGradeValue_(item.grade),
        status: nextStatus,
      },
    });
    await loadAdminData();
    showStatus(successMessage, "success");
    setBusyState(false);
    showResultOverlay_("更新しました", successMessage);
  } catch (error) {
    showStatus(error.message || "メンバー申請の処理に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("更新できませんでした", error.message || "メンバー申請の処理に失敗しました。");
  }
}

function resetTournamentForm() {
  state.selectedTournamentId = "";
  state.internalDeadlineManuallyEdited = false;
  state.gradeScheduleOverrides = {};
  elements.tournamentForm.reset();
  elements.tournamentType.value = "";
  elements.tournamentStatus.value = "active";
  elements.entryPageToken.value = getDefaultEntryPageToken_();
  elements.eventEndDate.value = "";
  resetDateTimeFields_(
    elements.trueDeadlineDate,
    elements.trueDeadlineTime
  );
  resetDateTimeFields_(
    elements.internalDeadlineDate,
    elements.internalDeadlineTime
  );
  setSelectedTournamentGrades("");
  populateManagerOptions();
  syncSelectedManagerFields();
  syncEntryUrlField_();
  syncInternalDeadlineDefault(true);
  renderGradeScheduleSettings();
  setBriefUploadStatus("アップロード後、要項URLへ自動反映します。", "");
  elements.briefUploadInput.value = "";
  renderTournamentList();
  syncDetailEditors();
}

function resetMemberForm() {
  elements.memberForm.reset();
  elements.memberStatus.value = "active";
  elements.memberRank.value = "";
  elements.memberGrade.value = "";
  renderMemberList();
}

function populateSettingsForm() {
  elements.settingsDriveFolderUrl.value = state.settings.drive_folder_url || "";
  elements.settingsAnnualSchedulePreviewUrl.value =
    state.settings.annual_schedule_preview_url || "";
  elements.settingsAnnualScheduleViewUrl.value =
    state.settings.annual_schedule_view_url || "";
  elements.settingsWebBaseUrl.value = state.settings.web_base_url || "";
  elements.settingsAdminPageUrl.value = state.settings.admin_page_url || "";
  elements.settingsDefaultEntryPageToken.value =
    getDefaultEntryPageToken_();
  elements.settingsCalendarId.value = state.settings.calendar_id || "";
  elements.settingsCalendarEmbedUrl.value = state.settings.calendar_embed_url || "";
  elements.settingsCalendarViewUrl.value = state.settings.calendar_view_url || "";
  populateLineBotSettingsForm_();
  populateLineMessageSettingsForm_();
}

function renderCalendarEmbed_() {
  const embedUrl = String(state.settings.calendar_embed_url || "").trim();
  const viewUrl = String(state.settings.calendar_view_url || "").trim();

  if (elements.calendarFrame) {
    elements.calendarFrame.src = embedUrl || "about:blank";
  }

  if (elements.calendarLink) {
    elements.calendarLink.href = viewUrl || "#";
    elements.calendarLink.classList.toggle("is-disabled", !viewUrl);
  }
}

function populateLineBotSettingsForm_() {
  elements.settingsLineGroupId.value = state.settings.line_group_id || "";
  elements.settingsLineTestGroupId.value = state.settings.line_test_group_id || "";
  elements.settingsDailyAnnouncementTime.value =
    state.settings.daily_announcement_time || "17:00";
  elements.settingsTournamentReminderTime.value =
    state.settings.tournament_reminder_time || "10:00";
  elements.settingsPendingMemberSummaryTime.value =
    state.settings.pending_member_summary_time || "07:00";
  elements.settingsNightlyAutomationTime.value =
    state.settings.nightly_automation_time || "23:59";
}

function populateLineMessageSettingsForm_() {
  const templates = state.settings.line_message_templates || {};
  elements.lineTemplateAnnouncement.value = templates.announcement || "";
  elements.lineTemplateGroupReminder.value = templates.group_reminder || "";
  elements.lineTemplateManagerInternalDeadline.value =
    templates.manager_internal_deadline || "";
  elements.lineTemplateManagerTrueDeadline.value =
    templates.manager_true_deadline || "";
  elements.lineTemplateAppliedNotification.value =
    templates.applied_notification || "";
  elements.lineTemplateMemberRegistrationRequest.value =
    templates.member_registration_request || "";
  elements.lineTemplatePendingMemberSummary.value =
    templates.pending_member_summary || "";
}

async function saveLineMessageTemplates_() {
  return postJson({
    action: "update_admin_settings",
    settings: {
      line_message_templates: {
        announcement: elements.lineTemplateAnnouncement.value.trim(),
        group_reminder: elements.lineTemplateGroupReminder.value.trim(),
        manager_internal_deadline: elements.lineTemplateManagerInternalDeadline.value.trim(),
        manager_true_deadline: elements.lineTemplateManagerTrueDeadline.value.trim(),
        applied_notification: elements.lineTemplateAppliedNotification.value.trim(),
        member_registration_request: elements.lineTemplateMemberRegistrationRequest.value.trim(),
        pending_member_summary: elements.lineTemplatePendingMemberSummary.value.trim(),
      },
    },
  });
}

function insertLinePlaceholder_(placeholder) {
  if (!placeholder) {
    return;
  }

  const target = getActiveLineTemplateTextarea_();
  const start = target.selectionStart || 0;
  const end = target.selectionEnd || 0;
  const before = target.value.slice(0, start);
  const after = target.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? "\n" : "";
  const suffix = after && !/^\s/.test(after) ? "\n" : "";
  const inserted = prefix + placeholder + suffix;

  target.value = before + inserted + after;
  target.focus();
  target.setSelectionRange(start + inserted.length, start + inserted.length);
}

function getActiveLineTemplateTextarea_() {
  const textareas = getLineTemplateTextareas_();
  const active = document.activeElement;

  if (textareas.indexOf(active) !== -1) {
    return active;
  }

  return elements.lineTemplateAnnouncement;
}

function getLineTemplateTextareas_() {
  return [
    elements.lineTemplateAnnouncement,
    elements.lineTemplateGroupReminder,
    elements.lineTemplateManagerInternalDeadline,
    elements.lineTemplateManagerTrueDeadline,
    elements.lineTemplateAppliedNotification,
    elements.lineTemplateMemberRegistrationRequest,
    elements.lineTemplatePendingMemberSummary,
  ].filter(Boolean);
}

function applyTournamentDefaultsIfNeeded_() {
  if (state.selectedTournamentId || state.isTournamentEditModalOpen) {
    return;
  }

  if (!elements.entryPageToken.value) {
    elements.entryPageToken.value = getDefaultEntryPageToken_();
  }

  syncEntryUrlField_();
}

function getDefaultEntryPageToken_() {
  return String(
    state.settings.default_entry_page_token || DEFAULT_ENTRY_PAGE_TOKEN
  ).trim();
}

function syncEntryUrlField_() {
  const generatedUrl = buildEntryPageUrl_(
    String(elements.entryPageToken.value || "").trim()
  );

  syncEntryUrlPlaceholder_();
  elements.entryUrl.value = generatedUrl;
}

function syncEntryUrlPlaceholder_() {
  elements.entryUrl.placeholder = buildEntryPageUrl_(
    String(elements.entryPageToken.value || "").trim()
  );
}

function buildEntryPageUrl_(entryPageToken) {
  const normalizedToken = String(entryPageToken || "").trim();
  const webBaseUrl = String(state.settings.web_base_url || "").trim();

  if (!normalizedToken || !webBaseUrl) {
    return "";
  }

  return webBaseUrl.replace(/\/+$/g, "") +
    "/entry/?page_token=" + encodeURIComponent(normalizedToken);
}

function buildScheduledTriggerResultMessage_(triggers) {
  const items = [
    ["大会情報更新通知", triggers.daily_announcement],
    ["メンバー申請まとめ通知", triggers.pending_member_registration_summary],
    ["夜間自動処理", triggers.applied_notification],
    ["締切リマインド", triggers.tournament_reminder],
  ];

  return items.map(function(item) {
    return item[0] + ": " + (item[1] || "作成済み");
  }).join("\n");
}

function buildTournamentEntryUrl_(item) {
  return buildEntryPageUrl_(item && item.entry_page_token) ||
    String(item && item.entry_url ? item.entry_url : "").trim();
}

async function copyTextToClipboard_(text) {
  const normalized = String(text || "");

  if (!normalized) {
    throw new Error("コピーするURLがありません。");
  }

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(normalized);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = normalized;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("URLのコピーに失敗しました。");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function attachFormsToHosts() {
  elements.tournamentForm.hidden = false;
  elements.memberForm.hidden = false;
  elements.tournamentCreateHost.appendChild(elements.tournamentForm);
  elements.memberCreateHost.appendChild(elements.memberForm);
}

function syncFormPlacement() {
  const tournamentTarget = state.isTournamentEditModalOpen ?
    elements.tournamentEditHost :
    elements.tournamentCreateHost;

  if (elements.tournamentForm.parentElement !== tournamentTarget) {
    tournamentTarget.appendChild(elements.tournamentForm);
  }

  if (elements.memberForm.parentElement !== elements.memberCreateHost) {
    elements.memberCreateHost.appendChild(elements.memberForm);
  }
}

function syncDetailEditors() {
  const showTournamentEditor = false;

  if (elements.tournamentDetailNote) {
    elements.tournamentDetailNote.classList.toggle("is-hidden", showTournamentEditor);
  }

  if (elements.tournamentDetailHost) {
    elements.tournamentDetailHost.classList.toggle("is-hidden", !showTournamentEditor);
  }
}

async function fetchJson(action) {
  return fetchJsonWithParams(action, {});
}

async function fetchJsonWithParams(action, params) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", action);
  Object.keys(params || {}).forEach(function(key) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
      url.searchParams.set(key, params[key]);
    }
  });

  if (state.adminToken) {
    url.searchParams.set("admin_token", state.adminToken);
  }

  const response = await fetch(url.toString(), { method: "GET" });
  const data = await readJsonResponse(response, "読み込み");

  if (!data.ok) {
    throw new Error(data.error || "読み込みに失敗しました。");
  }

  return data;
}

async function postJson(payload) {
  const nextPayload = Object.assign({}, payload);

  if (state.adminToken && !nextPayload.admin_token) {
    nextPayload.admin_token = state.adminToken;
  }

  const response = await fetch(API_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(nextPayload),
  });
  const data = await readJsonResponse(response, "保存");

  if (!data.ok) {
    throw new Error(data.error || "保存に失敗しました。");
  }

  return data;
}

async function readJsonResponse(response, actionLabel) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch (error) {
    const trimmed = String(text || "").trim();

    if (/^<!DOCTYPE html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      throw new Error(
        actionLabel +
        "先の Apps Script が JSON ではなく HTML を返しました。Webアプリの再デプロイ、公開権限、API URL を確認してください。"
      );
    }

    throw new Error(
      actionLabel +
      "先の応答を解釈できませんでした。先頭: " +
      trimmed.slice(0, 120)
    );
  }
}

function toApiDateTimeValue(dateValue, timeValue) {
  if (!dateValue) {
    return "";
  }

  return dateValue + "T" + normalizeTimeValue_(timeValue) + ":00+09:00";
}

function toDateInputValue(value) {
  return normalizeDateKey_(value);
}

function toDateTimeLocalValue(value) {
  return String(value || "").slice(0, 16);
}

function syncInternalDeadlineDefault(force) {
  if (!force && state.internalDeadlineManuallyEdited) {
    return;
  }

  setDateTimeFields_(
    elements.internalDeadlineDate,
    elements.internalDeadlineTime,
    getSuggestedInternalDeadline_()
  );
}

function getSuggestedInternalDeadline_() {
  if (!elements.trueDeadlineDate.value) {
    return "";
  }

  return getSuggestedInternalDeadlineFromDate_(elements.trueDeadlineDate.value);
}

async function handleBriefFile(file) {
  if (!file) {
    return;
  }

  if (file.type !== "application/pdf") {
    setBriefUploadStatus("現在は PDF のみアップロードできます。", "error");
    return;
  }

  if (!elements.tournamentTitle.value.trim()) {
    setBriefUploadStatus("先に大会名を入力してください。", "error");
    elements.tournamentTitle.focus();
    return;
  }

  if (!elements.eventStartDate.value) {
    setBriefUploadStatus("先に開催日時を入力してください。", "error");
    elements.eventStartDate.focus();
    return;
  }

  const grades = getSelectedTournamentGrades();
  if (!grades.length) {
    setBriefUploadStatus("先に開催級を選択してください。", "error");
    return;
  }

  try {
    setBusyState(true, "要項ファイルをアップロードしています...");
    setBriefUploadStatus("アップロード中です...", "");

    const contentBase64 = await readFileAsBase64_(file);
    const result = await postJson({
      action: "upload_brief_file",
      file_name: file.name,
      mime_type: file.type,
      content_base64: contentBase64,
      tournament: {
        title: elements.tournamentTitle.value.trim(),
        event_start_date: elements.eventStartDate.value,
        grades: grades.join(","),
        grade_configs: buildTournamentGradeConfigsPayload(),
      },
    });

    elements.driveUrl.value = result.drive_url || "";
    setBriefUploadStatus(
      (result.reused_existing ? "既存ファイルを再利用しました: " : "アップロードしました: ") +
      (result.file_name || file.name),
      "success"
    );
    setBusyState(false);
    showResultOverlay_(
      result.reused_existing ? "既存ファイルを再利用しました" : "アップロードしました",
      (result.reused_existing ?
        "同名の要項ファイルがすでに存在したため、そのファイルを再利用しました。\n" :
        "要項ファイルをアップロードしました。\n") +
      (result.file_name || file.name)
    );
  } catch (error) {
    setBriefUploadStatus(error.message || "ファイルのアップロードに失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("アップロードできませんでした", error.message || "ファイルのアップロードに失敗しました。");
  } finally {
    elements.briefUploadInput.value = "";
  }
}

function readFileAsBase64_(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();

    reader.onload = function() {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };

    reader.onerror = function() {
      reject(new Error("ファイルの読み込みに失敗しました。"));
    };

    reader.readAsDataURL(file);
  });
}

function setBriefUploadStatus(message, type) {
  elements.briefUploadStatus.textContent = message;
  elements.briefUploadStatus.className = "upload-status";

  if (type === "success") {
    elements.briefUploadStatus.classList.add("is-success");
  }

  if (type === "error") {
    elements.briefUploadStatus.classList.add("is-error");
  }
}

function shiftDateString(value, days, timeValue) {
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

  const shiftedDate = [
    shifted.getFullYear(),
    String(shifted.getMonth() + 1).padStart(2, "0"),
    String(shifted.getDate()).padStart(2, "0"),
  ].join("-");

  if (timeValue === undefined) {
    return shiftedDate;
  }

  return buildDateTimeKey_(shiftedDate, timeValue);
}

function getSuggestedInternalDeadlineFromDate_(trueDeadlineDate) {
  if (!trueDeadlineDate) {
    return "";
  }

  return shiftDateString(trueDeadlineDate, -3, "23:59");
}

function renderTournamentResponseOverview() {
  if (!elements.tournamentResponseOverviewHost) {
    return;
  }

  if (elements.tournamentResponseSort) {
    elements.tournamentResponseSort.value = state.tournamentResponseSort;
  }

  const visibleItems = getVisibleTournamentResponseOverview_();

  if (!visibleItems.length) {
    elements.tournamentResponseOverviewHost.innerHTML =
      '<p class="empty-state">表示できる大会がまだありません。</p>';
    return;
  }

  elements.tournamentResponseOverviewHost.innerHTML = visibleItems
    .map(function(item) {
      const statusTag = getTournamentStatusTag_(item.status);
      const applicantGroups = Array.isArray(item.applicant_groups) ? item.applicant_groups : [];
      const isApplied = String(item.status || "").trim() === "applied";
      const applicantBody = applicantGroups.length ?
        applicantGroups.map(function(group) {
          return (
            '<div class="response-overview-grade-row">' +
              '<div class="response-overview-grade-label">' +
                escapeHtml(formatOverviewGradeLabel(group.grade)) +
              "</div>" +
              '<div class="response-overview-grade-names">' +
                escapeHtml((group.names || []).join("、")) +
              "</div>" +
            "</div>"
          );
        }).join("") :
        '<p class="response-overview-empty">申込希望者はいません。</p>';

      return (
        '<section class="response-overview-card">' +
          '<div class="response-overview-card-header">' +
            '<h4>' + escapeHtml(item.title || "無題") + "</h4>" +
            '<div class="response-overview-tag-row">' +
              '<span class="response-overview-status-tag is-' + escapeHtml(statusTag.key) + '">' +
                escapeHtml(statusTag.label) +
              "</span>" +
              '<span class="response-overview-count">' +
                escapeHtml(String(item.applicant_count || 0)) + "名" +
              "</span>" +
            "</div>" +
          "</div>" +
          '<div class="response-overview-meta">' +
            '<span>大会日: ' + escapeHtml(item.event_date_label || "-") + "</span>" +
            '<span>締切日: ' + escapeHtml(item.internal_deadline_label || "-") + "</span>" +
            '<span>開催級: ' + escapeHtml(item.grades || "級制限なし") + "</span>" +
          "</div>" +
          '<div class="response-overview-body">' + applicantBody + "</div>" +
          '<div class="response-overview-actions response-overview-actions-compact">' +
            '<button type="button" class="response-toggle-button' +
              (isApplied ? " is-active" : "") +
              '" data-applied-toggle-id="' + escapeHtml(item.tournament_id || "") +
              '" aria-pressed="' + escapeHtml(String(isApplied)) + '">' +
              '<span class="response-toggle-track">' +
                '<span class="response-toggle-thumb"></span>' +
              "</span>" +
              '<span class="response-toggle-label">' +
                escapeHtml(isApplied ? "申込済" : "未申込") +
              "</span>" +
            "</button>" +
          "</div>" +
        "</section>"
      );
    })
    .join("");

  elements.tournamentResponseOverviewHost
    .querySelectorAll("[data-applied-toggle-id]")
    .forEach(function(button) {
      button.addEventListener("click", async function() {
        await updateTournamentAppliedStatus_(
          button.dataset.appliedToggleId,
          !button.classList.contains("is-active")
        );
      });
    });
}

function getSortedTournamentResponseOverview_() {
  const items = state.tournamentResponseOverview.slice();
  const sortKey = state.tournamentResponseSort;

  return items.sort(function(a, b) {
    const primary =
      sortKey === "event_start_date" ?
        compareOverviewDateValues_(a.event_start_date, b.event_start_date) :
        compareOverviewDateValues_(a.internal_deadline, b.internal_deadline);

    if (primary !== 0) {
      return primary;
    }

    return compareOverviewDateValues_(a.event_start_date, b.event_start_date) ||
      String(a.title || "").localeCompare(String(b.title || ""), "ja");
  });
}

function getVisibleTournamentResponseOverview_() {
  return getSortedTournamentResponseOverview_().filter(function(item) {
    return getTournamentStatusTag_(item.status).key !== "closed";
  });
}

function getFilteredTournamentListItems_() {
  return state.tournaments
    .slice()
    .sort(function(a, b) {
      return compareOverviewDateValues_(a.event_start_date, b.event_start_date) ||
        String(a.title || "").localeCompare(String(b.title || ""), "ja");
    })
    .filter(function(item) {
      return Boolean(state.tournamentListFilters[getTournamentStatusTag_(item.status).key]);
    });
}

function getGroupedTournamentListItems_() {
  const groups = {};

  getFilteredTournamentListItems_().forEach(function(item) {
    const groupKey = buildTournamentListGroupKey_(item);
    const overview = getTournamentOverviewById_(item.tournament_id);

    if (!groups[groupKey]) {
      groups[groupKey] = {
        group_key: groupKey,
        tournament_id: item.tournament_id || "",
        tournament_ids: [],
        title: buildTournamentDisplayTitleForGrouping_(item.title, []),
        status: item.status || "",
        event_start_date: item.event_start_date || "",
        event_end_date: item.event_end_date || item.event_start_date || "",
        internal_deadline: item.internal_deadline || "",
        true_deadline: item.true_deadline || "",
        grades: [],
        venue: item.venue || "",
        drive_url: item.drive_url || "",
        entry_page_token: item.entry_page_token || "",
        entry_url: item.entry_url || "",
        manager_name: item.manager_name || "",
        manager_line_user_id: item.manager_line_user_id || "",
        tournament_type: item.tournament_type || "",
        applicant_groups: [],
        applicant_count: 0,
      };
    }

    groups[groupKey].tournament_ids.push(item.tournament_id || "");
    groups[groupKey].grades = sortTournamentGrades_(
      groups[groupKey].grades.concat(normalizeGradeValues(item.grades || ""))
    );
    groups[groupKey].status = mergeTournamentStatuses_(
      groups[groupKey].status,
      item.status
    );

    if (overview) {
      groups[groupKey].applicant_groups = mergeApplicantGroups_(
        groups[groupKey].applicant_groups,
        overview.applicant_groups
      );
      groups[groupKey].applicant_count += Number(overview.applicant_count || 0);
    }
  });

  return Object.keys(groups).map(function(groupKey) {
    const item = groups[groupKey];
    item.grades = item.grades.join(",");
    item.title = buildTournamentDisplayTitleForGrouping_(item.title, item.grades);
    return item;
  }).sort(function(a, b) {
    return compareOverviewDateValues_(a.event_start_date, b.event_start_date) ||
      compareOverviewDateValues_(a.internal_deadline, b.internal_deadline) ||
      String(a.title || "").localeCompare(String(b.title || ""), "ja");
  });
}

function getTournamentFollowupItems_() {
  const todayKey = buildDateKeyFromDate_(new Date());

  return getGroupedTournamentListItemsFromSource_(state.tournaments)
    .filter(function(item) {
      const eventStartDate = normalizeDateKey_(item.event_start_date);
      return String(item.status || "").trim() === "applied" &&
        Number(item.applicant_count || 0) > 0 &&
        eventStartDate &&
        eventStartDate >= todayKey;
    })
    .sort(function(a, b) {
      return compareOverviewDateValues_(a.event_start_date, b.event_start_date) ||
        String(a.title || "").localeCompare(String(b.title || ""), "ja");
    });
}

function getGroupedTournamentListItemsFromSource_(items) {
  const groups = {};

  (items || []).forEach(function(item) {
    const groupKey = buildTournamentListGroupKey_(item);
    const overview = getTournamentOverviewById_(item.tournament_id);

    if (!groups[groupKey]) {
      groups[groupKey] = {
        group_key: groupKey,
        tournament_id: item.tournament_id || "",
        tournament_ids: [],
        title: buildTournamentDisplayTitleForGrouping_(item.title, []),
        status: item.status || "",
        event_start_date: item.event_start_date || "",
        event_end_date: item.event_end_date || item.event_start_date || "",
        internal_deadline: item.internal_deadline || "",
        true_deadline: item.true_deadline || "",
        grades: [],
        venue: item.venue || "",
        drive_url: item.drive_url || "",
        entry_page_token: item.entry_page_token || "",
        entry_url: item.entry_url || "",
        manager_name: item.manager_name || "",
        manager_line_user_id: item.manager_line_user_id || "",
        tournament_type: item.tournament_type || "",
        applicant_groups: [],
        applicant_count: 0,
      };
    }

    groups[groupKey].tournament_ids.push(item.tournament_id || "");
    groups[groupKey].grades = sortTournamentGrades_(
      groups[groupKey].grades.concat(normalizeGradeValues(item.grades || ""))
    );
    groups[groupKey].status = mergeTournamentStatuses_(
      groups[groupKey].status,
      item.status
    );

    if (overview) {
      groups[groupKey].applicant_groups = mergeApplicantGroups_(
        groups[groupKey].applicant_groups,
        overview.applicant_groups
      );
      groups[groupKey].applicant_count += Number(overview.applicant_count || 0);
    }
  });

  return Object.keys(groups).map(function(groupKey) {
    const item = groups[groupKey];
    item.grades = item.grades.join(",");
    item.title = buildTournamentDisplayTitleForGrouping_(item.title, item.grades);
    return item;
  });
}

function buildTournamentListGroupKey_(item) {
  return [
    buildTournamentBaseTitleForGrouping_(item.title, item.grades),
    String(item.tournament_type || "").trim(),
    String(item.venue || "").trim(),
    String(item.entry_page_token || "").trim(),
    normalizeDateKey_(item.event_start_date),
    normalizeDateKey_(item.event_end_date || item.event_start_date),
    String(item.internal_deadline || "").trim(),
  ].join("::");
}

function buildTournamentBaseTitleForGrouping_(title, grades) {
  const normalizedTitle = String(title || "").trim();
  const compactGradeLabel = normalizeGradeValues(grades)
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
  const normalizedGrades = normalizeGradeValues(grades).filter(function(grade) {
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

function mergeTournamentStatuses_(leftStatus, rightStatus) {
  const leftTag = getTournamentStatusTag_(leftStatus).key;
  const rightTag = getTournamentStatusTag_(rightStatus).key;

  if (!leftStatus) {
    return rightStatus || "";
  }

  if (leftTag === rightTag) {
    return leftStatus;
  }

  if (leftTag === "closed" && rightTag === "closed") {
    return "closed";
  }

  return "active";
}

function mergeApplicantGroups_(leftGroups, rightGroups) {
  const groupedNames = {};

  (leftGroups || []).concat(rightGroups || []).forEach(function(group) {
    const grade = String(group && group.grade ? group.grade : "").trim();
    const names = Array.isArray(group && group.names) ? group.names : [];

    if (!groupedNames[grade]) {
      groupedNames[grade] = [];
    }

    names.forEach(function(name) {
      if (groupedNames[grade].indexOf(name) === -1) {
        groupedNames[grade].push(name);
      }
    });
  });

  return Object.keys(groupedNames)
    .sort(function(a, b) {
      return String(a).localeCompare(String(b), "ja");
    })
    .map(function(grade) {
      return {
        grade: grade,
        names: groupedNames[grade].slice().sort(function(a, b) {
          return String(a).localeCompare(String(b), "ja");
        }),
      };
    });
}

function sortTournamentGrades_(grades) {
  return uniqueStrings((grades || []).filter(Boolean)).sort(function(a, b) {
    return TOURNAMENT_GRADE_OPTIONS.indexOf(a) - TOURNAMENT_GRADE_OPTIONS.indexOf(b);
  });
}

function parseTournamentIds_(value) {
  return String(value || "")
    .split(",")
    .map(function(item) {
      return String(item || "").trim();
    })
    .filter(Boolean);
}

function getTournamentOverviewById_(tournamentId) {
  return (state.tournamentResponseOverview || []).find(function(item) {
    return item.tournament_id === tournamentId;
  }) || null;
}

function getTournamentStatusTag_(status) {
  const normalized = String(status || "").trim();

  if (normalized === "applied") {
    return { key: "applied", label: "申込済" };
  }

  if (normalized === "no_applicants") {
    return { key: "closed", label: "申込無" };
  }

  if (
    normalized === "closed" ||
    normalized === "canceled"
  ) {
    return { key: "closed", label: "終了" };
  }

  return { key: "open", label: "受付中" };
}

function buildEventDateLabel_(item) {
  return buildEventDateLabelFromValues_(item.event_start_date, item.event_end_date) || "-";
}

function buildDaysUntilEventLabel_(eventStartDate) {
  const eventDateKey = normalizeDateKey_(eventStartDate);

  if (!eventDateKey) {
    return "大会日未設定";
  }

  const today = parseDateOnly_(buildDateKeyFromDate_(new Date()));
  const eventDate = parseDateOnly_(eventDateKey);
  const diffDays = Math.round(
    (eventDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays === 0) {
    return "本日開催";
  }

  if (diffDays > 0) {
    return "大会日まで" + diffDays + "日";
  }

  return "大会終了";
}

function buildEventDateLabelFromValues_(startDate, endDate) {
  const start = normalizeDateKey_(startDate);
  const end = normalizeDateKey_(endDate);

  if (!start) {
    return "";
  }

  if (!end || start === end) {
    return formatDateLabel_(start);
  }

  const startParts = start.split("-");
  const endParts = end.split("-");
  return Number(startParts[1]) + "月" + Number(startParts[2]) + "日 - " +
    Number(endParts[1]) + "月" + Number(endParts[2]) + "日";
}

function normalizeDateKey_(value) {
  if (!value) {
    return "";
  }

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return buildDateKeyFromDate_(value);
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  if (/^\d{8}$/.test(text)) {
    return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return buildDateKeyFromDate_(parsed);
  }

  return text.slice(0, 10);
}

function buildDateKeyFromDate_(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateOnly_(value) {
  const normalized = normalizeDateKey_(value);
  const parts = normalized.split("-");

  if (parts.length !== 3) {
    return new Date(NaN);
  }

  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function formatDateLabel_(dateString) {
  const parts = String(dateString).split("-");
  if (parts.length !== 3) {
    return String(dateString || "");
  }

  return Number(parts[1]) + "月" + Number(parts[2]) + "日";
}

function formatDateTimeLabel_(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return String(value);
  }

  return [
    Number(date.getMonth() + 1) + "月" + Number(date.getDate()) + "日",
    String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0"),
  ].join(" ");
}

function compareOverviewDateValues_(left, right) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");

  if (!leftValue && !rightValue) {
    return 0;
  }

  if (!leftValue) {
    return 1;
  }

  if (!rightValue) {
    return -1;
  }

  return leftValue.localeCompare(rightValue);
}

function formatOverviewGradeLabel(grade) {
  if (!grade || grade === "未登録") {
    return "未登録";
  }

  return String(grade).endsWith("級") ? String(grade) : String(grade) + "級";
}

async function updateTournamentAppliedStatus_(tournamentId, isApplied) {
  return updateTournamentAppliedStatusForIds_([tournamentId], isApplied);
}

async function updateTournamentAppliedStatusForIds_(tournamentIds, isApplied) {
  const ids = (tournamentIds || []).filter(Boolean);
  const nextStatus = isApplied ? "applied" : "active";
  const successMessage = isApplied ?
    "大会を申込済にしました。23:00 の完了通知対象になります。" :
    "大会を未申込に戻しました。";

  if (!ids.length) {
    showStatus("対象の大会が見つかりませんでした。", "error");
    return;
  }

  try {
    setBusyState(true, "大会の申込状態を更新しています...");
    await Promise.all(ids.map(function(tournamentId) {
      return postJson({
        action: "update_tournament_status",
        tournament_id: tournamentId,
        status: nextStatus,
      });
    }));
    await loadAdminData();
    showStatus(successMessage, "success");
    setBusyState(false);
    showResultOverlay_("更新しました", successMessage);
  } catch (error) {
    showStatus(error.message || "大会の申込状態の更新に失敗しました。", "error");
    setBusyState(false);
    showResultOverlay_("更新できませんでした", error.message || "大会の申込状態の更新に失敗しました。");
  }
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
  syncBodyBusyState_();
  elements.busyOverlay.classList.toggle("is-hidden", !isBusy);
  elements.busyMessage.textContent = message || "保存中です...";

  Array.from(document.querySelectorAll("button, input, select, textarea")).forEach(function(element) {
    if (elements.busyMessage.contains(element)) {
      return;
    }
    element.disabled = isBusy;
  });
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
    isOverlayOpen_(elements.authOverlay) ||
    isOverlayOpen_(elements.resultOverlay) ||
    isOverlayOpen_(elements.tournamentEditOverlay) ||
    isOverlayOpen_(elements.memberEditOverlay)
  );
}

function openAuthOverlay_() {
  elements.authOverlay.classList.remove("is-hidden");
  setAuthMessage_("", "");
  syncBodyBusyState_();
}

function closeAuthOverlay_() {
  elements.authOverlay.classList.add("is-hidden");
  setAuthBusyState_(false);
  setAuthMessage_("", "");
  syncBodyBusyState_();
}

function setAuthMessage_(message, type) {
  elements.authMessage.textContent = message || "";
  elements.authMessage.className = "status-message auth-message";

  if (type === "success") {
    elements.authMessage.classList.add("is-success");
  }

  if (type === "error") {
    elements.authMessage.classList.add("is-error");
  }
}

function setAuthBusyState_(isBusy, message) {
  state.isAuthBusy = Boolean(isBusy);
  elements.authForm.classList.toggle("is-busy", state.isAuthBusy);
  elements.authTokenInput.disabled = state.isAuthBusy;
  elements.authSubmitButton.disabled = state.isAuthBusy;
  elements.authBusyIndicator.classList.toggle("is-hidden", !state.isAuthBusy);

  if (message) {
    elements.authBusyMessage.textContent = message;
  }
}

function getInitialAdminToken_() {
  const url = new URL(window.location.href);
  const tokenFromQuery = String(url.searchParams.get("admin_token") || "").trim();

  if (tokenFromQuery) {
    return tokenFromQuery;
  }

  return String(window.localStorage.getItem("adminConsoleToken") || "").trim();
}

function persistAdminToken_(token) {
  window.localStorage.setItem("adminConsoleToken", token);
}

function clearPersistedAdminToken_() {
  window.localStorage.removeItem("adminConsoleToken");
}

function clearAdminTokenFromUrl_() {
  const url = new URL(window.location.href);

  if (!url.searchParams.has("admin_token")) {
    return;
  }

  url.searchParams.delete("admin_token");
  window.history.replaceState({}, "", url.toString());
}

async function authorizeAdminAccess_(token) {
  const normalizedToken = String(token || "").trim();

  if (state.isAuthBusy) {
    return false;
  }

  if (!normalizedToken) {
    setAuthMessage_("管理画面 token を入力してください。", "error");
    elements.authTokenInput.focus();
    return false;
  }

  state.adminToken = normalizedToken;
  setAuthMessage_("", "");
  setAuthBusyState_(true, "認証とデータを読み込んでいます...");

  try {
    await loadAdminData();
    state.isAuthorized = true;
    persistAdminToken_(normalizedToken);
    clearAdminTokenFromUrl_();
    setAuthBusyState_(false);
    closeAuthOverlay_();
    showStatus("", "");
    return true;
  } catch (error) {
    state.adminToken = "";
    state.isAuthorized = false;
    clearPersistedAdminToken_();
    setAuthBusyState_(false);
    openAuthOverlay_();
    setAuthMessage_(error.message || "認証に失敗しました。", "error");
    elements.authTokenInput.focus();
    elements.authTokenInput.select();
    return false;
  }
}

function isOverlayOpen_(element) {
  return Boolean(element) && !element.classList.contains("is-hidden");
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

function getPendingMembers_() {
  return state.members
    .filter(function(item) {
      return String(item.status || "").trim() === "pending";
    })
    .slice()
    .sort(function(a, b) {
      return String(a.updated_at || a.created_at || "").localeCompare(
        String(b.updated_at || b.created_at || "")
      );
    });
}

function getSortedMembers_() {
  return (state.members || []).slice().sort(function(a, b) {
    const gradeDiff = getMemberGradeSortIndex_(a.grade) - getMemberGradeSortIndex_(b.grade);

    if (gradeDiff !== 0) {
      return gradeDiff;
    }

    return String(a.display_name || buildMemberDisplayName_(a) || "").localeCompare(
      String(b.display_name || buildMemberDisplayName_(b) || ""),
      "ja"
    );
  });
}

function getFilteredMemberListItems_() {
  return getSortedMembers_().filter(function(item) {
    const status = String(item.status || "").trim() || "active";
    return Boolean(state.memberListFilters[status]);
  });
}

function getMemberStatusTag_(status) {
  const normalized = String(status || "").trim();

  if (normalized === "active") {
    return { key: "open", label: "active" };
  }

  if (normalized === "pending") {
    return { key: "applied", label: "pending" };
  }

  if (normalized === "inactive") {
    return { key: "closed", label: "inactive" };
  }

  if (normalized === "rejected") {
    return { key: "closed", label: "rejected" };
  }

  return { key: "closed", label: normalized || "unknown" };
}

function openMemberEditModal_(memberId) {
  const item = state.members.find(function(member) {
    return member.member_id === memberId;
  });

  if (!item) {
    showStatus("対象メンバーが見つかりませんでした。", "error");
    return;
  }

  state.editingMemberId = memberId;
  elements.memberEditId.value = item.member_id || "";
  elements.memberEditLastName.value = item.last_name || "";
  elements.memberEditLastNameKana.value = item.last_name_kana || "";
  elements.memberEditFirstName.value = item.first_name || "";
  elements.memberEditFirstNameKana.value = item.first_name_kana || "";
  elements.memberEditRank.value = String(item.rank || "");
  elements.memberEditGrade.value = normalizeMemberGradeValue_(item.grade);
  elements.memberEditStatus.value = item.status || "active";
  elements.memberEditOverlay.classList.remove("is-hidden");
  syncBodyBusyState_();
}

function openTournamentEditModal_(tournamentId) {
  return openTournamentEditModalForIds_([tournamentId]);
}

function openTournamentEditModalForIds_(tournamentIds) {
  const ids = (tournamentIds || []).filter(Boolean);
  const tournaments = ids.map(function(id) {
    return state.tournaments.find(function(tournament) {
      return tournament.tournament_id === id;
    }) || null;
  }).filter(Boolean);

  if (!tournaments.length) {
    showStatus("対象の大会が見つかりませんでした。", "error");
    return;
  }

  state.isTournamentEditModalOpen = true;
  elements.tournamentEditOverlay.classList.remove("is-hidden");
  syncBodyBusyState_();
  syncFormPlacement();
  populateTournamentFormFromItems_(tournaments);
}

function closeTournamentEditModal_(keepValues) {
  state.isTournamentEditModalOpen = false;
  elements.tournamentEditOverlay.classList.add("is-hidden");
  syncFormPlacement();

  if (!keepValues) {
    resetTournamentForm();
    state.tournamentMode = "tournament-list";
    renderTabs();
  }

  syncBodyBusyState_();
}

function reopenTournamentEditModal_() {
  state.isTournamentEditModalOpen = true;
  elements.tournamentEditOverlay.classList.remove("is-hidden");
  syncFormPlacement();
  syncBodyBusyState_();
}

function closeMemberEditModal_(preserveContext) {
  if (!preserveContext) {
    state.editingMemberId = "";
  }
  elements.memberEditOverlay.classList.add("is-hidden");
  syncBodyBusyState_();
}

function reopenMemberEditModal_() {
  elements.memberEditOverlay.classList.remove("is-hidden");
  syncBodyBusyState_();
}

function buildMemberEditPayload_() {
  return {
    member_id: elements.memberEditId.value.trim(),
    last_name: elements.memberEditLastName.value.trim(),
    last_name_kana: elements.memberEditLastNameKana.value.trim(),
    first_name: elements.memberEditFirstName.value.trim(),
    first_name_kana: elements.memberEditFirstNameKana.value.trim(),
    rank: elements.memberEditRank.value.trim(),
    grade: normalizeMemberGradeValue_(elements.memberEditGrade.value),
    status: elements.memberEditStatus.value,
  };
}

function buildMemberSavedMessage_(payload, suffix) {
  const fullName = buildMemberFullNameFromFields_(payload);
  return fullName ?
    fullName + " " + (suffix || "を保存しました。") :
    "メンバー情報を保存しました。";
}

function buildMemberFullNameFromFields_(payload) {
  return [
    String(payload.last_name || "").trim(),
    String(payload.first_name || "").trim(),
  ].join("");
}

function getMemberGradeSortIndex_(grade) {
  const normalized = normalizeMemberGradeValue_(grade);
  const index = MEMBER_GRADE_OPTIONS.indexOf(normalized);
  return index === -1 ? MEMBER_GRADE_OPTIONS.length : index;
}

function buildMemberKanaLabel_(item) {
  return [
    String(item.last_name_kana || "").trim(),
    String(item.first_name_kana || "").trim(),
  ].filter(Boolean).join(" ");
}

function setSelectedTournamentGrades(value) {
  const selectedValues = normalizeGradeValues(value);
  elements.grades.value = selectedValues.join(",");
  syncTournamentGradeSelector();
  syncGradeScheduleOverrides_();
  renderGradeScheduleSettings();
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

function getSelectedMemberGrade() {
  return normalizeMemberGradeValue_(elements.memberGrade.value);
}

function syncGradeScheduleOverrides_() {
  const selectedGrades = getSelectedTournamentGrades();
  const next = {};

  selectedGrades.forEach(function(grade) {
    const existing = state.gradeScheduleOverrides[grade] || {};

    next[grade] = {
      tournamentId: existing.tournamentId || "",
      useCommon: existing.useCommon !== false,
      eventStartDate: existing.eventStartDate || elements.eventStartDate.value,
      trueDeadline: existing.trueDeadline || buildDateTimeKey_(
        elements.trueDeadlineDate.value,
        elements.trueDeadlineTime.value
      ),
      internalDeadline: existing.internalDeadline || buildDateTimeKey_(
        elements.internalDeadlineDate.value,
        elements.internalDeadlineTime.value
      ),
    };
  });

  state.gradeScheduleOverrides = next;
}

function renderGradeScheduleSettings() {
  if (!elements.gradeScheduleSettings) {
    return;
  }

  syncGradeScheduleOverrides_();
  const selectedGrades = getSelectedTournamentGrades();

  if (!selectedGrades.length) {
    elements.gradeScheduleSettings.innerHTML =
      '<p class="grade-schedule-empty">開催級を選ぶと、級ごとの個別設定をここで調整できます。</p>';
    return;
  }

  elements.gradeScheduleSettings.innerHTML = selectedGrades.map(function(grade) {
    const config = state.gradeScheduleOverrides[grade];
    const fieldsHiddenClass = config.useCommon ? " is-hidden" : "";
    return (
      '<div class="grade-schedule-card" data-grade-card="' + escapeHtml(grade) + '">' +
        '<div class="grade-schedule-header">' +
          '<div class="grade-schedule-title">' + escapeHtml(grade) + "級</div>" +
          '<label class="checkbox-field">' +
            '<input type="checkbox" data-grade-use-common="' + escapeHtml(grade) + '"' +
            (config.useCommon ? " checked" : "") + ">" +
            "<span>共通設定を使う</span>" +
          "</label>" +
        "</div>" +
        '<div class="grade-schedule-fields' + fieldsHiddenClass + '" data-grade-fields="' + escapeHtml(grade) + '">' +
          '<div class="grade-schedule-grid">' +
            '<label class="field">' +
              "<span>大会日程</span>" +
              '<input type="date" data-grade-event-start-date="' + escapeHtml(grade) + '" value="' + escapeHtml(config.eventStartDate || "") + '">' +
            "</label>" +
            '<label class="field">' +
              "<span>主催締切</span>" +
              '<div class="field-inline">' +
                '<input type="date" data-grade-true-deadline-date="' + escapeHtml(grade) + '" value="' + escapeHtml(getDatePart_(config.trueDeadline)) + '">' +
                '<input type="time" data-grade-true-deadline-time="' + escapeHtml(grade) + '" value="' + escapeHtml(getTimePart_(config.trueDeadline)) + '">' +
              "</div>" +
            "</label>" +
            '<label class="field">' +
              "<span>サークル内締切</span>" +
              '<div class="field-inline">' +
                '<input type="date" data-grade-internal-deadline-date="' + escapeHtml(grade) + '" value="' + escapeHtml(getDatePart_(config.internalDeadline)) + '">' +
                '<input type="time" data-grade-internal-deadline-time="' + escapeHtml(grade) + '" value="' + escapeHtml(getTimePart_(config.internalDeadline)) + '">' +
              "</div>" +
            "</label>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }).join("");

  elements.gradeScheduleSettings.querySelectorAll("[data-grade-use-common]").forEach(function(input) {
    input.addEventListener("change", function() {
      const grade = input.dataset.gradeUseCommon;
      const config = state.gradeScheduleOverrides[grade];
      if (!config) {
        return;
      }

      config.useCommon = input.checked;
      if (!config.useCommon) {
        config.eventStartDate = elements.eventStartDate.value;
        config.trueDeadline = buildDateTimeKey_(
          elements.trueDeadlineDate.value,
          elements.trueDeadlineTime.value
        );
        config.internalDeadline = buildDateTimeKey_(
          elements.internalDeadlineDate.value,
          elements.internalDeadlineTime.value
        );
      }
      renderGradeScheduleSettings();
    });
  });

  elements.gradeScheduleSettings.querySelectorAll("[data-grade-event-start-date]").forEach(function(input) {
    input.addEventListener("change", function() {
      const config = state.gradeScheduleOverrides[input.dataset.gradeEventStartDate];
      if (config) {
        config.eventStartDate = input.value;
      }
    });
  });

  elements.gradeScheduleSettings.querySelectorAll("[data-grade-true-deadline-date]").forEach(function(input) {
    input.addEventListener("change", function() {
      const config = state.gradeScheduleOverrides[input.dataset.gradeTrueDeadlineDate];
      if (!config) {
        return;
      }

      const previousSuggested = getSuggestedInternalDeadlineFromDate_(
        getDatePart_(config.trueDeadline)
      );
      config.trueDeadline = buildDateTimeKey_(
        input.value,
        getTimePart_(config.trueDeadline)
      );
      if (!config.internalDeadline || config.internalDeadline === previousSuggested) {
        config.internalDeadline = getSuggestedInternalDeadlineFromDate_(input.value);
      }
      renderGradeScheduleSettings();
    });
  });

  elements.gradeScheduleSettings.querySelectorAll("[data-grade-true-deadline-time]").forEach(function(input) {
    input.addEventListener("change", function() {
      const config = state.gradeScheduleOverrides[input.dataset.gradeTrueDeadlineTime];
      if (!config) {
        return;
      }

      const previousSuggested = getSuggestedInternalDeadlineFromDate_(
        getDatePart_(config.trueDeadline)
      );
      config.trueDeadline = buildDateTimeKey_(
        getDatePart_(config.trueDeadline),
        input.value
      );
      if (!config.internalDeadline || config.internalDeadline === previousSuggested) {
        config.internalDeadline = getSuggestedInternalDeadlineFromDate_(
          getDatePart_(config.trueDeadline)
        );
      }
      renderGradeScheduleSettings();
    });
  });

  elements.gradeScheduleSettings.querySelectorAll("[data-grade-internal-deadline-date]").forEach(function(input) {
    input.addEventListener("change", function() {
      const config = state.gradeScheduleOverrides[input.dataset.gradeInternalDeadlineDate];
      if (config) {
        config.internalDeadline = buildDateTimeKey_(
          input.value,
          getTimePart_(config.internalDeadline)
        );
      }
    });
  });

  elements.gradeScheduleSettings.querySelectorAll("[data-grade-internal-deadline-time]").forEach(function(input) {
    input.addEventListener("change", function() {
      const config = state.gradeScheduleOverrides[input.dataset.gradeInternalDeadlineTime];
      if (config) {
        config.internalDeadline = buildDateTimeKey_(
          getDatePart_(config.internalDeadline),
          input.value
        );
      }
    });
  });
}

function buildTournamentGradeConfigsPayload() {
  return getSelectedTournamentGrades().map(function(grade) {
    const config = state.gradeScheduleOverrides[grade] || {};
    const useCommon = config.useCommon !== false;

    return {
      tournament_id: config.tournamentId || (
        getSelectedTournamentGrades().length === 1 ?
          elements.tournamentId.value.trim() :
          ""
      ),
      grade: grade,
      event_start_date: useCommon ? elements.eventStartDate.value : config.eventStartDate,
      true_deadline: toApiDateTimeValue(
        useCommon ? elements.trueDeadlineDate.value : getDatePart_(config.trueDeadline),
        useCommon ? elements.trueDeadlineTime.value : getTimePart_(config.trueDeadline)
      ),
      internal_deadline: toApiDateTimeValue(
        useCommon ? elements.internalDeadlineDate.value : getDatePart_(config.internalDeadline),
        useCommon ? elements.internalDeadlineTime.value : getTimePart_(config.internalDeadline)
      ),
    };
  });
}

function resetDateTimeFields_(dateElement, timeElement) {
  dateElement.value = "";
  timeElement.value = "23:59";
}

function setDateTimeFields_(dateElement, timeElement, value) {
  dateElement.value = toDateInputValue(value);
  timeElement.value = getTimePart_(value);
}

function buildDateTimeKey_(dateValue, timeValue) {
  if (!dateValue) {
    return "";
  }

  return dateValue + "T" + normalizeTimeValue_(timeValue);
}

function getDatePart_(value) {
  return String(value || "").slice(0, 10);
}

function getTimePart_(value) {
  const matched = String(value || "").match(/T(\d{2}:\d{2})/);
  return matched ? matched[1] : "23:59";
}

function normalizeTimeValue_(value) {
  return String(value || "23:59").slice(0, 5) || "23:59";
}

function buildManagerLabel(manager) {
  const displayName = String(manager.display_name || "").trim();
  const managerName = String(manager.manager_name || "").trim();

  if (displayName && managerName && displayName !== managerName) {
    return displayName + " (" + managerName + ")";
  }

  return displayName || managerName || "名称未設定";
}

function buildMemberDisplayName_(item) {
  const lastName = String(item.last_name || "").trim();
  const firstName = String(item.first_name || "").trim();
  const grade = formatMemberGradeLabel_(item.grade);
  const fullName = lastName + firstName;

  if (!fullName) {
    return "";
  }

  return grade ? fullName + " (" + grade + ")" : fullName;
}

function normalizeMemberGradeValue_(value) {
  const normalized = String(value || "").trim();

  if (normalized === "初心者") {
    return "beginner";
  }

  return MEMBER_GRADE_OPTIONS.indexOf(normalized) !== -1 ? normalized : "";
}

function formatMemberGradeLabel_(value) {
  const normalized = normalizeMemberGradeValue_(value);

  if (!normalized) {
    return "";
  }

  return normalized === "beginner" ? "初心者" : normalized + "級";
}

function formatRankLabel_(value) {
  const rankValue = value === undefined || value === null ?
    "" :
    String(value).trim();
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

  return labels[rankValue] || rankValue;
}

function getTournamentTypeValue(item) {
  const type = String(item.tournament_type || "").trim();

  if (
    type === "official" ||
    type === "support" ||
    type === "event"
  ) {
    return type;
  }

  if (
    item.is_official === true ||
    item.is_official === "TRUE" ||
    item.is_official === "true"
  ) {
    return "official";
  }

  return "";
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
