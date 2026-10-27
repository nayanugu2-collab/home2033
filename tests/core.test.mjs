import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { areaClass, calculate, comparison, forArea, median, monthSeries, monthsUntil, nextDay, priceFor, referencePrice, shiftMonth, summary, validTrades } from "../assets/core.js";

const today = "2026-10-26";
function trade(overrides = {}) {
  return { id: "test", complexId: "base", area: 59.87, priceManwon: 112000, date: "2026-10-05", canceled: false, ...overrides };
}
test("even/odd medians and no fabricated zero for missing data", () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([20, 10]), 15);
  assert.equal(median([]), null);
});
test("calendar windows, leap year, year boundary", () => {
  assert.equal(shiftMonth("2024-03-31", -1), "2024-02-29");
  assert.equal(shiftMonth("2026-01-31", -1), "2025-12-31");
  assert.equal(nextDay("2024-02-29"), "2024-03-01");
});
test("rolling year excludes old, future and canceled records", () => {
  const input = [trade({ date: "2025-10-26" }), trade({ date: "2025-10-27" }),
    trade({ date: "2026-10-27" }), trade({ canceled: true }), trade({ priceManwon: NaN })];
  assert.deepEqual(validTrades(input, today).map(t => t.date), ["2025-10-27"]);
});
test("59, 74 and 84 filters cannot absorb neighboring area types", () => {
  assert.equal(areaClass(59.97), "59");
  assert.equal(areaClass(74.99), "74");
  assert.equal(areaClass(84.99), "84");
  assert.equal(areaClass(77.8), null);
  assert.equal(areaClass(81.9), null);
  assert.equal(areaClass(60), null);
});
test("exact exclusive area matching and apartment identity", () => {
  const input = [trade(), trade({ area: 59.97 }), trade({ complexId: "other" }), trade({ area: 84.9 })];
  assert.equal(forArea(input, "base", "59").length, 2);
  assert.equal(forArea(input, "base", "59", "59.87").length, 1);
});
test("3 and 6 month medians are calendar windows, not latest 3 records", () => {
  const input = [
    trade({ date: "2026-10-05", priceManwon: 200000 }),
    trade({ date: "2026-07-27", priceManwon: 100000 }),
    trade({ date: "2026-07-26", priceManwon: 900000 }),
    trade({ date: "2026-04-27", priceManwon: 300000 }),
    trade({ date: "2026-04-26", priceManwon: 800000 })
  ];
  const s = summary(input, today);
  assert.equal(s.median3, 150000);
  assert.equal(s.count3, 2);
  assert.equal(s.count6, 4);
  assert.equal(s.median6, 250000);
  assert.equal(priceFor(s, "latest"), 200000);
});
test("gap and ratio use latest actual baseline, never purchase price", () => {
  assert.deepEqual(comparison(180000, 120000), { gap: 6, ratio: 1.5 });
  assert.equal(comparison(180000, null).gap, null);
  assert.equal(comparison(180000, 0).ratio, null);
  assert.equal(comparison(null, 120000).gap, null);
});
test("recent ten mean selects latest contracts from unsorted input, not all trades or a median", () => {
  const rows = Array.from({ length: 12 }, (_, i) => trade({ id: String(i),
    date: "2026-10-" + String(i + 1).padStart(2, "0"), priceManwon: i < 2 ? 999999 : i === 11 ? 211000 : 100000 + i * 1000 }));
  const s = summary(rows, today);
  assert.equal(priceFor(s, "average10"), 116500);
  assert.equal(s.count10, 10);
  assert.equal(s.start10, "2026-10-03");
  assert.equal(s.end10, "2026-10-12");
  assert.equal(rows[0].id, "0");
});
test("recent ten mean uses available contracts and preserves fractional manwon; empty is not zero", () => {
  const s = summary([trade({ priceManwon: 100000 }), trade({ priceManwon: 200001 })], today);
  assert.equal(s.average10, 150000.5);
  assert.equal(s.count10, 2);
  const empty = summary([], today);
  assert.equal(empty.average10, null);
  assert.equal(empty.count10, 0);
  assert.equal(empty.start10, null);
  assert.equal(empty.end10, null);
});
test("recent ten mean excludes canceled, outside-year, future and invalid prices before taking ten", () => {
  const s = summary([trade({ date: "2025-10-26", priceManwon: 999999 }),
    trade({ date: "2026-10-27", priceManwon: 999999 }), trade({ canceled: true, priceManwon: 999999 }),
    trade({ priceManwon: NaN }), trade({ priceManwon: 0 }),
    trade({ date: "2025-10-27", priceManwon: 100000 }), trade({ priceManwon: 140000 })], today);
  assert.equal(s.count10, 2);
  assert.equal(s.average10, 120000);
});
test("same-date tenth boundary is selected by stable ID order", () => {
  const rows = Array.from({ length: 11 }, (_, i) => trade({ id: String(i).padStart(2, "0"),
    priceManwon: i === 10 ? 999999 : 100000 + i })).reverse();
  assert.equal(summary(rows, today).average10, 100004.5);
});
test("mean respects complex, area band and exact area selection", () => {
  const rows = [trade({ priceManwon: 100000 }), trade({ priceManwon: 140000 }),
    trade({ area: 59.97, priceManwon: 180000 }), trade({ area: 84.9, priceManwon: 999999 }),
    trade({ complexId: "other", priceManwon: 999999 })];
  assert.equal(summary(forArea(rows, "base", "59"), today).average10, 140000);
  assert.equal(summary(forArea(rows, "base", "59", "59.87"), today).average10, 120000);
});
test("mean comparison uses means for both homes; other price options retain latest baseline", () => {
  const base = summary([trade({ priceManwon: 150000 }), trade({ date: "2026-09-01", priceManwon: 90000 })], today);
  const target = summary([trade({ priceManwon: 170000 }), trade({ date: "2026-09-01", priceManwon: 190000 })], today);
  assert.deepEqual(comparison(priceFor(target, "average10"), referencePrice(base, "average10")), { gap: 6, ratio: 1.5 });
  assert.equal(referencePrice(base, "latest"), 150000);
  assert.equal(referencePrice(base, "median3"), 150000);
  assert.equal(referencePrice(base, "median6"), 150000);
  assert.equal(referencePrice(summary([], today), "average10"), null);
});
test("negative gap is preserved", () => {
  assert.equal(comparison(100000, 120000).gap, -2);
});
test("monthly gap uses same month medians and keeps holes", () => {
  const targets = [trade({ complexId: "other", date: "2026-10-01", priceManwon: 180000 }),
    trade({ complexId: "other", date: "2026-10-20", priceManwon: 200000 }),
    trade({ complexId: "other", date: "2026-08-01", priceManwon: 170000 })];
  const base = [trade({ date: "2026-10-05", priceManwon: 120000 })];
  const series = monthSeries(targets, base, today);
  assert.equal(series.length, 13);
  assert.equal(series.at(-1).gap, 7);
  assert.equal(series.find(p => p.month === "2026-08").gap, null);
  assert.equal(series.find(p => p.month === "2026-09").price, null);
});
test("latest date ties are deterministic and disclosed", () => {
  const input = forArea([trade({ id: "z" }), trade({ id: "a", priceManwon: 130000 })], "base", "59");
  const s = summary(input, today);
  assert.equal(s.latest.id, "a");
  assert.equal(s.sameDateCount, 2);
});
test("month-end rolling year has 12 calendar months without an extra empty month", () => {
  const series = monthSeries([], [], "2026-10-31");
  assert.equal(series.length, 12);
  assert.equal(series[0].month, "2025-11");
});
const plan = {
  sale: 12, mortgage: 6, family: 2, assets: 1.7, monthly: 300, bonus: 2000,
  targetMonth: "2033-12", newLoan: 6, tax: 0.7, fees: 0.1, targetPrice: 22
};
test("2033 plan converts manwon, includes debt, savings, bonuses, loan and costs", () => {
  const r = calculate(plan, today);
  assert.equal(r.months, 86);
  assert.equal(r.bonusCount, 7);
  assert.ok(Math.abs(r.savings - 3.98) < 1e-9);
  assert.equal(r.netSale, 4);
  assert.ok(Math.abs(r.available - 15.68) < 1e-9);
  assert.ok(Math.abs(r.shortage - 7.12) < 1e-9);
});
test("no double count when buying in the current month", () => {
  const r = calculate({ ...plan, targetMonth: "2026-10" }, today);
  assert.equal(r.months, 0); assert.equal(r.savings, 0);
});
test("surplus and negative sale equity handled without clamping debts", () => {
  assert.ok(calculate({ ...plan, targetPrice: 1 }, today).surplus > 0);
  assert.equal(calculate({ ...plan, sale: 1 }, today).netSale, -7);
});
test("invalid, negative and missing financial inputs rejected", () => {
  assert.throws(() => calculate({ ...plan, monthly: -1 }, today));
  assert.throws(() => calculate({ ...plan, sale: NaN }, today));
  assert.throws(() => monthsUntil(today, "2026-09"));
  assert.throws(() => monthsUntil(today, "2033-13"));
});
test("sample data is separate from official prices and every identity exists", async () => {
  const registry = JSON.parse(await readFile(new URL("../data/complexes.json", import.meta.url)));
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url)));
  const official = JSON.parse(await readFile(new URL("../data/trades.json", import.meta.url)));
  assert.equal(sample.mode, "sample");
  assert.equal(official.mode, "official");
  assert.ok(sample.trades.length > 100);
  assert.ok(sample.trades.every(t => registry.complexes.some(c => c.id === t.complexId && c.legalDongCode === t.legalDongCode)));
});

