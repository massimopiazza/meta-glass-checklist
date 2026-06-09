import test from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";
import {
  addMockAttachment,
  buildStepCsv,
  calculateProgress,
  createGeneratedExport,
  createRun,
  getSequentialAccess,
  removeAttachment,
  toggleStepCompletion,
  toggleStepNotApplicable,
  updateStepNotes,
  validateTemplates
} from "../src/core.js";

const templatePaths = [
  new URL("../src/procedure-templates/ion-thruster-tvac-hotfire/template.json", import.meta.url),
  new URL("../src/procedure-templates/optical-payload-tvac/template.json", import.meta.url),
  new URL("../src/procedure-templates/rf-hat-payload-facility/template.json", import.meta.url)
];
const PROCEDURE_TEMPLATES = await Promise.all(
  templatePaths.map(async (url) => JSON.parse(await readFile(url, "utf8")))
);
const template = PROCEDURE_TEMPLATES[0];
const startedAt = "2026-06-07T10:00:00.000Z";

test("built-in templates are complete and have unique identifiers", () => {
  assert.deepEqual(validateTemplates(PROCEDURE_TEMPLATES), []);
  assert.equal(PROCEDURE_TEMPLATES.length, 3);
  assert.equal(
    PROCEDURE_TEMPLATES.every((item) => item.steps.every((step) => !("holdPoint" in step))),
    true
  );
  assert.equal(
    PROCEDURE_TEMPLATES.every((item) =>
      item.steps.every((step) => Array.isArray(step.images))
    ),
    true
  );
  const allSteps = PROCEDURE_TEMPLATES.flatMap((item) => item.steps);
  assert.equal(allSteps.filter((step) => step.images.length > 0).length, 6);
  assert.equal(allSteps.reduce((count, step) => count + step.images.length, 0), 9);
  assert.equal(allSteps.filter((step) => step.images.length > 1).length, 3);
});

test("run identifiers do not use the legacy RUN prefix", () => {
  const run = createRun(template, "Identifier demo", startedAt);
  assert.match(run.id, /^EP-/);
  assert.equal(run.id.startsWith("RUN-"), false);
});

test("completion and reopening preserve append-only audit history", () => {
  const run = createRun(template, "Hot-fire demo", startedAt);
  toggleStepCompletion(run, template, "EP-001", "2026-06-07T10:05:00.000Z");
  toggleStepCompletion(run, template, "EP-001", "2026-06-07T10:06:00.000Z");

  const state = run.stepStates["EP-001"];
  assert.equal(state.completed, false);
  assert.equal(state.completionCount, 1);
  assert.equal(state.reopenCount, 1);
  assert.equal(run.audit.filter((event) => event.type === "step_completed").length, 1);
  assert.equal(run.audit.filter((event) => event.type === "step_reopened").length, 1);
});

test("run completes automatically and reactivates when a step is reopened", () => {
  const run = createRun(template, "Completion demo", startedAt);
  template.steps.forEach((step, index) => {
    toggleStepCompletion(
      run,
      template,
      step.id,
      `2026-06-07T10:${String(index + 1).padStart(2, "0")}:00.000Z`
    );
  });

  assert.equal(run.status, "completed");
  assert.equal(calculateProgress(run, template).percent, 100);

  toggleStepCompletion(run, template, "EP-014", "2026-06-07T11:00:00.000Z");
  assert.equal(run.status, "active");
  assert.equal(run.completedAt, null);
  assert.ok(run.audit.some((event) => event.type === "run_reopened"));
});

test("sequential policy exposes every step but gates edits to the frontier", () => {
  const run = createRun(template, "Sequential demo", startedAt);

  assert.deepEqual(getSequentialAccess(run, template, 0), {
    sequential: true,
    firstIncompleteIndex: 0,
    canView: true,
    canEdit: true
  });
  // Every step can be opened for preview, regardless of distance from the frontier.
  assert.equal(getSequentialAccess(run, template, 1).canView, true);
  assert.equal(getSequentialAccess(run, template, 5).canView, true);
  // Only the frontier accepts edits.
  assert.equal(getSequentialAccess(run, template, 1).canEdit, false);
  assert.equal(getSequentialAccess(run, template, 5).canEdit, false);

  toggleStepCompletion(run, template, "EP-001", "2026-06-07T10:05:00.000Z");
  assert.equal(getSequentialAccess(run, template, 1).canEdit, true);
  assert.equal(getSequentialAccess(run, template, 2).canEdit, false);
  assert.equal(getSequentialAccess(run, template, 2).canView, true);
});

test("marking a step not applicable resolves it and advances the sequence", () => {
  const run = createRun(template, "N/A demo", startedAt);

  toggleStepNotApplicable(run, template, "EP-001", "2026-06-07T10:05:00.000Z");
  const stepState = run.stepStates["EP-001"];
  assert.equal(stepState.notApplicable, true);
  assert.equal(stepState.completed, false);
  assert.ok(run.audit.some((event) => event.type === "step_marked_na"));

  // The frontier advances past the N/A step.
  assert.equal(getSequentialAccess(run, template, 1).canEdit, true);
  const progress = calculateProgress(run, template);
  assert.equal(progress.notApplicable, 1);
  assert.equal(progress.resolved, 1);

  // Completing an N/A step supersedes the N/A mark.
  toggleStepCompletion(run, template, "EP-001", "2026-06-07T10:06:00.000Z");
  assert.equal(run.stepStates["EP-001"].notApplicable, false);
  assert.equal(run.stepStates["EP-001"].completed, true);
  assert.ok(run.audit.some((event) => event.type === "step_na_cleared"));
});

test("a run completes when every step is completed or N/A", () => {
  const run = createRun(template, "Mixed completion demo", startedAt);
  template.steps.forEach((step, index) => {
    const timestamp = `2026-06-07T11:${String(index + 1).padStart(2, "0")}:00.000Z`;
    if (index % 2 === 0) {
      toggleStepCompletion(run, template, step.id, timestamp);
    } else {
      toggleStepNotApplicable(run, template, step.id, timestamp);
    }
  });

  assert.equal(run.status, "completed");
  assert.equal(calculateProgress(run, template).percent, 100);

  // Reopening an N/A step reactivates the run.
  toggleStepNotApplicable(run, template, "EP-002", "2026-06-07T12:00:00.000Z");
  assert.equal(run.status, "active");
  assert.equal(run.completedAt, null);
});

test("notes normalize tags and mock attachments can be removed", () => {
  const run = createRun(template, "Evidence demo", startedAt);
  assert.equal(
    updateStepNotes(run, "EP-002", ["Observation", "Unknown"], "  Chamber clean  "),
    true
  );
  assert.deepEqual(run.stepStates["EP-002"].tags, ["Observation"]);
  assert.equal(run.stepStates["EP-002"].noteText, "Chamber clean");
  updateStepNotes(run, "EP-002", "Anomaly", "Chamber clean");
  assert.deepEqual(run.stepStates["EP-002"].tags, ["Anomaly"]);

  const attachment = addMockAttachment(run, "EP-002", "2026-06-07T10:10:00.000Z");
  assert.equal(run.stepStates["EP-002"].attachments.length, 1);
  assert.equal(removeAttachment(run, "EP-002", attachment.id), true);
  assert.equal(run.stepStates["EP-002"].attachments.length, 0);
});

test("CSV export escapes commas, quotes, and newlines", () => {
  const run = createRun(template, 'Run, "Alpha"', startedAt);
  updateStepNotes(run, "EP-001", ["Observation"], 'Line 1\n"Line 2"');
  const csv = buildStepCsv(run, template);

  assert.match(csv, /"Run, ""Alpha"""/);
  assert.match(csv, /"Line 1\n""Line 2"""/);
  assert.doesNotMatch(csv, /hold_point/);
  assert.match(csv.split("\r\n")[0], /note_tag/);
  assert.equal(csv.split("\r\n").length >= template.steps.length + 1, true);
});

test("generated exports contain persisted preview content", () => {
  const run = createRun(template, "Export demo", startedAt);
  const generated = createGeneratedExport(run, template, "json", startedAt);

  assert.equal(generated.runId, run.id);
  assert.equal(generated.format, "json");
  assert.match(generated.filename, /\.json$/);
  assert.match(generated.content, /"schemaVersion": 1/);
});
