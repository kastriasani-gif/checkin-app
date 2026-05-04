// Check-in app — pure browser, GitHub Contents API as backend.

const REPO_OWNER = "kastriasani-gif";
const REPO_NAME = "checkin-app";
const DATA_PATH = "data.json";
const BRANCH = "main";

const TOKEN_KEY = "checkin.token";
const USER_KEY = "checkin.user";

const START_DATE = new Date(2026, 4, 5); // 2026-05-05 (Mai = 4)

const state = {
  user: localStorage.getItem(USER_KEY) || "kastri",
  token: localStorage.getItem(TOKEN_KEY) || "",
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
  weekGrid: document.getElementById("week-grid"),
  weekStats: document.getElementById("week-stats"),
  weekLabel: document.getElementById("week-label"),
  syncState: document.getElementById("sync-state"),
  settingsBtn: document.getElementById("settings-btn"),
  tokenDialog: document.getElementById("token-dialog"),
  tokenInput: document.getElementById("token-input"),
  saveToken: document.getElementById("save-token"),
  shareLink: document.getElementById("share-link"),
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

function rollingWindowStart() {
  const today = startOfDay(new Date());
  const start = startOfDay(START_DATE);
  return today < start ? start : today;
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

function sessionDurationMs(s, now = Date.now()) {
  const start = new Date(s.started_at).getTime();
  const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
  return Math.max(0, end - start);
}

// --- Data layer (GitHub Contents API) ---

const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${DATA_PATH}`;

function setSync(text, isError = false) {
  els.syncState.textContent = text;
  els.syncState.classList.toggle("error", isError);
}

async function loadData() {
  state.loading = true;
  setSync("Lade...");
  try {
    // Always go through API to also capture sha (for future writes).
    const headers = { Accept: "application/vnd.github+json" };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`${API_BASE}?ref=${BRANCH}`, { headers });
    if (res.status === 404) {
      state.data = { sessions: [] };
      state.sha = null;
      setSync("Leer (noch nichts gespeichert)");
      return;
    }
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const json = await res.json();
    state.sha = json.sha;
    const decoded = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ""))));
    const parsed = JSON.parse(decoded);
    state.data = parsed && Array.isArray(parsed.sessions) ? parsed : { sessions: [] };
    setSync(`Geladen (${state.data.sessions.length} Sessions)`);
  } catch (e) {
    console.error(e);
    setSync("Fehler beim Laden", true);
    // Fallback: try raw URL (read-only) — useful before token is set.
    try {
      const res = await fetch(`${RAW_BASE}?t=${Date.now()}`);
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
  if (!state.token) {
    openTokenDialog("Token fehlt — bitte einrichten.");
    return false;
  }
  state.saving = true;
  setSync("Speichere...");
  try {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(state.data, null, 2))));
    const body = {
      message: `update sessions (${state.user})`,
      content,
      branch: BRANCH,
    };
    if (state.sha) body.sha = state.sha;
    const res = await fetch(API_BASE, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${state.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      setSync("Konflikt — lade neu", true);
      await loadData();
      render();
      return false;
    }
    if (res.status === 401 || res.status === 403) {
      setSync("Token ungültig oder ohne Schreibrechte", true);
      openTokenDialog("Token ungültig — siehe README für Setup");
      return false;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub ${res.status}: ${err}`);
    }
    const json = await res.json();
    state.sha = json.content.sha;
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
      li.append(time, dur, c);
      els.todayList.appendChild(li);
    });
  }
}

function renderDashboard() {
  const windowStart = rollingWindowStart();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(windowStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const users = ["kastri", "thomas"];

  els.weekLabel.textContent = `Aktuelle 7 Tage: ${days[0].toLocaleDateString("de-DE", {
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
      if (dayMs > 0) cell.textContent = fmtHoursMinutes(dayMs);
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

}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
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

// --- Token dialog ---

function openTokenDialog(hint) {
  if (hint) setSync(hint, true);
  els.tokenInput.value = state.token || "";
  els.tokenDialog.showModal();
  setTimeout(() => {
    els.tokenInput.focus();
    els.tokenInput.select();
  }, 50);
}

els.saveToken.addEventListener("click", (e) => {
  e.preventDefault();
  const v = els.tokenInput.value.trim();
  if (v) {
    state.token = v;
    localStorage.setItem(TOKEN_KEY, v);
    els.tokenDialog.close();
    setSync("Token gespeichert");
    init();
  } else {
    els.tokenDialog.close();
  }
});

// Allow sharing setup via URL: ?token=github_pat_...
function importTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (t) {
    state.token = t;
    localStorage.setItem(TOKEN_KEY, t);
    params.delete("token");
    const clean =
      window.location.pathname +
      (params.toString() ? "?" + params.toString() : "");
    window.history.replaceState({}, "", clean);
    setSync("Token aus Link gespeichert");
  }
}

// Copy a setup link with the current token to share with the other user.
async function copySetupLink() {
  if (!state.token) {
    openTokenDialog("Erst Token setzen, dann teilen.");
    return;
  }
  const url = `${window.location.origin}${window.location.pathname}?token=${encodeURIComponent(state.token)}`;
  try {
    await navigator.clipboard.writeText(url);
    setSync("Setup-Link kopiert");
  } catch {
    prompt("Setup-Link kopieren:", url);
  }
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
els.settingsBtn.addEventListener("click", () => openTokenDialog());
els.shareLink.addEventListener("click", (e) => {
  e.preventDefault();
  copySetupLink();
});

// Refresh from server on tab focus (catches changes from the other user).
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && !state.saving) {
    await loadData();
    render();
  }
});

// --- Init ---

async function init() {
  importTokenFromUrl();
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
