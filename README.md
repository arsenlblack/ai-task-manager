# AI-First Task Manager

This project is a minimal, working vertical slice of an **AI-first task manager** where a Custom GPT is the primary user interface, Google Sheets is the single source of truth, and Google Apps Script (GAS) provides explicit, deterministic HTTP endpoints.

The goal is not feature completeness, but **clarity, safety, and explainability** of GPT-driven operations.

---

## Architecture Overview

* **Custom GPT** — interprets free-text user intent and calls backend actions.
* **Google Apps Script Web App** — exposes a single, explicit API for all reads and writes.
* **Google Sheets** — authoritative system of record; no hidden state elsewhere.

GPT is treated as an *untrusted reasoning layer*. All validation and state transitions are enforced by the backend.

---

## Data Model (Google Sheet)

Single sheet: `tasks`

Fields:

* `id` — UUID
* `title` — task title
* `status` — `active | completed`
* `priority` — integer (default = 2)
* `start_at` — ISO timestamp, optional (task availability gate)
* `due_at` — ISO timestamp, optional
* `snoozed_until` — ISO timestamp, optional
* `created_at` — ISO timestamp
* `completed_at` — ISO timestamp, optional

Notes:

* **Snooze is modeled as temporal availability**, not a lifecycle state.
* Missing `start_at` means the task is immediately actionable.

---

## API Design

All operations are performed via a single endpoint:

`POST /exec`

With explicit actions:

* `create_task`
* `update_tasks`
* `complete_tasks`
* `snooze_tasks`
* `get_tasks`

Key properties:

* No implicit mutations
* ID-based updates only
* Required filters for reads (to prevent overfetch and hallucination)
* Deterministic error responses surfaced verbatim to GPT

---

## Relevance Logic: “Best Task Right Now”

Relevance is **deterministic and explainable by design**.

Scoring factors:

1. Priority (dominant signal)
2. Due date proximity (urgency refinement)
3. Task age (prevents starvation)

Only tasks that are:

* `active`
* not snoozed into the future
* not gated by future `start_at`

are considered.

The API returns both the recommended task and a human-readable reason.

---

## Assumptions

* Single-user task space
* No authentication or PII (test data only)
* GPT may hallucinate intent; backend must remain strict
* Time expressions are resolved by GPT into explicit UTC timestamps before API calls

---

## Trade-offs

* Deterministic rules over ML heuristics (auditability > optimality)
* Required query filters to avoid unbounded reads
* Minimal schema to keep reasoning and debugging transparent

This intentionally favors **predictable behavior over cleverness**.

---

## Observability

* All requests are logged with timestamp, action, payload, and result
* Logs are viewable via Apps Script execution logs

This provides basic traceability without external tooling.

---

## How to Run / Test

1. Open the Google Sheet and ensure the `tasks` sheet exists with the expected headers.
2. Deploy the Apps Script project as a Web App:

   * Execute as: **Me**
   * Access: **Anyone**
3. Copy the Web App URL and configure it in the Custom GPT Action.
4. Use natural-language prompts via GPT to create, query, update, snooze, and complete tasks.

No credentials are required.

---

## Production Security Notes

In a real production deployment:

* Endpoints would be protected via OAuth or service-to-service authentication
* Requests would include user identity and authorization context
* Sheet access would be replaced or wrapped with row-level ACLs
* Rate limiting and request validation would be enforced at the edge

These concerns are intentionally out of scope for this assessment.

---

## Optional Web Viewer

The optional “read-only web viewer” mentioned in the prompt refers to a small HTML page (served via GAS or static hosting) that displays tasks for inspection.

It is **not required** and was intentionally omitted to keep focus on GPT-driven workflows.

---

## Summary

This project demonstrates how to safely integrate GPT into a stateful system by:

* enforcing strict backend contracts
* making relevance logic explainable
* treating the model as a reasoning assistant, not a source of truth
