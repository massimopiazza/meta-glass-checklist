import {
  PROCEDURE_TEMPLATES,
  getTemplate,
  loadProcedureTemplates
} from "./templates.js?v=13";
import {
  NOTE_TAGS,
  addMockAttachment,
  archiveRun,
  calculateProgress,
  createId,
  createGeneratedExport,
  createRun,
  getSequentialAccess,
  nowIso,
  recordExport,
  removeAttachment,
  toggleStepCompletion,
  updateStepNotes,
  validateTemplates
} from "./core.js?v=13";
import {
  deleteExport,
  getExport,
  getExportsForRun,
  getAllRuns,
  saveExport,
  saveRun
} from "./storage.js?v=13";

const state = {
  currentScreen: "home",
  screenHistory: [],
  runs: [],
  selectedTemplateId: null,
  currentRunId: null,
  selectedStepIndex: 0,
  generatedExports: [],
  currentExportId: null,
  noteDraftTag: "",
  noteMenuOpen: false,
  modalActions: [],
  modalReturnFocus: null
};

const screens = Object.fromEntries(
  Array.from(document.querySelectorAll(".screen")).map((screen) => [screen.id, screen])
);

let toastTimer = null;

function iconMarkup(name, className = "") {
  return `<svg class="ui-icon ${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function displayRunId(runId) {
  return String(runId || "").replace(/^RUN-/, "");
}

function noteTagClass(tag) {
  return NOTE_TAGS.includes(tag) ? tag.toLowerCase() : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatShortDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function getCurrentRun() {
  return state.runs.find((run) => run.id === state.currentRunId) || null;
}

function getCurrentTemplate() {
  const run = getCurrentRun();
  return getTemplate(run?.templateId || state.selectedTemplateId);
}

function getSelectedStep() {
  return getCurrentTemplate()?.steps[state.selectedStepIndex] || null;
}

function getStepAccess(stepIndex = state.selectedStepIndex) {
  const run = getCurrentRun();
  const template = getCurrentTemplate();
  if (!run || !template) {
    return { sequential: false, firstIncompleteIndex: -1, canView: false, canEdit: false };
  }
  return getSequentialAccess(run, template, stepIndex);
}

function setScreen(screenId, options = {}) {
  if (!screens[screenId]) return;

  if (options.addToHistory !== false && state.currentScreen && state.currentScreen !== screenId) {
    state.screenHistory.push(state.currentScreen);
  }

  Object.values(screens).forEach((screen) => screen.classList.add("hidden"));
  screens[screenId].classList.remove("hidden");
  state.currentScreen = screenId;
  renderScreen(screenId);

  requestAnimationFrame(() => {
    focusFirst(screens[screenId]);
  });
}

function goBack() {
  if (state.currentScreen === "step-detail") {
    saveNoteDraft({ silent: true });
  }
  const previous = state.screenHistory.pop();
  if (previous) {
    setScreen(previous, { addToHistory: false });
  } else if (state.currentScreen !== "home") {
    setScreen("home", { addToHistory: false });
  }
}

function goHome() {
  if (state.currentScreen === "step-detail") {
    saveNoteDraft({ silent: true });
  }
  state.screenHistory = [];
  setScreen("home", { addToHistory: false });
}

function focusFirst(container) {
  const first = container.querySelector(".focusable:not([disabled]):not(.hidden)");
  first?.focus();
}

function moveFocus(direction) {
  const modal = document.getElementById("modal");
  const container = modal.classList.contains("hidden") ? screens[state.currentScreen] : modal;
  const focusable = Array.from(
    container.querySelectorAll(".focusable:not([disabled]):not(.hidden)")
  ).filter((element) => element.offsetParent !== null);

  if (!focusable.length) return;
  const currentIndex = focusable.indexOf(document.activeElement);
  const backwards = direction === "up" || direction === "left";
  let nextIndex;

  if (currentIndex < 0) {
    nextIndex = 0;
  } else if (backwards) {
    nextIndex = currentIndex === 0 ? focusable.length - 1 : currentIndex - 1;
  } else {
    nextIndex = currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
  }

  const next = focusable[nextIndex];
  next.focus();
  next.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function focusElement(element) {
  if (!element) return;
  element.focus();
  element.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function showToast(message, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`.trim();
  toast.offsetHeight;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  const duration = Math.min(8000, 3500 + Math.max(0, message.split(/\s+/).length - 2) * 300);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), duration);
}

function showModal({ title, message, icon = "info", tone = "default", actions }) {
  const modal = document.getElementById("modal");
  state.modalReturnFocus = document.activeElement;
  state.modalActions = actions;
  modal.dataset.tone = tone;
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-message").textContent = message;
  const iconName = icon === "!" ? "circle-alert" : icon === "i" ? "info" : icon;
  document.getElementById("modal-icon").innerHTML = iconMarkup(iconName);
  document.getElementById("modal-actions").innerHTML = actions
    .map((action, index) => {
      const actionClass = action.danger ? "danger" : action.primary ? "primary" : "";
      return `<button class="focusable ${actionClass}" data-action="modal-choice" data-index="${index}">${escapeHtml(action.label)}</button>`;
    })
    .join("");
  modal.classList.remove("hidden");
  requestAnimationFrame(() => focusFirst(modal));
}

function closeModal() {
  const modal = document.getElementById("modal");
  modal.classList.add("hidden");
  modal.dataset.tone = "default";
  state.modalActions = [];
  if (state.modalReturnFocus?.isConnected) {
    state.modalReturnFocus.focus();
  }
  state.modalReturnFocus = null;
}

function renderScreen(screenId) {
  switch (screenId) {
    case "home":
      renderHome();
      break;
    case "templates":
      renderTemplates();
      break;
    case "template-detail":
      renderTemplateDetail();
      break;
    case "start-run":
      renderStartRun();
      break;
    case "procedure":
      renderProcedure();
      break;
    case "step-detail":
      renderStepDetail();
      break;
    case "history":
      renderHistory();
      break;
    case "run-info":
      renderRunInfo();
      break;
    case "audit":
      renderAudit();
      break;
    case "export":
      renderExport();
      break;
    case "export-preview":
      renderExportPreview();
      break;
    case "step-image":
      renderStepImage();
      break;
  }
}

function renderHome() {
  const activeRuns = state.runs.filter((run) => run.status === "active");
  const summary = document.getElementById("home-run-summary");
  document.getElementById("history-count").textContent = state.runs.length
    ? `${state.runs.length} ${state.runs.length === 1 ? "entry" : "entries"}`
    : "No entries";

  if (!activeRuns.length) {
    summary.innerHTML = "";
    return;
  }

  const run = activeRuns[0];
  const template = getTemplate(run.templateId);
  const progress = calculateProgress(run, template);
  summary.innerHTML = `
    <article class="active-run-card">
      <div class="active-run-top">
        <div>
          <div class="active-run-eyebrow">Active procedure</div>
          <h2>${escapeHtml(run.name)}</h2>
          <p>${escapeHtml(template.shortTitle)} &middot; ${progress.completed}/${progress.total} complete</p>
        </div>
        <button class="resume-button focusable" data-action="resume-run" data-run-id="${escapeHtml(run.id)}">Resume</button>
      </div>
      <div class="mini-progress" aria-label="${progress.percent}% complete">
        <span style="width:${progress.percent}%"></span>
      </div>
    </article>`;
}

function renderTemplates() {
  document.getElementById("template-list").innerHTML = PROCEDURE_TEMPLATES.map((template) => {
    return `
      <button class="template-card focusable" data-action="select-template" data-template-id="${escapeHtml(template.id)}">
        <span class="template-code">${escapeHtml(template.code)}</span>
        <span class="template-card-content">
          <h2>${escapeHtml(template.title)}</h2>
          <p>${escapeHtml(template.summary)}</p>
          <span class="card-meta">
            <span class="meta-chip">${template.steps.length} steps</span>
            <span class="meta-chip">${escapeHtml(template.estimatedDuration)}</span>
          </span>
        </span>
        ${iconMarkup("chevron-right", "chevron")}
      </button>`;
  }).join("");
}

function renderTemplateDetail() {
  const template = getTemplate(state.selectedTemplateId);
  if (!template) return;

  document.getElementById("template-detail-title").textContent = template.shortTitle;
  document.getElementById("template-detail-meta").textContent =
    `${template.domain} · Version ${template.version}`;
  document.getElementById("template-detail-content").innerHTML = `
    <article class="detail-hero">
      <h2>${escapeHtml(template.title)}</h2>
      <p>${escapeHtml(template.summary)}</p>
      <div class="detail-facts">
        <div class="fact"><strong>${template.steps.length}</strong><span>Steps</span></div>
        <div class="fact"><strong>${escapeHtml(template.estimatedDuration)}</strong><span>Duration</span></div>
        <div class="fact"><strong>v${escapeHtml(template.version)}</strong><span>Template</span></div>
      </div>
    </article>
    <div class="preview-list">
      <h3>Procedure preview</h3>
      ${template.steps.slice(0, 6).map((step) => `
        <div class="preview-step">
          <code>${escapeHtml(step.id)}</code>
          <span>${escapeHtml(step.title)}</span>
        </div>
      `).join("")}
      <div class="preview-step">
        <code>+${template.steps.length - 6}</code>
        <span>Additional controlled steps</span>
      </div>
    </div>`;
}

function renderStartRun() {
  const template = getTemplate(state.selectedTemplateId);
  if (!template) return;

  const date = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  document.getElementById("start-run-template-name").textContent = template.title;
  document.getElementById("run-name").value = `${template.shortTitle} · ${date}`;
  document.getElementById("run-config").innerHTML = `
    <div class="config-row"><span>Template</span><strong>${escapeHtml(template.code)} v${escapeHtml(template.version)}</strong></div>
    <div class="config-row"><span>Procedure steps</span><strong>${template.steps.length}</strong></div>
    <div class="config-row"><span>Execution</span><strong>${template.executionPolicy.sequential ? "Sequential" : "Flexible"}</strong></div>
    <div class="config-row"><span>Storage</span><strong>Offline on this device</strong></div>
    <div class="config-row"><span>Evidence</span><strong>Mock photo provider</strong></div>`;
}

function renderProcedure() {
  const run = getCurrentRun();
  const template = getCurrentTemplate();
  if (!run || !template) {
    goHome();
    return;
  }

  const progress = calculateProgress(run, template);
  document.getElementById("procedure-title").textContent = run.name;
  document.getElementById("procedure-run-id").textContent = displayRunId(run.id);
  const status = document.getElementById("procedure-status");
  status.textContent = run.status[0].toUpperCase() + run.status.slice(1);
  status.className = `status-label ${run.status}`;
  document.getElementById("procedure-progress-text").textContent =
    `${progress.completed} / ${progress.total} complete`;
  document.getElementById("procedure-progress-percent").textContent = `${progress.percent}%`;
  document.getElementById("procedure-progress-fill").style.width = `${progress.percent}%`;

  document.getElementById("procedure-step-list").innerHTML = template.steps.map((step, index) => {
    const stepState = run.stepStates[step.id];
    const access = getSequentialAccess(run, template, index);
    const reopened = !stepState.completed && stepState.reopenCount > 0;
    const policyClass = !access.canView ? "locked" : !access.canEdit ? "preview-only" : "";
    const stateClass = stepState.completed ? "completed" : reopened ? "reopened" : policyClass;
    const stateIcon = stepState.completed
      ? iconMarkup("check")
      : reopened
        ? iconMarkup("rotate-ccw")
        : !access.canView
          ? iconMarkup("lock")
          : !access.canEdit
            ? iconMarkup("eye")
            : "";
    const metadata = stepState.completed
      ? `Completed ${formatShortDate(stepState.completedAt)}`
      : reopened
        ? `Reopened · ${stepState.reopenCount} event${stepState.reopenCount === 1 ? "" : "s"}`
        : stepState.noteText || stepState.tags.length || stepState.attachments.length
          ? "Evidence recorded"
          : "Pending";
    const noteTag = stepState.tags[0] || "";
    return `
      <button
        class="checklist-row focusable ${stateClass}"
        data-action="open-step"
        data-index="${index}"
        aria-disabled="${!access.canView}"
      >
        <span class="step-state-icon" aria-hidden="true">${stateIcon}</span>
        <span class="step-code">${escapeHtml(step.id)}</span>
        <span class="step-row-copy">
          <strong>${escapeHtml(step.title)}</strong>
          <small>${escapeHtml(metadata)}</small>
        </span>
        <span class="step-row-flags">
          ${noteTag ? `<span class="note-tag-badge ${noteTagClass(noteTag)}">${escapeHtml(noteTag)}</span>` : ""}
          ${access.sequential && !stepState.completed && !access.canView ? '<span class="policy-badge locked">Locked</span>' : ""}
          ${access.sequential && !stepState.completed && access.canView && !access.canEdit ? '<span class="policy-badge preview">Preview</span>' : ""}
        </span>
      </button>`;
  }).join("");
}

function renderStepDetail() {
  const run = getCurrentRun();
  const template = getCurrentTemplate();
  const step = getSelectedStep();
  if (!run || !template || !step) return;

  const stepState = run.stepStates[step.id];
  const access = getStepAccess();
  const readOnly = run.status === "archived" || !access.canEdit;
  const statusText = access.sequential && !access.canEdit
    ? "Preview"
    : stepState.completed
    ? "Completed"
    : stepState.reopenCount
      ? "Reopened"
      : "Pending";
  const statusClass = access.sequential && !access.canEdit
    ? "preview"
    : stepState.completed
      ? "completed"
      : stepState.reopenCount
        ? "active"
        : "";

  const selectedTag = NOTE_TAGS.find((tag) => stepState.tags.includes(tag)) || "";
  state.noteDraftTag = selectedTag;
  state.noteMenuOpen = false;
  document.getElementById("step-title").textContent = step.id;
  document.getElementById("step-position").textContent =
    `${state.selectedStepIndex + 1} of ${template.steps.length}`;
  const status = document.getElementById("step-status");
  status.textContent = statusText;
  status.className = `status-label ${statusClass}`;

  document.getElementById("step-detail-content").innerHTML = `
    <article class="step-hero">
      <div class="step-title-row">
        <h2>${escapeHtml(step.title)}</h2>
      </div>
      <p class="step-description">${escapeHtml(step.description)}</p>
      ${step.image ? `
        <button class="step-reference-card focusable" data-action="open-step-image">
          <img src="${escapeHtml(step.image.src)}" alt="">
          <span class="step-reference-copy">
            <small>Reference image</small>
            <strong>${escapeHtml(step.image.caption)}</strong>
            <span>${escapeHtml(step.image.credit)}</span>
          </span>
          ${iconMarkup("maximize-2", "step-reference-expand")}
        </button>` : ""}
      <button
        class="completion-control focusable ${stepState.completed ? "completed" : ""}"
        data-action="toggle-completion"
        aria-pressed="${stepState.completed}"
        ${readOnly ? "disabled" : ""}
      >
        <span class="completion-check" aria-hidden="true">${stepState.completed ? iconMarkup("check") : ""}</span>
        <span>
          <strong>${stepState.completed ? "Step completed" : "Mark step complete"}</strong>
          <small>${stepState.completed
            ? formatDateTime(stepState.completedAt)
            : run.status === "archived"
              ? "Archived run is read-only"
              : !access.canEdit
                ? "Complete the preceding step before taking action"
                : "Completion records the current timestamp"}</small>
        </span>
      </button>
    </article>

    <section class="notes-block">
      <h3>Notes</h3>
      <div class="note-tag-select">
        <span class="note-tag-label">Tag</span>
        <button
          id="note-tag-trigger"
          class="note-select-trigger focusable"
          data-action="toggle-note-menu"
          aria-haspopup="listbox"
          aria-expanded="false"
          ${readOnly ? "disabled" : ""}
        >
          <span id="note-tag-value">${escapeHtml(selectedTag || "Select tag")}</span>
          ${iconMarkup("chevron-right", "select-chevron")}
        </button>
        <div id="note-tag-menu" class="note-select-menu hidden" role="listbox" aria-label="Step note tag">
          <button
            class="note-select-option focusable ${selectedTag ? "" : "selected"}"
            data-action="select-note-tag"
            data-tag=""
            role="option"
            aria-selected="${!selectedTag}"
          >No tag</button>
          ${NOTE_TAGS.map((tag) => `
            <button
              class="note-select-option focusable ${selectedTag === tag ? "selected" : ""}"
              data-action="select-note-tag"
              data-tag="${escapeHtml(tag)}"
              role="option"
              aria-selected="${selectedTag === tag}"
            >${escapeHtml(tag)}</button>
          `).join("")}
        </div>
      </div>
      <textarea
        id="step-note-text"
        class="note-input focusable"
        maxlength="1200"
        placeholder="Optional note..."
        ${readOnly ? "disabled" : ""}
      >${escapeHtml(stepState.noteText)}</textarea>
      <div class="inline-actions">
        <button class="inline-button focusable primary" data-action="save-note" ${readOnly ? "disabled" : ""}>Save note</button>
        <button class="inline-button focusable" data-action="clear-note" ${readOnly ? "disabled" : ""}>Clear</button>
      </div>
    </section>

    <section class="evidence-block">
      <h3>Photo evidence</h3>
      <button class="camera-button focusable" data-action="add-mock-photo" aria-label="Add mock photo" ${readOnly ? "disabled" : ""}>${iconMarkup("camera")}</button>
      <div id="evidence-list">
        ${renderEvidence(stepState.attachments, readOnly)}
      </div>
    </section>`;

  const previousButton = document.getElementById("previous-step-button");
  const nextButton = document.getElementById("next-step-button");
  previousButton.disabled = state.selectedStepIndex === 0;
  const nextIndex = state.selectedStepIndex + 1;
  nextButton.disabled =
    nextIndex >= template.steps.length ||
    !getSequentialAccess(run, template, nextIndex).canView;
}

function renderStepImage() {
  const step = getSelectedStep();
  if (!step?.image) {
    goBack();
    return;
  }

  document.getElementById("step-image-title").textContent = step.title;
  document.getElementById("step-image-step").textContent = `${step.id} · Reference image`;
  const image = document.getElementById("step-image-full");
  image.src = step.image.src;
  image.alt = step.image.alt;
  document.getElementById("step-image-caption").textContent = step.image.caption;
  document.getElementById("step-image-credit").textContent = `Credit: ${step.image.credit}`;
}

function renderEvidence(attachments, readOnly) {
  if (!attachments.length) {
    return `<div class="evidence-card">
      <span class="mock-thumb">${iconMarkup("file-text")}</span>
      <span class="evidence-copy">
        <strong>No photo evidence attached</strong>
        <small>Prototype uses labeled mock evidence</small>
      </span>
    </div>`;
  }

  return attachments.map((attachment) => `
    <div class="evidence-card">
      <span class="mock-thumb">${iconMarkup("camera")}</span>
      <span class="evidence-copy">
        <strong>${escapeHtml(attachment.label)}</strong>
        <small>${formatDateTime(attachment.createdAt)}</small>
      </span>
      ${readOnly ? "" : `
        <button
          class="remove-evidence focusable"
          data-action="remove-attachment"
          data-attachment-id="${escapeHtml(attachment.id)}"
          aria-label="Remove ${escapeHtml(attachment.label)}"
        >${iconMarkup("x")}</button>`}
    </div>
  `).join("");
}

function renderHistory() {
  const container = document.getElementById("history-list");
  if (!state.runs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">${iconMarkup("history")}</div>
        <h2>No history yet</h2>
        <p>Started, completed, and archived procedures will appear here.</p>
      </div>`;
    return;
  }

  container.innerHTML = state.runs.map((run) => {
    const template = getTemplate(run.templateId);
    const progress = calculateProgress(run, template);
    return `
      <button class="history-card focusable" data-action="review-run" data-run-id="${escapeHtml(run.id)}">
        <span class="history-status ${run.status}"></span>
        <span class="history-card-content">
          <span class="card-top">
            <h2>${escapeHtml(run.name)}</h2>
            <span class="status-label ${run.status}">${escapeHtml(run.status)}</span>
          </span>
          <p>${escapeHtml(template.shortTitle)} · Updated ${formatShortDate(run.updatedAt)}</p>
          <span class="card-meta">
            <span class="meta-chip">${progress.completed}/${progress.total} complete</span>
            <span class="meta-chip">${run.audit.length} audit events</span>
          </span>
        </span>
      </button>`;
  }).join("");
}

function renderRunInfo() {
  const run = getCurrentRun();
  const template = getCurrentTemplate();
  if (!run || !template) return;
  const progress = calculateProgress(run, template);
  const attachments = Object.values(run.stepStates)
    .reduce((count, stepState) => count + stepState.attachments.length, 0);
  const notes = Object.values(run.stepStates)
    .filter((stepState) => stepState.noteText || stepState.tags.length).length;

  document.getElementById("run-info-id").textContent = displayRunId(run.id);
  document.getElementById("archive-run-button").disabled = run.status === "archived";
  document.getElementById("run-info-content").innerHTML = `
    <div class="audit-summary">
      <div class="summary-cell"><strong>${progress.percent}%</strong><span>Complete</span></div>
      <div class="summary-cell"><strong>${notes}</strong><span>Step notes</span></div>
      <div class="summary-cell"><strong>${attachments}</strong><span>Mock photos</span></div>
    </div>
    <section class="info-block">
      <h3>Run</h3>
      <div class="info-row"><span>Name</span><strong>${escapeHtml(run.name)}</strong></div>
      <div class="info-row"><span>Status</span><strong>${escapeHtml(run.status)}</strong></div>
      <div class="info-row"><span>Started</span><strong>${formatDateTime(run.createdAt)}</strong></div>
      <div class="info-row"><span>Updated</span><strong>${formatDateTime(run.updatedAt)}</strong></div>
      <div class="info-row"><span>Completed</span><strong>${formatDateTime(run.completedAt)}</strong></div>
    </section>
    <section class="info-block">
      <h3>Configuration</h3>
      <div class="info-row"><span>Template</span><strong>${escapeHtml(template.title)}</strong></div>
      <div class="info-row"><span>Version</span><strong>${escapeHtml(run.templateVersion)}</strong></div>
      <div class="info-row"><span>Persistence</span><strong>Offline IndexedDB</strong></div>
    </section>`;
}

function renderAudit() {
  const run = getCurrentRun();
  const template = getCurrentTemplate();
  if (!run || !template) return;

  document.getElementById("audit-list").innerHTML = [...run.audit]
    .reverse()
    .map((event) => {
      const step = event.stepId
        ? template.steps.find((candidate) => candidate.id === event.stepId)
        : null;
      const eventView = auditEventView(event, step);
      return `
        <article class="timeline-event ${eventView.className}">
          <h3>${escapeHtml(eventView.title)}</h3>
          <p>${escapeHtml(eventView.detail)}</p>
          <time datetime="${escapeHtml(event.at)}">${formatDateTime(event.at)}</time>
        </article>`;
    })
    .join("");
}

function auditEventView(event, step) {
  const stepLabel = step ? `${step.id} · ${step.title}` : "";
  switch (event.type) {
    case "run_started":
      return { title: "Run started", detail: event.details?.name || "Procedure run created", className: "" };
    case "step_completed":
      return { title: "Step completed", detail: stepLabel, className: "complete" };
    case "step_reopened":
      return { title: "Step reopened", detail: stepLabel, className: "reopen" };
    case "run_completed":
      return { title: "Run completed", detail: "All procedure steps were complete.", className: "complete" };
    case "run_reopened":
      return { title: "Run reactivated", detail: event.details?.reason || "A step was reopened.", className: "reopen" };
    case "note_updated":
      return { title: "Step note updated", detail: stepLabel, className: "" };
    case "mock_attachment_added":
      return { title: "Mock photo added", detail: stepLabel, className: "" };
    case "mock_attachment_removed":
      return { title: "Mock photo removed", detail: stepLabel, className: "archive" };
    case "export_generated":
      return { title: `${event.details?.format?.toUpperCase()} export generated`, detail: "Evidence package generated locally.", className: "" };
    case "run_archived":
      return { title: "Run archived", detail: "Run is now read-only.", className: "archive" };
    default:
      return { title: event.type.replaceAll("_", " "), detail: stepLabel, className: "" };
  }
}

function renderExport() {
  const run = getCurrentRun();
  if (!run) return;
  document.getElementById("export-run-id").textContent = displayRunId(run.id);
  document.getElementById("generated-export-count").textContent =
    String(state.generatedExports.length);
  const container = document.getElementById("generated-export-list");
  if (!state.generatedExports.length) {
    container.innerHTML = `
      <div class="generated-export-empty">
        ${iconMarkup("file-text")}
        <span>No generated exports yet</span>
      </div>`;
    return;
  }

  container.innerHTML = state.generatedExports.map((exportRecord) => `
    <div class="generated-export-row" data-export-id="${escapeHtml(exportRecord.id)}">
      <button
        class="generated-export-main focusable"
        data-action="preview-export"
        data-export-id="${escapeHtml(exportRecord.id)}"
      >
        <span class="generated-export-icon">${iconMarkup("file-text")}</span>
        <span class="generated-export-copy">
          <strong>${escapeHtml(exportRecord.filename)}</strong>
          <small>${formatDateTime(exportRecord.createdAt)} · ${formatBytes(exportRecord.content.length)}</small>
        </span>
        <span class="generated-export-format">${escapeHtml(exportRecord.format.toUpperCase())}</span>
      </button>
      <button
        class="generated-export-delete focusable"
        data-action="delete-export"
        data-export-id="${escapeHtml(exportRecord.id)}"
        aria-label="Delete ${escapeHtml(exportRecord.filename)}"
      >${iconMarkup("trash-2")}</button>
    </div>
  `).join("");
}

function renderExportPreview() {
  const exportRecord = state.generatedExports.find((item) => item.id === state.currentExportId);
  if (!exportRecord) {
    goBack();
    return;
  }
  document.getElementById("export-preview-name").textContent = exportRecord.filename;
  document.getElementById("export-preview-meta").innerHTML = `
    <span>${escapeHtml(exportRecord.format.toUpperCase())}</span>
    <span>${formatDateTime(exportRecord.createdAt)}</span>
    <span>${formatBytes(exportRecord.content.length)}</span>`;
  document.getElementById("export-preview-text").textContent = exportRecord.content;
}

async function persistCurrentRun() {
  const run = getCurrentRun();
  if (!run) return;
  await saveRun(run);
  state.runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function saveNoteDraft({ silent = false } = {}) {
  const run = getCurrentRun();
  const step = getSelectedStep();
  const textarea = document.getElementById("step-note-text");
  if (
    !run ||
    !step ||
    !textarea ||
    run.status === "archived" ||
    !getStepAccess().canEdit
  ) return false;

  const changed = updateStepNotes(
    run,
    step.id,
    state.noteDraftTag,
    textarea.value
  );
  if (changed) {
    await persistCurrentRun();
    if (!silent) showToast("Step note saved", "success");
  } else if (!silent) {
    showToast("No note changes");
  }
  return changed;
}

function closeNoteMenu({ returnFocus = true } = {}) {
  const trigger = document.getElementById("note-tag-trigger");
  const menu = document.getElementById("note-tag-menu");
  if (!trigger || !menu) return;
  state.noteMenuOpen = false;
  trigger.setAttribute("aria-expanded", "false");
  menu.classList.add("hidden");
  if (returnFocus) focusElement(trigger);
}

function toggleNoteMenu() {
  const trigger = document.getElementById("note-tag-trigger");
  const menu = document.getElementById("note-tag-menu");
  if (!trigger || !menu) return;

  if (state.noteMenuOpen) {
    closeNoteMenu();
    return;
  }

  state.noteMenuOpen = true;
  trigger.setAttribute("aria-expanded", "true");
  menu.classList.remove("hidden");
  const options = Array.from(menu.querySelectorAll(".note-select-option"));
  const selected = options.find((option) => option.dataset.tag === state.noteDraftTag) || options[0];
  const selector = trigger.closest(".note-tag-select");
  requestAnimationFrame(() => {
    selector?.scrollIntoView({ block: "start", behavior: "smooth" });
    menu.scrollTop = Math.max(0, selected.offsetTop - menu.offsetTop - 6);
    selected.focus({ preventScroll: true });
  });
}

function selectNoteTag(element) {
  state.noteDraftTag = element.dataset.tag || "";
  document.getElementById("note-tag-value").textContent = state.noteDraftTag || "Select tag";
  document.querySelectorAll(".note-select-option").forEach((option) => {
    const selected = option.dataset.tag === state.noteDraftTag;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", String(selected));
  });
  closeNoteMenu();
}

async function handleAction(action, element) {
  switch (action) {
    case "back":
      goBack();
      break;
    case "go-home":
      goHome();
      break;
    case "open-templates":
      setScreen("templates");
      break;
    case "open-history":
      setScreen("history");
      break;
    case "select-template":
      state.selectedTemplateId = element.dataset.templateId;
      setScreen("template-detail");
      break;
    case "start-procedure":
      setScreen("start-run");
      break;
    case "create-run": {
      const template = getTemplate(state.selectedTemplateId);
      const name = document.getElementById("run-name").value;
      if (!template) return;
      const run = createRun(template, name);
      state.runs.unshift(run);
      state.currentRunId = run.id;
      await saveRun(run);
      state.screenHistory = [];
      setScreen("procedure", { addToHistory: false });
      showToast("Procedure run started", "success");
      break;
    }
    case "resume-run":
    case "review-run":
      state.currentRunId = element.dataset.runId;
      state.selectedStepIndex = 0;
      setScreen("procedure");
      break;
    case "open-step":
      {
        const requestedIndex = Number(element.dataset.index);
        const access = getStepAccess(requestedIndex);
        if (!access.canView) {
          showToast("Complete earlier steps before opening this step");
          break;
        }
        state.selectedStepIndex = requestedIndex;
      }
      setScreen("step-detail");
      break;
    case "open-step-image":
      if (getSelectedStep()?.image) setScreen("step-image");
      break;
    case "previous-step":
      await saveNoteDraft({ silent: true });
      state.selectedStepIndex = Math.max(0, state.selectedStepIndex - 1);
      renderStepDetail();
      focusFirst(screens["step-detail"]);
      break;
    case "next-step": {
      await saveNoteDraft({ silent: true });
      const template = getCurrentTemplate();
      const nextIndex = Math.min(template.steps.length - 1, state.selectedStepIndex + 1);
      if (!getStepAccess(nextIndex).canView) {
        showToast("Complete the current step before moving ahead");
        break;
      }
      state.selectedStepIndex = nextIndex;
      renderStepDetail();
      focusFirst(screens["step-detail"]);
      break;
    }
    case "toggle-completion": {
      await saveNoteDraft({ silent: true });
      const run = getCurrentRun();
      const template = getCurrentTemplate();
      const step = getSelectedStep();
      if (!getStepAccess().canEdit) {
        showToast("Complete the preceding step before taking action");
        break;
      }
      const wasCompleted = run.stepStates[step.id].completed;
      toggleStepCompletion(run, template, step.id);
      await persistCurrentRun();
      renderStepDetail();
      showToast(wasCompleted ? "Step reopened; prior event retained" : "Step completed", wasCompleted ? "" : "success");
      break;
    }
    case "toggle-note-menu":
      toggleNoteMenu();
      break;
    case "select-note-tag":
      selectNoteTag(element);
      break;
    case "save-note":
      await saveNoteDraft();
      renderStepDetail();
      break;
    case "clear-note":
      showModal({
        title: "Clear step note?",
        message: "This clears the current note tag and text. The change will be recorded in the audit log.",
        icon: "!",
        actions: [
          { label: "Cancel", primary: false, handler: () => {} },
          {
            label: "Clear note",
            primary: true,
            handler: async () => {
              const textarea = document.getElementById("step-note-text");
              state.noteDraftTag = "";
              if (textarea) textarea.value = "";
              await saveNoteDraft({ silent: true });
              renderStepDetail();
              showToast("Step note cleared");
            }
          }
        ]
      });
      break;
    case "add-mock-photo":
      showModal({
        title: "Mock photo evidence",
        message: "Camera capture is simulated in this prototype. A future native companion app will use Meta Wearables DAT to capture an image from the glasses.",
        icon: "i",
        actions: [
          { label: "Cancel", primary: false, handler: () => {} },
          {
            label: "Add mock photo",
            primary: true,
            handler: async () => {
              const run = getCurrentRun();
              const step = getSelectedStep();
              addMockAttachment(run, step.id);
              await persistCurrentRun();
              renderStepDetail();
              showToast("Mock photo attached", "success");
            }
          }
        ]
      });
      break;
    case "remove-attachment":
      showModal({
        title: "Remove mock photo?",
        message: "The attachment will be removed and the action will remain visible in the audit log.",
        icon: "!",
        actions: [
          { label: "Cancel", primary: false, handler: () => {} },
          {
            label: "Remove",
            primary: true,
            handler: async () => {
              const run = getCurrentRun();
              const step = getSelectedStep();
              removeAttachment(run, step.id, element.dataset.attachmentId);
              await persistCurrentRun();
              renderStepDetail();
              showToast("Mock photo removed");
            }
          }
        ]
      });
      break;
    case "open-run-info":
      setScreen("run-info");
      break;
    case "open-audit":
      setScreen("audit");
      break;
    case "open-export":
      state.generatedExports = await getExportsForRun(getCurrentRun().id);
      setScreen("export");
      break;
    case "preview-export": {
      const exportId = element.dataset.exportId;
      let exportRecord = state.generatedExports.find((item) => item.id === exportId);
      if (!exportRecord) {
        exportRecord = await getExport(exportId);
        if (exportRecord) state.generatedExports.push(exportRecord);
      }
      if (!exportRecord) {
        showToast("Export is no longer available", "error");
        break;
      }
      state.currentExportId = exportId;
      setScreen("export-preview");
      break;
    }
    case "delete-export": {
      const exportId = element.dataset.exportId;
      const exportRecord = state.generatedExports.find((item) => item.id === exportId);
      if (!exportRecord) return;
      showModal({
        title: "Delete generated export?",
        message: `${exportRecord.filename} will be removed from this device.`,
        icon: "trash-2",
        tone: "danger",
        actions: [
          { label: "Cancel", primary: false, handler: () => {} },
          {
            label: "Delete",
            danger: true,
            handler: async () => {
              await deleteExport(exportId);
              state.generatedExports = state.generatedExports.filter((item) => item.id !== exportId);
              renderExport();
              focusFirst(screens.export);
              showToast("Generated export deleted");
            }
          }
        ]
      });
      break;
    }
    case "archive-run": {
      const run = getCurrentRun();
      if (!run || run.status === "archived") return;
      showModal({
        title: "Archive this run?",
        message: "Archived runs remain available for review and export, but their steps, notes, and attachments become read-only.",
        icon: "!",
        actions: [
          { label: "Cancel", primary: false, handler: () => {} },
          {
            label: "Archive",
            primary: true,
            handler: async () => {
              archiveRun(run);
              await persistCurrentRun();
              goHome();
              showToast("Run archived");
            }
          }
        ]
      });
      break;
    }
    case "download-json":
      await downloadExport("json");
      break;
    case "download-csv":
      await downloadExport("csv");
      break;
    case "modal-choice": {
      const selected = state.modalActions[Number(element.dataset.index)];
      closeModal();
      if (selected?.handler) await selected.handler();
      break;
    }
  }
}

async function downloadExport(format) {
  const run = getCurrentRun();
  const template = getCurrentTemplate();
  if (!run || !template) return;

  const timestamp = nowIso();
  const exportId = createId("export");
  recordExport(run, format, timestamp, exportId);
  const generated = createGeneratedExport(run, template, format, timestamp, exportId);
  await saveExport(generated);
  await persistCurrentRun();

  state.generatedExports = [
    generated,
    ...state.generatedExports.filter((item) => item.id !== generated.id)
  ];
  renderExport();

  const blob = new Blob([generated.content], { type: generated.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = generated.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  requestAnimationFrame(() => {
    focusElement(
      document.querySelector(`.generated-export-main[data-export-id="${generated.id}"]`)
    );
  });
  showToast(`${format.toUpperCase()} export generated`, "success");
}

function moveExportFocus(direction, activeElement) {
  const items = Array.from(
    screens.export.querySelectorAll(".export-option, .generated-export-main")
  ).filter((element) => element.offsetParent !== null);
  if (!items.length) return;

  const mainElement = activeElement.classList.contains("generated-export-delete")
    ? activeElement.closest(".generated-export-row")?.querySelector(".generated-export-main")
    : activeElement;
  const currentIndex = items.indexOf(mainElement);
  const delta = direction === "up" ? -1 : 1;
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + delta + items.length) % items.length;
  focusElement(items[nextIndex]);
}

function setupEvents() {
  document.addEventListener("click", (event) => {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement || actionElement.disabled) return;
    void handleAction(actionElement.dataset.action, actionElement).catch((error) => {
      console.error(error);
      showToast(error.message || "Action failed", "error");
    });
  });

  document.addEventListener("keydown", (event) => {
    const modalOpen = !document.getElementById("modal").classList.contains("hidden");
    const activeElement = document.activeElement;
    const editingText = activeElement?.matches("input, textarea");

    if (event.key === "Escape") {
      event.preventDefault();
      if (state.noteMenuOpen) closeNoteMenu();
      else if (modalOpen) closeModal();
      else goBack();
      return;
    }

    if (editingText) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(event.key === "ArrowUp" ? "up" : "down");
        return;
      }

      if (event.key === "Enter" && activeElement.tagName === "INPUT") {
        event.preventDefault();
        moveFocus("down");
      }
      return;
    }

    if (activeElement?.id === "export-preview-text") {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        activeElement.scrollBy({
          top: event.key === "ArrowUp" ? -96 : 96,
          behavior: "smooth"
        });
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusElement(screens["export-preview"].querySelector('[data-action="back"]'));
        return;
      }
    }

    if (
      activeElement?.classList.contains("generated-export-main") ||
      activeElement?.classList.contains("generated-export-delete")
    ) {
      const row = activeElement.closest(".generated-export-row");
      if (event.key === "ArrowRight" && activeElement.classList.contains("generated-export-main")) {
        event.preventDefault();
        focusElement(row?.querySelector(".generated-export-delete"));
        return;
      }
      if (event.key === "ArrowLeft" && activeElement.classList.contains("generated-export-delete")) {
        event.preventDefault();
        focusElement(row?.querySelector(".generated-export-main"));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        moveExportFocus(event.key === "ArrowUp" ? "up" : "down", activeElement);
        return;
      }
    }

    if (activeElement?.classList.contains("checklist-row")) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusElement(screens.procedure.querySelector('[data-action="go-home"]'));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        focusElement(screens.procedure.querySelector(".action-rail .focusable:not([disabled])"));
        return;
      }
    }

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      moveFocus(event.key.replace("Arrow", "").toLowerCase());
      return;
    }

    if (event.key === "Enter" && activeElement?.classList.contains("focusable")) {
      event.preventDefault();
      activeElement.click();
    }
  });
}

async function initialize() {
  await loadProcedureTemplates();
  const templateErrors = validateTemplates(PROCEDURE_TEMPLATES);
  if (templateErrors.length) {
    console.error("[Templates]", templateErrors);
    showToast("Built-in template validation failed", "error");
    return;
  }

  setupEvents();
  state.runs = await getAllRuns();
  setScreen("home", { addToHistory: false });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("[ServiceWorker] Registration failed", error);
    });
  }
}

initialize().catch((error) => {
  console.error(error);
  showToast("Unable to initialize the app", "error");
});
