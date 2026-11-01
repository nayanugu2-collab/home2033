import { areaClass, assetComparison, calculate, comparison, constructionLabel, forArea, koreaToday, matchesComplex, monthSeries, passesRatio, priceFor, referencePrice, referenceTrades, summary, trackerPreferences, validTrades, watchPreferences } from "./core.js?v=personal-tracker";

const $ = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
const money = n => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
const dateLabel = iso => iso ? iso.replaceAll("-", ".") : "거래 없음";
const stamp = iso => iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "갱신 전";
const ids = ["sale", "mortgage", "family", "assets", "monthly", "bonus", "targetMonth", "newLoan", "tax", "saleTax", "fees", "targetPrice"];
const controls = [...document.querySelectorAll("button, input, select")];
controls.forEach(control => { control.disabled = true; });
let registry, official = null, status = null, demo = false, payload = null, trades = [], baseTrades = [];
let area = "84", region = "all", selected = "gracium", exact = "all", saleAuto = true, targetAuto = true, loadError = "";
let officialPlanSnapshot = null;
let preferences = watchPreferences(null), defaultIds = new Set(), nationalIndex = null, nationalLoading = null;
let nationalTrades = [], nationalDistricts = new Set(), nationalPending = new Map();
const nationalStamps = new Map();
let tracker = trackerPreferences(null), baseRequest = 0;
try { tracker = trackerPreferences(JSON.parse(localStorage.getItem("home2033-tracker-v1"))); } catch {}
function personalMode() { return tracker.mode === "personal"; }
function currentBaseId() { return personalMode() ? tracker.id : registry.baseId; }
function currentBaseType() { return personalMode() ? tracker.area : "band59"; }
function currentBase() { return registry.complexes.find(c => c.id === currentBaseId()); }
function baseAreaLabel() { return currentBaseType().startsWith("band") ? currentBaseType().slice(4) + "㎡급" : currentBaseType() + "㎡"; }
function baseLabel() { return (currentBase()?.name || "기준 아파트 확인 필요") + " · 전용 " + baseAreaLabel(); }
function saveTracker() {
  if (demo) { $("trackerState").textContent = "샘플 기준·현금은 저장하지 않습니다."; return; }
  try { localStorage.setItem("home2033-tracker-v1", JSON.stringify(tracker)); $("trackerState").textContent = "기준과 현금을 이 브라우저에 저장했습니다."; }
  catch { $("trackerState").textContent = "저장소 사용 불가 · 이번 화면에만 적용합니다."; }
}
try { preferences = watchPreferences(JSON.parse(localStorage.getItem("home2033-watch-v1"))); } catch {}
function isWatched(c) { return c.id !== currentBaseId() && !preferences.removed.includes(c.id) && (c.id === registry.baseId || defaultIds.has(c.id) || preferences.added.includes(c.id)); }
function saveWatch() {
  try { localStorage.setItem("home2033-watch-v1", JSON.stringify(preferences)); $("watchStatus").textContent = "관심 목록을 이 브라우저에 저장했습니다."; }
  catch { $("watchStatus").textContent = "저장소를 사용할 수 없어 이번 화면에만 적용합니다."; }
}
const today = koreaToday();
$("todayLabel").textContent = today.replaceAll("-", ". ");
$("targetMonth").min = today.slice(0, 7);
if ($("targetMonth").value < today.slice(0, 7)) $("targetMonth").value = today.slice(0, 7);
try {
  const saved = JSON.parse(localStorage.getItem("home2033-plan-v2") || "null");
  if (saved) {
    for (const id of ids.filter(id => id !== "targetPrice")) if (saved.values?.[id] != null) $(id).value = saved.values[id];
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
      values: Object.fromEntries(ids.filter(id => id !== "targetPrice").map(id => [id, $(id).value])), saleAuto
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
function basePrice() { return personalMode() ? priceFor(baseSummary(), $("metric").value) : referencePrice(baseSummary(), $("metric").value); }
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
  return { c, stats, price, ...comparison(price, basePrice()), assetGap: assetComparison(price, basePrice(), tracker.cash).gap };
}
function notice() {
  $("modeLabel").textContent = demo ? "샘플 데이터" : "국토부 공식 실거래";
  $("modeDot").classList.toggle("demo", demo);
  $("demoToggle").textContent = demo ? "공식 데이터로 돌아가기" : "샘플로 둘러보기";
  $("demoToggle").setAttribute("aria-pressed", String(demo));
  $("updateLabel").textContent = demo ? "가상 거래 · 기준일 " + payload.asOf : "최종 정상 갱신 " + stamp(official?.updatedAt);
  const messages = [];
  if (demo) messages.push("샘플 모드 · 모든 가격과 거래는 UI 확인을 위한 가상 데이터입니다. 실제 시장 가격이나 2033년 예측이 아닙니다.");
  else {
    if (loadError) messages.push(loadError);
    if (status?.ok === false) messages.push("최근 수집 실패 · 마지막 정상 실거래를 유지합니다. " + status.message);
    if (!official?.updatedAt) messages.push("공식 실거래 수집 전입니다. README에 따라 MOLIT_SERVICE_KEY 등록 후 Actions를 실행하세요. 샘플로 화면을 둘러볼 수 있습니다.");
    if (official?.updatedAt && Date.now() - new Date(official.updatedAt).getTime() > 48 * 3600000) messages.push("정상 데이터 갱신 후 48시간이 지났습니다. Actions 실행 상태를 확인하세요.");
    if (!baseSummary().latest) messages.push("선택한 기준 주택·면적의 최근 12개월 실거래가 없습니다. 기준가·격차·자산 부족액은 계산하지 않습니다.");
    if (!messages.length) messages.push("최근 12개월 계약일 기준 · 해제 거래 제외 · 신고 지연으로 최근 거래가 아직 반영되지 않을 수 있습니다.");
  }
  $("notice").textContent = messages.join(" ");
  $("notice").className = "notice " + (demo ? "sample-notice" : messages.some(m => /실패|전입니다|없습니다|48시간/.test(m)) ? "warning" : "healthy");
  $("sourceStamp").textContent = "명부 확인 " + registry.checkedAt + (demo ? " · 샘플" : " · 최종 수집 " + stamp(official?.updatedAt));
}
function renderOverview(records) {
  const base = baseSummary(), latest = base.latest;
  const price = basePrice();
  $("baseName").textContent = currentBase()?.name || "기준 아파트 확인 필요";
  $("baseAreaLabel").textContent = "전용 " + baseAreaLabel();
  $("baseAge").textContent = currentBase() ? buildingAge(currentBase()) : "기준 아파트를 검색해 선택하세요.";
  $("basePurchase").hidden = personalMode();
  $("basePrice").innerHTML = money(price == null ? null : price / 10000) + "<small>억원" + (demo ? " · 샘플" : "") + "</small>";
  $("baseDetail").textContent = averageMode() ? "최근 10건 평균 · " + averageSample(base) + " · " + averagePeriod(base) :
    latest ? "최근 1건 · 계약 " + dateLabel(latest.date) + " · 전용 " + latest.area + "㎡ · " + latest.floor + "층" +
    (base.sameDateCount > 1 ? " · 같은 날 " + base.sameDateCount + "건" : "") : "최근 12개월 해당 전용면적 거래 없음";
  if (personalMode() && !averageMode() && $("metric").value !== "latest") $("baseDetail").textContent = $("metric").selectedOptions[0].textContent + " · " + ($("metric").value === "median3" ? base.count3 : base.count6) + "건 · " + baseAreaLabel();
  if (currentBaseId().startsWith("n-")) $("baseDetail").textContent += " · 지역 갱신 " + stamp(nationalStamps.get(currentBase()?.districtCode));
  const available = records.filter(r => r.price != null);
  $("summaryCount").innerHTML = available.length + "<small> / " + records.length + "개</small>";
  $("summaryCoverage").textContent = "현재 지역·면적·검색 조건 기준";
  const key = personalMode() ? "assetGap" : "gap";
  const closest = records.filter(r => r[key] != null).sort((a, b) => a[key] - b[key])[0];
  $("minGapLabel").textContent = personalMode() ? "내 집 + 현금 대비 최소 차액" : "가장 가까운 가격 격차";
  $("minGap").innerHTML = closest ? signed(closest[key]) + "<small>억</small>" : "—";
  $("minGapDetail").textContent = closest ? closest.c.name + " · 전용 " + area + "㎡급" : latest ? "비교 가능한 거래 없음" : "기준 실거래가가 필요합니다";
  renderBaseControls();
}
function renderBaseControls() {
  $("personalSettings").hidden = !personalMode();
  document.querySelectorAll("[data-tracker]").forEach(b => { const active = b.dataset.tracker === tracker.mode; b.classList.toggle("selected", active); b.setAttribute("aria-pressed", String(active)); });
  if (document.activeElement !== $("trackerCash")) $("trackerCash").value = tracker.cash == null ? "" : tracker.cash;
  const types = [...new Set(trades.filter(t => t.complexId === tracker.id).map(t => t.area))].sort((a, b) => a - b);
  const options = ["59", "74", "84"].map(a => '<option value="band' + a + '">' + a + '㎡급 전체 타입</option>');
  if (!tracker.area.startsWith("band") && !types.includes(Number(tracker.area))) types.push(Number(tracker.area));
  $("baseType").innerHTML = options.join("") + types.map(a => '<option value="' + a + '">정확한 전용 ' + a + '㎡' + (trades.some(t => t.complexId === tracker.id && t.area === a) ? "" : " · 거래 없음") + '</option>').join("");
  $("baseType").value = tracker.area;
  const budget = assetComparison(basePrice(), basePrice(), tracker.cash).available;
  $("trackerBudget").textContent = money(budget) + "억원";
  $("trackerFormula").textContent = baseLabel() + " " + money(basePrice() == null ? null : basePrice() / 10000) + "억 + 현금 " + money(tracker.cash) + "억 · 부채·세금 미차감";
  $("applyTracker").disabled = budget == null;
}
function renderBaseSearch() {
  const query = $("baseSearch").value.trim();
  if (!query) { $("baseSearchRows").innerHTML = ""; $("baseSearchStatus").textContent = "선택 기준: " + baseLabel() + " · 이름을 입력해 변경하세요."; return; }
  const matches = registry.complexes.filter(c => matchesComplex(c, query));
  $("baseSearchStatus").textContent = (nationalLoading ? "전국 명부 불러오는 중 · " : nationalIndex ? "전국 명부 · " : "기본 명부 · 전국 자료 연결 상태 확인 · ") + matches.length + "개 검색됨 · 앞 30개 표시";
  $("baseSearchRows").innerHTML = matches.slice(0, 30).map(c => '<div class="catalog-row"><div><b>' + escape(c.name) + '</b><small>' + escape(c.region + " · " + c.legalDong + " " + c.jibuns.join(", ")) + '</small></div><button type="button" class="outline-button" data-base="' + c.id + '"' + (c.comparisonEligible === false ? ' disabled' : '') + ' aria-label="' + escape(c.name) + ' 기준으로 선택">' + (c.comparisonEligible === false ? "국민임대" : c.id === tracker.id ? "선택됨" : "기준 선택") + '</button></div>').join("");
}
async function chooseBase(id) {
  const c = registry.complexes.find(c => c.id === id), request = ++baseRequest;
  if (!c || c.comparisonEligible === false) return;
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
function renderList() {
  const search = $("search").value;
  const candidates = registry.complexes.filter(c => isWatched(c) &&
    (region === "all" || c.region === region) && matchesComplex(c, search)).map(c => record(c));
  let records = candidates.filter(r => passesRatio(r.ratio, preferences.minimum));
  $("ratioNote").textContent = preferences.minimum ? "가격 배율 1.5배 미만 " + (candidates.length - records.length) + "개 숨김 · 배율을 계산할 거래가 없는 단지는 ‘거래 부족’으로 남깁니다." : "전체 배율 표시";
  records.sort((a, b) => {
    if ($("sort").value === "name") return a.c.name.localeCompare(b.c.name, "ko");
    if ($("sort").value === "date") return (b.stats.latest?.date ?? "").localeCompare(a.stats.latest?.date ?? "");
    return (a.gap ?? Infinity) - (b.gap ?? Infinity) || a.c.name.localeCompare(b.c.name, "ko");
  });
  renderOverview(records);
  const metric = $("metric").value, metricLabel = $("metric").selectedOptions[0].textContent;
  $("priceColumnLabel").textContent = metricLabel;
  $("priceBasis").textContent = personalMode() ? "선택한 기준 주택과 비교 주택 모두 같은 가격 지표로 비교합니다. 자산 차액 = 비교 주택 가격 − (기준 주택 가격 + 추가 현금). 부채·세금·거래비용 미차감이며, 1.5배 필터는 현금을 제외한 주택 가격 배율입니다." : averageMode() ?
    "기준 주택과 비교 단지 모두 최근 12개월 내 최신 10건의 산술평균입니다. 10건 미만이면 있는 거래만 평균하며, 두 단지의 거래 기간은 다를 수 있습니다." :
    "선택한 비교 가격을 기준 주택 59㎡급의 최근 거래 1건과 비교합니다.";
  const sameArea = currentBaseType() === "band" + area;
  $("areaNotice").innerHTML = (sameArea ? '' : '<span class="area-warning">면적이 다른 비교</span>') + '<span class="small">기준 ' + escape(baseAreaLabel()) + ' ↔ 비교 ' + area + '㎡급 · 실제 전용면적과 타입은 다를 수 있습니다.</span>';
  $("resultCount").innerHTML = "<b>" + records.length + "</b>개 관심 단지 <span class='muted'>· " + area + "㎡급" + (demo ? " · 샘플" : "") + "</span>";
  $("apartmentRows").innerHTML = records.map((r, index) => {
    const latest = r.stats.latest, low = (metric === "median3" ? r.stats.count3 < 3 : metric === "median6" ? r.stats.count6 < 3 : averageMode() ? r.stats.count10 < 3 : r.stats.count < 3) || (averageMode() && baseSummary().count10 < 3);
    const priceDetail = r.c.comparisonEligible === false ? "국민임대 · 매매 비교 제외" : averageMode() ? averageSample(r.stats) + " · " + averagePeriod(r.stats) :
      metric === "latest" ? (latest ? dateLabel(latest.date) + " · " + latest.area + "㎡" : "거래 부족 · 0건") :
      (metric === "median3" ? r.stats.count3 : r.stats.count6) + "건 · 최근 " + (metric === "median3" ? "3" : "6") + "개월";
    return '<tr class="' + (selected === r.c.id ? "selected-row" : "") + '" data-complex="' + r.c.id + '"><td class="name-cell"><span class="rank">' + String(index + 1).padStart(2, "0") +
      '</span><div><button type="button" class="complex-button" data-select="' + r.c.id + '">' + escape(r.c.name) + '</button><small>' + escape(r.c.region) + " · " + householdLabel(r.c) + (r.c.comparisonEligible === false ? ' · 국민임대' : '') + '</small><small class="building-age">' + escape(buildingAge(r.c)) + '</small><button type="button" class="watch-remove" data-watch="' + r.c.id + '" aria-label="' + escape(r.c.name) + ' 관심 제거">관심 제거</button></div></td>' +
      '<td data-label="' + escape(metricLabel) + '"><span class="cell-price">' + money(r.price == null ? null : r.price / 10000) + '</span><small class="' + (low ? "low-sample" : "muted") + '">' + priceDetail + "</small></td>" +
      '<td data-label="3개월 중앙값">' + medianCell(r.stats.median3, r.stats.count3) + '</td><td data-label="6개월 중앙값">' + medianCell(r.stats.median6, r.stats.count6) + "</td>" +
      '<td data-label="주택 가격 차이" class="gap-cell"><b>' + signed(r.gap) + '</b><small>' + (r.c.comparisonEligible === false ? "매매 비교 제외" : r.price == null ? "거래 부족" : low ? "거래 부족 · 표본 유의" : "기준 " + escape(baseAreaLabel()) + " 실거래 대비") + '</small></td><td data-label="가격 배율"><b>' +
      (r.ratio == null ? "—" : r.ratio.toFixed(2) + "배") + '</b></td><td class="asset-cell" data-label="내 집 + 현금 대비 차액"' + (personalMode() ? '' : ' hidden') + '><b>' + signed(r.assetGap) + '</b><small>' + (r.assetGap == null ? "기준가·현금 또는 비교 거래 확인 필요" : r.assetGap > 0 ? "추가 필요 · 부채·세금 별도" : r.assetGap < 0 ? "여유 금액 · 부채·세금 별도" : "입력 자산과 같음 · 비용 별도") + '</small></td><td class="row-arrow"><a href="#detail" data-detail="' + r.c.id + '" aria-label="' + escape(r.c.name) + ' 상세 그래프">↗</a></td></tr>';
  }).join("");
  $("noResults").hidden = records.length > 0;
  $("assetColumnLabel").hidden = !personalMode();
  renderManager();
}
function householdLabel(c) { return c.households == null ? "세대수 확인 필요" : c.households.toLocaleString() + "세대" + (c.minimumHouseholdsException ? " · 요청 예외" : ""); }
function renderManager() {
  const matches = registry.complexes.filter(c => c.id !== currentBaseId() && matchesComplex(c, $("catalogSearch").value));
  const shown = matches.slice(0, 60);
  $("catalogCount").textContent = matches.length + "개 검색됨" + (matches.length > shown.length ? " · 앞 60개 표시, 지역·단지명을 더 입력하세요." : "");
  $("catalogRows").innerHTML = shown.map(c => '<div class="catalog-row"><div><b>' + escape(c.name) + '</b><small>' + escape(c.region + " · " + c.legalDong + " " + c.jibuns.join(", ") + " · " + householdLabel(c)) + '</small><small>' + escape(buildingAge(c)) + '</small></div><button type="button" class="outline-button" data-watch="' + c.id + '" aria-label="' + escape(c.name) + (isWatched(c) ? ' 관심 제거' : ' 관심 추가') + '">' + (isWatched(c) ? "제거" : "+ 추가") + '</button></div>').join("") || '<p class="empty">검색 결과가 없습니다. 지역·단지명을 확인하세요.</p>';
}
function targetOptions() {
  const choices = registry.complexes.filter(isWatched);
  if (!choices.some(c => c.id === selected)) { selected = choices.find(c => c.comparisonEligible !== false)?.id || choices[0]?.id || null; exact = "all"; targetAuto = true; }
  $("targetComplex").innerHTML = choices.map(c => '<option value="' + c.id + '"' + (c.comparisonEligible === false ? ' disabled' : '') + '>' + escape(c.region + " · " + c.name + (c.comparisonEligible === false ? " · 국민임대(매매 제외)" : "")) + '</option>').join("") || '<option value="">관심 단지를 추가하세요</option>';
  $("targetComplex").disabled = !choices.length;
}
async function loadNational() {
  if (nationalIndex) return;
  if (nationalLoading) return nationalLoading;
  nationalLoading = (async () => {
    $("catalogSource").textContent = "전국 검색 명부를 불러오는 중…";
    try {
      const index = await getJSON("./data/nationwide/index.json");
      if (index.schemaVersion !== 1 || !Array.isArray(index.complexes)) throw new Error();
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
  if (!c || c.id === currentBaseId()) return;
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
function renderChart(container, series, keys, title) {
  const points = series.flatMap(p => keys.map(k => p[k])).filter(n => n != null);
  if (!points.length) { $(container).innerHTML = '<div class="chart-empty"><span>⌁</span>거래 부족<p>' + (container === "gapChart" ? "같은 월에 두 단지의 거래가 있어야 표시됩니다." : "선택한 전용면적의 거래를 기다리고 있습니다.") + "</p></div>"; return; }
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
      body += '<circle tabindex="0" cx="' + x(i) + '" cy="' + y(p[key]) + '" r="4" class="point-' + key + '"><title>' + escape(p.month + " · " + (key === "base" ? "기준 주택" : key === "gap" ? "격차" : "선택 단지") + " " + money(p[key]) + "억 · " + n + "건" + (n < 3 ? " · 거래 부족" : "")) + "</title></circle>";
    });
  });
  $(container).innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + escape(title) + '"><title>' + escape(title) + '</title>' + body + "</svg>";
}
function syncPrices() {
  if (!registry) return;
  if (!selectedComplex()) {
    $("targetPrice").value = ""; $("targetPrice").disabled = true; $("resetTarget").disabled = true;
    $("targetHint").textContent = "검색에서 관심 단지를 추가하세요.";
    return;
  }
  const eligible = selectedComplex().comparisonEligible !== false;
  const base = basePrice();
  if (saleAuto) $("sale").value = base == null ? "" : (base / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const value = record(selectedComplex(), exact).price;
  if (targetAuto || !eligible) $("targetPrice").value = value == null ? "" : (value / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  $("targetPrice").disabled = !eligible;
  $("resetTarget").disabled = !eligible;
  $("saleHint").textContent = saleAuto ? baseLabel() + " · " + (personalMode() ? $("metric").selectedOptions[0].textContent : averageMode() ? "최근 10건 평균" : "최근 1건") + " 연동 중 · 미래 예상 매도가는 직접 수정할 수 있습니다." : "직접 입력한 예상 매도가 · 실거래 비교 기준에는 영향을 주지 않습니다.";
  $("targetHint").textContent = !eligible ? "국민임대 단지로 매매 가격과 매수 자금 계산을 제공하지 않습니다. 다른 매매 단지를 선택하세요." : (demo ? "[샘플] " : "") + selectedComplex().name + " · " + (exact === "all" ? area + "㎡급" : exact + "㎡") + " · " +
    $("metric").selectedOptions[0].textContent + (targetAuto ? " 연동" : "을 참고한 직접 입력 시나리오") +
    (value == null ? " · 거래 부족: 목표 매수가를 직접 입력하면 계산할 수 있습니다." : " · 미래 가격 예측이 아닙니다.");
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
  const eligible = c.comparisonEligible !== false;
  $("useTarget").disabled = !eligible;
  $("selectedName").textContent = c.name;
  $("selectedRegion").textContent = c.region + (demo ? " · 샘플" : "");
  $("selectedAge").textContent = buildingAge(c);
  $("selectedAddress").textContent = c.legalDong + " " + c.jibuns.join(", ") + " · " + householdLabel(c) + " · " +
    (exact === "all" ? area + "㎡급의 타입을 함께 집계" : "정확한 전용 " + exact + "㎡만 집계") + (c.displayNote ? " · " + c.displayNote : "");
  $("selectedMetrics").innerHTML = [
    [$("metric").selectedOptions[0].textContent, !eligible ? "매매 비교 제외" : r.price == null ? "거래 부족" : money(r.price / 10000) + "억"],
    [personalMode() ? "내 집 + 현금 대비 차액" : "주택 가격 차이", signed(personalMode() ? r.assetGap : r.gap) + ((personalMode() ? r.assetGap : r.gap) == null ? "" : "억")],
    [averageMode() ? "평균에 사용한 거래" : "3개월 / 6개월 거래", averageMode() ? r.stats.count10 + " / 10건" : r.stats.count3 + "건 / " + r.stats.count6 + "건"],
    ["실제 전용면적", r.stats.areas.length ? r.stats.areas.join(" / ") + "㎡" : "해당 면적 거래 없음"]
  ].map(([label, value]) => "<div><span>" + label + "</span><b>" + escape(value) + "</b></div>").join("");
  $("selectedPriceDetail").textContent = !eligible ? "국민임대 · 매매 비교 제외. 임대료나 인근 단지 가격을 매매 가격으로 대체하지 않습니다." : averageMode() ? averageSample(r.stats) + " · " + averagePeriod(r.stats) +
    " · 선택한 전용면적의 실제 거래만 사용합니다. 아래 그래프는 월별 중앙값입니다." : "아래 그래프는 선택한 비교 가격과 별도로 월별 중앙값을 표시합니다.";
  if (c.id.startsWith("n-")) $("selectedPriceDetail").textContent += " · 해당 지역 거래 갱신 " + stamp(nationalStamps.get(c.districtCode));
  if (personalMode()) $("selectedPriceDetail").textContent += " · 주택끼리 가격 차이 " + signed(r.gap) + "억 / 자산 차액 " + signed(r.assetGap) + "억. 양수는 부족, 음수는 여유이며 부채·세금·비용은 별도입니다.";
  const ts = eligible ? forArea(trades, c.id, area, exact) : [], series = monthSeries(ts, baseTrades, asOf());
  renderChart("priceChart", series, ["price", "base"], "월별 실거래 중앙값. 빈 월은 연결하지 않습니다.");
  renderChart("gapChart", series, ["gap"], "같은 계약월의 선택 단지 중앙값과 " + baseLabel() + " 중앙값의 차이. 현재 현금은 과거 그래프에 반영하지 않습니다.");
  $("chartBaseLabel").textContent = baseLabel();
  $("gapChartNote").textContent = "주택 가격 차이 추세 · " + baseLabel() + " 대비 · 현재 보유 현금은 과거에 소급하지 않습니다.";
  if (!eligible) for (const id of ["priceChart", "gapChart"]) $(id).innerHTML = '<div class="chart-empty">국민임대<p>매매 비교 대상이 아닙니다.</p></div>';
  $("monthlyRows").innerHTML = series.map(p => "<tr><td>" + p.month + "</td><td>" + money(p.price) + "</td><td>" + p.count + (p.count < 3 ? " · 거래 부족" : "") + "</td><td>" + money(p.base) + "</td><td>" + p.baseCount + (p.baseCount < 3 ? " · 거래 부족" : "") + "</td><td>" + signed(p.gap) + "</td></tr>").join("");
  $("recentTrades").innerHTML = ts.length ? '<div class="ledger-list">' + ts.slice(0, 10).map(t => '<div><time>' + dateLabel(t.date) + '</time><span>' + t.area + "㎡ · " + escape(t.floor) + '층</span><b>' + money(t.priceManwon / 10000) + '억</b><small>' + escape(t.dealingType || "거래유형 미제공") + (demo ? " · 샘플" : "") + "</small></div>").join("") + "</div>" +
    (r.stats.sameDateCount > 1 ? '<p class="field-help">최신 계약일에 ' + r.stats.sameDateCount + "건이 있습니다. 최근 1건은 거래 ID 순으로 선택하며 당일 거래 내역도 함께 확인하세요.</p>" : "") : '<p class="empty">' + (eligible ? '거래 부족 · 해당 전용면적의 최근 12개월 거래가 없습니다.' : '국민임대 단지입니다. 매매 가격을 제공하지 않습니다.') + '</p>';
  $("complexSource").href = c.sources[0].url;
  $("complexSource").textContent = "단지 정보 확인 ↗ · " + c.checkedAt;
  $("targetComplex").value = selected;
  syncPrices();
  renderCalculation();
}
function renderCalculation() {
  $("planTarget").textContent = selectedComplex()?.name || "2033년의 다음 집";
  $("planSubtitle").textContent = $("targetMonth").value + " 매수 가정 · " + (exact === "all" ? area + "㎡급" : exact + "㎡") + (demo ? " · 샘플 가격" : "");
  const resultIds = ["shortage", "netSale", "assetResult", "savingsResult", "equityResult", "loanResult", "availableResult", "costResult"];
  try {
    if (!selectedComplex()) throw new Error("검색에서 관심 단지를 추가하세요.");
    if (selectedComplex().comparisonEligible === false) throw new Error("국민임대 단지는 매수 자금 계산 대상이 아닙니다. 다른 매매 단지를 선택하세요.");
    for (const id of ids) {
      if ($(id).value === "") throw new Error(id === "sale" ? "현재 주택 예상 매도가를 입력하세요." : id === "targetPrice" ? "거래 부족 · 목표 매수가를 직접 입력하세요." : "비어 있는 입력값을 확인하세요.");
    }
    const input = Object.fromEntries(ids.map(id => [id, id === "targetMonth" ? $(id).value : Number($(id).value)]));
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
  baseTrades = referenceTrades(trades, currentBaseId(), currentBaseType());
  renderList(); renderDetail(true); notice();
}
function choose(id, scroll = false) {
  selected = id; exact = "all"; targetAuto = true;
  renderList(); renderDetail(true);
  if (scroll) $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}
function setupRegistry() {
  $("regions").innerHTML = ["all", ...new Set(registry.complexes.filter(c => c.id !== registry.baseId).map(c => c.region))].map(r =>
    '<button type="button" data-region="' + r + '" aria-pressed="' + (r === region) + '" class="' + (r === region ? "selected" : "") + '">' + (r === "all" ? "전체 지역" : r) + "</button>").join("");
  targetOptions();
  $("registryNote").textContent = registry.notes.join(" ") + " 확인일 " + registry.checkedAt + ". 비교 후보 " + (registry.complexes.length - 1) + "개.";
  $("registryAudit").innerHTML = '<div class="audit-list">' + registry.complexes.map(c => '<div><b>' + escape(c.name) + '</b><span>' + escape(c.legalDong + " " + c.jibuns.join(", ") + " · 법정동 " + c.legalDongCode + " · " + c.households + "세대") + '</span>' +
    (c.note ? "<small>" + escape(c.note) + "</small>" : "") + '<a target="_blank" rel="noopener" href="' + escape(c.sources[0].url) + '">확인 출처 ↗</a></div>').join("") + "</div><h4>500세대 미만으로 제외한 구분 단지</h4>" +
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
  renderList(); renderDetail(true);
}));
$("regions").addEventListener("click", e => {
  const button = e.target.closest("[data-region]"); if (!button) return;
  region = button.dataset.region;
  $("regions").querySelectorAll("button").forEach(b => { b.classList.toggle("selected", b === button); b.setAttribute("aria-pressed", String(b === button)); });
  renderList();
});
$("apartmentRows").addEventListener("click", e => {
  const watch = e.target.closest("[data-watch]");
  if (watch) { toggleWatch(watch.dataset.watch); return; }
  const button = e.target.closest("[data-select], [data-detail]");
  if (button) { e.preventDefault(); choose(button.dataset.select || button.dataset.detail, true); return; }
  const row = e.target.closest("[data-complex]"); if (row) choose(row.dataset.complex);
});
$("search").addEventListener("input", renderList);
document.querySelectorAll("[data-tracker]").forEach(button => button.addEventListener("click", () => {
  ++baseRequest; tracker.mode = button.dataset.tracker; targetAuto = true;
  saveTracker(); targetOptions(); activateData();
  if (personalMode() && tracker.id.startsWith("n-")) loadNational().then(async () => {
    const c = currentBase();
    if (personalMode() && c?.id.startsWith("n-")) { await loadNationalDistrict(c.districtCode); activateData(); }
  }).catch(() => { $("trackerState").textContent = "기준 거래를 불러오지 못했습니다. 기준 아파트를 다시 선택하세요."; });
}));
$("baseSearch").addEventListener("input", () => { renderBaseSearch(); if ($("baseSearch").value.trim()) loadNational().then(renderBaseSearch); });
$("baseSearchRows").addEventListener("click", e => { const button = e.target.closest("[data-base]"); if (button) chooseBase(button.dataset.base); });
$("baseType").addEventListener("change", () => { tracker.area = $("baseType").value; targetAuto = true; saveTracker(); activateData(); });
$("trackerCash").addEventListener("input", () => { tracker.cash = $("trackerCash").value === "" ? null : Number($("trackerCash").value); saveTracker(); renderList(); renderDetail(); });
$("applyTracker").addEventListener("click", () => {
  if (!personalMode() || assetComparison(basePrice(), basePrice(), tracker.cash).available == null) return;
  $("assets").value = tracker.cash; saleAuto = true; syncPrices(); renderCalculation(); save();
  $("trackerState").textContent = "선택한 기준가와 현금을 자금 계획에 반영했습니다. 현금은 금융자산 항목에 한 번만 포함되며, 기존 대출·세금 입력은 유지합니다.";
  $("calculator").scrollIntoView({behavior:"smooth"});
});
$("catalogSearch").addEventListener("input", renderManager);
$("watchManager").addEventListener("toggle", () => { if ($("watchManager").open) { renderManager(); loadNational(); } });
$("catalogRows").addEventListener("click", e => { const button = e.target.closest("[data-watch]"); if (button) toggleWatch(button.dataset.watch); });
$("minimumRatio").addEventListener("change", () => { preferences.minimum = Number($("minimumRatio").value); saveWatch(); renderList(); });
$("sort").addEventListener("change", renderList);
$("metric").addEventListener("change", () => { targetAuto = true; renderList(); renderDetail(); });
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
  for (const id of ids) $(id).value = id === "targetMonth" ? (today.slice(0, 7) > "2033-12" ? today.slice(0, 7) : "2033-12") : "0";
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
      $("trackerState").textContent = "공식 모드의 기준 주택과 현금으로 복원했습니다.";
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
    $("minimumRatio").value = String(preferences.minimum);
    setupRegistry();
    $("trackerState").textContent = personalMode() ? "저장된 내 집·현금 기준을 불러왔습니다." : "동천센트럴자이 59㎡급 기준으로 비교합니다.";
    controls.forEach(control => { control.disabled = false; });
    await loadOfficial();
    if (preferences.added.length || (personalMode() && tracker.id.startsWith("n-"))) await loadNational();
  } catch {
    $("notice").textContent = "단지 명부를 불러오지 못했습니다. README의 HTTP 서버 실행 방법과 배포 경로를 확인하세요.";
    controls.forEach(control => { control.disabled = true; });
  }
}
init();

