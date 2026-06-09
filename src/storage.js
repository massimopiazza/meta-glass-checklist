const DB_NAME = "ait-procedure-runner-v1";
const DB_VERSION = 3;
const RUN_STORE = "runs";
const EXPORT_STORE = "exports";
const FALLBACK_KEY = "ait_procedure_runner_runs_v1";
const EXPORT_FALLBACK_KEY = "ait_procedure_runner_exports_v1";

function normalizeStoredRun(run) {
  const normalized = structuredClone(run);
  if (normalized.id?.startsWith("RUN-")) {
    normalized.id = normalized.id.slice(4);
  }
  for (const stepState of Object.values(normalized.stepStates || {})) {
    stepState.tags = Array.isArray(stepState.tags) ? stepState.tags.slice(0, 1) : [];
  }
  return normalized;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RUN_STORE)) {
        const store = database.createObjectStore(RUN_STORE, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(EXPORT_STORE)) {
        const exportStore = database.createObjectStore(EXPORT_STORE, { keyPath: "id" });
        exportStore.createIndex("runId", "runId", { unique: false });
        exportStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (event.oldVersion < 2) {
        const store = request.transaction.objectStore(RUN_STORE);
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const normalized = normalizeStoredRun(cursor.value);
          if (normalized.id !== cursor.value.id) {
            cursor.delete();
            store.put(normalized);
          } else {
            cursor.update(normalized);
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open database"));
  });
}

async function withStore(storeName, mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Database operation failed"));
    });
  } finally {
    database.close();
  }
}

function readFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const stored = raw ? JSON.parse(raw) : [];
    const normalized = stored.map(normalizeStoredRun);
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
      writeFallback(normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

function writeFallback(runs) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(runs));
}

function readExportFallback() {
  try {
    const raw = localStorage.getItem(EXPORT_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeExportFallback(exports) {
  localStorage.setItem(EXPORT_FALLBACK_KEY, JSON.stringify(exports));
}

export async function getAllRuns() {
  try {
    const runs = await withStore(RUN_STORE, "readonly", (store) => store.getAll());
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    console.warn("[Storage] IndexedDB unavailable, using localStorage fallback.", error);
    return readFallback().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export async function getRun(runId) {
  try {
    return (await withStore(RUN_STORE, "readonly", (store) => store.get(runId))) || null;
  } catch {
    return readFallback().find((run) => run.id === runId) || null;
  }
}

export async function saveRun(run) {
  try {
    await withStore(RUN_STORE, "readwrite", (store) => store.put(structuredClone(run)));
  } catch (error) {
    console.warn("[Storage] Persisting run to localStorage fallback.", error);
    const runs = readFallback();
    const existingIndex = runs.findIndex((item) => item.id === run.id);
    if (existingIndex >= 0) {
      runs[existingIndex] = structuredClone(run);
    } else {
      runs.push(structuredClone(run));
    }
    writeFallback(runs);
  }
  return run;
}

export async function getExportsForRun(runId) {
  try {
    const exports = await withStore(
      EXPORT_STORE,
      "readonly",
      (store) => store.index("runId").getAll(runId)
    );
    return exports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    console.warn("[Storage] Reading exports from localStorage fallback.", error);
    return readExportFallback()
      .filter((item) => item.runId === runId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export async function getExport(exportId) {
  try {
    return (await withStore(EXPORT_STORE, "readonly", (store) => store.get(exportId))) || null;
  } catch {
    return readExportFallback().find((item) => item.id === exportId) || null;
  }
}

export async function saveExport(exportRecord) {
  try {
    await withStore(
      EXPORT_STORE,
      "readwrite",
      (store) => store.put(structuredClone(exportRecord))
    );
  } catch (error) {
    console.warn("[Storage] Persisting export to localStorage fallback.", error);
    const exports = readExportFallback();
    const existingIndex = exports.findIndex((item) => item.id === exportRecord.id);
    if (existingIndex >= 0) {
      exports[existingIndex] = structuredClone(exportRecord);
    } else {
      exports.push(structuredClone(exportRecord));
    }
    writeExportFallback(exports);
  }
  return exportRecord;
}

export async function deleteExport(exportId) {
  try {
    await withStore(EXPORT_STORE, "readwrite", (store) => store.delete(exportId));
  } catch (error) {
    console.warn("[Storage] Deleting export from localStorage fallback.", error);
    writeExportFallback(readExportFallback().filter((item) => item.id !== exportId));
  }
}
