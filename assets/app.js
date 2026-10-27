import { areaClass, calculate, comparison, forArea, koreaToday, monthSeries, priceFor, referencePrice, summary, validTrades } from "./core.js?v=average10";

const $ = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
const money = n => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
const dateLabel = iso => iso ? iso.replaceAll("-", ".") : "거래 없음";
const stamp = iso => iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "갱신 전";
const ids = ["sale", "mortgage", "family", "assets", "monthly", "bonus", "targetMonth", "newLoan", "tax", "fees", "targetPrice"];
const controls = [...document.querySelectorAll("button, input, select")];
controls.forEach(control => { control.disabled = true; });
let registry, official = null, status = null, demo = false, payload = null, trades = [], baseTrades = [];
let area = "84", region = "all", selected = "gracium", exact = "all", saleAuto = true, targetAuto = true, loadError = "";
let officialPlanSnapshot = null;
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
function basePrice() { return referencePrice(baseSummary(), $("metric").value); }
function averageMode() { return $("metric").value === "average10"; }
function averageSample(stats) {
  return stats.count10 < 3 ? "거래 부족 · " + stats.count10 + "/10건" :
    stats.count10 < 10 ? "10건 미만 · " + stats.count10 + "건 평균" : "10건 평균";
}
function averagePeriod(stats) {
  return stats.count10 ? dateLabel(stats.start10) + " ~ " + dateLabel(stats.end10) : "해당 면적 거래 없음";
}
function selectedComplex() { return registry.complexes.find(c => c.id === selected); }
function getSummary(c, exactType = "all") { return summary(forArea(trades, c.id, area, exactType), asOf()); }
function record(c, exactType = "all") {
  const stats = getSummary(c, exactType);
  const price = priceFor(stats, $("metric").value);
  return { c, stats, price, ...comparison(price, basePrice()) };
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
    if (!baseSummary().latest) messages.push("최근 12개월의 기준 주택 59㎡급 실거래가 없습니다. 기준가·격차·배율은 계산하지 않습니다.");
    if (!messages.length) messages.push("최근 12개월 계약일 기준 · 해제 거래 제외 · 신고 지연으로 최근 거래가 아직 반영되지 않을 수 있습니다.");
  }
  $("notice").textContent = messages.join(" ");
  $("notice").className = "notice " + (demo ? "sample-notice" : messages.some(m => /실패|전입니다|없습니다|48시간/.test(m)) ? "warning" : "healthy");
  $("sourceStamp").textContent = "명부 확인 " + registry.checkedAt + (demo ? " · 샘플" : " · 최종 수집 " + stamp(official?.updatedAt));
}
function renderOverview(records) {
  const base = baseSummary(), latest = base.latest;
  const price = basePrice();
  $("basePrice").innerHTML = money(price == null ? null : price / 10000) + "<small>억원" + (demo ? " · 샘플" : "") + "</small>";
  $("baseDetail").textContent = averageMode() ? "최근 10건 평균 · " + averageSample(base) + " · " + averagePeriod(base) :
    latest ? "최근 1건 · 계약 " + dateLabel(latest.date) + " · 전용 " + latest.area + "㎡ · " + latest.floor + "층" +
    (base.sameDateCount > 1 ? " · 같은 날 " + base.sameDateCount + "건" : "") : "최근 12개월 59㎡급 거래 없음";
  const available = records.filter(r => r.price != null);
  $("summaryCount").innerHTML = available.length + "<small> / " + records.length + "개</small>";
  $("summaryCoverage").textContent = "현재 지역·면적·검색 조건 기준";
  const closest = records.filter(r => r.gap != null).sort((a, b) => a.gap - b.gap)[0];
  $("minGap").innerHTML = closest ? signed(closest.gap) + "<small>억</small>" : "—";
  $("minGapDetail").textContent = closest ? closest.c.name + " · 전용 " + area + "㎡급" : latest ? "비교 가능한 거래 없음" : "기준 실거래가가 필요합니다";
}
function medianCell(price, n) {
  return '<span class="cell-price">' + money(price == null ? null : price / 10000) + '</span><small class="' + (n < 3 ? "low-sample" : "muted") + '">' +
    (n < 3 ? "거래 부족 · " + n + "건" : n + "건") + "</small>";
}
function renderList() {
  const search = $("search").value.trim().toLowerCase();
  let records = registry.complexes.filter(c => c.id !== registry.baseId &&
    (region === "all" || c.region === region) && (c.name + c.legalDong).toLowerCase().includes(search)).map(c => record(c));
  records.sort((a, b) => {
    if ($("sort").value === "name") return a.c.name.localeCompare(b.c.name, "ko");
    if ($("sort").value === "date") return (b.stats.latest?.date ?? "").localeCompare(a.stats.latest?.date ?? "");
    return (a.gap ?? Infinity) - (b.gap ?? Infinity) || a.c.name.localeCompare(b.c.name, "ko");
  });
  renderOverview(records);
  const metric = $("metric").value, metricLabel = $("metric").selectedOptions[0].textContent;
  $("priceColumnLabel").textContent = metricLabel;
  $("priceBasis").textContent = averageMode() ?
    "기준 주택과 비교 단지 모두 최근 12개월 내 최신 10건의 산술평균입니다. 10건 미만이면 있는 거래만 평균하며, 두 단지의 거래 기간은 다를 수 있습니다." :
    "선택한 비교 가격을 기준 주택 59㎡급의 최근 거래 1건과 비교합니다.";
  $("areaNotice").innerHTML = area === "59" ? '<span class="small">기준 59㎡급 ↔ 비교 59㎡급 · 같은 면적급 안에서도 실제 전용면적과 타입은 다를 수 있습니다.</span>' :
    '<span class="area-warning">면적이 다른 비교</span><span class="small">기준 59㎡급 ↔ 비교 ' + area + '㎡급 · 면적 증가분이 가격 격차에 포함됩니다.</span>';
  $("resultCount").innerHTML = "<b>" + records.length + "</b>개 관심 단지 <span class='muted'>· " + area + "㎡급" + (demo ? " · 샘플" : "") + "</span>";
  $("apartmentRows").innerHTML = records.map((r, index) => {
    const latest = r.stats.latest, low = (metric === "median3" ? r.stats.count3 < 3 : metric === "median6" ? r.stats.count6 < 3 : averageMode() ? r.stats.count10 < 3 : r.stats.count < 3) || (averageMode() && baseSummary().count10 < 3);
    const priceDetail = averageMode() ? averageSample(r.stats) + " · " + averagePeriod(r.stats) :
      metric === "latest" ? (latest ? dateLabel(latest.date) + " · " + latest.area + "㎡" : "거래 부족 · 0건") :
      (metric === "median3" ? r.stats.count3 : r.stats.count6) + "건 · 최근 " + (metric === "median3" ? "3" : "6") + "개월";
    return '<tr class="' + (selected === r.c.id ? "selected-row" : "") + '" data-complex="' + r.c.id + '"><td class="name-cell"><span class="rank">' + String(index + 1).padStart(2, "0") +
      '</span><div><button type="button" class="complex-button" data-select="' + r.c.id + '">' + escape(r.c.name) + '</button><small>' + escape(r.c.region) + " · " + r.c.households.toLocaleString() + '세대</small></div></td>' +
      '<td data-label="' + escape(metricLabel) + '"><span class="cell-price">' + money(r.price == null ? null : r.price / 10000) + '</span><small class="' + (low ? "low-sample" : "muted") + '">' + priceDetail + "</small></td>" +
      '<td data-label="3개월 중앙값">' + medianCell(r.stats.median3, r.stats.count3) + '</td><td data-label="6개월 중앙값">' + medianCell(r.stats.median6, r.stats.count6) + "</td>" +
      '<td data-label="기준 대비 격차" class="gap-cell"><b>' + signed(r.gap) + '</b><small>' + (r.price == null ? "거래 부족" : low ? "거래 부족 · 표본 유의" : averageMode() ? "기준 59㎡급 평균 대비" : "기준 최신 59㎡급 대비") + '</small></td><td data-label="가격 배율"><b>' +
      (r.ratio == null ? "—" : r.ratio.toFixed(2) + "배") + '</b></td><td class="row-arrow"><a href="#detail" data-detail="' + r.c.id + '" aria-label="' + escape(r.c.name) + ' 상세 그래프">↗</a></td></tr>';
  }).join("");
  $("noResults").hidden = records.length > 0;
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
  const base = basePrice();
  if (saleAuto) $("sale").value = base == null ? "" : (base / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const value = record(selectedComplex(), exact).price;
  if (targetAuto) $("targetPrice").value = value == null ? "" : (value / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  $("saleHint").textContent = saleAuto ? (averageMode() ? "기준 주택 최근 10건 평균" : "기준 주택 최근 1건") + " 연동 중 · 미래 예상 매도가는 직접 수정할 수 있습니다." : "직접 입력한 예상 매도가 · 실거래 비교 기준에는 영향을 주지 않습니다.";
  $("targetHint").textContent = (demo ? "[샘플] " : "") + selectedComplex().name + " · " + (exact === "all" ? area + "㎡급" : exact + "㎡") + " · " +
    $("metric").selectedOptions[0].textContent + (targetAuto ? " 연동" : "을 참고한 직접 입력 시나리오") +
    (value == null ? " · 거래 부족: 목표 매수가를 직접 입력하면 계산할 수 있습니다." : " · 미래 가격 예측이 아닙니다.");
}
function renderDetail(resetTypes = false) {
  const c = selectedComplex();
  if (!c) return;
  if (resetTypes) {
    const types = getSummary(c).areas;
    $("exactArea").innerHTML = '<option value="all">선택 면적급 전체 타입</option>' + types.map(a => '<option value="' + a + '">' + a + "㎡</option>").join("");
    if (!types.some(a => String(a) === exact)) exact = "all";
    $("exactArea").value = exact;
  }
  const r = record(c, exact);
  $("selectedName").textContent = c.name;
  $("selectedRegion").textContent = c.region + (demo ? " · 샘플" : "");
  $("selectedAddress").textContent = c.legalDong + " " + c.jibuns.join(", ") + " · " + c.households.toLocaleString() + "세대 · " +
    (exact === "all" ? area + "㎡급의 타입을 함께 집계" : "정확한 전용 " + exact + "㎡만 집계");
  $("selectedMetrics").innerHTML = [
    [$("metric").selectedOptions[0].textContent, r.price == null ? "거래 부족" : money(r.price / 10000) + "억"],
    ["기준 대비 격차", signed(r.gap) + (r.gap == null ? "" : "억")],
    [averageMode() ? "평균에 사용한 거래" : "3개월 / 6개월 거래", averageMode() ? r.stats.count10 + " / 10건" : r.stats.count3 + "건 / " + r.stats.count6 + "건"],
    ["실제 전용면적", r.stats.areas.length ? r.stats.areas.join(" / ") + "㎡" : "해당 면적 거래 없음"]
  ].map(([label, value]) => "<div><span>" + label + "</span><b>" + escape(value) + "</b></div>").join("");
  $("selectedPriceDetail").textContent = averageMode() ? averageSample(r.stats) + " · " + averagePeriod(r.stats) +
    " · 선택한 전용면적의 실제 거래만 사용합니다. 아래 그래프는 월별 중앙값입니다." : "아래 그래프는 선택한 비교 가격과 별도로 월별 중앙값을 표시합니다.";
  const ts = forArea(trades, c.id, area, exact), series = monthSeries(ts, baseTrades, asOf());
  renderChart("priceChart", series, ["price", "base"], "월별 실거래 중앙값. 빈 월은 연결하지 않습니다.");
  renderChart("gapChart", series, ["gap"], "같은 계약월의 선택 단지 중앙값과 동천센트럴자이 59㎡급 중앙값의 차이");
  $("monthlyRows").innerHTML = series.map(p => "<tr><td>" + p.month + "</td><td>" + money(p.price) + "</td><td>" + p.count + (p.count < 3 ? " · 거래 부족" : "") + "</td><td>" + money(p.base) + "</td><td>" + p.baseCount + (p.baseCount < 3 ? " · 거래 부족" : "") + "</td><td>" + signed(p.gap) + "</td></tr>").join("");
  $("recentTrades").innerHTML = ts.length ? '<div class="ledger-list">' + ts.slice(0, 10).map(t => '<div><time>' + dateLabel(t.date) + '</time><span>' + t.area + "㎡ · " + escape(t.floor) + '층</span><b>' + money(t.priceManwon / 10000) + '억</b><small>' + escape(t.dealingType || "거래유형 미제공") + (demo ? " · 샘플" : "") + "</small></div>").join("") + "</div>" +
    (r.stats.sameDateCount > 1 ? '<p class="field-help">최신 계약일에 ' + r.stats.sameDateCount + "건이 있습니다. 최근 1건은 거래 ID 순으로 선택하며 당일 거래 내역도 함께 확인하세요.</p>" : "") : '<p class="empty">거래 부족 · 해당 전용면적의 최근 12개월 거래가 없습니다.</p>';
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
    $("savingMonths").textContent = "오늘부터 " + r.months + "개월 저축 + 성과급 " + r.bonusCount + "회. 월 저축은 다음 달부터, 성과급은 12개월을 채울 때마다 1회 적립하는 가정입니다.";
    $("calcError").textContent = "";
  } catch (e) {
    for (const id of resultIds) $(id).textContent = "—";
    $("surplus").textContent = "";
    $("savingMonths").textContent = "";
    $("calcError").textContent = e.message;
  }
}
function activateData() {
  trades = validTrades(payload?.trades || [], asOf());
  baseTrades = forArea(trades, registry.baseId, "59");
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
  $("targetComplex").innerHTML = registry.complexes.filter(c => c.id !== registry.baseId).map(c => '<option value="' + c.id + '">' + escape(c.region + " · " + c.name) + "</option>").join("");
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
  const button = e.target.closest("[data-select], [data-detail]");
  if (button) { e.preventDefault(); choose(button.dataset.select || button.dataset.detail, true); return; }
  const row = e.target.closest("[data-complex]"); if (row) choose(row.dataset.complex);
});
$("search").addEventListener("input", renderList);
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
  $("demoToggle").disabled = true;
  try {
    if (demo) {
      demo = false; payload = official;
      if (officialPlanSnapshot) {
        for (const [id, value] of Object.entries(officialPlanSnapshot.values)) $(id).value = value;
        saleAuto = officialPlanSnapshot.saleAuto;
      }
      $("saveState").textContent = "공식 모드의 기존 입력값으로 복원됨";
    } else {
      const sample = checkPayload(await getJSON("./data/sample.json"), "sample");
      officialPlanSnapshot = { values: Object.fromEntries(ids.filter(id => id !== "targetPrice").map(id => [id, $(id).value])), saleAuto };
      payload = sample; demo = true;
      $("saveState").textContent = "샘플 입력값은 저장하지 않습니다.";
    }
    targetAuto = true; activateData();
  } catch { $("notice").textContent = "샘플 파일을 불러오지 못했습니다. 배포 파일과 연결 상태를 확인하세요."; }
  finally { $("demoToggle").disabled = false; }
});
async function init() {
  try {
    registry = await getJSON("./data/complexes.json");
    if (!Array.isArray(registry.complexes) || !registry.complexes.some(c => c.id === registry.baseId)) throw new Error();
    setupRegistry();
    controls.forEach(control => { control.disabled = false; });
    await loadOfficial();
  } catch {
    $("notice").textContent = "단지 명부를 불러오지 못했습니다. README의 HTTP 서버 실행 방법과 배포 경로를 확인하세요.";
    controls.forEach(control => { control.disabled = true; });
  }
}
init();

