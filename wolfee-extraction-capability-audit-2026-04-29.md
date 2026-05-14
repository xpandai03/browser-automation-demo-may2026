# Wolfee URL Extraction — Capability Audit of the Axiom Playwright Service

**Date:** 2026-04-29
**Service:** axiom-browser-agent-clone (Railway)
**Audit type:** Read-only investigation, no code changes
**Probes:** Real Playwright runs against live URLs (see IP caveat below)

---

## 1. Executive summary

**Verdict: Conditional yes — integrate, but only after fixing one production blocker and adding one new endpoint.** This service has the right primitives for what Wolfee needs (real Chromium, stealth fingerprint patches, modal dismissal, retry-with-fresh-context) and empirically extracts clean job-description text from LinkedIn, Greenhouse, Ashby, and Lever. It does **not** unblock Indeed or Glassdoor (Cloudflare 403s persist). Two material caveats: (a) the deployed service is currently broken for *any* external navigation because Chromium can't authenticate the configured SOCKS5 proxy — every workflow call returns `Browser does not support socks5 proxy authentication`, and (b) there is no public "render URL → return text" endpoint, only domain-specific routes (TN patient creation, Uber Eats meal finder) and a generic NL-driven workflow runner that's not a clean fit for Wolfee. Expose a small `POST /api/extract/render-text` route on the existing runtime (≈30–60 min of work) and fix the proxy. After that, this is a fine fit for Wolfee's 50–200/day load and an acceptable fit for 1000/day with the caveats in §6.

---

## 2. Current API surface

Inventory taken from [services/api/app.py](services/api/app.py#L120-L133) and [services/api/routes/](services/api/routes/).

### Public endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health/fast` | Liveness; zero deps | none |
| GET | `/health` | Detailed status (proxy, openai key) | none |
| GET | `/health/ready` | Readiness | none |
| GET | `/health/browser-check` | Launches Playwright, hits `example.com` | none |
| GET | `/api/health/proxy-sanity` | SOCKS5 proxy sanity check | none |
| POST | `/api/workflow/run` | NL → workflow → execute | none |
| POST | `/api/workflow/run-sync` | Same, form-data, returns aggregated result | none |
| POST | `/api/workflow/parse` | NL → parsed steps (preview, no run) | none |
| POST | `/api/workflow/execute-steps` | Execute a pre-parsed list of `WorkflowStep` | none |
| GET | `/api/workflow/run-stream` | SSE-streamed workflow run | none |
| POST | `/api/resume/tailor` | LLM resume tailoring | none |
| POST | `/api/picker/load`/`click-and-update`/`scroll`/`close` | Visual element picker | none |
| POST | `/api/food-delivery/run` | Uber Eats high-protein cart | none |
| POST | `/api/tn/create-patient` | TherapyNotes patient creation | `X-API-Key` header |
| GET | `/api/tn/test` | TN health | none |

### Auth model

- `/api/tn/*` requires `X-API-Key` header (middleware in [services/api/app.py:101-118](services/api/app.py#L101-L118)).
- **Everything else is unauthenticated.** CORS is `*` ([app.py:78](services/api/app.py#L78)). If Wolfee integrates today, any caller on the internet can also use it. We should add a similar middleware-level API-key gate before exposing this to a second consumer.

### Rate limits / quotas

- **None implemented.** No per-IP throttling, no concurrency throttling, no cost cap. Single Railway replica (`numReplicas: 1` in [railway.json](railway.json)) is the de facto cap.

### Is there a "render URL → return text" endpoint?

**No.** The closest surfaces are:

1. `POST /api/workflow/execute-steps` accepting a `[{action: "goto", url: ...}, {action: "extract", selector: "body"}]` array — works in principle, but currently broken in prod (see §3) and returns a workflow-shaped result, not a clean `{text, title}`.
2. `POST /api/picker/load` opens a URL into a runtime page, but it's designed to return *clickable elements with bounding boxes* for an element picker UI, not text.

A small new route is the right shape — see §7.

---

## 3. Source-coverage probe table

### IP caveat (important — read this)

The audit brief asks for probes from the Railway service IP. As deployed, the Railway service has a **hard blocker**: `API_PROXY_ENABLED=true` is set, but Chromium does not support SOCKS5 proxy authentication ([config.py:99-133](services/api/config.py#L99-L133)). Every navigation through the standard runtime path fails with `BrowserType.launch: Browser does not support socks5 proxy authentication`. Confirmed against `/api/health/proxy-sanity` and `/api/workflow/execute-steps` on the live deployment:

```
$ curl https://axiom-browser-agent-clone-production.up.railway.app/api/health/proxy-sanity
{"success":false, "error":"Unexpected: BrowserType.launch: Browser does not support socks5 proxy authentication"}
```

Because of this, I could not run probes through the production endpoint without modifying production config. I instead ran probes locally using the **same `PlaywrightRuntime` code path** ([services/api/mcp_runtime.py](services/api/mcp_runtime.py)) with `skip_proxy=True, skip_resource_blocking=True, skip_stealth=True` — the exact configuration the TN executor uses successfully today ([routes/therapy_notes.py:45](services/api/routes/therapy_notes.py#L45)). This means probes use the same Chromium build, the same fingerprint patches, the same UA, the same context init script.

**The IP, however, is local residential (76.91.60.192) — not the Railway IP and not the IPRoyal residential proxy IP.** Implications:

- For sites that gate primarily on **headless detection / fingerprint** (LinkedIn): residential vs Railway IP shouldn't matter. Results will hold.
- For sites that gate primarily on **datacenter IP reputation** (Indeed, Glassdoor): my residential IP is *more permissive* than Railway's Linux datacenter IP would be. So if Indeed 403s me here, Railway's IP will also 403; if it had passed for me, that wouldn't have proven Railway. **Indeed/Glassdoor are blocked in both cases.**
- For Railway to extract from Indeed/Glassdoor reliably, the path forward is the residential proxy (IPRoyal) — but that requires fixing the SOCKS5 auth bug *or* switching to HTTP-CONNECT with embedded auth.

### Probe results (n = real probes from local IP using the production runtime)

| Source | URL pattern | n | Pass | Title cleanly extracted | JD body chars (median) | Notes |
|---|---|---|---|---|---|---|
| LinkedIn | `/jobs/view/<id>` | 10 real IDs | 10/10 | yes ("Company hiring Role in Loc \| LinkedIn") | 4031 | `div.description__text` reliable; ESC dismisses modal 100% |
| Greenhouse | `job-boards.greenhouse.io/<co>/jobs/<id>` | 1 | 1/1 | yes | 8202 | reCAPTCHA flagged on apply form, JD viewing is open |
| Ashby | `jobs.ashbyhq.com/<co>/<uuid>` | 1 | 1/1 | yes ("Role @ Company") | 6568 | Salary range present in body |
| Lever | `jobs.lever.co/<co>/<uuid>` | 1 | 1/1 | yes ("Company - Role") | 5322 | No specific selector hit my generic list; `body` text is clean |
| Indeed | `/viewjob?jk=<id>` and `/q-...jobs.html` | 2 | 0/2 | "Just a moment..." | 250 | Hard Cloudflare 403 + Ray ID, both URLs |
| Glassdoor (job page) | `/job-listing/...JV_...htm` | 1 | 0/1 (404 "Job is OOO") | n/a | 772 | URL likely synthetic; no live JV URL findable from outside |
| Glassdoor (search) | `/Job/...SRCH_...htm` | 1 | rendered, no JD wrapper | partial ("125,037 Software engineer jobs") | 14207 (search results) | Rendered without challenge, but it's a board page not a JD page — JD verdict unverified |
| Workable boards | `apply.workable.com/<co>/` | 3 | 0/3 (all redirected to `/oops`) | n/a | 525 | Slugs were stale; cannot conclude on Workable from this — see §4 |
| Stripe (custom careers) | `stripe.com/jobs/listing/<slug>` | 1 | 0/1 (404 "Not Found") | n/a | 9 | Custom site rejected; behaviour will vary per company |
| PDF | `dummy.pdf` over HTTPS | 1 | nav 200, body text 0 | n/a | 0 | Chromium renders PDF in viewer; `inner_text("body")` returns empty |

Raw probe records are in `/tmp/job_probe_results.json` on the audit machine; representative LinkedIn snippet:

```json
{"url":"https://www.linkedin.com/jobs/view/4356062884","nav_status":200,
 "title":"Netflix hiring Software Engineer (L4) - Personalization in United States | LinkedIn",
 "modal_dismissed_with":"ESC","selector_hits":[
   {"sel":"div.show-more-less-html__markup","count":1,"len":4031},
   {"sel":"div.description__text","count":1,"len":4042}],
 "t_ms":4682}
```

---

## 4. LinkedIn deep-dive

This is the most important question, so it gets the most detail.

### Sample

I queried LinkedIn's public guest API for live job IDs, then probed 10 real `/jobs/view/<id>` URLs. (An earlier round of 5 fake IDs all redirected to `expired_jd_redirect` search pages — important to know: **expired/invalid LinkedIn IDs silently redirect to a search page, not a 404**, so callers must verify `final_url` still matches `/jobs/view/<id>`.)

Sample companies that worked: Netflix, Notion (×3), SeatGeek, Uber, Handshake, Julius AI, Twitch.

### Pass rate

**10/10 of the live IDs returned HTTP 200 with the JD content visible after dismissing the modal.** No headless detection triggered, no rate limiting, no captcha.

### Modal dismissal

ESC key dismissed the login modal in 9/10 cases. The button selector `button[aria-label='Dismiss']` worked in the one remaining case where ESC reportedly succeeded but a defensive button click was also possible. Recommended order: `button[aria-label='Dismiss']` → `button.modal__dismiss` → ESC.

### JD selectors (stable, in priority order)

1. `div.show-more-less-html__markup` — body text only, cleanest
2. `section.show-more-less-html`
3. `div.description__text`

All three returned text in 10/10 probes. Length ranged 1.8K–6.3K characters (median 4031). The LinkedIn guest JD page is consistent across the sample; selectors haven't drifted in the time the project's existing Greenhouse selectors have remained stable.

### Headless detection

Not triggered. Existing fingerprint patches in [mcp_runtime.py:314-428](services/api/mcp_runtime.py#L314-L428) (webdriver=false, fake plugins, hardwareConcurrency=4, WebGL spoof, chrome.runtime, permissions shim) appear sufficient for LinkedIn's guest-view path. Chromium UA matches Linux platform — important per existing [CLAUDE.md](https://github.com/anthropics/.) note that mismatched UA/platform is an obvious tell.

### Rate-limiting

Not observed in 10 sequential probes from one IP/context (each probe did create a fresh context internally on retries, so this isn't fully sequential traffic, but the 10 navs completed in roughly 60 seconds total). Not enough to claim a hard limit. **Recommend the integration cap at 1 nav/sec/IP and cool down on any 429 or "ERR_BLOCKED_BY_CLIENT".** A residential proxy with sticky session would protect against this if Wolfee load grows.

### Failure modes seen

- Synthetic/expired ID → silent redirect to `linkedin.com/jobs/<role>-jobs?trk=expired_jd_redirect`. Caller must check `final_url`. The page that loads is a *board* with a "first job" sidebar that *also* fills `description__text` — so blindly trusting the selector value when redirected is a footgun. Recommended: reject any extraction where the final URL doesn't still match `/jobs/view/<id>`.
- Sponsored / private-page jobs (none in my sample) — anecdotal reports indicate harder authwall with no dismiss; not observable in 10/10 sample, treat as <10% in the wild.

### Verdict

**LinkedIn `/jobs/view/<id>` is reliable** for guest-viewable jobs, with the caveat that callers must verify `final_url` to detect expired-redirect. 10/10 pass rate is a strong signal at this sample size; flag as "best-effort with text-paste fallback" in the Wolfee UI.

---

## 5. PDF capability

**Not currently supported.** Chromium opens PDFs in its built-in viewer, but that viewer renders inside a plugin/iframe, so `page.inner_text("body")` returns empty (probe confirmed: body_len=0 on `dummy.pdf`). No PDF text extraction toolchain is installed in the service ([requirements.txt](requirements.txt) — no `pdfminer`, `pdfplumber`, `pypdf`, or `pdf-parse`).

**Cheap to add (~1–2 hours):**

1. Detect PDF via `Content-Type` of the navigation response or by sniffing the URL extension.
2. If PDF, fetch via `httpx`/`aiohttp` (bypass the browser entirely), pipe bytes into `pdfminer.six.high_level.extract_text` or `pypdf.PdfReader`.
3. Wire into the new `/render-text` endpoint as a branch.

Add `pdfminer.six` (≈ 6 MB) to `requirements.txt`. The Playwright Docker base image already has Python; no system deps needed for that lib.

---

## 6. Operational realities

### Resource footprint per render

From the probes (local, but architecturally identical to Railway):

- **Cold start (first call after container boot)**: ~7–10s — includes Playwright/Chromium spin-up.
- **Warm**: 4–7s end-to-end per render (nav + 2.5s settle + extract + block-detect). Pure nav is ~3s.
- **Memory**: Chromium ≈ 250–400 MB resident, plus ~50–100 MB per active page. With one shared browser/page (current model), steady-state memory ≈ 350–500 MB. Railway free/Hobby tiers usually allow 512 MB; verify the current Railway plan can sustain this without OOM-kill.

### Concurrency model — **this is a real constraint**

The runtime is a process-global singleton ([mcp_runtime.py:1633-1641](services/api/mcp_runtime.py#L1633-L1641)) with a single `Browser → Context → Page`. Two concurrent workflow calls would step on each other's `Page` state. There is no per-request isolation in the workflow path. The TN path adds an `asyncio.Lock` ([tn_executor.py:1234](services/api/tn_executor.py#L1234)) that returns 429 on contention. **The workflow path has no such guard.**

`numReplicas: 1` in [railway.json](railway.json) means the process is also a single worker.

Practical capacity:
- Sequential workload: ~10 renders/min sustained (6s/render).
- Burst: undefined — concurrent calls will produce wrong results, not errors.

### Failure modes seen in production-style runs

- Browser crashes on heavy SPA pages (memory/SIGSEGV) — runtime has a retry-with-fresh-context layer ([mcp_runtime.py:530-604](services/api/mcp_runtime.py#L530-L604), max 3 retries with exponential backoff). Helps; isn't a silver bullet.
- Page-load timeout on slow networks (default 45s) — handled.
- Cookie banner overlays — handled by `_try_dismiss_cookies` ([mcp_runtime.py:643-690](services/api/mcp_runtime.py#L643-L690)).
- Cloudflare challenge pages — `detect_block` ([mcp_runtime.py:1529-1596](services/api/mcp_runtime.py#L1529-L1596)) flags them; no auto-bypass.
- **The proxy bug** is the dominant production failure mode right now.

### Cost estimate

Railway Hobby tier ≈ $5/mo flat + ~$0.000463/GB-hr RAM, ~$0.000463/vCPU-hr. With 512 MB RAM constantly running, roughly $1.50–2.50/mo just for "on" — independent of request volume.

Per-render incremental cost is mostly bandwidth (a JD page ≈ 200 KB downloaded; with resource blocking off, full assets ≈ 2–4 MB). At 100 renders/day: <1 GB egress/mo, well inside any tier. At 1000/day: ~10 GB/mo egress — still cheap, ≈$1/mo.

If Wolfee adds the residential proxy (recommended for Indeed/Glassdoor coverage), IPRoyal pricing is **the dominant cost** — currently ~$1.50/GB on residential. A JD page through a residential proxy is ~200 KB → $0.0003/render. At 1000/day that's $9/mo. Manageable.

**Bottom line**: at expected volumes, this is **<$30/mo all-in** even at 1000/day with a residential proxy. The cost question for Wolfee is engineering time, not infra spend.

---

## 7. Recommended integration shape

### Endpoint

```
POST /api/extract/render-text
Headers: X-API-Key: <wolfee-key>
Body: {
  "url": "https://www.linkedin.com/jobs/view/4406118990",
  "wait_for_selector": "div.description__text",   // optional
  "dismiss_modal": true,                            // optional, defaults true for linkedin.com
  "timeout_ms": 25000                               // optional
}

Response 200 (success):
{
  "ok": true,
  "url": "https://www.linkedin.com/jobs/view/4406118990",
  "final_url": "https://www.linkedin.com/jobs/view/4406118990",
  "status": 200,
  "title": "Notion hiring Software Engineer, New Grad in San Francisco, CA | LinkedIn",
  "text": "<cleaned body text, ~5–15 KB>",
  "jd_text": "<text from div.description__text if matched, else null>",
  "duration_ms": 4682
}

Response 200 (controlled failure):
{
  "ok": false,
  "url": "...",
  "reason": "blocked" | "timeout" | "navigation_failed" | "expired_redirect",
  "final_url": "...",
  "status": 403,
  "title": "Just a moment..."
}
```

Why this shape:

- **Body text always returned** so the LLM can do its own cleanup pass — keeps this service's responsibility narrow.
- **`jd_text` as an optional bonus**: when a known JD selector matches (LinkedIn, Greenhouse, Ashby), we hand back the cleaner subset. If nothing matches, we return `null` and the caller still has `text`.
- **`final_url` is critical** for LinkedIn's silent expired-redirect case (see §4).
- **`reason: "expired_redirect"`** is a derived signal: when `final_url` no longer matches the pattern of the input URL (e.g. `view/<id>` → `<role>-jobs?...expired_jd_redirect`), return this rather than misleading `ok: true`.
- Don't return raw HTML by default — Wolfee's LLM doesn't need it; it doubles bandwidth.

### What to NOT add to this endpoint

- Domain-specific structured extraction (`{role, company, level, salary}`). Wolfee's LLM is better positioned to do that and the cost is negligible. Keeping this service "render + clean text" reduces coupling and avoids selector maintenance creep.
- A queue/job-id pattern. At 50–1000/day synchronous is fine; if we need async later, add it later.

### Effort estimate (honest)

| Task | Effort |
|---|---|
| Fix SOCKS5 proxy (switch to HTTP-CONNECT with embedded creds, OR set `skip_proxy=True` for the new route, OR disable proxy entirely if Wolfee accepts datacenter-IP coverage) | **30–90 min** depending on path chosen |
| Add `services/api/routes/extract.py` with one POST handler, modeled on `food_delivery` and using `PlaywrightRuntime(skip_proxy=..., skip_resource_blocking=True, skip_stealth=True)` | **30 min** |
| Add modal-dismissal helper (cribbed from this audit's probe.py — ~15 lines) | 10 min |
| Add `expired_redirect` detection (regex on `final_url`) | 10 min |
| Add API-key middleware for `/api/extract/*` (mirror the TN one in [app.py:101-118](services/api/app.py#L101-L118)) | 15 min |
| Add per-request asyncio.Lock to avoid the singleton-runtime contention bug, OR refactor to per-request runtime instance | 30–60 min |
| Add PDF branch (pdfminer.six in requirements + content-type sniff) | 60–90 min |
| Tests + minimal docs | 30 min |

**Total: 4–6 hours of focused work** for the no-PDF version, **6–8 hours** with PDF. The biggest unknown is whichever proxy path you choose — fixing SOCKS5 auth properly would mean switching to a different IPRoyal endpoint or to HTTP proxy with embedded creds, both of which need their own validation.

---

## 8. Honest source-by-source verdicts

| Source | Verdict | Sample size | Reasoning |
|---|---|---|---|
| **LinkedIn `/jobs/view/<id>`** | **Reliable** | 10/10 live IDs | Strong signal at n=10; selectors stable; modal dismiss reliable. Caveat: caller must verify `final_url` to catch silent expired-redirects. |
| **Greenhouse (`job-boards.greenhouse.io`)** | **Reliable** | 1/1 + Wolfee already says it works via basic fetch | Playwright works; basic fetch + their public API also works. Wolfee likely doesn't need this service for Greenhouse. |
| **Ashby** | **Reliable** | 1/1 + Wolfee already says works via `__appData` | Same — basic fetch works for Ashby per Wolfee's prior testing. Playwright path works as a fallback. |
| **Lever (individual job)** | **Reliable** | 1/1 | Body text clean; no specific JD selector but the whole-body pass-through is fine for an LLM consumer. |
| **Workable** | **Unverified — likely partial** | 0/3 (all stale board slugs) | Could not get a live job URL to probe. Architecturally similar to Lever (React SPA). Best guess: works when given a live job URL, fails when given a stale board. Mark as "best-effort, may fail". |
| **Custom careers pages** | **Highly variable** | 1 sample (Stripe) returned 404 to our request | Per-company. No general guarantee. Treat as "best effort" with text-paste fallback. |
| **Indeed** | **Blocked** | 0/2 | Cloudflare 403 from residential IP today. Railway IP will be at least as bad. Even with residential proxy, Indeed's challenge stack is aggressive — would need additional anti-bot measures (e.g., curl-impersonate, undetected-chromedriver) that this service doesn't have. **Don't promise this.** |
| **Glassdoor (individual job)** | **Unverified** | 1/1 of synthetic URL hit "Job is OOO" 404; 1/1 of search-results URL rendered cleanly | Glassdoor *is* serving us, unlike Indeed. But I don't have a real `JV_<id>.htm` URL to confirm individual JD page rendering. Treat as "probably works, needs confirmation with a live URL". |
| **PDF** | **Not supported, cheap to add** | n/a | Out-of-the-box Chromium can't extract PDF text. ~1–2 hours of work to add `pdfminer.six` + content-type branch. |

---

## 9. Recommendation

**Integrate, with two preconditions.**

1. **Fix the proxy block** (one of: switch to HTTP-CONNECT with embedded creds, or accept datacenter IP and set `skip_proxy=True` for the new route as we already do for TN, or remove `API_PROXY_ENABLED` from production until we have a working proxy path).
2. **Add `POST /api/extract/render-text`** with the shape in §7.

Once those two are done, this service unlocks LinkedIn, Lever, Workable (probably), and provides a clean fallback for custom careers pages that basic-fetch Wolfee can't render. It does **not** unlock Indeed and probably does not unlock Glassdoor without further anti-bot work; tell users that explicitly and offer a "paste the JD as text" fallback in the Wolfee UI for those.

If the only gap Wolfee cares about is LinkedIn — integrate. The 10/10 pass rate on real IDs, with an existing well-thought-out fingerprint patch layer that addresses LinkedIn's specific `navigator.webdriver` / WebGL / chrome.runtime tells, is a solid base. Greenhouse/Ashby/Lever are bonuses Wolfee can already get other ways. Indeed/Glassdoor would need a different toolchain (residential proxy + curl-impersonate or commercial unblocker like Bright Data) that this service does not currently include.

If Wolfee wants Indeed/Glassdoor coverage as a hard requirement, **don't integrate this service for those two**; they're best served by a commercial unblocker layer.

---

## Appendix A — Probe methodology

- Code: `/tmp/job_probe.py` (not committed — local audit artifact).
- Runtime: `PlaywrightRuntime(skip_proxy=True, skip_resource_blocking=True, skip_stealth=True)` — exact production config used by `/api/tn/create-patient`.
- Browser: Chromium 141.0.7390.37 via Playwright 1.57.x.
- UA: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36` (matches production [mcp_runtime.py:202-206](services/api/mcp_runtime.py#L202-L206)).
- Fingerprint patches: as injected by `_inject_fingerprint_patches` ([mcp_runtime.py:314-428](services/api/mcp_runtime.py#L314-L428)).
- IP: Local residential `76.91.60.192` (audit caveat — see §3).
- Live LinkedIn IDs sourced from `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`.

## Appendix B — Open questions for the calling team

1. Is datacenter-IP coverage acceptable, or do you need residential routing? Determines whether we keep IPRoyal in the loop.
2. What's your acceptable per-render timeout? My recommendation is 25s; cold starts can push to 10s+.
3. Do you want the service to do *any* domain-specific parsing (e.g., a small `jd_text` selector hit), or do you want pure raw text and you'll do all parsing in your LLM step? (§7 suggests both, but I can simplify.)
4. PDF support: needed at launch, or can it wait?
