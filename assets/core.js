export const AREA_BANDS = { "59": [58, 60], "74": [73, 75], "84": [83, 85.01] };
export function areaClass(area) {
  return Object.keys(AREA_BANDS).find(key => area >= AREA_BANDS[key][0] && area < AREA_BANDS[key][1]) ?? null;
}
export function shiftMonth(iso, offset) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
export function nextDay(iso) {
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export function koreaToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function validTrades(trades, asOf) {
  const start = nextDay(shiftMonth(asOf, -12));
  return trades.filter(t => !t.canceled && t.date >= start && t.date <= asOf &&
    Number.isFinite(t.priceManwon) && t.priceManwon > 0 &&
    Number.isFinite(t.area) && t.area > 0);
}
export function forArea(trades, id, band, exact = "all") {
  return trades.filter(t => t.complexId === id && areaClass(t.area) === band &&
    (exact === "all" || Math.abs(t.area - Number(exact)) < 0.00005))
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));
}
export function constructionLabel(trades, id, today) {
  const currentYear = Number(today.slice(0, 4));
  // Building age is property metadata: use all areas, independent of price filters.
  const years = [...new Set(trades.filter(t => t.complexId === id && !t.canceled && t.date <= today &&
    Number.isInteger(t.buildYear) && t.buildYear >= 1900 &&
    t.buildYear <= Number(t.date?.slice(0, 4)) && t.buildYear <= currentYear)
    .map(t => t.buildYear))].sort((a, b) => a - b);
  if (!years.length) return "건축연도 확인 필요";
  const oldest = currentYear - years[0], newest = currentYear - years.at(-1);
  return years.join("·") + "년 건축 · " + (oldest === newest ? oldest : newest + "–" + oldest) + "년 경과";
}
export function summary(trades, asOf) {
  trades = validTrades(trades, asOf).sort((a, b) =>
    b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));
  const recent = n => trades.filter(t => t.date >= nextDay(shiftMonth(asOf, -n)) && t.date <= asOf);
  const three = recent(3), six = recent(6), ten = trades.slice(0, 10);
  return {
    latest: trades[0] ?? null,
    average10: ten.length ? ten.reduce((sum, t) => sum + t.priceManwon, 0) / ten.length : null,
    count10: ten.length, start10: ten.at(-1)?.date ?? null, end10: ten[0]?.date ?? null,
    median3: median(three.map(t => t.priceManwon)),
    median6: median(six.map(t => t.priceManwon)),
    count3: three.length, count6: six.length, count: trades.length,
    areas: [...new Set(trades.map(t => t.area))].sort((a, b) => a - b),
    sameDateCount: trades.length ? trades.filter(t => t.date === trades[0].date).length : 0
  };
}
export function priceFor(summaryValue, metric) {
  return metric === "latest" ? summaryValue.latest?.priceManwon ?? null : summaryValue[metric];
}
export function referencePrice(summaryValue, metric) {
  return priceFor(summaryValue, metric === "average10" ? "average10" : "latest");
}
export function comparison(price, base) {
  return price == null || base == null || base <= 0 ? { gap: null, ratio: null } :
    { gap: (price - base) / 10000, ratio: price / base };
}
export function monthSeries(trades, baseTrades, asOf) {
  trades = validTrades(trades, asOf);
  baseTrades = validTrades(baseTrades, asOf);
  const first = nextDay(shiftMonth(asOf, -12)).slice(0, 7) + "-01";
  const [startYear, startMonth] = first.split("-").map(Number);
  const [endYear, endMonth] = asOf.split("-").map(Number);
  const length = (endYear - startYear) * 12 + endMonth - startMonth + 1;
  const months = Array.from({ length }, (_, i) => shiftMonth(first, i).slice(0, 7));
  return months.map(month => {
    const target = trades.filter(t => t.date.startsWith(month));
    const base = baseTrades.filter(t => t.date.startsWith(month));
    const price = median(target.map(t => t.priceManwon));
    const basePrice = median(base.map(t => t.priceManwon));
    return {
      month, price: price == null ? null : price / 10000,
      base: basePrice == null ? null : basePrice / 10000,
      gap: price == null || basePrice == null ? null : (price - basePrice) / 10000,
      count: target.length, baseCount: base.length
    };
  });
}
export function monthsUntil(today, targetMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) throw new Error("목표 매수 시점을 확인하세요.");
  const [year, month] = today.split("-").map(Number);
  const [targetYear, targetM] = targetMonth.split("-").map(Number);
  const count = (targetYear - year) * 12 + targetM - month;
  if (count < 0) throw new Error("목표 시점은 이번 달 이후로 입력하세요.");
  return count;
}
export function calculate(input, today) {
  const required = ["sale", "mortgage", "family", "assets", "monthly", "bonus", "newLoan", "tax", "fees", "targetPrice"];
  for (const key of required) {
    if (!Number.isFinite(input[key]) || input[key] < 0) throw new Error("금액은 0 이상의 숫자로 입력하세요.");
  }
  const months = monthsUntil(today, input.targetMonth);
  const bonusCount = Math.floor(months / 12);
  const savings = (input.monthly * months + input.bonus * bonusCount) / 10000;
  const netSale = input.sale - input.mortgage - input.family;
  const equity = netSale + input.assets + savings;
  const available = equity + input.newLoan;
  const totalCost = input.targetPrice + input.tax + input.fees;
  return { months, bonusCount, savings, netSale, equity, available, totalCost,
    shortage: Math.max(0, totalCost - available), surplus: Math.max(0, available - totalCost) };
}

