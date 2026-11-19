export const AREA_BANDS = { "59": [58, 60], "74": [73, 75], "84": [83, 85.01] };
export function matchesComplex(c, query) {
  const normalize = value => String(value).replace(/\s+/g, "").toLowerCase();
  const text = normalize([c.name, c.region, c.legalDong, ...(c.jibuns || []), ...(c.aliases || [])].join(" "));
  return text.includes(normalize(query)) || query.trim().split(/\s+/).every(part => text.includes(normalize(part)));
}
export function passesRatio(ratio, minimum) {
  return ratio == null || (Number.isFinite(ratio) && ratio >= minimum);
}
export function watchPreferences(value) {
  return { removed: Array.isArray(value?.removed) ? value.removed.filter(x => typeof x === "string") : [],
    added: Array.isArray(value?.added) ? value.added.filter(x => typeof x === "string" && x.startsWith("n-")) : [],
    minimum: value?.minimum === 0 ? 0 : 1.5 };
}
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
export function trackerPreferences(value) {
  return { mode: value?.mode === "personal" ? "personal" : "standard",
    id: typeof value?.id === "string" && /^[a-z0-9-]+$/.test(value.id) ? value.id : "base",
    area: typeof value?.area === "string" && /^(band(59|74|84)|\d+(\.\d+)?)$/.test(value.area) ? value.area : "band59",
    cash: Number.isFinite(value?.cash) && value.cash >= 0 ? value.cash : 0 };
}
export function referenceTrades(trades, id, type) {
  if (/^band(59|74|84)$/.test(type)) return forArea(trades, id, type.slice(4));
  const exact = Number(type);
  return Number.isFinite(exact) && exact > 0 ? trades.filter(t => t.complexId === id && Math.abs(t.area - exact) < 0.00005) : [];
}
export function assetComparison(price, house, cash) {
  if (![price, house, cash].every(Number.isFinite) || price <= 0 || house <= 0 || cash < 0)
    return { available: null, gap: null };
  const available = house / 10000 + cash;
  return { available, gap: price / 10000 - available };
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
// District shards already match MOLIT name + address in the collector. Keep their
// verified apartment IDs and legal-dong codes together when aggregating a dong.
export function checkNeighborhoodPayload(value, districtCode) {
  if (value?.schemaVersion !== 2 || value.mode !== "official" || value.districtCode !== districtCode ||
      !Array.isArray(value.complexes) || !Array.isArray(value.trades)) throw new Error("동네 자료 형식 오류");
  const known = new Map();
  for (const c of value.complexes) {
    if (known.has(c.id) || c.districtCode !== districtCode || !/^\d{10}$/.test(c.legalDongCode) ||
        !c.legalDongCode.startsWith(districtCode) || !c.legalDong || !Array.isArray(c.jibuns) || !c.jibuns.length)
      throw new Error("동네 단지 신원 오류");
    known.set(c.id, c);
  }
  for (const t of value.trades) {
    const c = known.get(t.complexId);
    if (!c || t.legalDongCode !== c.legalDongCode || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
        !Number.isFinite(t.area) || t.area <= 0 || !Number.isInteger(t.priceManwon) || t.priceManwon <= 0)
      throw new Error("동네 거래 신원 오류");
  }
  return value;
}
export function neighborhoodSeries(trades, complexes, dongCode, band, asOf, period = 12) {
  const length = [6, 12, 24, 36, 60, 120].includes(period) ? period : 12;
  const first = shiftMonth(asOf.slice(0, 7) + "-01", 1 - length);
  const known = new Map(complexes.filter(c => (dongCode === "all" || c.legalDongCode === dongCode) && c.comparisonEligible !== false).map(c => [c.id, c]));
  const rows = trades.filter(t => !t.canceled && known.get(t.complexId)?.legalDongCode === t.legalDongCode &&
    (band === "all" || areaClass(t.area) === band) && t.date >= first && t.date <= asOf &&
    Number.isFinite(t.priceManwon) && t.priceManwon > 0 && Number.isFinite(t.area) && t.area > 0);
  return Array.from({ length }, (_, i) => {
    const month = shiftMonth(first, i).slice(0, 7);
    const monthly = rows.filter(t => t.date.startsWith(month));
    const value = median(monthly.map(t => t.priceManwon));
    return { month, price: value == null ? null : value / 10000, count: monthly.length,
      complexCount: new Set(monthly.map(t => t.complexId)).size,
      partial: month === asOf.slice(0, 7) };
  });
}
export function checkTrendPayload(value, code) {
  if (value?.schemaVersion !== 1 || value.kind !== "regional-monthly-median" || value.districtCode !== code || !Array.isArray(value.months)) throw new Error("추세 자료 형식 오류");
  const seen = new Set();
  for (const m of value.months) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month) || seen.has(m.month) || !Number.isFinite(Date.parse(m.updatedAt)) || !Array.isArray(m.rows)) throw new Error("추세 계약월 오류");
    seen.add(m.month);
    const rows = new Set();
    for (const r of m.rows) {
      const key = r.dongCode + "|" + r.area;
      if (rows.has(key) || (r.dongCode !== "all" && (!/^\d{10}$/.test(r.dongCode) || !r.dongCode.startsWith(code))) ||
          !["all", "59", "74", "84"].includes(r.area) || !Number.isFinite(r.priceManwon) || r.priceManwon <= 0 ||
          !Number.isInteger(r.count) || r.count < 1 || !Number.isInteger(r.complexCount) || r.complexCount < 1 || r.complexCount > r.count || typeof r.dongName !== "string") throw new Error("추세 통계 오류");
      rows.add(key);
    }
  }
  return value;
}
export function regionalSeries(value, dong, area, asOf, period = 12) {
  const length = [6, 12, 24, 36, 60, 120].includes(period) ? period : 12;
  const first = shiftMonth(asOf.slice(0, 7) + "-01", 1 - length);
  const months = new Map(value.months.map(m => [m.month, m]));
  return Array.from({ length }, (_, i) => {
    const month = shiftMonth(first, i).slice(0, 7), m = months.get(month);
    const row = m?.rows.find(r => r.dongCode === dong && r.area === area);
    return { month, price: row ? row.priceManwon / 10000 : null,
      count: row?.count ?? (m ? 0 : null), complexCount: row?.complexCount ?? (m ? 0 : null),
      available: !!m, updatedAt: m?.updatedAt ?? null, partial: month === asOf.slice(0, 7) };
  });
}
export function rawRegionalPayload(value, code) {
  const day = value.asOf, start = nextDay(shiftMonth(day, -12)), cutoff = start.slice(0, 7);
  const fullMonth = month => month > cutoff || (month === cutoff && start.endsWith("-01"));
  const known = new Map(value.complexes.filter(c => c.districtCode === code && c.comparisonEligible !== false).map(c => [c.id, c]));
  const input = value.trades.filter(t => known.get(t.complexId)?.legalDongCode === t.legalDongCode && !t.canceled && fullMonth(t.date.slice(0,7)) && t.date <= day && Number.isFinite(t.priceManwon) && t.priceManwon > 0 && Number.isFinite(t.area) && t.area > 0);
  const names = new Map();
  for (const t of input) {
    const key = t.date.slice(0,7)+"|"+t.legalDongCode;
    if (!names.has(key)) names.set(key,new Set());
    names.get(key).add(known.get(t.complexId).legalDong);
  }
  const conflicts = new Set([...names].filter(([,v])=>v.size>1).map(([key])=>key));
  const groups = new Map();
  for (const t of input) {
    const c = known.get(t.complexId), month = t.date.slice(0, 7);
    if (conflicts.has(month+"|"+t.legalDongCode)) continue;
    const band = areaClass(t.area);
    for (const [dongCode, dongName] of [["all", "전체"], [c.legalDongCode, c.legalDong]]) for (const area of ["all", ...(band ? [band] : [])]) {
      const key = month + "|" + dongCode + "|" + area;
      if (!groups.has(key)) groups.set(key, {month,dongCode,dongName,area,prices:[],ids:new Set()});
      const group = groups.get(key); group.prices.push(t.priceManwon); group.ids.add(c.id);
    }
  }
  const rows = new Map();
  for (const g of groups.values()) {
    if (!rows.has(g.month)) rows.set(g.month, []);
    rows.get(g.month).push({dongCode:g.dongCode,dongName:g.dongName,area:g.area,priceManwon:median(g.prices),count:g.prices.length,complexCount:g.ids.size});
  }
  const months = neighborhoodSeries([], [], "all", "all", day, 12).filter(p=>fullMonth(p.month)).map(p=>({month:p.month,updatedAt:value.updatedAt || day+"T00:00:00+09:00",rows:rows.get(p.month) || [],excludedIdentityConflicts:input.filter(t=>t.date.startsWith(p.month)&&conflicts.has(p.month+"|"+t.legalDongCode)).length}));
  return {schemaVersion:1,kind:"regional-monthly-median",districtCode:code,months};
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
  const saleTax = input.saleTax ?? 0;
  if (!Number.isFinite(saleTax) || saleTax < 0) throw new Error("양도세는 0 이상의 숫자로 입력하세요.");
  const months = monthsUntil(today, input.targetMonth);
  const bonusCount = Math.floor(months / 12);
  const savings = (input.monthly * months + input.bonus * bonusCount) / 10000;
  const netSale = input.sale - input.mortgage - input.family - saleTax;
  const equity = netSale + input.assets + savings;
  const available = equity + input.newLoan;
  const totalCost = input.targetPrice + input.tax + input.fees;
  return { months, bonusCount, savings, netSale, equity, available, totalCost,
    shortage: Math.max(0, totalCost - available), surplus: Math.max(0, available - totalCost) };
}

