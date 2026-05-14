# browser-agent-base Investigation

## TL;DR

**FastAPI + Python Playwright** “Axiom Builder API” (`services/api/`) with a **vanilla JS** workflow UI (`frontend/`) and optional **OpenAI** NL→steps. Browser work is **direct Playwright** in `mcp_runtime.py`, not the vendored **`playwright-mcp/`** Node package. **For the CEO demo, keep your Jotform Playwright script + HITL mock** unless you want **90–150 min** tonight for install, JSON steps, and selector tuning inside this UI.

## What it is

**Uvicorn/FastAPI** (`run_api.py`, `services/api/app.py`) exposes workflow, resume, food-delivery, TherapyNotes, extract, and health routes. **Playwright** runs automation; **OpenAI** parses chat instructions (`shared/ai/workflow_parser.py`). **`POST /api/workflow/execute-steps`** runs hand-built JSON steps **without** OpenAI. **`backend/`** is legacy simulated job flow; **`services/api/`** is current. **`main.py`** is a no-op placeholder.

## What works today

- Server starts; **`GET /health/fast`** OK; **`GET /`** serves the Browser Agent UI.
- **`POST /api/workflow/execute-steps`** executes pre-parsed steps through `mcp_executor` / `mcp_runtime`.
- Frontend **Builder** presets can hit **`execute-steps`** with embedded `workflow_json` (no NL parse).
- **`API_USE_SIMULATION=true`** → fake MCP client for logic tests.
- **TherapyNotes** executor: phased Playwright flow with structured logs (see `screenshots/tn/`).

## What doesn't work / is stubbed

- **Playwright browsers** not bundled: **`/health/browser-check`** failed here until **`playwright install`** — budget **5–15 min** per machine.
- **Chat / `run-sync` / stream** need **`OPENAI_API_KEY`** (or aliases in `config.py`) for `parse_instructions_to_steps`.
- **No GHL**, **no field-level confidence**, **no intake exception queue** (only generic step outcomes / TN errors).
- **`/api/tn/*`** needs **`TN_API_KEY`** + **`THERAPYNOTES_*`**; **`/api/extract/*`** needs **`EXTRACT_API_KEY`** or 500/401.

## Lead Intake fit assessment

| Requirement | Verdict |
|-------------|---------|
| Structured lead JSON | **Partial** — `user_data` dict only; no CRM webhook/schema. |
| Confidence / routing layer | **✗** |
| Headed/headless browser | **✓** |
| Semantic real-time logs | **Partial** — per-step logs/screenshots, not per-field confidence. |
| HITL / review UI | **Partial** — timeline UI ≠ your lead-review mock. |
| Stop before human submit | **Partial** — omit submit step; no dedicated gate type. |
| Under-5-min recordable flow | **Partial** — after browser install + working steps. |

## Three options for the demo

### Option 1: Jotform script + HITL mock (RECOMMENDED)

- **Effort:** **45–90 min** (rehearsal + recording + short voiceover).
- **Demo impact:** **High** honesty-to-effort ratio.
- **What to do:** (1) One headed dry run of your script on the Jotform. (2) Side-by-side your HITL HTML; narrate fictional low-confidence routing. (3) Record lead → fills → stop before submit → mock queue in **under 5 min**. (4) Defer GHL/scoring to Phase 1 on the diagram.
- **Risks:** Jotform DOM drift — rehearse once.
- **Why I recommend:** **Fastest credible demo**; no API keys or repo integration required.

### Option 2: This repo’s UI + `execute-steps` on Jotform (NOT RECOMMENDED for a short night)

- **Effort:** **90–150 min** (`playwright install chromium` **5–15 min**; JSON steps **30–90 min**; env/UI **15–30 min**).
- **Demo impact:** **High** if green — timeline + screenshots look “productized.”
- **What to do:** (1) venv + `pip install -r requirements.txt` + `playwright install chromium`. (2) `uvicorn services.api.app:app`. (3) Mirror your script as `steps` + `user_data`. (4) POST from Builder or `curl`. (5) Record; end steps before submit.
- **Risks:** More failure modes than the script alone; still **no** confidence scoring.
- **Why I don't recommend for tomorrow:** Same Playwright capability as Option 1 with **extra integration surface**.

### Option 3: TherapyNotes or NL Chat tab (NOT RECOMMENDED)

- **Effort:** **2–4+ h** or blocked without creds/keys.
- **Demo impact:** **Low** for lead intake narrative; **risky** live if TN fails.
- **What to do:** Skip unless the buyer explicitly wants EHR automation proof.
- **Risks:** Auth, SPA flakiness; repo screenshots show mixed pass/fail.
- **Why I don't recommend:** **Wrong story** and **higher demo risk** than Options 1–2.

## My recommendation

**Option 1.** Treat this repo as **credible Phase-1 engineering substrate** (API + Playwright runtime + optional UI), not as a **faster** path than your script for tomorrow. **Next 30 min if you agree:** one full script rehearsal, outline **60s** narration, then record—**avoid** TN and NL chat tonight.

## Appendix: things Raunek should know about the codebase

- **Canonical stack:** Python 3 + FastAPI + Playwright + OpenAI (optional for some flows); static frontend at `/` and `/static/…`.
- **Legacy:** `backend/` uses a **simulated** executor — prefer **`services/api/`**.
- **`playwright-mcp/`** is Microsoft’s MCP server repo copy; **not** what the Python server invokes for tools.
- **Railway:** heavy imports lazy-loaded; **`PORT`** honored.
- **This session:** `pip install -r requirements.txt` then import OK; **`/health/browser-check`** failed until **`playwright install`** — expect that on fresh clones.
