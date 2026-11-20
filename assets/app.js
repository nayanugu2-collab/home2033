import { areaClass, assetComparison, calculate, capitalComparison, comparison, constructionLabel, forArea, koreaToday, matchesComplex, meetsHouseholdMinimum, MIN_HOUSEHOLDS, monthSeries, passesRatio, priceFor, referenceTrades, summary, trackerPreferences, validTrades, watchPreferences } from "./core.js?v=300-households";
import { initNeighborhood } from "./neighborhood.js?v=300-households";
import { initBudget } from "./budget.js?v=naver-land-mobile";

const $ = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
const money = n => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
const dateLabel = iso => iso ? iso.replaceAll("-", ".") : "거래 없음";
const stamp = iso => iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "갱신 전";
const ids = ["sale", "mortgage", "family", "assets", "monthly", "bonus", "targetMonth", "newLoan", "tax", "saleTax", "fees", "targetPrice"];
const controls = [...document.querySelectorAll("button, input, select")];
controls.forEach(control => { control.disabled = true; });
const WATCH_PAGE_SIZE = 8;
let watchPage = 0;
let registry, official = null, status = null, demo = false, payload = null, trades = [], baseTrades = [];
let area = "84", region = "all", selected = "gracium", exact = "all", saleAuto = true, targetAuto = true, loadError = "";
let officialPlanSnapshot = null, neighborhoods = null;
let preferences = watchPreferences(null), defaultIds = new Set(), nationalIndex = null, nationalLoading = null;
let nationalTrades = [], nationalDistricts = new Set(), nationalPending = new Map();
const nationalStamps = new Map();
let tracker = trackerPreferences(null), baseRequest = 0;
let baseSearchMarkup = "";
try { tracker = trackerPreferences(JSON.parse(localStorage.getItem("home2033-tracker-v1"))); } catch {}
function personalMode() { return tracker.mode === "personal"; }
function currentBaseId() { return personalMode() ? tracker.id : null; }
function currentBaseType() { return tracker.area; }
function currentBase() { return registry.complexes.find(c => c.id === currentBaseId() && meetsHouseholdMinimum(c)); }
function baseAreaLabel() { return currentBaseType().startsWith("band") ? currentBaseType().slice(4) + "㎡급" : currentBaseType() + "㎡"; }
function baseLabel() { return currentBase() ? currentBase().name + " · 전용 " + baseAreaLabel() : "기준 아파트 미선택"; }
function trackerStatus(message) { $("trackerState").hidden = !message; $("trackerState").textContent = message; }
function saveTracker() {
  if (demo) { trackerStatus("샘플에서 바꾼 비교 기준은 저장하지 않습니다."); return; }
  try { localStorage.setItem("home2033-tracker-v1", JSON.stringify(tracker)); trackerStatus("비교 기준을 이 브라우저에 저장했습니다."); }
  catch { trackerStatus("저장소 사용 불가 · 이번 화면에만 적용합니다."); }
}
try { preferences = watchPreferences(JSON.parse(localStorage.getItem("home2033-watch-v1"))); } catch {}
function isWatched(c) { return meetsHouseholdMinimum(c) && c.id !== currentBaseId() && !preferences.removed.includes(c.id) && (c.id === registry.baseId || defaultIds.has(c.id) || preferences.added.includes(c.id)); }
function saveWatch() {
  try { localStorage.setItem("home2033-watch-v1", JSON.stringify(preferences)); $("watchStatus").textContent = "관심 목록을 이 브라우저에 저장했습니다."; }
  catch { $("watchStatus").textContent = "저장소를 사용할 수 없어 이번 화면에만 적용합니다."; }
}
const today = koreaToday();
const currentMonth = today.slice(0, 7);
$("todayLabel").textContent = today.replaceAll("-", ". ");
$("targetMonth").min = currentMonth;
try {
  const saved = JSON.parse(localStorage.getItem("home2033-plan-v2") || "null");
  if (saved) {
    for (const id of ids.filter(id => id !== "targetPrice" && id !== "targetMonth")) if (saved.values?.[id] != null) $(id).value = saved.values[id];
    const month = saved.values?.targetMonth;
    // Legacy saves included the prefilled month even when the user never changed it.
    if (typeof month === "string" && month >= currentMonth && (month !== "2033-12" || saved.targetMonthSelected === true)) $("targetMonth").value = month;
    saleAuto = saved.saleAuto !== false;
  }
} catch { $("saveState").textContent = "브라우저 저장소를 사용할 수 없습니다. 현재 입력은 계산에 반영됩니다."; }
function save() {
  if (demo) {
    $("saveState").textContent = "샘플 입력값은 저장하지 않습니다.";
    return;
  }
  try {
    // A scenario target price is never retained across apartment/area changes.
    localStorage.setItem("home2033-plan-v2", JSON.stringify({
      values: Object.fromEntries(ids.filter(id => id !== "targetPrice").map(id => [id, $(id).value])), saleAuto,
      targetMonthSelected: $("targetMonth").value !== ""
    }));
    $("saveState").textContent = "이 브라우저에 저장됨";
  } catch { $("saveState").textContent = "브라우저 저장 불가 · 현재 입력으로 계산 중"; }
}
async function getJSON(path) {
  const response = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw new Error("파일 응답 " + response.status);
  return response.json();
}
function checkPayload(value, expectedMode) {
  if (value?.schemaVersion !== 2 || value.mode !== expectedMode || !Array.isArray(value.trades)) throw new Error("데이터 형식이 맞지 않습니다.");
  const known = new Map(registry.complexes.map(c => [c.id, c]));
  for (const row of value.trades) {
    const c = known.get(row.complexId);
    if (!c || row.legalDongCode !== c.legalDongCode || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isInteger(row.priceManwon) || row.priceManwon <= 0 || !Number.isFinite(row.area) || row.area <= 0) {
      throw new Error("검증되지 않은 거래 데이터입니다.");
    }
  }
  return value;
}
function asOf() { return demo ? payload.asOf : today; }
function baseSummary() { return summary(baseTrades, asOf()); }
function basePrice() { return priceFor(baseSummary(), $("metric").value); }
function averageMode() { return $("metric").value === "average10"; }
function averageSample(stats) {
  return stats.count10 < 3 ? "거래 부족 · " + stats.count10 + "/10건" :
    stats.count10 < 10 ? "10건 미만 · " + stats.count10 + "건 평균" : "10건 평균";
}
function averagePeriod(stats) {
  return stats.count10 ? dateLabel(stats.start10) + " ~ " + dateLabel(stats.end10) : "해당 면적 거래 없음";
}
function selectedComplex() { return registry.complexes.find(c => c.id === selected); }
function buildingAge(c) { return constructionLabel([...(official?.trades || []), ...nationalTrades], c.id, today); }
function getSummary(c, exactType = "all") { return summary(c.comparisonEligible === false ? [] : forArea(trades, c.id, area, exactType), asOf()); }
function record(c, exactType = "all") {
  const stats = getSummary(c, exactType);
  const price = priceFor(stats, $("metric").value);
  if (!personalMode()) return { c, stats, price, ...capitalComparison(price == null ? null : price / 10000, tracker.capital) };
  const base = basePrice();
  return { c, stats, price, ...comparison(price, base), assetGap: assetComparison(price, base, tracker.cash).gap };
}
function notice() {
  $("modeLabel").textContent = demo ? "샘플 데이터" : "국토부 공식 실거래";
  $("modeDot").classList.toggle("demo", demo);
  $("demoToggle").textContent = demo ? "공식 데이터로 돌아가기" : "샘플로 둘러보기";
  $("demoToggle").setAttribute("aria-pressed", String(demo));
  $("updateLabel").textContent = demo ? "가상 거래 · 기준일 " + payload.asOf : "최종 정상 갱신 " + stamp(official?.updatedAt);
  const messages = [];
  if (demo) messages.push("샘플 모드 · 모든 가격과 거래는 화면 확인용 가상 데이터입니다.");
  else {
    if (loadError) messages.push(loadError);
    if (status?.ok === false) messages.push("최근 수집 실패 · 마지막 정상 실거래를 유지합니다. " + status.message);
    if (!official?.updatedAt) messages.push("공식 실거래 수집 전입니다. README에 따라 MOLIT_SERVICE_KEY 등록 후 Actions를 실행하세요. 샘플로 화면을 둘러볼 수 있습니다.");
    if (official?.updatedAt && Date.now() - new Date(official.updatedAt).getTime() > 48 * 3600000) messages.push("정상 데이터 갱신 후 48시간이 지났습니다. Actions 실행 상태를 확인하세요.");
    if (personalMode() && currentBase() && !baseSummary().latest) messages.push("선택한 기준 주택·면적의 최근 12개월 실거래가 없습니다. 기준가·격차·자산 부족액은 계산하지 않습니다.");
    if (!messages.length) messages.push("최근 12개월 계약일 기준 · 해제 거래 제외 · 신고 지연으로 최근 거래가 아직 반영되지 않을 수 있습니다.");
  }
  $("notice").textContent = messages.join(" ");
  $("notice").className = "notice " + (demo ? "sample-notice" : messages.some(m => /실패|전입니다|없습니다|48시간/.test(m)) ? "warning" : "healthy");
  $("sourceStamp").textContent = "명부 확인 " + registry.checkedAt + (demo ? " · 샘플" : " · 최종 수집 " + stamp(official?.updatedAt));
}
function renderOverview(records) {
  $("capitalSettings").hidden = personalMode();
  $("homeReference").hidden = !personalMode();
  if (personalMode()) renderHomeReference();
  const available = records.filter(r => r.price != null);
  $("summaryCount").innerHTML = available.length + "<small> / " + records.length + "개</small>";
  $("summaryCoverage").textContent = "현재 지역·면적·검색 조건 기준";
  const key = personalMode() ? "assetGap" : "gap";
  const distance = value => personalMode() ? value : Math.abs(value);
  const closest = records.filter(r => r[key] != null).sort((a, b) => distance(a[key]) - distance(b[key]))[0];
  $("minGapLabel").textContent = personalMode() ? "내 집 + 현금 대비 최소 차액" : "내 자본과 가장 가까운 단지";
  $("minGap").innerHTML = closest ? signed(closest[key]) + "<small>억</small>" : "—";
  $("minGapDetail").textContent = closest ? complexLabel(closest.c) + " · 전용 " + area + "㎡급" : personalMode() ?
    basePrice() != null ? "비교 가능한 거래 없음" : "기준 실거래가가 필요합니다" :
    tracker.capital == null ? "자기자본을 입력하면 차액이 표시됩니다" : "비교 가능한 거래 없음";
  renderBaseControls();
}
function renderHomeReference() {
  const home = currentBase(), base = baseSummary(), latest = base.latest, price = basePrice();
  $("baseName").textContent = home ? `${home.name} (${householdLabel(home)})` : "기준 아파트를 선택하세요";
  $("baseAreaLabel").textContent = home ? "전용 " + baseAreaLabel() : "";
  $("baseAge").textContent = home ? buildingAge(home) : "위 검색에서 내 아파트를 선택하세요.";
  $("basePrice").innerHTML = money(price == null ? null : price / 10000) + "<small>억원" + (demo ? " · 샘플" : "") + "</small>";
  $("baseDetail").textContent = !home ? "" : !latest ? "최근 12개월 해당 전용면적 거래 없음" :
    averageMode() ? "최근 10건 평균 · " + averageSample(base) + " · " + averagePeriod(base) :
    $("metric").value === "latest" ? "최근 1건 · 계약 " + dateLabel(latest.date) + " · 전용 " + latest.area + "㎡ · " + latest.floor + "층" +
      (base.sameDateCount > 1 ? " · 같은 날 " + base.sameDateCount + "건" : "") :
    $("metric").selectedOptions[0].textContent + " · " + ($("metric").value === "median3" ? base.count3 : base.count6) + "건 · " + baseAreaLabel();
  if (home?.id.startsWith("n-")) $("baseDetail").textContent += " · 지역 갱신 " + stamp(nationalStamps.get(home.districtCode));
}
function renderBaseControls() {
  $("personalSettings").hidden = !personalMode();
  document.querySelectorAll("[data-tracker]").forEach(b => { const active = b.dataset.tracker === tracker.mode; b.classList.toggle("selected", active); b.setAttribute("aria-pressed", String(active)); });
  if (document.activeElement !== $("trackerCapital")) $("trackerCapital").value = tracker.capital ?? "";
  $("applyCapital").disabled = tracker.capital == null;
  if (!personalMode()) return;
  if (document.activeElement !== $("trackerCash")) $("trackerCash").value = tracker.cash == null ? "" : tracker.cash;
  const types = [...new Set(trades.filter(t => t.complexId === tracker.id).map(t => t.area))].sort((a, b) => a - b);
  const options = ["59", "74", "84"].map(a => '<option value="band' + a + '">' + a + '㎡급 전체 타입</option>');
  if (!tracker.area.startsWith("band") && !types.includes(Number(tracker.area))) types.push(Number(tracker.area));
  $("baseType").innerHTML = options.join("") + types.map(a => '<option value="' + a + '">정확한 전용 ' + a + '㎡' + (trades.some(t => t.complexId === tracker.id && t.area === a) ? "" : " · 거래 없음") + '</option>').join("");
  $("baseType").value = tracker.area;
  $("baseType").disabled = !currentBase();
  const price = basePrice();
  const budget = assetComparison(price, price, tracker.cash).available;
  $("trackerBudget").textContent = budget == null ? "—" : money(budget) + "억원";
  $("trackerFormula").textContent = currentBase() ? baseLabel() + " " + money(price == null ? null : price / 10000) + "억 + 현금 " + money(tracker.cash) + "억 · 부채·세금 미차감" : "내 아파트를 검색해 비교 기준을 선택하세요.";
  $("applyTracker").disabled = budget == null;
}
function renderBaseSearch() {
  const query = $("baseSearch").value.trim();
  if (!query) {
    baseSearchMarkup = "";
    $("baseSearchRows").innerHTML = "";
    $("baseSearchStatus").textContent = currentBase() ? "선택 기준: " + baseLabel() + " · 이름을 입력해 변경하세요." : "아파트 이름을 입력하면 전국 검색 명부를 불러옵니다.";
    return;
  }
  const matches = registry.complexes.filter(c => meetsHouseholdMinimum(c) && matchesComplex(c, query));
  $("baseSearchStatus").textContent = (nationalLoading ? "전국 명부 불러오는 중 · " : nationalIndex ? "전국 명부 · " : "기본 명부 · 전국 자료 연결 상태 확인 · ") + matches.length + "개 검색됨 · 앞 30개 표시";
  const markup = matches.slice(0, 30).map(c => '<div class="catalog-row"><div><b>' + escape(c.name + " (" + householdLabel(c) + ")") + '</b><small>' + escape(c.region + " · " + c.legalDong + " " + c.jibuns.join(", ")) + '</small></div><button type="button" class="outline-button" data-base="' + c.id + '"' + (c.comparisonEligible === false ? ' disabled' : '') + ' aria-label="' + escape(c.name) + ' 기준으로 선택">' + (c.comparisonEligible === false ? "국민임대" : c.id === tracker.id ? "선택됨" : "기준 선택") + '</button></div>').join("");
  if (markup !== baseSearchMarkup) {
    $("baseSearchRows").innerHTML = markup;
    baseSearchMarkup = markup;
  }
}
async function chooseBase(id) {
  const c = registry.complexes.find(c => c.id === id), request = ++baseRequest;
  if (!meetsHouseholdMinimum(c) || c.comparisonEligible === false) return;
  $("baseSearchStatus").textContent = "기준 주택의 공식 거래를 확인하는 중…";
  try {
    if (id.startsWith("n-")) await loadNationalDistrict(c.districtCode);
    if (request !== baseRequest || !personalMode()) return;
    tracker.id = id;
    const rows = [...(payload?.trades || []), ...(demo ? [] : nationalTrades)].filter(t => t.complexId === id);
    tracker.area = rows.some(t => areaClass(t.area) === "59") ? "band59" : rows.some(t => areaClass(t.area) === "84") ? "band84" : rows.length ? String(rows[0].area) : "band59";
    exact = "all"; targetAuto = true; saveTracker(); targetOptions(); activateData(); renderBaseSearch();
  } catch { $("baseSearchStatus").textContent = "기준 거래를 불러오지 못해 기존 기준을 유지합니다. 다시 선택하세요."; }
}
function medianCell(price, n) {
  return '<span class="cell-price">' + money(price == null ? null : price / 10000) + '</span><small class="' + (n < 3 ? "low-sample" : "muted") + '">' +
    (n < 3 ? "거래 부족 · " + n + "건" : n + "건") + "</small>";
}
function renderWatchPageControls(resultCount) {
  const pageCount = Math.max(1, Math.ceil(resultCount / WATCH_PAGE_SIZE));
  watchPage = Math.min(watchPage, pageCount - 1);
  for (const pager of $("watchList").querySelectorAll("[data-watch-pager]")) {
    pager.hidden = pageCount === 1;
    pager.querySelector('[data-watch-step="-1"]').disabled = watchPage === 0;
    pager.querySelector('[data-watch-step="1"]').disabled = watchPage === pageCount - 1;
    pager.querySelector("span").textContent = `${watchPage + 1} / ${pageCount} 페이지`;
  }
  return watchPage * WATCH_PAGE_SIZE;
}
function renderList() {
  const search = $("search").value;
  const personal = personalMode();
  const minimum = personal ? preferences.minimum : preferences.capitalMinimum;
  const ratioAvailable = personal || tracker.capital > 0;
  const candidates = registry.complexes.filter(c => isWatched(c) &&
    (region === "all" || c.region === region) && matchesComplex(c, search)).map(c => record(c));
  const records = candidates.filter(r => passesRatio(r.ratio, minimum));
  $("minimumRatio").disabled = !ratioAvailable;
  $("minimumRatio").value = String(ratioAvailable ? minimum : 0);
  $("ratioFilterLabel").textContent = personal ? "주택 가격 배율" : "자본 대비 배율";
  $("ratioNote").textContent = ratioAvailable && minimum ? "1.5배 미만 " + (candidates.length - records.length) + "개 숨김 · 배율을 계산할 거래가 없는 단지는 ‘거래 부족’으로 남깁니다." : "";
  records.sort((a, b) => {
    if ($("sort").value === "name") return a.c.name.localeCompare(b.c.name, "ko");
    if ($("sort").value === "date") return (b.stats.latest?.date ?? "").localeCompare(a.stats.latest?.date ?? "");
    return (a.gap ?? Infinity) - (b.gap ?? Infinity) || a.c.name.localeCompare(b.c.name, "ko");
  });
  renderOverview(records);
  const metric = $("metric").value, metricLabel = $("metric").selectedOptions[0].textContent;
  $("priceColumnLabel").textContent = metricLabel;
  $("priceBasis").textContent = personal ? "선택한 기준 주택과 비교 주택 모두 같은 가격 지표를 사용합니다. 자산 차액은 비교 가격에서 기준 주택 가격과 추가 현금을 뺀 금액입니다. 부채·세금·거래비용은 별도이며, 배율은 주택 가격끼리 비교합니다." :
    "자본 대비 차액은 비교 가격에서 입력 자본을 뺀 금액입니다. 양수는 추가 필요, 음수는 여유 금액입니다. 대출·세금·거래비용은 자금 계획에서 반영하세요.";
  const sameArea = currentBaseType() === "band" + area;
  $("areaNotice").hidden = !currentBase();
  $("areaNotice").innerHTML = (sameArea ? '' : '<span class="area-warning">면적이 다른 비교</span>') + '<span class="small">기준 ' + escape(baseAreaLabel()) + ' ↔ 비교 ' + area + '㎡급 · 실제 전용면적과 타입은 다를 수 있습니다.</span>';
  const gapLabel = personal ? "주택 가격 차이" : "자본 대비 차액";
  $("gapColumnLabel").textContent = gapLabel;
  const baseLow = personal && averageMode() && baseSummary().count10 < 3;
  const offset = renderWatchPageControls(records.length);
  const resultLabel = `${records.length.toLocaleString("ko-KR")}개 · ${area}㎡급${demo ? " · 샘플" : ""}`;
  $("watchListCount").textContent = resultLabel;
  $("resultCount").textContent = records.length ? `${resultLabel} · ${offset + 1}–${Math.min(offset + WATCH_PAGE_SIZE, records.length)}번째 표시` : resultLabel;
  $("apartmentRows").innerHTML = records.slice(offset, offset + WATCH_PAGE_SIZE).map((r, index) => {
    const latest = r.stats.latest, low = metric === "median3" ? r.stats.count3 < 3 : metric === "median6" ? r.stats.count6 < 3 : averageMode() ? r.stats.count10 < 3 : r.stats.count < 3;
    const priceDetail = r.c.comparisonEligible === false ? "국민임대 · 매매 비교 제외" : averageMode() ? averageSample(r.stats) + " · " + averagePeriod(r.stats) :
      metric === "latest" ? (latest ? dateLabel(latest.date) + " · " + latest.area + "㎡" : "거래 부족 · 0건") :
      (metric === "median3" ? r.stats.count3 : r.stats.count6) + "건 · 최근 " + (metric === "median3" ? "3" : "6") + "개월";
    const gapDetail = r.c.comparisonEligible === false ? "매매 비교 제외" : r.price == null ? "거래 부족" : r.gap == null ?
      personal ? "기준 실거래가 필요" : "자기자본 입력 필요" : low || baseLow ? "거래 부족 · 표본 유의" :
      personal ? "기준 " + baseAreaLabel() + " 실거래 대비" : r.gap > 0 ? "추가 필요" : r.gap < 0 ? "여유 금액" : "입력 자본과 같음";
    return '<tr class="' + (selected === r.c.id ? "selected-row" : "") + '" data-complex="' + r.c.id + '"><td class="name-cell"><span class="rank">' + String(offset + index + 1).padStart(2, "0") +
      '</span><div><button type="button" class="complex-button" data-select="' + r.c.id + '">' + escape(r.c.name + " (" + householdLabel(r.c) + ")") + '</button><small>' + escape(r.c.region) + (r.c.comparisonEligible === false ? ' · 국민임대' : '') + '</small><small class="building-age">' + escape(buildingAge(r.c)) + '</small><button type="button" class="watch-remove" data-watch="' + r.c.id + '" aria-label="' + escape(r.c.name) + ' 관심 제거">관심 제거</button></div></td>' +
      '<td data-label="' + escape(metricLabel) + '"><span class="cell-price">' + money(r.price == null ? null : r.price / 10000) + '</span><small class="' + (low ? "low-sample" : "muted") + '">' + priceDetail + "</small></td>" +
      '<td data-label="3개월 중앙값">' + medianCell(r.stats.median3, r.stats.count3) + '</td><td data-label="6개월 중앙값">' + medianCell(r.stats.median6, r.stats.count6) + "</td>" +
      '<td data-label="' + gapLabel + '" class="gap-cell"><b>' + signed(r.gap) + '</b><small>' + escape(gapDetail) + '</small></td><td data-label="배율"><b>' +
      (r.ratio == null ? "—" : r.ratio.toFixed(2) + "배") + '</b></td>' + (personal ? '<td class="asset-cell" data-label="내 집 + 현금 대비 차액"><b>' + signed(r.assetGap) + '</b><small>' + (r.assetGap == null ? "기준가·현금 또는 비교 거래 확인 필요" : r.assetGap > 0 ? "추가 필요 · 부채·세금 별도" : r.assetGap < 0 ? "여유 금액 · 부채·세금 별도" : "입력 자산과 같음 · 비용 별도") + '</small></td>' : '<td hidden></td>') + '<td class="row-arrow"><a href="#detail" data-detail="' + r.c.id + '" aria-label="' + escape(r.c.name) + ' 상세 그래프">↗</a></td></tr>';
  }).join("");
  $("noResults").hidden = records.length > 0;
  $("assetColumnLabel").hidden = !personal;
  if ($("watchManager").open) renderManager();
}
function renderListFromStart() {
  watchPage = 0;
  renderList();
}
function householdLabel(c) { return c.households == null ? "세대수 확인 필요" : c.households.toLocaleString('ko-KR') + "세대"; }
function complexLabel(c) { return c.name + " (" + householdLabel(c) + ")"; }
function renderManager() {
  const matches = registry.complexes.filter(c => meetsHouseholdMinimum(c) && c.id !== currentBaseId() && matchesComplex(c, $("catalogSearch").value));
  const shown = matches.slice(0, 60);
  $("catalogCount").textContent = matches.length + "개 검색됨" + (matches.length > shown.length ? " · 앞 60개 표시, 지역·단지명을 더 입력하세요." : "");
  $("catalogRows").innerHTML = shown.map(c => '<div class="catalog-row"><div><b>' + escape(complexLabel(c)) + '</b><small>' + escape(c.region + " · " + c.legalDong + " " + c.jibuns.join(", ")) + '</small><small>' + escape(buildingAge(c)) + '</small></div><button type="button" class="outline-button" data-watch="' + c.id + '" aria-label="' + escape(c.name) + (isWatched(c) ? ' 관심 제거' : ' 관심 추가') + '">' + (isWatched(c) ? "제거" : "+ 추가") + '</button></div>').join("") || '<p class="empty">검색 결과가 없습니다. 지역·단지명을 확인하세요.</p>';
}
function targetOptions() {
  const choices = registry.complexes.filter(isWatched);
  if (!choices.some(c => c.id === selected)) { selected = choices.find(c => c.comparisonEligible !== false)?.id || choices[0]?.id || null; exact = "all"; targetAuto = true; }
  $("targetComplex").innerHTML = choices.map(c => '<option value="' + c.id + '"' + (c.comparisonEligible === false ? ' disabled' : '') + '>' + escape(c.region + " · " + c.name + " (" + householdLabel(c) + ")" + (c.comparisonEligible === false ? " · 국민임대(매매 제외)" : "")) + '</option>').join("") || '<option value="">관심 단지를 추가하세요</option>';
  $("targetComplex").disabled = !choices.length;
}
async function loadNational() {
  if (nationalIndex) return;
  if (nationalLoading) return nationalLoading;
  nationalLoading = (async () => {
    $("catalogSource").textContent = "전국 검색 명부를 불러오는 중…";
    try {
      const index = await getJSON("./data/nationwide/index.json");
      if (index.schemaVersion !== 1 || index.minimumHouseholds !== MIN_HOUSEHOLDS || !Array.isArray(index.complexes)) throw new Error();
      const existing = new Set(registry.complexes.map(c => c.id));
      for (const c of index.complexes) if (!existing.has(c.id) && /^n-[a-f0-9]{20}$/.test(c.id) && /^\d{10}$/.test(c.legalDongCode) && c.districtCode === c.legalDongCode.slice(0, 5) && Array.isArray(c.jibuns) && c.jibuns.length && Array.isArray(c.sources) && c.sources.length) registry.complexes.push(c);
      nationalIndex = index;
      $("catalogSource").textContent = index.note + " 지역 자료 " + index.availableDistricts + "/" + index.totalDistricts + " · 가장 오래된 갱신 " + stamp(index.updatedAt) + (index.failedDistricts.length ? " · 일부 지역 수집 실패, 마지막 정상 자료 사용" : "");
      for (const code of new Set(registry.complexes.filter(c => preferences.added.includes(c.id) || (personalMode() && c.id === tracker.id && c.id.startsWith("n-"))).map(c => c.districtCode))) await loadNationalDistrict(code);
      targetOptions(); activateData(); renderBaseSearch();
    } catch { nationalIndex = null; $("catalogSource").textContent = "전국 검색 자료를 불러오지 못했습니다. 현재 검증된 단지는 계속 검색·추가할 수 있습니다. 잠시 후 다시 열어주세요."; }
    finally { nationalLoading = null; }
  })();
  return nationalLoading;
}
async function loadNationalDistrict(code) {
  if (nationalDistricts.has(code)) return;
  if (nationalPending.has(code)) return nationalPending.get(code);
  const promise = (async () => {
    try {
      const value = checkPayload(await getJSON("./data/nationwide/" + code + ".json"), "official");
      nationalTrades.push(...value.trades.filter(t => !defaultIds.has(t.complexId) && t.complexId !== registry.baseId));
      nationalStamps.set(code, value.updatedAt);
      nationalDistricts.add(code);
    } finally { nationalPending.delete(code); }
  })();
  nationalPending.set(code, promise);
  return promise;
}
async function toggleWatch(id) {
  const c = registry.complexes.find(c => c.id === id);
  if (!meetsHouseholdMinimum(c) || c.id === currentBaseId()) return;
  const removing = isWatched(c);
  const isDefault = defaultIds.has(id) || id === registry.baseId;
  if (!removing && !isDefault) {
    $("watchStatus").textContent = "해당 지역의 공식 실거래를 불러오는 중…";
    try { await loadNationalDistrict(c.districtCode); }
    catch { $("watchStatus").textContent = "지역 거래를 불러오지 못해 추가하지 않았습니다. 다시 시도하세요."; return; }
  }
  preferences.removed = preferences.removed.filter(x => x !== id);
  preferences.added = preferences.added.filter(x => x !== id);
  if (removing) preferences.removed.push(id);
  else if (!isDefault) preferences.added.push(id);
  saveWatch(); targetOptions(); activateData();
  $("watchStatus").textContent += " " + c.name + (removing ? " 제거됨." : " 추가됨. 가격 배율·면적 필터에 따라 목록에서 숨겨질 수 있습니다.");
}
function renderChart(container, series, keys, title, labels = {}, emptyMessage) {
  const points = series.flatMap(p => keys.map(k => p[k])).filter(n => n != null);
  if (!points.length) { $(container).innerHTML = '<div class="chart-empty"><span>⌁</span>' + (emptyMessage ? escape(emptyMessage) : '거래 부족<p>선택한 전용면적의 거래를 기다리고 있습니다.</p>') + '</div>'; return; }
  const W = 550, H = 240, L = 45, R = 20, T = 20, B = 35;
  const minimum = Math.min(...points), maximum = Math.max(...points);
  const margin = Math.max((maximum - minimum) * 0.2, 0.5), low = minimum - margin, high = maximum + margin;
  const x = i => L + i * (W - L - R) / (series.length - 1);
  const y = v => T + (high - v) * (H - T - B) / (high - low);
  let body = "";
  for (let i = 0; i < 4; i++) {
    const value = low + (high - low) * i / 3, yy = y(value);
    body += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" class="grid-line"/><text x="8" y="' + (yy + 4) + '">' + value.toFixed(1) + "</text>";
  }
  if (low < 0 && high > 0) body += '<line x1="' + L + '" y1="' + y(0) + '" x2="' + (W - R) + '" y2="' + y(0) + '" class="zero-line"/>';
  series.forEach((p, i) => { if (i % 3 === 0 || i === series.length - 1) body += '<text text-anchor="middle" x="' + x(i) + '" y="' + (H - 10) + '">' + p.month.slice(2).replace("-", ".") + "</text>"; });
  keys.forEach(key => {
    let path = "", previous = false;
    series.forEach((p, i) => { if (p[key] == null) { previous = false; return; } path += (previous ? " L " : " M ") + x(i) + " " + y(p[key]); previous = true; });
    body += '<path d="' + path + '" fill="none" class="series-' + key + '"/>';
    series.forEach((p, i) => { if (p[key] == null) return;
      const n = key === "base" ? p.baseCount : p.count;
      const description = p.month + " · " + (labels[key] || (key === "base" ? "기준 주택" : key === "gap" ? "격차" : "선택 단지")) + " " + money(p[key]) + "억 · " + n + "건" + (n < 3 ? " · 거래 부족" : "");
      body += '<circle tabindex="0" data-month-index="' + i + '" aria-label="' + escape(description) + '" cx="' + x(i) + '" cy="' + y(p[key]) + '" r="' + (container === "neighborhoodChart" ? 6 : 4) + '" class="point-' + key + '"><title>' + escape(description) + "</title></circle>";
    });
  });
  $(container).innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + escape(title) + '"><title>' + escape(title) + '</title>' + body + "</svg>";
}
function syncPrices() {
  if (!registry) return;
  const home = currentBase(), base = home ? basePrice() : null;
  if (saleAuto) $("sale").value = !home ? "0" : base == null ? "" : (base / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  $("resetSale").hidden = !home;
  $("saleHint").textContent = saleAuto && home ? baseLabel() + " · " + $("metric").selectedOptions[0].textContent + " 연동 중 · 예상 매도가는 직접 수정할 수 있습니다." :
    saleAuto ? "매도할 집이 있다면 예상 매도가를 직접 입력하세요." : "직접 입력한 예상 매도가 · 실거래 비교 기준에는 영향을 주지 않습니다.";
  const target = selectedComplex();
  if (!target) {
    $("targetPrice").value = ""; $("targetPrice").disabled = true; $("resetTarget").disabled = true;
    $("targetHint").textContent = "검색에서 관심 단지를 추가하세요.";
    return;
  }
  const eligible = target.comparisonEligible !== false;
  const value = priceFor(getSummary(target, exact), $("metric").value);
  if (targetAuto || !eligible) $("targetPrice").value = value == null ? "" : (value / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  $("targetPrice").disabled = !eligible;
  $("resetTarget").disabled = !eligible;
  $("targetHint").textContent = !eligible ? "국민임대 단지로 매매 가격과 매수 자금 계산을 제공하지 않습니다. 다른 매매 단지를 선택하세요." : (demo ? "[샘플] " : "") + target.name + " · " + (exact === "all" ? area + "㎡급" : exact + "㎡") + " · " +
    $("metric").selectedOptions[0].textContent + (targetAuto ? " 연동" : "을 참고한 직접 입력 시나리오") +
    (value == null ? " · 거래 부족: 목표 매수가를 직접 입력하면 계산할 수 있습니다." : " · 미래 가격 예측이 아닙니다.");
}
function renderComparisonHistory(ts, eligible) {
  const personal = personalMode();
  const capital = tracker.capital;
  let series = monthSeries(ts, baseTrades, asOf());
  const hasPrice = series.some(p => p.price != null);
  if (!personal) series = series.map(p => ({ ...p, base: capital, gap: capitalComparison(p.price, capital).gap }));
  const hasBaseline = personal ? Boolean(currentBase()) : capital != null;
  const baseline = personal ? baseLabel() : "입력 자본 " + money(capital) + "억";
  $("chartBaseLegend").hidden = !hasBaseline || !eligible;
  $("chartBaseLabel").textContent = baseline;
  $("gapChartSubtitle").textContent = personal ? "같은 계약월끼리 비교 · 억원" : "자본 대비 · 억원";
  $("gapChartLegend").textContent = personal ? "선택 단지 − 기준 주택" : "월별 실거래 중앙값 − 입력 자본";
  $("gapChartNote").textContent = personal ? "두 단지에 모두 거래가 있는 월만 비교합니다. 현재 현금은 과거 그래프에 반영하지 않습니다." :
    capital == null ? "" : "현재 입력한 자본을 모든 달의 고정 기준으로 사용합니다.";
  $("monthlyBaseLabel").textContent = personal ? "기준 주택" : "입력 자본";
  $("monthlyBaseCount").hidden = !personal;
  renderChart("priceChart", series, personal || (hasPrice && hasBaseline) ? ["price", "base"] : ["price"], "월별 실거래 중앙값. 빈 월은 연결하지 않습니다.");
  const emptyMessage = personal ? hasBaseline ? "같은 월에 두 단지의 거래가 있어야 차액이 표시됩니다." : "기준 아파트를 선택하면 차액이 표시됩니다." :
    hasBaseline ? "선택한 면적에 거래가 있는 월의 차액을 표시합니다." : "자기자본을 입력하면 차액이 표시됩니다.";
  renderChart("gapChart", series, ["gap"], personal ? "같은 계약월의 선택 단지 중앙값과 " + baseline + " 중앙값의 차이." : "각 계약월의 선택 단지 중앙값과 " + baseline + "의 차이.", {}, emptyMessage);
  if (!eligible) for (const id of ["priceChart", "gapChart"]) $(id).innerHTML = '<div class="chart-empty">국민임대<p>매매 비교 대상이 아닙니다.</p></div>';
  $("monthlyRows").innerHTML = series.map(p => "<tr><td>" + p.month + "</td><td>" + money(p.price) + "</td><td>" + p.count + (p.count < 3 ? " · 거래 부족" : "") + "</td><td>" + money(p.base) + "</td>" +
    (personal ? "<td>" + p.baseCount + (p.baseCount < 3 ? " · 거래 부족" : "") + "</td>" : "") + "<td>" + signed(p.gap) + "</td></tr>").join("");
}
function renderDetail(resetTypes = false) {
  const c = selectedComplex();
  $("detail").hidden = !c;
  if (!c) { syncPrices(); renderCalculation(); return; }
  if (resetTypes) {
    const types = getSummary(c).areas;
    $("exactArea").innerHTML = '<option value="all">선택 면적급 전체 타입</option>' + types.map(a => '<option value="' + a + '">' + a + "㎡</option>").join("");
    if (!types.some(a => String(a) === exact)) exact = "all";
    $("exactArea").value = exact;
  }
  const r = record(c, exact);
  const gap = personalMode() ? r.assetGap : r.gap;
  const eligible = c.comparisonEligible !== false;
  $("useTarget").disabled = !eligible;
  $("selectedName").textContent = c.name + " (" + householdLabel(c) + ")";
  $("selectedRegion").textContent = c.region + (demo ? " · 샘플" : "");
  $("selectedAge").textContent = buildingAge(c);
  $("selectedAddress").textContent = c.legalDong + " " + c.jibuns.join(", ") + " · " +
    (exact === "all" ? area + "㎡급의 타입을 함께 집계" : "정확한 전용 " + exact + "㎡만 집계") + (c.displayNote ? " · " + c.displayNote : "");
  $("selectedMetrics").innerHTML = [
    [$("metric").selectedOptions[0].textContent, !eligible ? "매매 비교 제외" : r.price == null ? "거래 부족" : money(r.price / 10000) + "억"],
    [personalMode() ? "내 집 + 현금 대비 차액" : "자본 대비 차액", gap == null ? "—" : signed(gap) + "억"],
    [averageMode() ? "평균에 사용한 거래" : "3개월 / 6개월 거래", averageMode() ? r.stats.count10 + " / 10건" : r.stats.count3 + "건 / " + r.stats.count6 + "건"],
    ["실제 전용면적", r.stats.areas.length ? r.stats.areas.join(" / ") + "㎡" : "해당 면적 거래 없음"]
  ].map(([label, value]) => "<div><span>" + label + "</span><b>" + escape(value) + "</b></div>").join("");
  $("selectedPriceDetail").textContent = !eligible ? "국민임대 · 매매 비교 제외. 임대료나 인근 단지 가격을 매매 가격으로 대체하지 않습니다." : averageMode() ? averageSample(r.stats) + " · " + averagePeriod(r.stats) +
    " · 선택한 전용면적의 실제 거래만 사용합니다. 아래 그래프는 월별 중앙값입니다." : "아래 그래프는 선택한 비교 가격과 별도로 월별 중앙값을 표시합니다.";
  if (c.id.startsWith("n-")) $("selectedPriceDetail").textContent += " · 해당 지역 거래 갱신 " + stamp(nationalStamps.get(c.districtCode));
  if (personalMode()) $("selectedPriceDetail").textContent += " · 주택끼리 가격 차이 " + signed(r.gap) + "억 / 자산 차액 " + signed(r.assetGap) + "억. 양수는 부족, 음수는 여유이며 부채·세금·비용은 별도입니다.";
  const ts = eligible ? forArea(trades, c.id, area, exact) : [];
  renderComparisonHistory(ts, eligible);
  $("recentTrades").innerHTML = ts.length ? '<div class="ledger-list">' + ts.slice(0, 10).map(t => '<div><time>' + dateLabel(t.date) + '</time><span>' + t.area + "㎡ · " + escape(t.floor) + '층</span><b>' + money(t.priceManwon / 10000) + '억</b><small>' + escape(t.dealingType || "거래유형 미제공") + (demo ? " · 샘플" : "") + "</small></div>").join("") + "</div>" +
    (r.stats.sameDateCount > 1 ? '<p class="field-help">최신 계약일에 ' + r.stats.sameDateCount + "건이 있습니다. 최근 1건은 거래 ID 순으로 선택하며 당일 거래 내역도 함께 확인하세요.</p>" : "") : '<p class="empty">' + (eligible ? '거래 부족 · 해당 전용면적의 최근 12개월 거래가 없습니다.' : '국민임대 단지입니다. 매매 가격을 제공하지 않습니다.') + '</p>';
  $("complexSource").href = c.sources[0].url;
  $("complexSource").textContent = "단지 정보 확인 ↗ · " + c.checkedAt;
  $("targetComplex").value = selected;
  syncPrices();
  renderCalculation();
}
function renderCalculation() {
  const selectedMonth = $("targetMonth").value;
  $("planTarget").textContent = selectedComplex()?.name || "목표 주택";
  $("planSubtitle").textContent = (selectedMonth || "이번 달") + " 매수 가정 · " + (exact === "all" ? area + "㎡급" : exact + "㎡") + (demo ? " · 샘플 가격" : "");
  const resultIds = ["shortage", "netSale", "assetResult", "savingsResult", "equityResult", "loanResult", "availableResult", "costResult"];
  try {
    if (!selectedComplex()) throw new Error("검색에서 관심 단지를 추가하세요.");
    if (selectedComplex().comparisonEligible === false) throw new Error("국민임대 단지는 매수 자금 계산 대상이 아닙니다. 다른 매매 단지를 선택하세요.");
    for (const id of ids) {
      if (id !== "targetMonth" && $(id).value === "") throw new Error(id === "sale" ? "현재 주택 예상 매도가를 입력하세요." : id === "targetPrice" ? "거래 부족 · 목표 매수가를 직접 입력하세요." : "비어 있는 입력값을 확인하세요.");
    }
    const input = Object.fromEntries(ids.map(id => [id, id === "targetMonth" ? selectedMonth || currentMonth : Number($(id).value)]));
    if (!input.targetPrice) throw new Error("목표 매수가는 0보다 커야 합니다.");
    const r = calculate(input, today);
    $("shortage").innerHTML = money(r.shortage) + "<small>억원</small>";
    $("surplus").textContent = r.surplus > 0 ? money(r.surplus) + "억 여유" : r.shortage === 0 ? "입력한 가정에서는 자기자본이 충족됩니다." : "목표까지 더 모아야 할 금액";
    const values = { netSale: r.netSale, assetResult: input.assets, savingsResult: r.savings, equityResult: r.equity, loanResult: input.newLoan, availableResult: r.available, costResult: r.totalCost };
    for (const [id, value] of Object.entries(values)) $(id).textContent = money(value) + "억";
    $("savingMonths").textContent = "오늘부터 " + r.months + "개월 저축 + 성과급 " + r.bonusCount + "회. 월 저축은 다음 달부터, 성과급은 12개월을 채울 때마다 1회 적립합니다. 매도 순자금에서 양도세 " + money(input.saleTax) + "억을 차감했습니다. 세금 입력 0은 비과세 판정이 아닙니다.";
    $("calcError").textContent = "";
  } catch (e) {
    for (const id of resultIds) $(id).textContent = "—";
    $("surplus").textContent = "";
    $("savingMonths").textContent = "";
    $("calcError").textContent = e.message;
  }
}
function activateData() {
  trades = validTrades([...(payload?.trades || []), ...(demo ? [] : nationalTrades)], asOf());
  baseTrades = currentBase() ? referenceTrades(trades, currentBaseId(), currentBaseType()) : [];
  renderList(); renderDetail(true); notice();
  neighborhoods?.update({ demo, payload, complexes: registry.complexes });
}
function choose(id, scroll = false) {
  selected = id; exact = "all"; targetAuto = true;
  renderList(); renderDetail(true);
  if (scroll) $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}
function setupRegistry() {
  $("regions").innerHTML = ["all", ...new Set(registry.complexes.map(c => c.region))].map(r =>
    '<button type="button" data-region="' + r + '" aria-pressed="' + (r === region) + '" class="' + (r === region ? "selected" : "") + '">' + (r === "all" ? "전체 지역" : r) + "</button>").join("");
  targetOptions();
  $("registryNote").textContent = "기본 명부에서 300세대 이상으로 확인된 단지의 출처입니다. 확인일 " + registry.checkedAt + ".";
  $("registryAudit").innerHTML = '<div class="audit-list">' + registry.complexes.filter(meetsHouseholdMinimum).map(c => '<div><b>' + escape(complexLabel(c)) + '</b><span>' + escape(c.legalDong + " " + c.jibuns.join(", ") + " · 법정동 " + c.legalDongCode) + '</span>' +
    (c.note ? "<small>" + escape(c.note) + "</small>" : "") + '<a target="_blank" rel="noopener" href="' + escape(c.sources[0].url) + '">확인 출처 ↗</a></div>').join("") + "</div><h4>초기 후보 검증 이력</h4>" +
    registry.excludedCandidates.map(c => "<p>" + escape(c.name + " · " + c.households + "세대 · " + c.reason) + ' <a target="_blank" rel="noopener" href="' + escape(c.source) + '">출처 ↗</a></p>').join("");
}
async function loadOfficial() {
  $("refresh").disabled = true;
  const results = await Promise.allSettled([getJSON("./data/trades.json"), getJSON("./data/status.json")]);
  try {
    if (results[0].status !== "fulfilled") throw results[0].reason;
    official = checkPayload(results[0].value, "official");
    loadError = "";
  } catch {
    loadError = official ? "공식 파일을 새로 불러오지 못해 현재 화면의 마지막 정상 데이터를 유지합니다." : "공식 데이터 파일에 연결하지 못했습니다. HTTP 미리보기 또는 Pages 경로와 Actions를 확인하세요.";
  }
  status = results[1].status === "fulfilled" ? results[1].value : null;
  if (!status && official?.updatedAt) loadError += " 수집 상태 파일을 확인할 수 없습니다.";
  if (!demo) { payload = official; activateData(); }
  $("refresh").disabled = false;
}
document.querySelectorAll("[data-area]").forEach(button => button.addEventListener("click", () => {
  area = button.dataset.area; exact = "all"; targetAuto = true;
  document.querySelectorAll("[data-area]").forEach(b => { b.classList.toggle("selected", b === button); b.setAttribute("aria-pressed", String(b === button)); });
  renderListFromStart(); renderDetail(true);
}));
$("regions").addEventListener("click", e => {
  const button = e.target.closest("[data-region]"); if (!button) return;
  region = button.dataset.region;
  $("regions").querySelectorAll("button").forEach(b => { b.classList.toggle("selected", b === button); b.setAttribute("aria-pressed", String(b === button)); });
  renderListFromStart();
});
$("watchList").addEventListener("click", e => {
  const button = e.target.closest("[data-watch-step]");
  if (!button || button.disabled || !registry) return;
  watchPage += Number(button.dataset.watchStep);
  renderList();
  const heading = $("watchResultHeading");
  heading.focus({preventScroll: true});
  heading.scrollIntoView({block: "start"});
});
$("apartmentRows").addEventListener("click", e => {
  const watch = e.target.closest("[data-watch]");
  if (watch) { toggleWatch(watch.dataset.watch); return; }
  const button = e.target.closest("[data-select], [data-detail]");
  if (button) { e.preventDefault(); choose(button.dataset.select || button.dataset.detail, true); return; }
  const row = e.target.closest("[data-complex]"); if (row) choose(row.dataset.complex);
});
$("search").addEventListener("input", renderListFromStart);
document.querySelectorAll("[data-tracker]").forEach(button => button.addEventListener("click", () => {
  if (tracker.mode === button.dataset.tracker) return;
  ++baseRequest; tracker.mode = button.dataset.tracker; watchPage = 0;
  saveTracker(); targetOptions(); activateData();
  if (personalMode()) renderBaseSearch();
  if (personalMode() && tracker.id?.startsWith("n-")) loadNational().then(async () => {
    const c = currentBase();
    if (personalMode() && c?.id.startsWith("n-")) { await loadNationalDistrict(c.districtCode); activateData(); }
  }).catch(() => { trackerStatus("기준 거래를 불러오지 못했습니다. 기준 아파트를 다시 선택하세요."); });
}));
$("trackerCapital").addEventListener("input", e => {
  const input = e.currentTarget;
  tracker.capital = input.validity.valid && input.value !== "" ? input.valueAsNumber : null;
  if (input.validity.valid) saveTracker();
  else trackerStatus("자기자본은 0 이상의 숫자로 입력하세요.");
  renderListFromStart(); renderDetail();
});
$("applyCapital").addEventListener("click", () => {
  if (personalMode() || tracker.capital == null) return;
  $("assets").value = tracker.capital;
  syncPrices(); renderCalculation(); save();
  trackerStatus("입력 자본을 자금 계획의 금융자산에 반영했습니다.");
  $("calculator").scrollIntoView({behavior:"smooth"});
});
$("baseSearch").addEventListener("input", () => { renderBaseSearch(); if ($("baseSearch").value.trim()) loadNational().then(renderBaseSearch); });
$("baseSearchRows").addEventListener("click", e => { const button = e.target.closest("[data-base]"); if (button) chooseBase(button.dataset.base); });
$("baseType").addEventListener("change", () => { tracker.area = $("baseType").value; targetAuto = true; saveTracker(); activateData(); });
$("trackerCash").addEventListener("input", () => { tracker.cash = $("trackerCash").value === "" ? null : Number($("trackerCash").value); saveTracker(); renderList(); renderDetail(); });
$("applyTracker").addEventListener("click", () => {
  if (!personalMode() || assetComparison(basePrice(), basePrice(), tracker.cash).available == null) return;
  $("assets").value = tracker.cash; saleAuto = true; syncPrices(); renderCalculation(); save();
  trackerStatus("선택한 기준가와 현금을 자금 계획에 반영했습니다. 현금은 금융자산 항목에 한 번만 포함됩니다.");
  $("calculator").scrollIntoView({behavior:"smooth"});
});
$("catalogSearch").addEventListener("input", renderManager);
$("watchManager").addEventListener("toggle", () => { if ($("watchManager").open) { renderManager(); loadNational(); } });
$("catalogRows").addEventListener("click", e => { const button = e.target.closest("[data-watch]"); if (button) toggleWatch(button.dataset.watch); });
$("minimumRatio").addEventListener("change", () => {
  preferences[personalMode() ? "minimum" : "capitalMinimum"] = Number($("minimumRatio").value);
  saveWatch(); renderListFromStart();
});
$("sort").addEventListener("change", renderListFromStart);
$("metric").addEventListener("change", () => { targetAuto = true; renderListFromStart(); renderDetail(); });
$("exactArea").addEventListener("change", () => { exact = $("exactArea").value; targetAuto = true; renderDetail(); });
$("targetComplex").addEventListener("change", () => choose($("targetComplex").value));
$("calculatorForm").addEventListener("submit", e => e.preventDefault());
for (const id of ids) $(id).addEventListener("input", () => {
  if (id === "sale") saleAuto = false;
  if (id === "targetPrice") targetAuto = false;
  syncPrices(); renderCalculation(); save();
});
$("resetSale").addEventListener("click", () => { saleAuto = true; syncPrices(); renderCalculation(); save(); });
$("resetTarget").addEventListener("click", () => { targetAuto = true; syncPrices(); renderCalculation(); });
$("resetCalculator").addEventListener("click", () => {
  for (const id of ids) $(id).value = id === "targetMonth" ? "" : "0";
  saleAuto = true; targetAuto = true; syncPrices(); renderCalculation(); save();
});
$("useTarget").addEventListener("click", () => { $("calculator").scrollIntoView({ behavior: "smooth" }); $("targetComplex").focus({ preventScroll: true }); });
$("refresh").addEventListener("click", loadOfficial);
$("demoToggle").addEventListener("click", async () => {
  ++baseRequest;
  $("demoToggle").disabled = true;
  try {
    if (demo) {
      demo = false; payload = official;
      if (officialPlanSnapshot) {
        for (const [id, value] of Object.entries(officialPlanSnapshot.values)) $(id).value = value;
        saleAuto = officialPlanSnapshot.saleAuto;
        tracker = { ...officialPlanSnapshot.tracker };
      }
      $("saveState").textContent = "공식 모드의 기존 입력값으로 복원됨";
      trackerStatus("공식 모드의 기존 비교 기준으로 복원했습니다.");
    } else {
      const sample = checkPayload(await getJSON("./data/sample.json"), "sample");
      officialPlanSnapshot = { values: Object.fromEntries(ids.filter(id => id !== "targetPrice").map(id => [id, $(id).value])), saleAuto, tracker: { ...tracker } };
      payload = sample; demo = true;
      $("saveState").textContent = "샘플 입력값은 저장하지 않습니다.";
    }
    targetAuto = true; targetOptions(); activateData();
  } catch { $("notice").textContent = "샘플 파일을 불러오지 못했습니다. 배포 파일과 연결 상태를 확인하세요."; }
  finally { $("demoToggle").disabled = false; }
});
async function init() {
  try {
    registry = await getJSON("./data/complexes.json");
    if (!Array.isArray(registry.complexes) || !registry.complexes.some(c => c.id === registry.baseId)) throw new Error();
    defaultIds = new Set(registry.complexes.filter(c => c.id !== registry.baseId).map(c => c.id));
    setupRegistry();
    controls.forEach(control => { control.disabled = false; });
    neighborhoods = initNeighborhood({ getJSON, renderChart });
    initBudget(getJSON);
    await loadOfficial();
    if (personalMode()) renderBaseSearch();
    if (preferences.added.length || (personalMode() && tracker.id?.startsWith("n-"))) await loadNational();
  } catch {
    $("notice").textContent = "단지 명부를 불러오지 못했습니다. README의 HTTP 서버 실행 방법과 배포 경로를 확인하세요.";
    controls.forEach(control => { control.disabled = true; });
  }
}
init();

