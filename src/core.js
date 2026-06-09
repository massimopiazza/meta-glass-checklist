const NOTE_TAGS = ["Nominal", "Observation", "Anomaly", "Hold", "Retest"];

export { NOTE_TAGS };

// A step is "resolved" once it has been completed or explicitly marked not
// applicable. Both states satisfy the sequential gate and run completion.
export function isStepResolved(stepState) {
  return Boolean(stepState?.completed || stepState?.notApplicable);
}

export function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createRun(template, name, timestamp = nowIso()) {
  const compactDate = timestamp.slice(2, 10).replaceAll("-", "");
  const timePart = timestamp.slice(11, 23).replaceAll(":", "").replace(".", "");
  const entropy = Math.random().toString(36).slice(2, 4).toUpperCase();
  const suffix = `${timePart}-${entropy}`;
  const id = `${template.code}-${compactDate}-${suffix}`;
  const stepStates = {};

  for (const step of template.steps) {
    stepStates[step.id] = {
      completed: false,
      completedAt: null,
      completionCount: 0,
      reopenCount: 0,
      notApplicable: false,
      notApplicableAt: null,
      tags: [],
      noteText: "",
      attachments: []
    };
  }

  return {
    id,
    templateId: template.id,
    templateVersion: template.version,
    templateTitle: template.title,
    name: name.trim() || id,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    archivedAt: null,
    stepStates,
    audit: [
      {
        id: createId("event"),
        type: "run_started",
        at: timestamp,
        details: {
          templateId: template.id,
          templateVersion: template.version,
          name: name.trim() || id
        }
      }
    ]
  };
}

export function calculateProgress(run, template) {
  const total = template.steps.length;
  let completed = 0;
  let notApplicable = 0;
  for (const step of template.steps) {
    const stepState = run.stepStates[step.id];
    if (stepState?.completed) completed += 1;
    else if (stepState?.notApplicable) notApplicable += 1;
  }
  // "Resolved" steps (completed or N/A) count as done for the progress bar,
  // sequential gating, and automatic run completion.
  const resolved = completed + notApplicable;

  return {
    completed,
    notApplicable,
    resolved,
    total,
    percent: total ? Math.round((resolved / total) * 100) : 0
  };
}

// Sequential procedures expose every step for preview. Only the current step in
// the sequence (the first unresolved step) and the resolved steps behind it are
// editable; upcoming steps are read-only until the sequence reaches them.
export function getSequentialAccess(run, template, stepIndex) {
  const sequential = Boolean(template.executionPolicy?.sequential);
  if (!sequential || run.status === "completed") {
    return { sequential, firstIncompleteIndex: -1, canView: true, canEdit: true };
  }

  const firstIncompleteIndex = template.steps.findIndex((step) => {
    return !isStepResolved(run.stepStates[step.id]);
  });
  if (firstIncompleteIndex < 0) {
    return { sequential, firstIncompleteIndex, canView: true, canEdit: true };
  }

  return {
    sequential,
    firstIncompleteIndex,
    // Every step can be opened and previewed; only the frontier and the
    // resolved steps before it accept edits.
    canView: true,
    canEdit: stepIndex <= firstIncompleteIndex
  };
}

export function toggleStepCompletion(run, template, stepId, timestamp = nowIso()) {
  const stepState = run.stepStates[stepId];
  if (!stepState) {
    throw new Error(`Unknown step: ${stepId}`);
  }

  if (stepState.completed) {
    stepState.completed = false;
    stepState.completedAt = null;
    stepState.reopenCount += 1;
    run.audit.push({
      id: createId("event"),
      type: "step_reopened",
      at: timestamp,
      stepId
    });

    if (run.status === "completed") {
      run.status = "active";
      run.completedAt = null;
      run.audit.push({
        id: createId("event"),
        type: "run_reopened",
        at: timestamp,
        details: { reason: "A completed step was reopened." }
      });
    }
  } else {
    // Completing a step supersedes any not-applicable mark.
    if (stepState.notApplicable) {
      stepState.notApplicable = false;
      stepState.notApplicableAt = null;
      run.audit.push({
        id: createId("event"),
        type: "step_na_cleared",
        at: timestamp,
        stepId,
        details: { reason: "Step was completed." }
      });
    }
    stepState.completed = true;
    stepState.completedAt = timestamp;
    stepState.completionCount += 1;
    run.audit.push({
      id: createId("event"),
      type: "step_completed",
      at: timestamp,
      stepId,
      details: { completionCount: stepState.completionCount }
    });

    maybeCompleteRun(run, template, timestamp);
  }

  run.updatedAt = timestamp;
  return run;
}

// Marks or clears the not-applicable state for a step. A not-applicable step is
// "resolved": it satisfies the sequential gate and counts toward run completion,
// but is never recorded as completed.
export function toggleStepNotApplicable(run, template, stepId, timestamp = nowIso()) {
  const stepState = run.stepStates[stepId];
  if (!stepState) {
    throw new Error(`Unknown step: ${stepId}`);
  }

  if (stepState.notApplicable) {
    stepState.notApplicable = false;
    stepState.notApplicableAt = null;
    run.audit.push({
      id: createId("event"),
      type: "step_na_cleared",
      at: timestamp,
      stepId
    });

    if (run.status === "completed") {
      run.status = "active";
      run.completedAt = null;
      run.audit.push({
        id: createId("event"),
        type: "run_reopened",
        at: timestamp,
        details: { reason: "A not-applicable step was reopened." }
      });
    }
  } else {
    // Marking a completed step as not applicable supersedes its completion.
    if (stepState.completed) {
      stepState.completed = false;
      stepState.completedAt = null;
      run.audit.push({
        id: createId("event"),
        type: "step_reopened",
        at: timestamp,
        stepId,
        details: { reason: "Step was marked not applicable." }
      });
    }
    stepState.notApplicable = true;
    stepState.notApplicableAt = timestamp;
    run.audit.push({
      id: createId("event"),
      type: "step_marked_na",
      at: timestamp,
      stepId
    });

    maybeCompleteRun(run, template, timestamp);
  }

  run.updatedAt = timestamp;
  return run;
}

// Promotes an active run to completed once every step is resolved.
function maybeCompleteRun(run, template, timestamp) {
  if (run.status === "completed") return;
  const progress = calculateProgress(run, template);
  if (progress.resolved === progress.total) {
    run.status = "completed";
    run.completedAt = timestamp;
    run.audit.push({
      id: createId("event"),
      type: "run_completed",
      at: timestamp
    });
  }
}

export function updateStepNotes(run, stepId, tag, noteText, timestamp = nowIso()) {
  const stepState = run.stepStates[stepId];
  if (!stepState) {
    throw new Error(`Unknown step: ${stepId}`);
  }

  const requestedTag = Array.isArray(tag) ? tag[0] : tag;
  const normalizedTags = NOTE_TAGS.includes(requestedTag) ? [requestedTag] : [];
  const normalizedText = noteText.trim();
  const changed =
    JSON.stringify(stepState.tags) !== JSON.stringify(normalizedTags) ||
    stepState.noteText !== normalizedText;

  if (!changed) return false;

  stepState.tags = normalizedTags;
  stepState.noteText = normalizedText;
  run.updatedAt = timestamp;
  run.audit.push({
    id: createId("event"),
    type: "note_updated",
    at: timestamp,
    stepId,
    details: {
      tags: normalizedTags,
      hasText: Boolean(normalizedText)
    }
  });
  return true;
}

export function addMockAttachment(run, stepId, timestamp = nowIso()) {
  const stepState = run.stepStates[stepId];
  if (!stepState) {
    throw new Error(`Unknown step: ${stepId}`);
  }

  const attachment = {
    id: createId("mock-photo"),
    kind: "mock-photo",
    label: `Mock evidence ${stepState.attachments.length + 1}`,
    createdAt: timestamp,
    provider: "prototype"
  };

  stepState.attachments.push(attachment);
  run.updatedAt = timestamp;
  run.audit.push({
    id: createId("event"),
    type: "mock_attachment_added",
    at: timestamp,
    stepId,
    details: { attachmentId: attachment.id }
  });
  return attachment;
}

export function removeAttachment(run, stepId, attachmentId, timestamp = nowIso()) {
  const stepState = run.stepStates[stepId];
  if (!stepState) return false;

  const originalLength = stepState.attachments.length;
  stepState.attachments = stepState.attachments.filter((item) => item.id !== attachmentId);
  if (stepState.attachments.length === originalLength) return false;

  run.updatedAt = timestamp;
  run.audit.push({
    id: createId("event"),
    type: "mock_attachment_removed",
    at: timestamp,
    stepId,
    details: { attachmentId }
  });
  return true;
}

export function archiveRun(run, timestamp = nowIso()) {
  if (run.status === "archived") return false;
  run.status = "archived";
  run.archivedAt = timestamp;
  run.updatedAt = timestamp;
  run.audit.push({
    id: createId("event"),
    type: "run_archived",
    at: timestamp
  });
  return true;
}

export function recordExport(run, format, timestamp = nowIso(), exportId = null) {
  run.updatedAt = timestamp;
  run.audit.push({
    id: createId("event"),
    type: "export_generated",
    at: timestamp,
    details: { format, exportId }
  });
}

export function buildExportPackage(run, template) {
  return {
    schemaVersion: 1,
    exportedAt: nowIso(),
    template: structuredClone(template),
    run: structuredClone(run)
  };
}

export function escapeCsv(value) {
  const stringValue = value == null ? "" : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

export function buildStepCsv(run, template) {
  const headers = [
    "run_id",
    "run_name",
    "run_status",
    "template_id",
    "template_version",
    "step_id",
    "step_title",
    "completed",
    "completed_at",
    "completion_count",
    "reopen_count",
    "not_applicable",
    "not_applicable_at",
    "note_tag",
    "note_text",
    "mock_attachment_count",
    "run_updated_at"
  ];

  const rows = template.steps.map((step) => {
    const state = run.stepStates[step.id];
    return [
      run.id,
      run.name,
      run.status,
      template.id,
      template.version,
      step.id,
      step.title,
      state.completed,
      state.completedAt,
      state.completionCount,
      state.reopenCount,
      state.notApplicable,
      state.notApplicableAt,
      state.tags.join("|"),
      state.noteText,
      state.attachments.length,
      run.updatedAt
    ];
  });

  return [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");
}

export function createGeneratedExport(
  run,
  template,
  format,
  timestamp = nowIso(),
  exportId = createId("export")
) {
  const normalizedFormat = format === "csv" ? "csv" : "json";
  const filenameBase = run.id.toLowerCase();
  return {
    id: exportId,
    runId: run.id,
    format: normalizedFormat,
    filename: `${filenameBase}.${normalizedFormat}`,
    createdAt: timestamp,
    mimeType: normalizedFormat === "json"
      ? "application/json"
      : "text/csv;charset=utf-8",
    content: normalizedFormat === "json"
      ? JSON.stringify(buildExportPackage(run, template), null, 2)
      : buildStepCsv(run, template)
  };
}

export function validateTemplates(templates) {
  const templateIds = new Set();
  const errors = [];

  for (const template of templates) {
    if (templateIds.has(template.id)) {
      errors.push(`Duplicate template id: ${template.id}`);
    }
    templateIds.add(template.id);

    if (
      template.schemaVersion !== 1 ||
      !template.version ||
      !template.title ||
      !template.steps?.length ||
      typeof template.executionPolicy?.sequential !== "boolean"
    ) {
      errors.push(`Incomplete template: ${template.id}`);
    }

    const stepIds = new Set();
    for (const step of template.steps || []) {
      if (stepIds.has(step.id)) {
        errors.push(`Duplicate step id ${step.id} in ${template.id}`);
      }
      stepIds.add(step.id);
      if (!step.title || !step.description) {
        errors.push(`Incomplete step ${step.id} in ${template.id}`);
      }
      if (!Array.isArray(step.images)) {
        errors.push(`Missing images array on ${step.id} in ${template.id}`);
      } else {
        for (const image of step.images) {
          if (
            !image?.src ||
            !image?.alt ||
            !image?.caption ||
            !image?.credit ||
            !image?.sourceUrl
          ) {
            errors.push(`Incomplete image metadata on ${step.id} in ${template.id}`);
          }
        }
      }
    }
  }
  return errors;
}
