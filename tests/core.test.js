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
    PROCEDURE_TEMPLATES.every((item) => item.steps.every((step) => Object.hasOwn(step, "image"))),
    true
  );
  assert.equal(
    PROCEDURE_TEMPLATES.flatMap((item) => item.steps).filter((step) => step.image).length,
    6
  );
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

test("sequential policy allows the current step and one read-only preview", () => {
  const run = createRun(template, "Sequential demo", startedAt);

  assert.deepEqual(getSequentialAccess(run, template, 0), {
    sequential: true,
    firstIncompleteIndex: 0,
    canView: true,
    canEdit: true
  });
  assert.equal(getSequentialAccess(run, template, 1).canView, true);
  assert.equal(getSequentialAccess(run, template, 1).canEdit, false);
  assert.equal(getSequentialAccess(run, template, 2).canView, false);

  toggleStepCompletion(run, template, "EP-001", "2026-06-07T10:05:00.000Z");
  assert.equal(getSequentialAccess(run, template, 1).canEdit, true);
  assert.equal(getSequentialAccess(run, template, 2).canView, true);

  toggleStepCompletion(run, template, "EP-004", "2026-06-07T10:06:00.000Z");
  assert.equal(getSequentialAccess(run, template, 3).canView, true);
  assert.equal(getSequentialAccess(run, template, 3).canEdit, false);
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
