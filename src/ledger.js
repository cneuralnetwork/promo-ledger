export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

export function localISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateFromISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
    ? date
    : null;
}

export function dayDifference(fromISO, toISO) {
  const a = dateFromISO(fromISO);
  const b = dateFromISO(toISO);
  if (!a || !b) return 0;
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86400000,
  );
}

export function effectiveStatus(promo, today = localISO()) {
  if (promo.status === "paid") return "paid";
  if (
    promo.status === "invoiced" &&
    promo.dueDate &&
    dayDifference(promo.dueDate, today) > 0
  )
    return "overdue";
  return promo.status === "invoiced" ? "invoiced" : "draft";
}

export function statusLabel(status) {
  return (
    { draft: "Draft", invoiced: "Invoiced", paid: "Paid", overdue: "Overdue" }[
      status
    ] || "Draft"
  );
}

export function parseAmountCents(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:\d{1,9})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fractional = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatMoney(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function currencySymbol(currency = "USD") {
  return (
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(1)
      .find((part) => part.type === "currency")?.value || currency
  );
}

export function humanDate(value, includeYear = false) {
  const date = dateFromISO(value);
  if (!date) return "No date";
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][date.getMonth()];
  return `${date.getDate()} ${month}${includeYear ? ` ${date.getFullYear()}` : ""}`;
}

export function dateLabel(promo, today = localISO()) {
  if (promo.status === "paid")
    return promo.paidDate
      ? `Paid ${humanDate(promo.paidDate, promo.paidDate.slice(0, 4) !== today.slice(0, 4))}`
      : "Paid";
  if (promo.status === "draft") return "Not invoiced";
  if (!promo.dueDate) return "No due date";
  const late = dayDifference(promo.dueDate, today);
  return late > 0
    ? `${late} ${late === 1 ? "day" : "days"} late`
    : `Due ${humanDate(promo.dueDate, promo.dueDate.slice(0, 4) !== today.slice(0, 4))}`;
}

export function totals(promos, today = localISO()) {
  const month = today.slice(0, 7);
  return promos.reduce(
    (sum, promo) => {
      if (promo.status === "paid" && promo.paidDate?.startsWith(month)) {
        sum.earned += promo.amountCents;
        sum.paidCount += 1;
      }
      if (promo.status === "invoiced") {
        sum.owed += promo.amountCents;
        sum.invoicedCount += 1;
        if (effectiveStatus(promo, today) === "overdue") {
          sum.overdue += promo.amountCents;
          sum.overdueCount += 1;
        }
      }
      return sum;
    },
    {
      earned: 0,
      owed: 0,
      overdue: 0,
      paidCount: 0,
      invoicedCount: 0,
      overdueCount: 0,
    },
  );
}

export function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

export function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(promos, currency = "USD", today = localISO()) {
  const headers = [
    "Brand",
    "Deliverable",
    "Platform",
    "Fee",
    "Currency",
    "Status",
    "Due date",
    "Invoice date",
    "Paid date",
    "Invoice number",
    "Paid by",
    "Contact",
    "Payment method",
    "Notes",
  ];
  const rows = promos.map((promo) => [
    promo.brand,
    promo.deliverable,
    promo.platform,
    (promo.amountCents / 100).toFixed(2),
    currency,
    statusLabel(effectiveStatus(promo, today)),
    promo.dueDate,
    promo.invoiceDate,
    promo.paidDate,
    promo.invoiceNumber,
    promo.payer,
    promo.contact,
    promo.method,
    promo.notes,
  ]);
  return (
    "\ufeff" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

export function normalizePromo(value) {
  if (!value || typeof value !== "object")
    throw new Error("A promo record is missing.");
  const text = (key) =>
    typeof value[key] === "string" ? value[key].trim() : "";
  const date = (key) => {
    const item = text(key);
    if (item && !dateFromISO(item))
      throw new Error(`Invalid ${key} in a promo record.`);
    return item;
  };
  const status = text("status");
  if (!["draft", "invoiced", "paid"].includes(status))
    throw new Error("A promo has an unknown status.");
  if (!text("brand") || !text("deliverable"))
    throw new Error("Every promo needs a brand and deliverable.");
  if (
    !Number.isSafeInteger(value.amountCents) ||
    value.amountCents <= 0 ||
    value.amountCents > 99999999900
  )
    throw new Error("A promo has an invalid fee.");
  if (status === "invoiced" && !date("dueDate"))
    throw new Error("Every invoiced promo needs a payment due date.");
  if (status === "paid" && !date("paidDate"))
    throw new Error("Every paid promo needs a paid date.");
  const id = text("id");
  if (!id || id.length > 100) throw new Error("A promo has an invalid ID.");
  const keys = [
    "brand",
    "deliverable",
    "platform",
    "invoiceNumber",
    "payer",
    "contact",
    "method",
    "notes",
  ];
  const limits = {
    brand: 100,
    deliverable: 140,
    platform: 80,
    invoiceNumber: 80,
    payer: 140,
    contact: 140,
    method: 100,
    notes: 4000,
  };
  for (const key of keys)
    if (text(key).length > limits[key])
      throw new Error(`A promo ${key} is too long.`);
  return {
    id,
    status,
    amountCents: value.amountCents,
    ...Object.fromEntries(keys.map((key) => [key, text(key)])),
    dueDate: date("dueDate"),
    invoiceDate: date("invoiceDate"),
    paidDate: date("paidDate"),
    createdAt: text("createdAt") || new Date().toISOString(),
    updatedAt: text("updatedAt") || new Date().toISOString(),
  };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid JSON backup.");
  }
  if (
    data?.app !== "Promo Ledger" ||
    data?.version !== 1 ||
    !Array.isArray(data.promos)
  )
    throw new Error("This file is not a Promo Ledger backup.");
  if (data.promos.length > 10000)
    throw new Error("This backup has too many records.");
  const promos = data.promos.map(normalizePromo);
  if (new Set(promos.map((promo) => promo.id)).size !== promos.length)
    throw new Error("The backup contains duplicate promo IDs.");
  const currency = CURRENCIES.includes(data.currency) ? data.currency : "USD";
  return { promos, currency };
}

export function addDays(iso, days) {
  const date = dateFromISO(iso);
  date.setDate(date.getDate() + days);
  return localISO(date);
}
