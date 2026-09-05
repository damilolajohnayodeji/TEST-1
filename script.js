/* ==========================================================================
   Birthday Celebration — Application Logic
   Vanilla JS. No build step. Talks to a Google Apps Script Web App backend.
   ========================================================================== */

/* --------------------------------------------------------------------
   CONFIG — replace with your deployed Apps Script Web App URL.
   -------------------------------------------------------------------- */
const API_URL = "https://script.google.com/macros/s/AKfycbyvXNSNg1Stbdxuu8err3_ggHZzDUcTA3Y2IHsJuAUjTA70Af720xZe0u6zGcY5sAZY/exec";

/* --------------------------------------------------------------------
   STATE
   -------------------------------------------------------------------- */
const state = {
  settings: null,
  messages: [],
  currentMessageId: null,
  card: {
    theme: "classic-purple",
    orientation: "portrait",
    size: "story"
  }
};

const THEMES = [
  { id: "classic-purple", label: "Classic Purple" },
  { id: "blush-dream", label: "Blush Dream" },
  { id: "midnight-gold", label: "Midnight Gold" },
  { id: "fresh-mint", label: "Fresh Mint" },
  { id: "sunset-coral", label: "Sunset Coral" }
];

const SESSION_KEY = "birthdayapp_session_token";

/* --------------------------------------------------------------------
   DOM HELPERS
   -------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove("is-hidden"); }
function hide(el) { el.classList.add("is-hidden"); }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function setLoading(btn, isLoading) {
  btn.disabled = isLoading;
  btn.classList.toggle("is-loading", isLoading);
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3200);
}

function formatDate(dateLike) {
  if (!dateLike) return "";
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatTimestamp(dateLike) {
  if (!dateLike) return "";
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

/* --------------------------------------------------------------------
   API LAYER
   Contract expected from the Apps Script backend (see README.md):

   GET  ?action=getSettings
        -> { success: true, data: { celebrant_name, profile_picture_url,
             birthday_picture_url, birthday_date, birthday_title,
             birthday_introduction } }
        NOTE: Owner_PIN must never be included in this response.

   POST { action: "submitMessage", sender_name, message }
        -> { success: true } | { success: false, error }

   POST { action: "login", pin }
        -> { success: true, token } | { success: false, error }

   GET  ?action=getMessages&token=...
        -> { success: true, data: [{ id, sender_name, message, timestamp }] }
        -> { success: false, error: "unauthorized" }  (bad/expired token)
   -------------------------------------------------------------------- */

async function apiGet(params) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error("Network error (" + res.status + ")");
  return res.json();
}

async function apiPost(body) {
  // text/plain avoids a CORS preflight against Apps Script's web app endpoint.
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("Network error (" + res.status + ")");
  return res.json();
}

function getToken() {
  return sessionStorage.getItem(SESSION_KEY);
}
function setToken(token) {
  sessionStorage.setItem(SESSION_KEY, token);
}
function clearToken() {
  sessionStorage.removeItem(SESSION_KEY);
}

/* --------------------------------------------------------------------
   ROUTER
   -------------------------------------------------------------------- */
const VIEWS = ["home", "login", "vault", "message"];

function parseHash() {
  const hash = (location.hash || "#home").replace(/^#/, "");
  const [name, param] = hash.split("/");
  return { name: VIEWS.includes(name) ? name : "home", param };
}

function navigate(route) {
  location.hash = route;
}

function router() {
  const { name, param } = parseHash();

  if ((name === "vault" || name === "message") && !getToken()) {
    navigate("login");
    return;
  }

  VIEWS.forEach((v) => hide($("view-" + v)));
  show($("view-" + name));
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  if (name === "vault") loadVault();
  if (name === "message") openMessage(param);
}

window.addEventListener("hashchange", router);

/* --------------------------------------------------------------------
   PAGE 1 — PUBLIC BIRTHDAY PAGE
   -------------------------------------------------------------------- */

async function loadSettings() {
  hide($("home-error"));
  hide($("home-content"));
  show($("home-loading"));

  try {
    const res = await apiGet({ action: "getSettings" });
    if (!res || res.success === false) {
      throw new Error((res && res.error) || "Could not load celebration settings.");
    }
    state.settings = res.data || {};
    renderSettings(state.settings);
    hide($("home-loading"));
    show($("home-content"));
  } catch (err) {
    hide($("home-loading"));
    $("home-error-message").textContent =
      err.message || "Something went wrong while fetching the celebration details.";
    show($("home-error"));
  }
}

function renderSettings(data) {
  const photo = data.profile_picture_url || data.birthday_picture_url || "";
  const photoEl = $("celebrant-photo");
  photoEl.src = photo;
  photoEl.alt = data.celebrant_name ? `Photo of ${data.celebrant_name}` : "Celebrant photo";

  $("celebrant-name").textContent = data.celebrant_name || "Our Celebrant";
  $("celebrant-date").textContent = formatDate(data.birthday_date);
  $("celebrant-intro").textContent =
    data.birthday_introduction ||
    "Today is a special day. Leave a message, prayer or birthday wish to make it memorable.";

  if (data.birthday_title) {
    document.title = data.birthday_title;
  }
}

$("home-retry").addEventListener("click", loadSettings);

$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nameField = $("visitor-name");
  const messageField = $("visitor-message");
  const nameError = $("visitor-name-error");
  const messageError = $("visitor-message-error");
  const successEl = $("send-success");
  const errorEl = $("send-error");

  nameError.textContent = "";
  messageError.textContent = "";
  hide(successEl);
  hide(errorEl);
  nameField.closest(".field").classList.remove("field--invalid");
  messageField.closest(".field").classList.remove("field--invalid");

  const name = nameField.value.trim();
  const message = messageField.value.trim();
  let hasError = false;

  if (!name) {
    nameError.textContent = "Please enter your name.";
    nameField.closest(".field").classList.add("field--invalid");
    hasError = true;
  }
  if (!message) {
    messageError.textContent = "Please write a birthday message.";
    messageField.closest(".field").classList.add("field--invalid");
    hasError = true;
  }
  if (hasError) return;

  const btn = $("send-btn");
  setLoading(btn, true);

  try {
    const res = await apiPost({ action: "submitMessage", sender_name: name, message });
    if (!res || res.success === false) {
      throw new Error((res && res.error) || "Your message could not be sent. Please try again.");
    }
    show(successEl);
    $("message-form").reset();
  } catch (err) {
    errorEl.textContent = err.message || "Your message could not be sent. Please try again.";
    show(errorEl);
  } finally {
    setLoading(btn, false);
  }
});

/* --------------------------------------------------------------------
   PAGE 2 — LOGIN
   -------------------------------------------------------------------- */

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const pinField = $("pin-input");
  const pinError = $("pin-error");
  const loginError = $("login-error");
  pinError.textContent = "";
  hide(loginError);
  pinField.closest(".field").classList.remove("field--invalid");

  const pin = pinField.value.trim();
  if (!pin) {
    pinError.textContent = "Please enter your PIN.";
    pinField.closest(".field").classList.add("field--invalid");
    return;
  }

  const btn = $("login-btn");
  setLoading(btn, true);

  try {
    // The PIN is only ever compared server-side inside Apps Script.
    const res = await apiPost({ action: "login", pin });
    if (!res || res.success === false || !res.token) {
      throw new Error((res && res.error) || "Incorrect PIN. Please try again.");
    }
    setToken(res.token);
    pinField.value = "";
    navigate("vault");
  } catch (err) {
    loginError.textContent = err.message || "Incorrect PIN. Please try again.";
    show(loginError);
  } finally {
    setLoading(btn, false);
  }
});

$("logout-btn").addEventListener("click", () => {
  clearToken();
  state.messages = [];
  navigate("home");
  toast("Logged out.");
});

/* --------------------------------------------------------------------
   PAGE 3 — MESSAGE VAULT
   -------------------------------------------------------------------- */

async function loadVault() {
  hide($("vault-error"));
  hide($("vault-empty"));
  hide($("message-list"));
  show($("vault-loading"));
  $("vault-count").textContent = "";

  try {
    const res = await apiGet({ action: "getMessages", token: getToken() });
    if (!res || res.success === false) {
      if (res && res.error === "unauthorized") {
        clearToken();
        navigate("login");
        return;
      }
      throw new Error((res && res.error) || "Could not load messages.");
    }
    state.messages = res.data || [];
    renderVault();
  } catch (err) {
    hide($("vault-loading"));
    $("vault-error-message").textContent = err.message || "Could not load messages.";
    show($("vault-error"));
  }
}

function renderVault() {
  hide($("vault-loading"));
  const list = $("message-list");
  list.innerHTML = "";

  $("vault-count").textContent =
    state.messages.length === 1 ? "1 message" : `${state.messages.length} messages`;

  if (state.messages.length === 0) {
    show($("vault-empty"));
    hide(list);
    return;
  }

  hide($("vault-empty"));
  const sorted = [...state.messages].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  sorted.forEach((m) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <button type="button" class="message-item" data-id="${escapeHtml(m.id)}">
        <div class="message-item__top">
          <span class="message-item__name">${escapeHtml(m.sender_name)}</span>
          <span class="message-item__time">${escapeHtml(formatTimestamp(m.timestamp))}</span>
        </div>
        <p class="message-item__preview">${escapeHtml(m.message)}</p>
      </button>
    `;
    list.appendChild(li);
  });

  show(list);

  list.querySelectorAll(".message-item").forEach((btn) => {
    btn.addEventListener("click", () => navigate("message/" + btn.dataset.id));
  });
}

$("vault-retry").addEventListener("click", loadVault);

$("download-pdf-btn").addEventListener("click", async () => {
  const btn = $("download-pdf-btn");
  if (!state.messages.length) {
    toast("There are no messages to export yet.");
    return;
  }

  setLoading(btn, true);
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 48;
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    const celebrantName = (state.settings && state.settings.celebrant_name) || "Birthday Messages";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`Birthday Messages for ${celebrantName}`, margin, y);
    y += 28;

    const sorted = [...state.messages].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    sorted.forEach((m, index) => {
      const lines = [];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      const nameLine = `${index + 1}. ${m.sender_name}`;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const timeLine = formatTimestamp(m.timestamp);
      doc.setFontSize(11);
      const bodyLines = doc.splitTextToSize(m.message, maxWidth);

      const blockHeight = 16 + 14 + bodyLines.length * 14 + 14;
      if (y + blockHeight > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(nameLine, margin, y);
      y += 15;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(120);
      doc.text(timeLine, margin, y);
      doc.setTextColor(20);
      y += 14;

      doc.setFontSize(11);
      doc.text(bodyLines, margin, y);
      y += bodyLines.length * 14 + 16;
    });

    doc.save(`birthday-messages-${Date.now()}.pdf`);
  } catch (err) {
    toast("Could not generate the PDF. Please try again.");
  } finally {
    setLoading(btn, false);
  }
});

/* --------------------------------------------------------------------
   PAGE 4 — INDIVIDUAL MESSAGE + BIRTHDAY CARD DESIGNER
   -------------------------------------------------------------------- */

function openMessage(id) {
  const message = state.messages.find((m) => String(m.id) === String(id));

  if (!message) {
    // Vault hasn't loaded yet (e.g. direct navigation) — load then retry.
    if (!state.messages.length) {
      apiGet({ action: "getMessages", token: getToken() })
        .then((res) => {
          if (res && res.success !== false) {
            state.messages = res.data || [];
            openMessage(id);
          } else {
            navigate("vault");
          }
        })
        .catch(() => navigate("vault"));
      return;
    }
    navigate("vault");
    return;
  }

  state.currentMessageId = message.id;
  renderMessageDetail(message);
  updateCardPreview();
}

function renderMessageDetail(m) {
  $("message-detail").innerHTML = `
    <p class="message-detail__name">${escapeHtml(m.sender_name)}</p>
    <p class="message-detail__time">${escapeHtml(formatTimestamp(m.timestamp))}</p>
    <p class="message-detail__body">${escapeHtml(m.message)}</p>
  `;
}

function buildThemeChips() {
  const row = $("theme-row");
  row.innerHTML = "";
  THEMES.forEach((t) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (t.id === state.card.theme ? " is-active" : "");
    chip.textContent = t.label;
    chip.dataset.theme = t.id;
    chip.addEventListener("click", () => {
      state.card.theme = t.id;
      row.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      updateCardPreview();
    });
    row.appendChild(chip);
  });
}

$("orientation-row").querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.card.orientation = chip.dataset.orientation;
    $("orientation-row").querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    updateCardPreview();
  });
});

$("size-row").querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.card.size = chip.dataset.size;
    $("size-row").querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    updateCardPreview();
  });
});

function updateCardPreview() {
  const message = state.messages.find((m) => String(m.id) === String(state.currentMessageId));
  if (!message) return;

  const el = $("card-preview");
  const celebrantName = (state.settings && state.settings.celebrant_name) || "our celebrant";

  // Reset classes, then apply theme / orientation / size.
  el.className = "card-preview theme-" + state.card.theme;
  if (state.card.orientation === "landscape") el.classList.add("card-preview--landscape");
  if (state.card.size !== "story") el.classList.add("card-preview--size-" + state.card.size);

  $("card-eyebrow").textContent = "Happy Birthday, " + celebrantName + "!";
  $("card-name").textContent = message.sender_name;
  $("card-message").textContent = message.message;
  $("card-sender").textContent = message.sender_name;
  $("card-footer").textContent = "made with love for " + celebrantName;
}

buildThemeChips();

$("download-card-btn").addEventListener("click", async () => {
  const btn = $("download-card-btn");
  const el = $("card-preview");
  if (!el) return;

  setLoading(btn, true);
  const previousTransform = el.style.transform;

  try {
    // Fonts must be fully loaded so the exported image text matches the
    // on-screen preview exactly (no fallback-font reflow in the capture).
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    // Neutralise the small-screen preview scale-down (see CSS) so the
    // captured canvas reflects the card's true, undistorted layout.
    el.style.transform = "none";

    const canvas = await html2canvas(el, {
      backgroundColor: null,
      useCORS: true,
      scale: Math.max(3, window.devicePixelRatio * 2 || 3),
      logging: false
    });

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `birthday-card-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    toast("Could not export the card. Please try again.");
  } finally {
    el.style.transform = previousTransform;
    setLoading(btn, false);
  }
});

/* --------------------------------------------------------------------
   INIT
   -------------------------------------------------------------------- */

async function init() {
  await loadSettings();
  router();
}

document.addEventListener("DOMContentLoaded", init);
