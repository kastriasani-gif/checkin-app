// Check-in app. Writes go through a small server API so users do not need GitHub tokens.

const USER_KEY = "checkin.user";
const API_ENDPOINT = window.CHECKIN_API_URL || "/api/sessions";
const DATA_FALLBACK_URL = "data.json";

const START_DATE = new Date(2026, 4, 5); // 2026-05-05 (Mai = 4)

const state = {
  user: localStorage.getItem(USER_KEY) || "kastri",
  data: { sessions: [] },
  sha: null,
  loading: false,
  saving: false,
  pendingCheckoutId: null,
  timerInterval: null,
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  userBtns: document.querySelectorAll(".user"),
  statusCard: document.querySelector(".status-card"),
  statusLabel: document.getElementById("status-label"),
  timer: document.getElementById("timer"),
  statusMeta: document.getElementById("status-meta"),
  actionBtn: document.getElementById("action-btn"),
  commentArea: document.getElementById("comment-area"),
  commentInput: document.getElementById("comment"),
  confirmCheckout: document.getElementById("confirm-checkout"),
  cancelCheckout: document.getElementById("cancel-checkout"),
  todaySection: document.getElementById("today-section"),
  todaySummary: document.getElementById("today-summary"),
  todayList: document.getElementById("today-list"),
  recentSection: document.getElementById("recent-section"),
  recentList: document.getElementById("recent-list"),
  weekGrid: document.getElementById("week-grid"),
  weekStats: document.getElementById("week-stats"),
  weekLabel: document.getElementById("week-label"),
  dashboardHistory: document.getElementById("dashboard-history"),
  historyLabel: document.getElementById("history-label"),
  historyList: document.getElementById("history-list"),
  weeksSection: document.getElementById("weeks-section"),
  weeksTable: document.getElementById("weeks-table"),
  monthsSection: document.getElementById("months-section"),
  monthsTable: document.getElementById("months-table"),
  syncState: document.getElementById("sync-state"),
};

// --- Time helpers ---

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [h, m, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

function fmtHoursMinutes(ms) {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}min`;
}

function fmtClock(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

function dashboardWindowStart() {
  const today = startOfDay(new Date());
  const start = startOfDay(START_DATE);
  const weekStart = startOfWeek(today);
  return weekStart < start ? start : weekStart;
}

function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

function fmtShortDate(d) {
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function listPastWeeks() {
  const startBoundary = startOfWeek(START_DATE);
  const currentWeekStart = startOfWeek(new Date());
  const weeks = [];
  const cursor = new Date(startBoundary);
  while (cursor < currentWeekStart) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setDate(end.getDate() + 6);
    weeks.push({ start, end });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks.reverse();
}

function weekStatsForUser(weekStart, user) {
  const weekEndExclusive = new Date(weekStart);
  weekEndExclusive.setDate(weekEndExclusive.getDate() + 7);
  const sessions = state.data.sessions.filter(
    (s) =>
      s.user === user &&
      new Date(s.started_at) >= weekStart &&
      new Date(s.started_at) < weekEndExclusive
  );
  const totalMs = sessions.reduce((sum, s) => sum + sessionDurationMs(s), 0);
  let daysMet = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dayMs = sessions
      .filter((s) => sameDay(new Date(s.started_at), d))
      .reduce((sum, s) => sum + sessionDurationMs(s), 0);
    if (dayMs >= 3600000) daysMet++;
  }
  return { totalMs, daysMet, met: daysMet >= 5 };
}

function listMonths() {
  const today = new Date();
  const start = new Date(START_DATE.getFullYear(), START_DATE.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 1);
  const months = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months.reverse();
}

function monthStatsForUser(monthStart, user) {
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  const sessions = state.data.sessions.filter(
    (s) =>
      s.user === user &&
      new Date(s.started_at) >= monthStart &&
      new Date(s.started_at) < monthEnd
  );
  const totalMs = sessions.reduce((sum, s) => sum + sessionDurationMs(s), 0);
  const activeDays = new Set();
  sessions.forEach((s) => activeDays.add(dayKey(new Date(s.started_at))));
  return { totalMs, activeDays: activeDays.size };
}

function isCurrentMonth(monthStart) {
  const today = new Date();
  return (
    monthStart.getFullYear() === today.getFullYear() &&
    monthStart.getMonth() === today.getMonth()
  );
}

function fmtDayLabel(d) {
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function isBeforeStart() {
  return startOfDay(new Date()) < startOfDay(START_DATE);
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function dayKey(d) {
  return String(startOfDay(d).getTime());
}

function sessionDurationMs(s, now = Date.now()) {
  const start = new Date(s.started_at).getTime();
  const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
  return Math.max(0, end - start);
}

function createSessionItem(x) {
  const li = document.createElement("li");
  const time = document.createElement("span");
  time.className = "session-time";
  time.textContent = `${fmtClock(x.started_at)} – ${
    x.ended_at ? fmtClock(x.ended_at) : "läuft"
  }`;
  const dur = document.createElement("span");
  dur.className = "session-duration";
  dur.textContent = fmtHoursMinutes(sessionDurationMs(x));
  const c = document.createElement("span");
  c.className = "session-comment";
  if (x.comment) {
    c.textContent = x.comment;
  } else {
    c.textContent = x.ended_at ? "(kein Kommentar)" : "läuft...";
    c.classList.add("placeholder");
  }
  const actions = document.createElement("span");
  actions.className = "session-actions";
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "delete-session";
  deleteBtn.textContent = "Löschen";
  deleteBtn.setAttribute("aria-label", `Session ${time.textContent} löschen`);
  deleteBtn.addEventListener("click", () => deleteSession(x.id));
  actions.appendChild(deleteBtn);

  li.append(time, dur, c, actions);
  return li;
}

function createDateHeader(d, sessions) {
  const li = document.createElement("li");
  li.className = "date-header";
  const label = document.createElement("span");
  label.className = "date-label";
  label.textContent = fmtDayLabel(d);
  const totals = document.createElement("span");
  totals.className = "date-totals";
  totals.textContent = fmtHoursMinutes(
    sessions.reduce((sum, x) => sum + sessionDurationMs(x), 0)
  );
  li.append(label, totals);
  return li;
}

// --- Data layer ---

function setSync(text, isError = false) {
  els.syncState.textContent = text;
  els.syncState.classList.toggle("error", isError);
}

async function loadData() {
  state.loading = true;
  setSync("Lade...");
  try {
    const res = await fetch(`${API_ENDPOINT}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const json = await res.json();
    state.sha = json.sha;
    const parsed = json.data;
    state.data = parsed && Array.isArray(parsed.sessions) ? parsed : { sessions: [] };
    setSync(`Geladen (${state.data.sessions.length} Sessions)`);
  } catch (e) {
    console.error(e);
    setSync("Fehler beim Laden", true);
    // Fallback keeps GitHub Pages usable for read-only viewing while the API is being set up.
    try {
      const res = await fetch(`${DATA_FALLBACK_URL}?t=${Date.now()}`);
      if (res.ok) {
        state.data = await res.json();
        setSync("Geladen (read-only)");
      }
    } catch {}
  } finally {
    state.loading = false;
  }
}

async function saveData() {
  state.saving = true;
  setSync("Speichere...");
  try {
    const res = await fetch(API_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: state.data, sha: state.sha }),
    });
    if (res.status === 409) {
      setSync("Konflikt — lade neu", true);
      await loadData();
      render();
      return false;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Speichern fehlgeschlagen (${res.status})`);
    }
    const json = await res.json();
    state.sha = json.sha;
    setSync("Gespeichert");
    return true;
  } catch (e) {
    console.error(e);
    setSync(e.message || "Fehler beim Speichern", true);
    return false;
  } finally {
    state.saving = false;
  }
}

// --- Session actions ---

function activeSession() {
  return state.data.sessions.find(
    (s) => s.user === state.user && !s.ended_at
  );
}

async function checkIn() {
  if (activeSession()) return;
  if (isBeforeStart()) return;
  const session = {
    id: crypto.randomUUID(),
    user: state.user,
    started_at: new Date().toISOString(),
    ended_at: null,
    comment: null,
  };
  state.data.sessions.push(session);
  render();
  const ok = await saveData();
  if (!ok) {
    state.data.sessions = state.data.sessions.filter((s) => s.id !== session.id);
    render();
  }
}

function beginCheckout() {
  const s = activeSession();
  if (!s) return;
  state.pendingCheckoutId = s.id;
  els.commentInput.value = "";
  els.commentArea.classList.remove("hidden");
  els.commentInput.focus();
}

function cancelCheckout() {
  state.pendingCheckoutId = null;
  els.commentArea.classList.add("hidden");
}

async function confirmCheckout() {
  const id = state.pendingCheckoutId;
  if (!id) return;
  const s = state.data.sessions.find((x) => x.id === id);
  if (!s) return;
  const original = { ended_at: s.ended_at, comment: s.comment };
  s.ended_at = new Date().toISOString();
  s.comment = els.commentInput.value.trim() || null;
  cancelCheckout();
  render();
  const ok = await saveData();
  if (!ok) {
    s.ended_at = original.ended_at;
    s.comment = original.comment;
    render();
  }
}

async function deleteSession(id) {
  const s = state.data.sessions.find((x) => x.id === id);
  if (!s) return;
  const label = `${fmtClock(s.started_at)} – ${s.ended_at ? fmtClock(s.ended_at) : "läuft"}`;
  if (!confirm(`${label} wirklich löschen?`)) return;

  const originalSessions = state.data.sessions.slice();
  state.data.sessions = state.data.sessions.filter((x) => x.id !== id);
  if (state.pendingCheckoutId === id) cancelCheckout();
  if (
    state.dashboardSelection &&
    state.dashboardSelection.user === s.user &&
    state.dashboardSelection.day === dayKey(new Date(s.started_at)) &&
    !sessionsForUserDay(s.user, new Date(s.started_at)).length
  ) {
    state.dashboardSelection = null;
  }
  render();
  const ok = await saveData();
  if (!ok) {
    state.data.sessions = originalSessions;
    render();
  }
}

// --- Rendering ---

function renderTracker() {
  const s = activeSession();
  const today = state.data.sessions
    .filter(
      (x) => x.user === state.user && sameDay(new Date(x.started_at), new Date())
    )
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  els.actionBtn.disabled = false;
  if (s) {
    els.statusCard.classList.add("active");
    els.statusLabel.textContent = "Eingecheckt";
    els.statusMeta.textContent = `seit ${fmtClock(s.started_at)}`;
    els.actionBtn.textContent = "Auschecken";
    els.actionBtn.onclick = beginCheckout;
  } else if (isBeforeStart()) {
    els.statusCard.classList.remove("active");
    els.statusLabel.textContent = "Noch nicht gestartet";
    els.statusMeta.textContent = `Start am ${START_DATE.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
    els.timer.textContent = "00:00:00";
    els.actionBtn.textContent = "Einchecken";
    els.actionBtn.disabled = true;
    els.actionBtn.onclick = null;
  } else {
    els.statusCard.classList.remove("active");
    els.statusLabel.textContent = "Ausgecheckt";
    els.statusMeta.textContent = "";
    els.timer.textContent = "00:00:00";
    els.actionBtn.textContent = "Einchecken";
    els.actionBtn.onclick = checkIn;
  }

  // Hide "Heute" section entirely before start date
  if (isBeforeStart()) {
    els.todaySection.classList.add("hidden");
    return;
  }
  els.todaySection.classList.remove("hidden");

  // Today summary
  const totalMs = today.reduce((sum, x) => sum + sessionDurationMs(x), 0);
  els.todaySummary.textContent = fmtHoursMinutes(totalMs);

  // Today list
  els.todayList.innerHTML = "";
  if (today.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Noch keine Session heute";
    els.todayList.appendChild(li);
  } else {
    today.forEach((x) => {
      els.todayList.appendChild(createSessionItem(x));
    });
  }

  renderRecentHistory();
}

function renderRecentHistory() {
  const today = startOfDay(new Date());
  const sessions = state.data.sessions
    .filter((x) => x.user === state.user && startOfDay(new Date(x.started_at)) < today)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  els.recentList.innerHTML = "";
  if (sessions.length === 0) {
    els.recentSection.classList.add("hidden");
    return;
  }

  els.recentSection.classList.remove("hidden");
  const grouped = new Map();
  sessions.forEach((x) => {
    const key = dayKey(new Date(x.started_at));
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(x);
  });

  grouped.forEach((items, key) => {
    const d = new Date(Number(key));
    els.recentList.appendChild(createDateHeader(d, items));
    items
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
      .forEach((x) => els.recentList.appendChild(createSessionItem(x)));
  });
}

function renderDashboard() {
  const windowStart = dashboardWindowStart();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(windowStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const users = ["kastri", "thomas"];

  els.weekLabel.textContent = `Diese Woche: ${days[0].toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  })} – ${days[6].toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  })}`;

  // Build grid
  els.weekGrid.innerHTML = "";
  const corner = document.createElement("div");
  corner.className = "week-cell header";
  corner.textContent = "";
  els.weekGrid.appendChild(corner);

  const today = new Date();
  days.forEach((d) => {
    const cell = document.createElement("div");
    cell.className = "week-cell header";
    if (sameDay(d, today)) cell.classList.add("today");
    const wd = dayNames[(d.getDay() + 6) % 7];
    cell.innerHTML = `${wd}<span class="day-label">${d.getDate()}.${
      d.getMonth() + 1
    }</span>`;
    els.weekGrid.appendChild(cell);
  });

  users.forEach((u) => {
    const label = document.createElement("div");
    label.className = "week-cell label";
    label.textContent = u;
    els.weekGrid.appendChild(label);
    days.forEach((d) => {
      const cell = document.createElement("div");
      cell.className = "week-cell";
      if (sameDay(d, today)) cell.classList.add("today");
      const dayMs = state.data.sessions
        .filter(
          (s) => s.user === u && sameDay(new Date(s.started_at), d)
        )
        .reduce((sum, s) => sum + sessionDurationMs(s), 0);
      const hours = dayMs / 3600000;
      if (dayMs > 0) {
        cell.textContent = fmtHoursMinutes(dayMs);
        cell.classList.add("has-history");
        cell.setAttribute("role", "button");
        cell.setAttribute("tabindex", "0");
        cell.setAttribute("aria-label", `${u}, ${fmtDayLabel(d)}, ${fmtHoursMinutes(dayMs)} anzeigen`);
        if (
          state.dashboardSelection &&
          state.dashboardSelection.user === u &&
          state.dashboardSelection.day === dayKey(d)
        ) {
          cell.classList.add("selected");
        }
        cell.addEventListener("click", () => selectDashboardDay(u, d));
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectDashboardDay(u, d);
          }
        });
      }
      if (hours >= 1) cell.classList.add("met");
      els.weekGrid.appendChild(cell);
    });
  });

  // 7-day window stats
  els.weekStats.innerHTML = "";
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 7);
  users.forEach((u) => {
    const userSessions = state.data.sessions.filter(
      (s) =>
        s.user === u &&
        new Date(s.started_at) >= windowStart &&
        new Date(s.started_at) < windowEnd
    );
    const totalMs = userSessions.reduce((sum, s) => sum + sessionDurationMs(s), 0);
    const daysMet = days.filter((d) => {
      const dayMs = userSessions
        .filter((s) => sameDay(new Date(s.started_at), d))
        .reduce((sum, s) => sum + sessionDurationMs(s), 0);
      return dayMs >= 3600000;
    }).length;
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="name">${u}</div>
      <div class="total">${fmtHoursMinutes(totalMs)}</div>
      <div class="meta">${daysMet}/5 Tage erfüllt</div>
    `;
    els.weekStats.appendChild(card);
  });

  renderDashboardHistory();
  renderWeeksHistory();
  renderMonthsHistory();
}

const USERS = ["kastri", "thomas"];

function appendOverviewCell(parent, opts = {}) {
  const cell = document.createElement("div");
  cell.className = "overview-cell";
  if (opts.header) cell.classList.add("header");
  if (opts.classes) opts.classes.forEach((c) => cell.classList.add(c));
  if (opts.primary !== undefined) {
    const p = document.createElement("div");
    p.className = "primary";
    p.textContent = opts.primary;
    cell.appendChild(p);
  }
  if (opts.secondary !== undefined) {
    const s = document.createElement("div");
    s.className = "secondary";
    s.textContent = opts.secondary;
    cell.appendChild(s);
  }
  parent.appendChild(cell);
  return cell;
}

function renderWeeksHistory() {
  const weeks = listPastWeeks();
  if (weeks.length === 0) {
    els.weeksSection.classList.add("hidden");
    return;
  }
  els.weeksSection.classList.remove("hidden");
  els.weeksTable.innerHTML = "";

  appendOverviewCell(els.weeksTable, { header: true, primary: "Woche" });
  USERS.forEach((u) =>
    appendOverviewCell(els.weeksTable, { header: true, primary: u })
  );

  weeks.forEach(({ start, end }) => {
    const kw = isoWeekNumber(start);
    appendOverviewCell(els.weeksTable, {
      primary: `KW ${kw}`,
      secondary: `${fmtShortDate(start)}–${fmtShortDate(end)}`,
    });
    USERS.forEach((u) => {
      const { totalMs, daysMet, met } = weekStatsForUser(start, u);
      const mark = met ? "✓" : "✗";
      appendOverviewCell(els.weeksTable, {
        primary: `${daysMet}/5 ${mark}`,
        secondary: fmtHoursMinutes(totalMs),
        classes: [met ? "met" : "missed"],
      });
    });
  });
}

function dayHoursForUser(d, user) {
  const ms = state.data.sessions
    .filter((s) => s.user === user && sameDay(new Date(s.started_at), d))
    .reduce((sum, s) => sum + sessionDurationMs(s), 0);
  return ms / 3600000;
}

function bucketForHours(h) {
  if (h <= 0) return 0;
  if (h < 1) return 1;
  if (h < 2) return 2;
  return 3;
}

function renderMonthsHistory() {
  const months = listMonths();
  if (months.length === 0) {
    els.monthsSection.classList.add("hidden");
    return;
  }
  els.monthsSection.classList.remove("hidden");
  els.monthsTable.innerHTML = "";
  els.monthsTable.className = "month-board";

  const today = startOfDay(new Date());
  const startBoundary = startOfDay(START_DATE);

  months.forEach((monthStart) => {
    const card = document.createElement("div");
    card.className = "month-card";

    const head = document.createElement("div");
    head.className = "month-head";
    const label = document.createElement("div");
    label.className = "month-label";
    label.textContent = monthStart.toLocaleDateString("de-DE", {
      month: "long",
      year: "numeric",
    });
    head.appendChild(label);
    if (isCurrentMonth(monthStart)) {
      const tag = document.createElement("span");
      tag.className = "month-tag";
      tag.textContent = "läuft";
      head.appendChild(tag);
    }
    card.appendChild(head);

    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const daysInMonth = Math.round(
      (monthEnd - monthStart) / 86400000
    );

    USERS.forEach((u) => {
      const row = document.createElement("div");
      row.className = "month-row";
      const name = document.createElement("div");
      name.className = "month-user";
      name.textContent = u;
      row.appendChild(name);

      const grid = document.createElement("div");
      grid.className = "month-grid";
      let totalMs = 0;
      let activeDays = 0;
      for (let i = 0; i < daysInMonth; i++) {
        const d = new Date(monthStart);
        d.setDate(d.getDate() + i);
        const cell = document.createElement("div");
        cell.className = "month-day";
        const isFuture = d > today;
        const isBeforeStartDay = d < startBoundary;
        if (isFuture || isBeforeStartDay) {
          cell.classList.add("inactive");
          cell.setAttribute("aria-label", `${fmtShortDate(d)} – noch nicht`);
        } else {
          const h = dayHoursForUser(d, u);
          const b = bucketForHours(h);
          cell.classList.add(`b${b}`);
          const dayMs = h * 3600000;
          totalMs += dayMs;
          if (dayMs > 0) activeDays++;
          cell.setAttribute(
            "aria-label",
            `${fmtShortDate(d)} – ${fmtHoursMinutes(dayMs)}`
          );
          cell.title = `${fmtShortDate(d)} · ${fmtHoursMinutes(dayMs)}`;
        }
        grid.appendChild(cell);
      }
      row.appendChild(grid);

      const total = document.createElement("div");
      total.className = "month-total";
      total.innerHTML = `<span class="primary">${fmtHoursMinutes(
        totalMs
      )}</span><span class="secondary">${activeDays} ${
        activeDays === 1 ? "Tag" : "Tage"
      }</span>`;
      row.appendChild(total);

      card.appendChild(row);
    });

    els.monthsTable.appendChild(card);
  });
}

function sessionsForUserDay(user, d) {
  return state.data.sessions
    .filter((s) => s.user === user && sameDay(new Date(s.started_at), d))
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
}

function selectDashboardDay(user, d) {
  state.dashboardSelection = { user, day: dayKey(d) };
  renderDashboard();
}

function renderDashboardHistory() {
  const selection = state.dashboardSelection;
  if (!selection) {
    els.dashboardHistory.classList.add("hidden");
    els.historyList.innerHTML = "";
    return;
  }

  const selectedDay = new Date(Number(selection.day));
  const sessions = sessionsForUserDay(selection.user, selectedDay);
  if (sessions.length === 0) {
    state.dashboardSelection = null;
    els.dashboardHistory.classList.add("hidden");
    els.historyList.innerHTML = "";
    return;
  }

  els.dashboardHistory.classList.remove("hidden");
  els.historyLabel.textContent = `${selection.user} · ${fmtDayLabel(selectedDay)}`;
  els.historyList.innerHTML = "";

  sessions.forEach((x) => {
    els.historyList.appendChild(createSessionItem(x));
  });
}

function render() {
  renderTracker();
  renderDashboard();
  tickTimer();
}

function tickTimer() {
  const s = activeSession();
  if (s) {
    els.timer.textContent = fmtDuration(sessionDurationMs(s));
  }
}

// --- Tabs & user switch ---

function switchTab(tab) {
  els.tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  els.views.forEach((v) =>
    v.classList.toggle("hidden", v.id !== `view-${tab}`)
  );
}

function switchUser(user) {
  state.user = user;
  localStorage.setItem(USER_KEY, user);
  els.userBtns.forEach((b) =>
    b.classList.toggle("active", b.dataset.user === user)
  );
  cancelCheckout();
  render();
}

// --- Wire up events ---

els.tabs.forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab))
);
els.userBtns.forEach((b) =>
  b.addEventListener("click", () => switchUser(b.dataset.user))
);
els.confirmCheckout.addEventListener("click", confirmCheckout);
els.cancelCheckout.addEventListener("click", cancelCheckout);

// Refresh from server on tab focus (catches changes from the other user).
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && !state.saving) {
    await loadData();
    render();
  }
});

// --- Init ---

async function init() {
  // Set initial UI from persisted user
  els.userBtns.forEach((b) =>
    b.classList.toggle("active", b.dataset.user === state.user)
  );
  await loadData();
  render();
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(tickTimer, 1000);
  // Periodic refresh every 30s so both users see updates without reloading.
  setInterval(async () => {
    if (state.saving || document.visibilityState !== "visible") return;
    await loadData();
    render();
  }, 30000);
}

init();
