import test from "node:test";
import assert from "node:assert/strict";
import {
  csvCell,
  dateLabel,
  effectiveStatus,
  parseAmountCents,
  parseBackup,
  toCSV,
  totals,
} from "../src/ledger.js";

test("overdue is derived from an unpaid invoice and its due date", () => {
  const invoice = {
    status: "invoiced",
    dueDate: "2026-10-01",
    amountCents: 125000,
  };
  assert.equal(effectiveStatus(invoice, "2026-10-04"), "overdue");
  assert.equal(dateLabel(invoice, "2026-10-04"), "3 days late");
  assert.equal(
    effectiveStatus({ ...invoice, status: "paid" }, "2026-10-04"),
    "paid",
  );
  assert.equal(
    effectiveStatus({ ...invoice, dueDate: "2026-10-04" }, "2026-10-04"),
    "invoiced",
  );
});

test("owed includes overdue, while earned counts payments in the current month", () => {
  const records = [
    { status: "invoiced", dueDate: "2026-10-01", amountCents: 125000 },
    { status: "invoiced", dueDate: "2026-10-20", amountCents: 240000 },
    { status: "paid", paidDate: "2026-10-02", amountCents: 480000 },
    { status: "paid", paidDate: "2026-09-25", amountCents: 300000 },
    { status: "draft", amountCents: 90000 },
  ];
  assert.deepEqual(totals(records, "2026-10-04"), {
    earned: 480000,
    owed: 365000,
    overdue: 125000,
    paidCount: 1,
    invoicedCount: 2,
    overdueCount: 1,
  });
});

test("amount entry rejects excess precision and invalid values", () => {
  assert.equal(parseAmountCents("1200.50"), 120050);
  assert.equal(parseAmountCents("0.01"), 1);
  assert.equal(parseAmountCents("1.234"), null);
  assert.equal(parseAmountCents("-1"), null);
  assert.equal(parseAmountCents("0"), null);
});

test("CSV quotes text and uses ISO dates", () => {
  const csv = toCSV(
    [
      {
        brand: "A, B",
        deliverable: 'A "reel"',
        platform: "",
        amountCents: 10050,
        status: "paid",
        dueDate: "2026-10-01",
        invoiceDate: "",
        paidDate: "2026-10-02",
        invoiceNumber: "",
        payer: "",
        contact: "",
        method: "",
        notes: "line\none",
      },
    ],
    "USD",
    "2026-10-04",
  );
  assert.match(csv, /"A, B","A ""reel"""/);
  assert.match(csv, /100\.50,USD,Paid,2026-10-01/);
  assert.match(csv, /"line\none"/);
});

test("CSV treats formula-looking user text as text", () => {
  assert.equal(
    csvCell('=HYPERLINK("https://example.com")'),
    '"\'=HYPERLINK(""https://example.com"")"',
  );
  assert.equal(csvCell(" @SUM(A1:A2)"), "' @SUM(A1:A2)");
});

test("backup validation catches malformed records before import", () => {
  assert.throws(() => parseBackup("{oops"), /valid JSON/);
  assert.throws(
    () =>
      parseBackup(
        JSON.stringify({
          app: "Promo Ledger",
          version: 1,
          promos: [
            {
              id: "1",
              brand: "Brand",
              deliverable: "Post",
              amountCents: 100,
              status: "invoiced",
              dueDate: "",
            },
          ],
        }),
      ),
    /due date/,
  );
});
