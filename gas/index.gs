function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action;
    const payload = normalizePayload(body.payload || {});

    if (!action) {
      const error = { error: "Missing action" };
      logEvent("invalid_request", body, error);
      return jsonResponse(error);
    }

    let response;

    switch (action) {
      case "create_task":
        response = createTask(payload);
        break;

      case "update_tasks":
        response = updateTasks(payload);
        break;

      case "complete_tasks":
        response = completeTasks(payload);
        break;

      case "snooze_tasks":
        response = snoozeTasks(payload);
        break;

      case "get_tasks":
        response = getTasks(payload);
        break;

      default:
        response = jsonResponse({ error: "Unknown action" });
    }

    logEvent(action, payload, JSON.parse(response.getContent()));
    return response;

  } catch (err) {
    logEvent("exception", null, err.message);
    return jsonResponse({ error: err.message });
  }
}

/* =======================
   LOGGING & HELPERS
======================= */

function normalizePayload(p) {
  const clean = {};
  Object.keys(p || {}).forEach(k => {
    if (p[k] !== "" && p[k] !== "*" && p[k] !== null && p[k] !== undefined) {
      clean[k] = p[k];
    }
  });
  return clean;
}

function logEvent(action, payload, result) {
  console.log(JSON.stringify({
    ts: nowISO(),
    action,
    payload,
    result
  }));
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  return SpreadsheetApp.getActive().getSheetByName("tasks");
}

function nowISO() {
  return new Date().toISOString();
}

function uuid() {
  return Utilities.getUuid();
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/* =======================
   TIME FILTERING
======================= */

function applyTimeRange(tasks, range, field) {
  const from = new Date(range.from);
  const to = new Date(range.to);

  return tasks.filter(t => {
    if (!t[field]) return false;
    const d = new Date(t[field]);
    return d >= from && d <= to;
  });
}

/* =======================
   CREATE
======================= */

function createTask(payload) {
  if (!payload.title) {
    return jsonResponse({ error: "title is required" });
  }

  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const now = new Date(nowISO());

  const titleIdx = headers.indexOf("title");
  const statusIdx = headers.indexOf("status");
  const createdIdx = headers.indexOf("created_at");

  for (let r of rows) {
    if (
      r[titleIdx] === payload.title &&
      r[statusIdx] === "active" &&
      sameDay(new Date(r[createdIdx]), now)
    ) {
      return jsonResponse({
        ok: true,
        idempotent: true
      });
    }
  }

  const task = {
    id: uuid(),
    title: payload.title,
    status: "active",
    priority: Number.isInteger(payload.priority) ? payload.priority : 2,
    start_at: payload.start_at || "",
    due_at: payload.due_at || "",
    snoozed_until: "",
    created_at: nowISO(),
    completed_at: ""
  };

  sheet.appendRow(Object.values(task));
  return jsonResponse({ ok: true, task });
}

/* =======================
   UPDATE (BULK, ID ONLY)
======================= */

function updateTasks(payload) {
  if (!Array.isArray(payload.tasks) || !payload.tasks.length) {
    return jsonResponse({ error: "tasks array is required" });
  }

  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();

  const idCol = headers.indexOf("id");
  const indexById = {};

  rows.forEach((r, i) => {
    indexById[r[idCol]] = i + 2;
  });

  let updated = 0;

  payload.tasks.forEach(t => {
    const row = indexById[t.id];
    if (!row) return;

    Object.keys(t).forEach(key => {
      if (key === "id") return;
      if (t[key] === "" || t[key] === null || t[key] === undefined) return;

      const col = headers.indexOf(key);
      if (col !== -1) {
        sheet.getRange(row, col + 1).setValue(t[key]);
      }
    });

    updated++;
  });

  return jsonResponse({ ok: true, updated });
}

/* =======================
   COMPLETE (BULK)
======================= */

function completeTasks(payload) {
  if (!Array.isArray(payload.ids) || !payload.ids.length) {
    return jsonResponse({ error: "ids array is required" });
  }

  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();

  const idCol = headers.indexOf("id");
  const statusCol = headers.indexOf("status") + 1;
  const completedCol = headers.indexOf("completed_at") + 1;

  let count = 0;
  rows.forEach((r, i) => {
    if (payload.ids.includes(r[idCol])) {
      sheet.getRange(i + 2, statusCol).setValue("completed");
      sheet.getRange(i + 2, completedCol).setValue(nowISO());
      count++;
    }
  });

  return jsonResponse({ ok: true, completed: count });
}

/* =======================
   SNOOZE (BULK)
======================= */

function snoozeTasks(payload) {
  if (!Array.isArray(payload.tasks) || !payload.tasks.length) {
    return jsonResponse({ error: "tasks array is required" });
  }

  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();

  const idCol = headers.indexOf("id");
  const snoozeCol = headers.indexOf("snoozed_until") + 1;

  let count = 0;

  payload.tasks.forEach(t => {
    rows.forEach((r, i) => {
      if (r[idCol] === t.id) {
        sheet.getRange(i + 2, snoozeCol).setValue(t.snoozed_until);
        count++;
      }
    });
  });

  return jsonResponse({ ok: true, snoozed: count });
}

/* =======================
   GET TASKS (QUERY)
======================= */

function getTasks(payload) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const now = new Date(nowISO());

  let tasks = rows.map(r =>
    Object.fromEntries(headers.map((h, i) => [h, r[i]]))
  );
  
  if (!payload.filters || Object.keys(payload.filters).length === 0) {
    return jsonResponse({
      error: "At least one explicit filter is required"
    });
  }

  if (payload.filters.status) {
    tasks = tasks.filter(t => t.status === payload.filters.status);
  }

  if (payload.filters.title_contains) {
    const q = payload.filters.title_contains.trim().toLowerCase();

    if (q !== "*" && q !== "") {
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(q)
      );
    }
  }

  if (payload.filters.time_range) {
    const { from, to } = payload.filters.time_range;
    if (!from || !to) {
      return jsonResponse({
        error: "time_range.from and time_range.to must be non-empty ISO strings"
      });
    }
    if (!payload.filters.time_field) {
      return jsonResponse({ error: "time_field required when time_range is specified" });
    }

    tasks = applyTimeRange(tasks, payload.filters.time_range, payload.filters.time_field);
  }

  const isActionableQuery = payload.recommend === true;

  if (isActionableQuery) {
    tasks = tasks.filter(t => {
      if (t.status !== "active") return false;
      if (t.snoozed_until && new Date(t.snoozed_until) > now) return false;
      if (t.start_at && new Date(t.start_at) > now) return false;
      return true;
    });
  }

  let response = { ok: true, tasks };

  if (payload.recommend && tasks.length) {
    tasks.forEach(t => {
      let score = 0;

      score += (t.priority || 2) * 100;

      if (t.due_at) {
        const hoursToDue = (new Date(t.due_at) - now) / 36e5;
        if (hoursToDue >= 0) {
          score += Math.max(0, 50 - hoursToDue);
        }
      }

      const ageHours = (now - new Date(t.created_at)) / 36e5;
      score += Math.min(20, ageHours / 24);

      t._score = score;
    });
    tasks.sort((a, b) => b._score - a._score);
    response.recommended = tasks[0];
    response.reason = "priority, due proximity, and task age";
  }

  return jsonResponse(response);
}
