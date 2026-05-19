/**
 * DrSnip consultation intake — standalone Playwright demo (headed).
 * Setup: npm install playwright && npx playwright install chromium && node demo.js
 * Jotform may rate-limit repeat submissions from the same IP; space out dry runs if needed.
 * Tweak PACING_MS_AFTER_LOAD (below) to stretch toward a ~2–3 minute live walkthrough.
 */

const { chromium } = require("playwright");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const fs = require("fs");

const PACING_MS_AFTER_LOAD = 2200;

/** Optional: node demo.js [--status-file /path/to.json] [--run-id server-supplied-id] */
function parseDemoArgs() {
  const argv = process.argv.slice(2);
  let statusFile = null;
  let runIdArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--status-file" && argv[i + 1]) {
      statusFile = argv[i + 1];
      i++;
    } else if (argv[i] === "--run-id" && argv[i + 1]) {
      runIdArg = argv[i + 1];
      i++;
    }
  }
  return { statusFile, runIdArg };
}

const _demoArgs = parseDemoArgs();
const STATUS_FILE = _demoArgs.statusFile;
const SECTIONS_TOTAL = 8;

let lastStatusLog = "";
let lastSectionLabel = "";

function fieldsFilledForStatus() {
  return Math.min(29, Math.round((filledCount / 48) * 29));
}

function writeStatusJson(partial) {
  if (!STATUS_FILE) return;
  const started = typeof globalThis.__demoStartedAt === "string" ? globalThis.__demoStartedAt : new Date().toISOString();
  const rid = typeof globalThis.__demoRunId === "string" ? globalThis.__demoRunId : "local";
  const payload = {
    run_id: rid,
    state: "running",
    started_at: started,
    current_section: lastSectionLabel,
    sections_completed: typeof globalThis.__demoSectionsDone === "number" ? globalThis.__demoSectionsDone : 0,
    sections_total: SECTIONS_TOTAL,
    fields_filled: fieldsFilledForStatus(),
    fields_total: 29,
    latest_log: lastStatusLog,
    screenshot_path: null,
    result: null,
    ...partial,
  };
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error(`[status-file] write failed: ${e.message}`);
  }
}

function bumpSection(label, completedIndex) {
  lastSectionLabel = label;
  globalThis.__demoSectionsDone = completedIndex;
  writeStatusJson({
    current_section: label,
    sections_completed: completedIndex,
    fields_filled: fieldsFilledForStatus(),
    latest_log: lastStatusLog,
  });
}

let statusDebounceTimer = null;
function scheduleStatusFlush() {
  if (!STATUS_FILE) return;
  if (statusDebounceTimer) clearTimeout(statusDebounceTimer);
  statusDebounceTimer = setTimeout(() => {
    statusDebounceTimer = null;
    writeStatusJson({});
  }, 500);
}

const FORM_URL = "https://form.jotform.com/ITSnip/drsnip-consultation-intake";

const PATIENT = {
  intake_id: "INT-2026-08711",
  source: "website_lead_form",
  first_name: "Michael",
  last_name: "Chen",
  email: "m.chen.demo@example.com",
  phone: "(415) 555-0142",
  dob: { month: "03", day: "22", year: "1988" },
  occupation: "Software Engineer",
  employer: "Bay Area Tech Co.",
  job_title: "Senior Engineer",
  job_demands: "Desk Job",
  education: "Masters",
  ethnicity: "Asian",
  relationship_status: "Married",
  num_children: "2",
  wish_more_children: "No",
  consider_adoption: "No",
  vasectomy_duration: "About 1 year",
  considered_tubal: "No",
  considered_temporary: "Yes",
  current_methods: "Condoms",
  prior_methods: "Condoms, Withdrawal",
  religion_conflict: "No",
  sexual_concerns: "No",
  genetic_condition: "No",
  emergency_name: "Jennifer Chen",
  emergency_phone: "(415) 555-0188",
  emergency_relationship: "Spouse",
  how_heard: "Google search",
  referral_specify: "Searched vasectomy SF Bay Area",
  additional_notes: "Available weekday mornings for consultation.",
};

const CONFIDENCE = {
  first_name: 99,
  last_name: 99,
  email: 100,
  phone: 100,
  dob: 98,
  occupation: 95,
  employer: 94,
  job_title: 95,
  job_demands: 97,
  education: 97,
  ethnicity: 96,
  relationship_status: 97,
  num_children: 95,
  wish_more_children: 97,
  consider_adoption: 96,
  vasectomy_duration: 90,
  considered_tubal: 88,
  considered_temporary: 91,
  current_methods: 92,
  prior_methods: 89,
  religion_conflict: 96,
  sexual_concerns: 95,
  genetic_condition: 96,
  emergency_name: 99,
  emergency_phone: 100,
  emergency_relationship: 98,
  how_heard: 95,
  referral_specify: 88,
  additional_notes: 87,
};

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

const DEMO_PARTNER = {
  first: "Jennifer",
  last: "Chen",
  phone: "(415) 555-0199",
  consent_share: "Yes",
  age: "36",
  occupation: "Registered Nurse",
  education: "Graduate Degree",
  years_together: "12",
  marriage_you: "1st",
  marriage_spouse: "1st",
};

const DEMO_CHILDREN = [
  { age: "8", relation: "Ours", gender: "Male", dependent: "Yes" },
  { age: "5", relation: "Ours", gender: "Female", dependent: "Yes" },
];

let filledCount = 0;
const confidencesUsed = [];

function ts() {
  return new Date().toISOString().slice(11, 19).replace("T", " ");
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + " ".repeat(n - str.length);
}

function logLine(level, msg) {
  const stamp = `${C.dim}[${ts()}]${C.reset}`;
  let tag = "";
  if (level === "OK") tag = `${C.green}OK  ${C.reset}`;
  else if (level === "INFO") tag = `${C.blue}INFO${C.reset}`;
  else if (level === "WARN") tag = `${C.yellow}WARN${C.reset}`;
  else if (level === "GATE") tag = `${C.magenta}GATE${C.reset}`;
  else if (level === "FLAG") tag = `${C.red}FLAG${C.reset}`;
  console.log(`${stamp} ${tag} ${msg}`);
}

function banner(title) {
  const line = "─".repeat(72);
  console.log(`\n${C.dim}${line}${C.reset}`);
  console.log(`${C.dim}  ${title}${C.reset}`);
  console.log(`${C.dim}${line}${C.reset}`);
}

async function sectionBanner(page, title) {
  banner(title);
  await page.waitForTimeout(800);
}

function confOf(key) {
  const v = CONFIDENCE[key];
  if (typeof v === "number") return v;
  return 92;
}

function trackConf(key) {
  confidencesUsed.push(confOf(key));
}

function logFieldOk(key, label, value, indent = "    ") {
  trackConf(key);
  const display = String(value).replace(/\s+/g, " ").slice(0, 40);
  logLine("OK", `${indent}filled ${pad(label, 22)} = ${pad(display, 28)} [conf: ${confOf(key)}%]`);
  filledCount += 1;
  lastStatusLog = `filled ${label} = ${display} [conf: ${confOf(key)}%]`;
  scheduleStatusFlush();
}

function logParseOk(key, value) {
  const display = String(value).replace(/\s+/g, " ").slice(0, 36);
  logLine("OK", `  ${pad(key, 22)} = ${pad(display, 36)} [conf: ${confOf(key)}%]`);
}

async function tryLocate(page, strategies) {
  for (const s of strategies) {
    try {
      let loc = null;
      if (s.role) {
        loc = page.getByRole(s.role, s.opts || {});
      } else if (s.label) {
        loc = page.getByLabel(new RegExp(s.label, "i"));
      } else if (s.placeholder) {
        loc = page.getByPlaceholder(new RegExp(s.placeholder, "i"));
      } else if (s.selector) {
        loc = page.locator(s.selector).first();
      }
      if (loc && (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))) {
        return loc.first();
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

async function fillTextByStrategies(page, key, label, value, strategies) {
  const loc = await tryLocate(page, strategies);
  if (!loc) {
    logLine("WARN", `    could not locate field ${label} — skipped`);
    return false;
  }
  try {
    await loc.scrollIntoViewIfNeeded();
    await loc.click({ timeout: 5000 });
    await loc.fill("");
    await loc.fill(String(value));
    logFieldOk(key, label, value);
    return true;
  } catch (e) {
    logLine("WARN", `    fill failed for ${label}: ${e.message}`);
    return false;
  }
}

async function selectByLabel(page, key, label, selectNameOrId, desired) {
  const strategies = [
    { selector: selectNameOrId.startsWith("#") ? selectNameOrId : `select[name="${selectNameOrId}"]` },
    { label: `^${label}$` },
  ];
  let loc = await tryLocate(page, strategies);
  if (!loc) {
    logLine("WARN", `    could not locate select ${label} — skipped`);
    return false;
  }
  try {
    await loc.scrollIntoViewIfNeeded();
    const opts = await loc.locator("option").allTextContents();
    const values = await loc.locator("option").evaluateAll((els) =>
      els.map((o) => ({ text: (o.textContent || "").trim(), value: o.getAttribute("value") || "" }))
    );
    let picked = values.find((v) => v.value === desired || v.text === desired);
    if (!picked) {
      const dl = desired.toLowerCase();
      picked = values.find(
        (v) =>
          v.text.toLowerCase() === dl ||
          v.text.toLowerCase().includes(dl) ||
          v.value.toLowerCase().includes(dl)
      );
    }
    if (!picked && values.length > 1) {
      picked = values.find((v) => v.value && v.text !== "Please Select") || values[1];
      logLine("WARN", `    ${label}: no exact match for "${desired}" — picked "${picked.text}"`);
    }
    if (!picked) {
      logLine("WARN", `    ${label}: no options — skipped`);
      return false;
    }
    await loc.selectOption({ value: picked.value || picked.text });
    logFieldOk(key, label, picked.text || picked.value);
    return true;
  } catch (e) {
    logLine("WARN", `    select failed ${label}: ${e.message}`);
    return false;
  }
}

async function clickRadioByName(page, key, humanLabel, nameAttr, answer) {
  try {
    const group = page.locator(`input[name="${nameAttr}"]`).first();
    await group.scrollIntoViewIfNeeded().catch(() => {});
    const byValue = page.locator(`input[name="${nameAttr}"][value="${answer}"]`).first();
    if ((await byValue.count()) > 0) {
      await byValue.click({ force: true });
      logFieldOk(key, humanLabel, answer);
      return true;
    }
    const label = page.locator(`label:has-text("${answer}")`).filter({
      has: page.locator(`input[name="${nameAttr}"]`),
    });
    if ((await label.count()) > 0) {
      await label.first().click({ force: true });
      logFieldOk(key, humanLabel, answer);
      return true;
    }
  } catch (e) {
    logLine("WARN", `    radio ${humanLabel}: ${e.message}`);
  }
  logLine("WARN", `    radio ${humanLabel} — skipped`);
  return false;
}

async function checkCheckboxValue(page, key, humanLabel, nameBracket, value) {
  try {
    const inp = page.locator(`input[name="${nameBracket}"][value="${value}"]`).first();
    await inp.scrollIntoViewIfNeeded({ timeout: 8000 });
    if (!(await inp.isVisible())) {
      logLine("WARN", `    checkbox ${humanLabel} / ${value} not visible — skipped`);
      return false;
    }
    await inp.check({ force: true });
    logFieldOk(key, humanLabel, value);
    return true;
  } catch (e) {
    logLine("WARN", `    checkbox ${humanLabel}: ${e.message}`);
    return false;
  }
}

async function waitPartnerVisible(page) {
  await page.locator("#id_12").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
}

async function confirmSubmit(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const url = page.url();
    const body = await page.textContent("body").catch(() => "");
    if (/thank you|thanks for|submission received|successfully submitted|your response has been recorded/i.test(body || "")) {
      return { ok: true, via: "message" };
    }
    if (/thankyou|thank-you|complete/i.test(url)) {
      return { ok: true, via: "url" };
    }
    if (await page.locator(".form-submission-complete, .thankyou, .jotform-submit-success").count().catch(() => 0)) {
      return { ok: true, via: "selector" };
    }
    if (await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]').count()) {
      return { ok: false, captcha: true };
    }
    if (/there are errors|incomplete fields|fix them before continuing/i.test(body || "")) {
      return { ok: false, validation: true };
    }
    if (/only one entry|multiple submissions are disabled|submission limit/i.test(body || "")) {
      return { ok: false, limit: true };
    }
    await page.waitForTimeout(400);
  }
  return { ok: false, timeout: true };
}

async function clickSubmit(page) {
  const attempts = [
    () => page.locator("#input_81"),
    () => page.locator('button[type="submit"]'),
    () => page.locator('input[type="submit"]'),
    () => page.getByRole("button", { name: /^submit$/i }),
    () => page.locator(".form-submit-button"),
  ];
  for (let i = 0; i < attempts.length; i++) {
    const loc = attempts[i]().first();
    try {
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        logLine("INFO", `Submit attempt ${i + 1}: clicking visible submit control`);
        await loc.scrollIntoViewIfNeeded();
        await loc.click();
        return true;
      }
    } catch {
      /* next */
    }
    logLine("INFO", `Submit attempt ${i + 1}: no visible control`);
  }
  const html = (await page.content().catch(() => "")).slice(0, 4000);
  logLine("FLAG", "No submit button found. HTML fragment:");
  console.log(C.dim + html + C.reset);
  return false;
}

async function main() {
  const cliRunId = _demoArgs.runIdArg;
  const runId = cliRunId || `run-${crypto.randomBytes(4).toString("hex")}-${Date.now()}`;
  globalThis.__demoRunId = runId;
  globalThis.__demoStartedAt = new Date().toISOString();
  globalThis.__demoSectionsDone = 0;

  if (STATUS_FILE) {
    writeStatusJson({
      state: "running",
      current_section: "Initializing",
      sections_completed: 0,
      latest_log: "Agent starting",
    });
  }

  const t0 = Date.now();
  filledCount = 0;
  confidencesUsed.length = 0;

  banner(`Patient Intake Agent · ${runId}`);
  logLine("INFO", "Lead webhook received from website");
  logLine("INFO", `  → Patient: ${PATIENT.first_name} ${PATIENT.last_name} (${PATIENT.intake_id})`);
  logLine("INFO", `  → Source: ${PATIENT.source}`);

  banner("Step 1 · Parse and score intake data");
  const parseOrder = [
    ["first_name", PATIENT.first_name],
    ["last_name", PATIENT.last_name],
    ["email", PATIENT.email],
    ["phone", PATIENT.phone],
    ["dob", `${PATIENT.dob.month}/${PATIENT.dob.day}/${PATIENT.dob.year}`],
    ["occupation", PATIENT.occupation],
    ["employer", PATIENT.employer],
    ["job_title", PATIENT.job_title],
    ["job_demands", PATIENT.job_demands],
    ["education", PATIENT.education],
    ["ethnicity", PATIENT.ethnicity],
    ["relationship_status", PATIENT.relationship_status],
    ["num_children", PATIENT.num_children],
    ["wish_more_children", PATIENT.wish_more_children],
    ["consider_adoption", PATIENT.consider_adoption],
    ["vasectomy_duration", PATIENT.vasectomy_duration],
    ["considered_tubal", PATIENT.considered_tubal],
    ["considered_temporary", PATIENT.considered_temporary],
    ["current_methods", PATIENT.current_methods],
    ["prior_methods", PATIENT.prior_methods],
    ["religion_conflict", PATIENT.religion_conflict],
    ["sexual_concerns", PATIENT.sexual_concerns],
    ["genetic_condition", PATIENT.genetic_condition],
    ["emergency_name", PATIENT.emergency_name],
    ["emergency_phone", PATIENT.emergency_phone],
    ["emergency_relationship", PATIENT.emergency_relationship],
    ["how_heard", PATIENT.how_heard],
    ["referral_specify", PATIENT.referral_specify],
    ["additional_notes", PATIENT.additional_notes],
  ];
  for (const [k, v] of parseOrder) {
    logParseOk(k, v);
  }
  if (STATUS_FILE) bumpSection("Enrichment (simulated)", 1);

  banner("Step 2 · Enrichment (simulated)");
  logLine("INFO", "  → Email domain reputation lookup … clean (demo stub)");
  logLine("INFO", "  → Duplicate lead search … no conflicting intake (demo stub)");
  logLine("GATE", "  → No PII persisted — in-memory only for this demo run");
  if (STATUS_FILE) bumpSection("Launching Chromium", 2);

  banner("Step 3 · Browser agent · DrSnip intake form");
  logLine("INFO", `Launching headed Chromium → ${FORM_URL}`);
  logLine("INFO", "Using semantic selectors (DOM-based, not coordinates)");
  confidencesUsed.length = 0;

  const browser = await chromium.launch({
    headless: false,
    slowMo: 400,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(FORM_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("form.jotform-form", { timeout: 30000 });
    logLine("OK", "Page loaded · DrSnip Consultation Intake");
    logLine("INFO", "Waiting for form scripts and conditional rules …");
    await page.waitForTimeout(PACING_MS_AFTER_LOAD);
    if (STATUS_FILE) {
      lastStatusLog = "Page loaded · DrSnip Consultation Intake";
      bumpSection("Patient Information", 3);
    }

    await sectionBanner(page, "→ Section: Patient Information");
    await fillTextByStrategies(page, "first_name", "first_name", PATIENT.first_name, [
      { selector: 'input[name="q91_name[first]"]' },
      { selector: "#first_91" },
      { label: "First Name" },
    ]);
    await fillTextByStrategies(page, "last_name", "last_name", PATIENT.last_name, [
      { selector: 'input[name="q91_name[last]"]' },
      { selector: "#last_91" },
      { label: "Last Name" },
    ]);
    await fillTextByStrategies(page, "email", "email", PATIENT.email, [
      { selector: 'input[name="q92_email"]' },
      { selector: "#input_92" },
      { label: "Email" },
    ]);
    await fillTextByStrategies(page, "phone", "phone", PATIENT.phone, [
      { selector: 'input[name="q93_phoneNumber[full]"]' },
      { selector: "#input_93_full" },
      { label: "Phone Number" },
    ]);

    const lite = page.locator("#lite_mode_94");
    if (await lite.isVisible().catch(() => false)) {
      await lite.scrollIntoViewIfNeeded();
      await lite.fill(`${PATIENT.dob.month}-${PATIENT.dob.day}-${PATIENT.dob.year}`);
      logFieldOk("dob", "dob", `${PATIENT.dob.month}/${PATIENT.dob.day}/${PATIENT.dob.year}`);
    } else {
      await fillTextByStrategies(page, "dob", "dob_month", PATIENT.dob.month, [{ selector: 'input[name="q94_dateOf[month]"]' }]);
      await fillTextByStrategies(page, "dob", "dob_day", PATIENT.dob.day, [{ selector: 'input[name="q94_dateOf[day]"]' }]);
      await fillTextByStrategies(page, "dob", "dob_year", PATIENT.dob.year, [{ selector: 'input[name="q94_dateOf[year]"]' }]);
    }

    await fillTextByStrategies(page, "occupation", "occupation", PATIENT.occupation, [
      { selector: 'input[name="q3_q3_textbox1"]' },
      { label: "Field of Work" },
    ]);
    await fillTextByStrategies(page, "employer", "employer", PATIENT.employer, [
      { selector: 'input[name="q4_q4_textbox2"]' },
      { label: "Employer" },
    ]);
    await fillTextByStrategies(page, "job_title", "job_title", PATIENT.job_title, [
      { selector: 'input[name="q5_q5_textbox3"]' },
      { label: "Job Title" },
    ]);
    await selectByLabel(page, "job_demands", "job_demands", "#input_6", PATIENT.job_demands);
    await selectByLabel(page, "education", "education", "#input_7", PATIENT.education);
    await selectByLabel(page, "ethnicity", "ethnicity", "#input_9", PATIENT.ethnicity);
    if (STATUS_FILE) bumpSection("Consultation Information", 4);

    await sectionBanner(page, "→ Section: Consultation Information");
    await selectByLabel(page, "relationship_status", "relationship_status", "#input_11", PATIENT.relationship_status);
    await page.waitForTimeout(600);
    await waitPartnerVisible(page);

    await fillTextByStrategies(page, "relationship_status", "partner_first", DEMO_PARTNER.first, [
      { selector: 'input[name="q12_q12_textbox10"]' },
    ]);
    await fillTextByStrategies(page, "relationship_status", "partner_last", DEMO_PARTNER.last, [
      { selector: 'input[name="q13_q13_textbox11"]' },
    ]);
    await fillTextByStrategies(page, "relationship_status", "partner_phone", DEMO_PARTNER.phone, [
      { selector: 'input[name="q14_q14_phone12[full]"]' },
    ]);
    await clickRadioByName(page, "relationship_status", "partner_consent", "q15_q15_radio13", DEMO_PARTNER.consent_share);
    await fillTextByStrategies(page, "relationship_status", "partner_age", DEMO_PARTNER.age, [
      { selector: 'input[name="q16_q16_number14"]' },
    ]);
    await fillTextByStrategies(page, "relationship_status", "partner_job", DEMO_PARTNER.occupation, [
      { selector: 'input[name="q17_q17_textbox15"]' },
    ]);
    await selectByLabel(page, "relationship_status", "partner_education", "#input_18", DEMO_PARTNER.education);
    await fillTextByStrategies(page, "relationship_status", "years_relationship", DEMO_PARTNER.years_together, [
      { selector: 'input[name="q19_q19_textbox17"]' },
    ]);
    await selectByLabel(page, "relationship_status", "marriage_you", "#input_20", DEMO_PARTNER.marriage_you);
    await selectByLabel(page, "relationship_status", "marriage_spouse", "#input_21", DEMO_PARTNER.marriage_spouse);
    if (STATUS_FILE) bumpSection("Children Information", 5);

    await sectionBanner(page, "→ Section: Children Information");
    await fillTextByStrategies(page, "num_children", "num_children", PATIENT.num_children, [
      { selector: 'input[name="q24_q24_number22"]' },
      { label: "How many children" },
    ]);
    await page.locator('input[name="q24_q24_number22"]').press("Tab");
    await page.waitForTimeout(900);

    for (let i = 0; i < DEMO_CHILDREN.length; i++) {
      const c = DEMO_CHILDREN[i];
      const n = i + 1;
      const ageSel = `#input_${25 + i * 4}`;
      const relSel = `#input_${26 + i * 4}`;
      const genSel = `#input_${27 + i * 4}`;
      const qid = 28 + i * 4;
      const radioSuffix = 26 + i * 4;
      const radioName = `q${qid}_q${qid}_radio${radioSuffix}`;
      await fillTextByStrategies(page, "num_children", `child_${n}_age`, c.age, [{ selector: ageSel }]);
      await selectByLabel(page, "num_children", `child_${n}_relation`, relSel, c.relation);
      await selectByLabel(page, "num_children", `child_${n}_gender`, genSel, c.gender);
      await clickRadioByName(page, "num_children", `child_${n}_dependent`, radioName, c.dependent);
    }
    if (STATUS_FILE) bumpSection("Family planning", 6);

    await sectionBanner(page, "→ Section: Family Planning");
    await clickRadioByName(page, "wish_more_children", "wish_more_children", "q58_q58_radio56", PATIENT.wish_more_children);
    await clickRadioByName(page, "consider_adoption", "consider_adoption", "q59_q59_radio57", PATIENT.consider_adoption);
    await fillTextByStrategies(page, "vasectomy_duration", "vasectomy_duration", PATIENT.vasectomy_duration, [
      { selector: 'input[name="q60_q60_textbox58"]' },
    ]);
    await clickRadioByName(page, "considered_tubal", "considered_tubal", "q61_q61_radio59", PATIENT.considered_tubal);
    await clickRadioByName(page, "considered_temporary", "considered_temporary", "q62_q62_radio60", PATIENT.considered_temporary);

    await sectionBanner(page, "→ Section: Birth Control History");
    await checkCheckboxValue(page, "current_methods", "current_methods", "q64_q64_checkbox62[]", PATIENT.current_methods);
    const priorKnown = new Set(["Abstinence", "Condoms", "Diaphragm", "IUD", "Patch", "Pill", "Shot", "None"]);
    const priorParts = PATIENT.prior_methods.split(",").map((s) => s.trim());
    for (const p of priorParts) {
      if (priorKnown.has(p)) {
        await checkCheckboxValue(page, "prior_methods", "prior_methods", "q66_q66_checkbox64[]", p);
      } else {
        const other = page.locator("#other_66");
        if ((await other.count()) > 0) {
          await other.scrollIntoViewIfNeeded();
          await other.check({ force: true });
          const oin = page.locator("#other_66_input input.form-textbox").first();
          await oin.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
          await oin.fill(p);
          trackConf("prior_methods");
          logLine("OK", `    filled prior_methods           = ${p} (via Other)              [conf: ${confOf("prior_methods")}%]`);
          filledCount += 1;
        } else {
          logLine("WARN", `    prior_methods: no checkbox for "${p}" — skipped`);
        }
      }
    }
    if (STATUS_FILE) bumpSection("Medical & personal", 7);

    await sectionBanner(page, "→ Section: Medical & Personal");
    await clickRadioByName(page, "religion_conflict", "religion_conflict", "q68_q68_radio66", PATIENT.religion_conflict);
    await clickRadioByName(page, "sexual_concerns", "sexual_concerns", "q69_q69_radio67", PATIENT.sexual_concerns);
    await clickRadioByName(page, "genetic_condition", "genetic_condition", "q71_q71_radio69", PATIENT.genetic_condition);

    await sectionBanner(page, "→ Section: Emergency Contact");
    await fillTextByStrategies(page, "emergency_name", "emergency_name", PATIENT.emergency_name, [
      { selector: 'input[name="q74_q74_textbox72"]' },
    ]);
    await fillTextByStrategies(page, "emergency_phone", "emergency_phone", PATIENT.emergency_phone, [
      { selector: 'input[name="q75_q75_phone73[full]"]' },
    ]);
    await fillTextByStrategies(page, "emergency_relationship", "emergency_relationship", PATIENT.emergency_relationship, [
      { selector: 'input[name="q76_q76_textbox74"]' },
    ]);

    await sectionBanner(page, "→ Section: Referral / Attribution");
    await checkCheckboxValue(page, "how_heard", "how_heard", "q78_q78_checkbox76[]", "Google");
    const specify = page.locator('input[name="q79_q79_textbox77"]');
    if (await specify.isVisible().catch(() => false)) {
      await specify.fill(PATIENT.referral_specify);
      logFieldOk("referral_specify", "referral_specify", PATIENT.referral_specify);
    } else {
      logLine("INFO", "Referral specify field hidden — merged into additional notes");
    }

    await sectionBanner(page, "→ Section: Additional Notes");
    const notesText = `${PATIENT.additional_notes}\n${PATIENT.referral_specify}`;
    await fillTextByStrategies(page, "additional_notes", "additional_notes", notesText, [
      { selector: 'textarea[name="q90_isThere"]' },
      { selector: "#input_90" },
      { label: "anything else" },
    ]);
    if (STATUS_FILE) bumpSection("Submitting", 8);

    logLine("INFO", `All sections addressed · ${filledCount} field operations logged`);

    logLine("INFO", "Clicking Submit…");
    const clicked = await clickSubmit(page);
    if (!clicked) {
      await page.screenshot({ path: path.join(os.tmpdir(), `${runId}-submit-miss.png`), fullPage: true });
      if (STATUS_FILE) {
        writeStatusJson({
          state: "error",
          error: "Submit button not found",
          result: null,
          screenshot_path: path.join(os.tmpdir(), `${runId}-submit-miss.png`),
        });
      }
      process.exitCode = 1;
      return;
    }

    const outcome = await confirmSubmit(page);
    if (outcome.captcha) {
      logLine("FLAG", "Captcha or bot challenge detected — stop for human review");
      await page.screenshot({ path: path.join(os.tmpdir(), `${runId}-captcha.png`), fullPage: true });
      if (STATUS_FILE) {
        writeStatusJson({
          state: "error",
          error: "Captcha or bot challenge detected",
          result: null,
          screenshot_path: path.join(os.tmpdir(), `${runId}-captcha.png`),
        });
      }
      process.exitCode = 1;
      return;
    }
    if (outcome.validation) {
      logLine("FLAG", "Form validation error after submit — check required fields");
      await page.screenshot({ path: path.join(os.tmpdir(), `${runId}-validation.png`), fullPage: true });
      if (STATUS_FILE) {
        writeStatusJson({
          state: "error",
          error: "Form validation error after submit",
          result: null,
          screenshot_path: path.join(os.tmpdir(), `${runId}-validation.png`),
        });
      }
      process.exitCode = 1;
      return;
    }
    if (outcome.limit) {
      logLine("FLAG", "Form rejected duplicate submission (Jotform limit). Use a fresh browser profile or wait before re-demo.");
      await page.screenshot({ path: path.join(os.tmpdir(), `${runId}-limit.png`), fullPage: true });
      if (STATUS_FILE) {
        writeStatusJson({
          state: "error",
          error: "Jotform submission limit or duplicate blocked",
          result: null,
          screenshot_path: path.join(os.tmpdir(), `${runId}-limit.png`),
        });
      }
      process.exitCode = 1;
      return;
    }
    if (!outcome.ok) {
      logLine("FLAG", "Could not confirm thank-you state within timeout");
      await page.screenshot({ path: path.join(os.tmpdir(), `${runId}-timeout.png`), fullPage: true });
      if (STATUS_FILE) {
        writeStatusJson({
          state: "error",
          error: "Confirmation timeout — thank-you state not detected",
          result: null,
          screenshot_path: path.join(os.tmpdir(), `${runId}-timeout.png`),
        });
      }
      process.exitCode = 1;
      return;
    }

    const shotPath = path.join(os.tmpdir(), `${runId}-confirmation.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    logLine("OK", `Submission confirmed · ${outcome.via}`);
    logLine("OK", `Screenshot saved → ${shotPath}`);

    const ms = Date.now() - t0;
    const avg = confidencesUsed.length
      ? Math.round(confidencesUsed.reduce((a, b) => a + b, 0) / confidencesUsed.length)
      : 0;
    const dur = `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;

    if (STATUS_FILE) {
      writeStatusJson({
        state: "complete",
        sections_completed: SECTIONS_TOTAL,
        current_section: "Complete",
        fields_filled: 29,
        fields_total: 29,
        latest_log: `Submitted · ${PATIENT.first_name} ${PATIENT.last_name} · ${dur}`,
        screenshot_path: shotPath,
        result: {
          intake_id: PATIENT.intake_id,
          fields_filled: filledCount,
          avg_confidence: avg,
          duration: dur,
          screenshot_path: shotPath,
        },
      });
    }

    banner("Run summary");
    logLine("OK", "Run complete");
    console.log(`${C.dim}         Intake ID:${C.reset}           ${PATIENT.intake_id}`);
    console.log(`${C.dim}         Status:${C.reset}              Submitted`);
    console.log(`${C.dim}         Field operations:${C.reset}      ${filledCount}`);
    console.log(`${C.dim}         Avg confidence:${C.reset}        ${avg}%`);
    console.log(`${C.dim}         Duration:${C.reset}              ${dur}`);
    console.log(`${C.dim}         Screenshots:${C.reset}           1`);

    logLine("INFO", "Pausing 5s before closing browser…");
    await page.waitForTimeout(5000);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  logLine("FLAG", e.stack || String(e));
  if (STATUS_FILE) {
    try {
      writeStatusJson({
        state: "error",
        error: String(e && e.message ? e.message : e),
        result: null,
      });
    } catch (_) {
      /* ignore */
    }
  }
  process.exit(1);
});
