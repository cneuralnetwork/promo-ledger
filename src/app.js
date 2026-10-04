import {
  addDays,
  CURRENCIES,
  currencySymbol,
  dateLabel,
  effectiveStatus,
  escapeHTML as h,
  formatMoney,
  humanDate,
  localISO,
  normalizePromo,
  parseAmountCents,
  parseBackup,
  statusLabel,
  toCSV,
  totals,
} from "./ledger.js";
import {
  deletePromo,
  listPromos,
  mergePromos,
  openDatabase,
  savePromo,
} from "./db.js";

const app = document.querySelector("#app");
const formDialog = document.querySelector("#promo-dialog");
const detailDialog = document.querySelector("#detail-dialog");
const form = document.querySelector("#promo-form");
const fileInput = document.querySelector("#backup-file");
const toastElement = document.querySelector("#toast");
const state = {
  promos: [],
  currency: localStorage.getItem("pl-currency") || "USD",
  theme: localStorage.getItem("pl-theme") || "system",
  filter: "all",
  sort: "updated",
  query: "",
  brand: "",
  editingId: null,
  detailId: null,
};
if (!CURRENCIES.includes(state.currency)) state.currency = "USD";
if (!["system", "light", "dark"].includes(state.theme)) state.theme = "system";
let toastTimeout;

function applyTheme() {
  const theme =
    state.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : state.theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#15140f" : "#f6f3ec";
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener(
  "change",
  applyTheme,
);

function notify(message) {
  toastElement.textContent = message;
  toastElement.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastElement.hidden = true;
  }, 4000);
}

function view() {
  const name = location.hash.slice(1);
  return ["dashboard", "promos", "brands", "invoices", "settings"].includes(
    name,
  )
    ? name
    : "dashboard";
}

function monthName() {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(new Date());
}
function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
function badge(promo) {
  const status = effectiveStatus(promo);
  return `<span class="pl-badge pl-badge--${status}">${statusLabel(status)}</span>`;
}

function heading(title, eyebrow, description = "", buttons = "") {
  return `<header class="pl-head"><div class="pl-head-copy"><span class="pl-date-line">${h(eyebrow)}</span><h1 class="pl-h1">${h(title)}</h1>${description ? `<p class="pl-subhead">${h(description)}</p>` : ""}</div>${buttons ? `<div class="pl-head-actions">${buttons}</div>` : ""}</header>`;
}

function addButton() {
  return '<button class="pl-btn pl-btn--primary" type="button" data-action="add">Add promo</button>';
}
function exportButton() {
  return '<button class="pl-btn pl-btn--secondary" type="button" data-action="export-csv">Export CSV</button>';
}

function statCards() {
  const sum = totals(state.promos);
  return `<section class="pl-stats" aria-label="Your money at a glance">
    <article class="pl-card pl-stat pl-stat--paid"><span class="pl-stat-label">Earned this month</span><strong class="pl-stat-value">${h(formatMoney(sum.earned, state.currency))}</strong><p class="pl-stat-meta">${plural(sum.paidCount, "promo")} paid this month</p></article>
    <article class="pl-card pl-stat"><span class="pl-stat-label">Owed to you</span><strong class="pl-stat-value">${h(formatMoney(sum.owed, state.currency))}</strong><p class="pl-stat-meta">${plural(sum.invoicedCount, "invoice")} out, including overdue</p></article>
    <article class="pl-card pl-stat pl-stat--overdue"><span class="pl-stat-label">Overdue</span><strong class="pl-stat-value">${h(formatMoney(sum.overdue, state.currency))}</strong><p class="pl-stat-meta">${sum.overdueCount ? `${plural(sum.overdueCount, "payment")} past due` : "No payments past due"}</p></article>
  </section>`;
}

function promoRow(promo) {
  const status = effectiveStatus(promo);
  return `<tr class="${status === "overdue" ? "pl-is-overdue" : ""}">
    <td><button class="pl-row-button" type="button" data-action="detail" data-id="${h(promo.id)}" aria-label="Open ${h(promo.brand)} promo details"><span class="pl-brand-name">${h(promo.brand)}</span><span class="pl-row-sub">${h(promo.deliverable)}</span></button></td>
    <td class="pl-platform" data-label="Platform">${h(promo.platform || "Not set")}</td>
    <td class="pl-date-cell ${status === "overdue" ? "pl-late" : ""}" data-label="Payment">${h(dateLabel(promo))}</td>
    <td class="pl-amount" data-label="Fee">${h(formatMoney(promo.amountCents, state.currency))}</td>
    <td data-label="Status">${badge(promo)}</td>
  </tr>`;
}

function promoTable(promos) {
  return `<div class="pl-table-wrap"><table class="pl-table"><thead><tr><th scope="col">Brand &amp; deliverable</th><th scope="col">Platform</th><th scope="col">Payment</th><th scope="col" class="pl-amount">Amount</th><th scope="col">Status</th></tr></thead><tbody>${promos.map(promoRow).join("")}</tbody></table></div>`;
}

function emptyState(title, message, action = "") {
  return `<div class="pl-empty"><h2>${h(title)}</h2><p>${h(message)}</p>${action}</div>`;
}

function sortPromos(promos) {
  const list = [...promos];
  switch (state.sort) {
    case "due":
      return list.sort(
        (a, b) =>
          (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
    case "amount":
      return list.sort(
        (a, b) =>
          b.amountCents - a.amountCents ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
    case "brand":
      return list.sort(
        (a, b) =>
          a.brand.localeCompare(b.brand) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
    default:
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

function filteredPromos(kind) {
  let promos = state.promos;
  if (kind === "invoices")
    promos = promos.filter((promo) => promo.status !== "draft");
  if (state.brand)
    promos = promos.filter((promo) => promo.brand === state.brand);
  if (state.filter !== "all")
    promos = promos.filter((promo) => effectiveStatus(promo) === state.filter);
  const query = state.query.trim().toLocaleLowerCase();
  if (query)
    promos = promos.filter((promo) =>
      [
        promo.brand,
        promo.deliverable,
        promo.platform,
        promo.invoiceNumber,
        promo.payer,
      ].some((value) => value.toLocaleLowerCase().includes(query)),
    );
  return sortPromos(promos);
}

function ledgerArea(kind) {
  const promos = filteredPromos(kind);
  if (!state.promos.length)
    return emptyState(
      "No promos yet",
      "Add your first deal and we'll keep track of who owes you.",
      addButton(),
    );
  if (!promos.length)
    return emptyState(
      "No matching promos",
      "Try a different search or status.",
      '<button class="pl-btn pl-btn--secondary" type="button" data-action="clear-filters">Clear filters</button>',
    );
  return `<p class="pl-results">Showing ${plural(promos.length, "promo")}</p>${promoTable(promos)}`;
}

function filters(kind) {
  const options =
    kind === "invoices"
      ? [
          ["all", "All"],
          ["invoiced", "Invoiced"],
          ["overdue", "Overdue"],
          ["paid", "Paid"],
        ]
      : [
          ["all", "All"],
          ["draft", "Draft"],
          ["invoiced", "Invoiced"],
          ["overdue", "Overdue"],
          ["paid", "Paid"],
        ];
  return `<div class="pl-filters" role="group" aria-label="Filter by status">${options.map(([key, label]) => `<button class="pl-filter" type="button" data-action="filter" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`).join("")}</div>`;
}

function toolbar(kind) {
  return `<div class="pl-toolbar"><div class="pl-toolbar-group"><label class="pl-field pl-search"><span>Search promos</span><input id="search-promos" type="search" placeholder="Brand, deliverable or invoice" value="${h(state.query)}" autocomplete="off"></label><label class="pl-field"><span>Sort by</span><select id="sort-promos" class="pl-select"><option value="updated" ${state.sort === "updated" ? "selected" : ""}>Recently updated</option><option value="due" ${state.sort === "due" ? "selected" : ""}>Due date</option><option value="amount" ${state.sort === "amount" ? "selected" : ""}>Highest fee</option><option value="brand" ${state.sort === "brand" ? "selected" : ""}>Brand name</option></select></label></div></div><div class="pl-toolbar-actions">${filters(kind)}${state.brand ? `<button class="pl-btn pl-btn--ghost pl-btn--small" type="button" data-action="clear-brand">Clear brand: ${h(state.brand)}</button>` : ""}</div>`;
}

function dashboard() {
  const recent = sortPromos(state.promos).slice(0, 8);
  return `<div class="pl-view">${heading("Your promos, paid.", monthName(), "", state.promos.length ? exportButton() + addButton() : "")}${statCards()}<section class="pl-view" aria-labelledby="recent-heading"><div class="pl-section-head"><h2 class="pl-h2" id="recent-heading">Recent deals</h2>${state.promos.length > 8 ? '<a class="pl-text-btn" href="#promos">See all promos</a>' : `<span class="pl-count">${plural(state.promos.length, "promo")}</span>`}</div>${recent.length ? promoTable(recent) : emptyState("No promos yet", "Add your first deal and we'll keep track of who owes you.", addButton())}</section></div>`;
}

function promosView(kind) {
  const isInvoices = kind === "invoices";
  const title = isInvoices ? "Invoices" : "All promos";
  const description = isInvoices
    ? "See what has been invoiced, what is late, and what has landed."
    : "Every deal in one place, from draft to paid.";
  return `<div class="pl-view">${heading(title, monthName(), description, state.promos.length ? exportButton() + addButton() : "")}${toolbar(kind)}<section class="pl-view" data-ledger-area aria-label="${title}">${ledgerArea(kind)}</section></div>`;
}

function brandsView() {
  if (!state.promos.length)
    return `<div class="pl-view">${heading("Brands", "Who you work with", "See every brand in your ledger.")}${emptyState("No brands yet", "Brands appear here when you add your first promo.", addButton())}</div>`;
  const grouped = new Map();
  for (const promo of state.promos) {
    const key = promo.brand;
    const group = grouped.get(key) || {
      name: key,
      count: 0,
      total: 0,
      owed: 0,
    };
    group.count += 1;
    group.total += promo.amountCents;
    if (promo.status === "invoiced") group.owed += promo.amountCents;
    grouped.set(key, group);
  }
  const cards = [...grouped.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (group) =>
        `<article class="pl-card pl-brand-card"><div class="pl-brand-card-top"><h2 class="pl-brand-card-name">${h(group.name)}</h2><span class="pl-count">${plural(group.count, "promo")}</span></div><div><span class="pl-stat-label">Total deal value</span><div class="pl-num">${h(formatMoney(group.total, state.currency))}</div></div><div class="pl-brand-card-foot"><span>${h(formatMoney(group.owed, state.currency))} owed</span><button class="pl-text-btn" type="button" data-action="brand" data-brand="${h(group.name)}">View promos</button></div></article>`,
    )
    .join("");
  return `<div class="pl-view">${heading("Brands", "Who you work with", `${plural(grouped.size, "brand")} in your ledger.`, addButton())}<div class="pl-brand-grid">${cards}</div></div>`;
}

function settingsView() {
  return `<div class="pl-view">${heading("Settings", "Your ledger", "Keep a copy of your records and choose how this device shows them.")}<div class="pl-settings-grid">
    <section class="pl-card pl-settings-section"><h2>Backup and export</h2><p>Your promos live in this browser. Download a backup before clearing browser data or changing devices.</p><button class="pl-btn pl-btn--secondary" type="button" data-action="export-json">Download backup</button><button class="pl-btn pl-btn--secondary" type="button" data-action="import-json">Import backup</button><p class="pl-note">Import adds records and updates any with matching IDs. It does not delete your other records.</p></section>
    <section class="pl-card pl-settings-section"><h2>Appearance</h2><p>Choose the theme that reads best for you.</p><label class="pl-field"><span>Theme</span><select id="theme-select"><option value="system" ${state.theme === "system" ? "selected" : ""}>Use device setting</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option></select></label></section>
    <section class="pl-card pl-settings-section"><h2>Currency</h2><p>Choose a currency before adding deals. All promos in a ledger use the same currency.</p><label class="pl-field"><span>Ledger currency</span><select id="currency-select" ${state.promos.length ? "disabled" : ""}>${CURRENCIES.map((currency) => `<option value="${currency}" ${currency === state.currency ? "selected" : ""}>${currency}</option>`).join("")}</select></label><p class="pl-note">${state.promos.length ? "Currency is locked while this ledger has records." : "No conversion is applied to existing amounts."}</p></section>
    <section class="pl-card pl-settings-section"><h2>Try sample records</h2><p>Add clearly fictional deals to explore the dashboard. You can edit or delete each one later.</p><button class="pl-btn pl-btn--secondary" type="button" data-action="sample">Add sample records</button><p class="pl-note">This adds five examples to your current ledger.</p></section>
  </div></div>`;
}

function render() {
  const current = view();
  document
    .querySelectorAll("[data-nav]")
    .forEach((link) =>
      link.setAttribute(
        "aria-current",
        link.dataset.nav === current ? "page" : "false",
      ),
    );
  app.innerHTML = {
    dashboard,
    promos: () => promosView("promos"),
    brands: brandsView,
    invoices: () => promosView("invoices"),
    settings: settingsView,
  }[current]();
  document.title = `${current === "dashboard" ? "Dashboard" : current[0].toUpperCase() + current.slice(1)} · Promo Ledger`;
}

function refreshLedgerArea() {
  const area = app.querySelector("[data-ledger-area]");
  if (area) area.innerHTML = ledgerArea(view());
}

function openForm(promo = null) {
  form.reset();
  form.querySelector("#form-error").hidden = true;
  state.editingId = promo?.id || null;
  document.querySelector("#promo-dialog-title").textContent = promo
    ? "Edit promo"
    : "Add promo";
  form.querySelector('[type="submit"]').textContent = promo
    ? "Save changes"
    : "Save promo";
  document.querySelector(".pl-currency-symbol").textContent = currencySymbol(
    state.currency,
  );
  if (promo) {
    for (const key of [
      "brand",
      "deliverable",
      "platform",
      "status",
      "dueDate",
      "invoiceDate",
      "paidDate",
      "invoiceNumber",
      "payer",
      "contact",
      "method",
      "notes",
    ])
      form.elements[key].value = promo[key] || "";
    form.elements.amount.value = (promo.amountCents / 100).toFixed(2);
  }
  formDialog.showModal();
  form.elements.brand.focus();
}

function showFormError(message, field) {
  const error = document.querySelector("#form-error");
  error.textContent = message;
  error.hidden = false;
  field?.focus();
}

async function saveFromForm(event) {
  event.preventDefault();
  const fields = form.elements;
  const brand = fields.brand.value.trim();
  const deliverable = fields.deliverable.value.trim();
  const amountCents = parseAmountCents(fields.amount.value);
  if (!brand) return showFormError("Add the brand name.", fields.brand);
  if (!deliverable)
    return showFormError(
      "Describe what you are delivering.",
      fields.deliverable,
    );
  if (amountCents === null)
    return showFormError(
      "Enter a fee greater than zero with no more than two decimal places.",
      fields.amount,
    );
  if (fields.status.value === "invoiced" && !fields.dueDate.value)
    return showFormError(
      "Set a payment due date for an invoiced promo.",
      fields.dueDate,
    );
  const old = state.promos.find((promo) => promo.id === state.editingId);
  const now = new Date().toISOString();
  const promo = normalizePromo({
    id: old?.id || crypto.randomUUID(),
    createdAt: old?.createdAt || now,
    updatedAt: now,
    brand,
    deliverable,
    platform: fields.platform.value,
    amountCents,
    status: fields.status.value,
    dueDate: fields.dueDate.value,
    invoiceDate:
      fields.status.value === "draft" ? "" : fields.invoiceDate.value,
    paidDate:
      fields.status.value === "paid"
        ? fields.paidDate.value || old?.paidDate || localISO()
        : "",
    invoiceNumber: fields.invoiceNumber.value,
    payer: fields.payer.value,
    contact: fields.contact.value,
    method: fields.method.value,
    notes: fields.notes.value,
  });
  try {
    await savePromo(promo);
    await reload();
    formDialog.close();
    notify(old ? "Promo updated." : "Promo added.");
  } catch (error) {
    showFormError(error.message || "Could not save this promo.");
  }
}

function detailMarkup(promo) {
  const status = effectiveStatus(promo);
  const timeline = [
    {
      date: promo.createdAt.slice(0, 10),
      label: `Added to ledger ${humanDate(promo.createdAt.slice(0, 10), true)}`,
      className: "",
    },
  ];
  if (promo.invoiceDate)
    timeline.push({
      date: promo.invoiceDate,
      label: `Invoice sent ${humanDate(promo.invoiceDate, true)}`,
      className: "pl-is-invoiced",
    });
  if (promo.paidDate && promo.status === "paid")
    timeline.push({
      date: promo.paidDate,
      label: `Paid ${humanDate(promo.paidDate, true)}`,
      className: "pl-is-paid",
    });
  timeline.sort((a, b) => a.date.localeCompare(b.date));
  const item = (label, value, mono = false) =>
    value
      ? `<dt>${label}</dt><dd${mono ? ' class="pl-num"' : ""}>${h(value)}</dd>`
      : "";
  return `<header class="pl-dialog-header"><div><p class="pl-overline">Promo record</p><h2 id="detail-title">${h(promo.brand)}</h2><p class="pl-muted" style="margin:4px 0 0">${h(promo.deliverable)}</p></div><button class="pl-close" type="button" data-close="detail-dialog" aria-label="Close details">Close</button></header>
    <div class="pl-detail-body"><div class="pl-detail-title-line">${badge(promo)}<strong class="pl-num">${h(formatMoney(promo.amountCents, state.currency))}</strong></div>
    <section class="pl-detail-group"><h3>Payment details</h3><dl class="pl-dl">${item("Platform", promo.platform)}${item("Payment due", promo.dueDate ? humanDate(promo.dueDate, true) : "")}${item("Paid on", promo.status === "paid" && promo.paidDate ? humanDate(promo.paidDate, true) : "")}${item("Invoice sent", promo.invoiceDate ? humanDate(promo.invoiceDate, true) : "")}${item("Invoice number", promo.invoiceNumber)}${item("Paid by", promo.payer)}${item("Contact", promo.contact)}${item("Method", promo.method)}</dl></section>
    ${promo.notes ? `<section class="pl-detail-group"><h3>Notes</h3><p class="pl-notes">${h(promo.notes)}</p></section>` : ""}
    <section class="pl-detail-group"><h3>History</h3><ul class="pl-timeline">${timeline.map((entry) => `<li class="${entry.className}">${h(entry.label)}</li>`).join("")}</ul></section></div>
    <footer class="pl-detail-footer">${promo.status === "invoiced" ? `<button class="pl-btn pl-btn--primary pl-btn--small" type="button" data-action="mark-paid" data-id="${h(promo.id)}">Mark as paid</button>` : ""}<button class="pl-btn pl-btn--secondary pl-btn--small" type="button" data-action="edit" data-id="${h(promo.id)}">Edit</button><button class="pl-text-btn pl-text-btn--danger" type="button" data-action="delete" data-id="${h(promo.id)}">Delete</button></footer>`;
}

function openDetail(id) {
  const promo = state.promos.find((item) => item.id === id);
  if (!promo) return;
  state.detailId = id;
  document.querySelector("#detail-content").innerHTML = detailMarkup(promo);
  detailDialog.showModal();
  detailDialog.querySelector(".pl-close").focus();
}

async function reload() {
  state.promos = await listPromos();
  render();
  if (detailDialog.open && state.detailId) {
    const promo = state.promos.find((item) => item.id === state.detailId);
    if (promo)
      document.querySelector("#detail-content").innerHTML = detailMarkup(promo);
    else detailDialog.close();
  }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function samplePromos() {
  const today = localISO();
  const now = new Date().toISOString();
  const examples = [
    [
      "Halcyon Tea",
      "2 TikToks",
      "TikTok",
      125000,
      "invoiced",
      -9,
      -39,
      "0142",
      "Halcyon Tea Co. via Lumen Agency",
    ],
    [
      "Fernway Skincare",
      "Reel + 3 stories",
      "Instagram Reel",
      240000,
      "invoiced",
      10,
      -20,
      "0143",
      "Fernway Skincare",
    ],
    [
      "Brightfold Apparel",
      "Story set + link",
      "Instagram Stories",
      90000,
      "draft",
      0,
      0,
      "",
      "",
    ],
    [
      "Kestrel Audio",
      "60s integration",
      "YouTube integration",
      480000,
      "paid",
      -2,
      -30,
      "0138",
      "Kestrel Audio",
    ],
    [
      "Orbit Meal Kits",
      "Dedicated video",
      "YouTube video",
      313000,
      "paid",
      -12,
      -42,
      "0137",
      "Orbit Meal Kits",
    ],
  ];
  return examples.map(
    ([
      brand,
      deliverable,
      platform,
      amountCents,
      status,
      dueOffset,
      invoiceOffset,
      invoiceNumber,
      payer,
    ]) => ({
      id: `sample-${brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      brand,
      deliverable,
      platform,
      amountCents,
      status,
      dueDate: status === "draft" ? "" : addDays(today, dueOffset),
      invoiceDate: status === "draft" ? "" : addDays(today, invoiceOffset),
      paidDate: status === "paid" ? addDays(today, dueOffset) : "",
      invoiceNumber,
      payer,
      contact: "",
      method: "",
      notes: "Sample record. Edit or delete when you are ready.",
      createdAt: `${addDays(today, status === "draft" ? -4 : invoiceOffset - 8)}T12:00:00.000Z`,
      updatedAt: now,
    }),
  );
}

document.addEventListener("click", async (event) => {
  const close = event.target.closest("[data-close]");
  if (close) {
    document.getElementById(close.dataset.close).close();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "add") return openForm();
  if (action === "detail") return openDetail(button.dataset.id);
  if (action === "edit") {
    const promo = state.promos.find((item) => item.id === button.dataset.id);
    if (!promo) return;
    detailDialog.close();
    return openForm(promo);
  }
  if (action === "mark-paid") {
    const promo = state.promos.find((item) => item.id === button.dataset.id);
    if (!promo) return;
    try {
      await savePromo({
        ...promo,
        status: "paid",
        paidDate: localISO(),
        updatedAt: new Date().toISOString(),
      });
      await reload();
      notify(`${promo.brand} marked as paid.`);
    } catch (error) {
      notify(error.message || "Could not update this promo.");
    }
    return;
  }
  if (action === "delete") {
    const promo = state.promos.find((item) => item.id === button.dataset.id);
    if (
      !promo ||
      !confirm(`Delete the promo for ${promo.brand}? This cannot be undone.`)
    )
      return;
    try {
      await deletePromo(promo.id);
      state.detailId = null;
      detailDialog.close();
      await reload();
      notify("Promo deleted.");
    } catch (error) {
      notify(error.message || "Could not delete this promo.");
    }
    return;
  }
  if (action === "filter") {
    state.filter = button.dataset.filter;
    render();
    return;
  }
  if (action === "clear-filters") {
    state.filter = "all";
    state.query = "";
    state.brand = "";
    render();
    return;
  }
  if (action === "clear-brand") {
    state.brand = "";
    render();
    return;
  }
  if (action === "brand") {
    state.brand = button.dataset.brand;
    state.filter = "all";
    state.query = "";
    location.hash = "#promos";
    return;
  }
  if (action === "export-csv") {
    const current = view();
    const rows =
      current === "dashboard"
        ? sortPromos(state.promos)
        : filteredPromos(current);
    download(
      `promo-ledger-${localISO()}.csv`,
      toCSV(rows, state.currency),
      "text/csv;charset=utf-8",
    );
    notify("CSV downloaded.");
    return;
  }
  if (action === "export-json") {
    download(
      `promo-ledger-backup-${localISO()}.json`,
      JSON.stringify(
        {
          app: "Promo Ledger",
          version: 1,
          exportedAt: new Date().toISOString(),
          currency: state.currency,
          promos: state.promos,
        },
        null,
        2,
      ),
      "application/json",
    );
    notify("Backup downloaded.");
    return;
  }
  if (action === "import-json") {
    fileInput.click();
    return;
  }
  if (action === "sample") {
    const missing = samplePromos().filter(
      (promo) => !state.promos.some((existing) => existing.id === promo.id),
    );
    if (!missing.length) {
      notify("The sample records are already in this ledger.");
      return;
    }
    try {
      await mergePromos(missing);
      await reload();
      notify(`${plural(missing.length, "sample record")} added.`);
    } catch (error) {
      notify(error.message || "Could not add sample records.");
    }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "search-promos") {
    state.query = event.target.value;
    refreshLedgerArea();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "sort-promos") {
    state.sort = event.target.value;
    refreshLedgerArea();
  }
  if (event.target.id === "theme-select") {
    state.theme = event.target.value;
    localStorage.setItem("pl-theme", state.theme);
    applyTheme();
  }
  if (
    event.target.id === "currency-select" &&
    !state.promos.length &&
    CURRENCIES.includes(event.target.value)
  ) {
    state.currency = event.target.value;
    localStorage.setItem("pl-currency", state.currency);
    notify(`Currency set to ${state.currency}.`);
  }
});

form.addEventListener("submit", saveFromForm);
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  if (file.size > 5_000_000)
    return notify("Choose a backup smaller than 5 MB.");
  try {
    const backup = parseBackup(await file.text());
    if (state.promos.length && backup.currency !== state.currency)
      throw new Error(
        `This backup uses ${backup.currency}, but your ledger uses ${state.currency}.`,
      );
    await mergePromos(backup.promos);
    if (!state.promos.length) {
      state.currency = backup.currency;
      localStorage.setItem("pl-currency", state.currency);
    }
    await reload();
    notify(`Imported ${plural(backup.promos.length, "promo")}.`);
  } catch (error) {
    notify(error.message || "Could not import this backup.");
  }
});

window.addEventListener("hashchange", () => {
  state.filter = "all";
  state.query = "";
  if (view() !== "promos") state.brand = "";
  render();
  app.focus({ preventScroll: true });
});
formDialog.addEventListener("click", (event) => {
  if (event.target === formDialog) formDialog.close();
});
detailDialog.addEventListener("click", (event) => {
  if (event.target === detailDialog) detailDialog.close();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

try {
  await openDatabase();
  await reload();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
} catch (error) {
  app.innerHTML = `<div class="pl-empty"><h1 class="pl-h1">Could not open your ledger</h1><p>${h(error.message || "This browser may be blocking local storage. Open the app in a regular browser window and try again.")}</p></div>`;
}
