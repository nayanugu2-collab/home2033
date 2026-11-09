import { checkNeighborhoodPayload, koreaToday, neighborhoodSeries } from "./core.js?v=neighborhood-trends";

export function initNeighborhood({ getJSON, renderChart }) {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
  const money = n => n == null ? "—" : n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const stamp = iso => iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "확인 필요";
  let district = "41135", dong = "4113511000", period = 12, source = null, mode = null;
  let current = null, series = [], request = 0, initialized = false;
  const cache = new Map();

  function empty(message) {
    $("neighborhoodChart").innerHTML = '<div class="chart-empty">' + escape(message) + '</div>';
    $("neighborhoodMetrics").textContent = "";
    $("neighborhoodRows").innerHTML = "";
    $("neighborhoodPoint").textContent = "";
    $("neighborhoodTitle").textContent = "동네별 실거래 중앙값";
    $("neighborhoodRange").textContent = "";
  }
  function showPoint(index) {
    const p = series[index];
    if (!p) return;
    $("neighborhoodPoint").textContent = p.month + " · " + (p.price == null ? "거래 없음" : money(p.price) + "억원 · " + p.count + "건 / " + p.complexCount + "개 단지" + (p.count < 3 ? " · 거래 부족" : "")) + (p.partial ? " · 이번 달 집계 중" : "");
  }
  function render() {
    if (!current) return;
    const c = current.complexes.find(c => c.legalDongCode === dong);
    const day = mode ? source.payload.asOf : koreaToday();
    series = neighborhoodSeries(current.trades, current.complexes, dong, $("neighborhoodArea").value, day, period);
    $("neighborhoodTitle").textContent = (mode ? "[샘플] " : "") + (c?.legalDong || "선택 동네") + " · 전용 " + $("neighborhoodArea").value + "㎡급";
    $("neighborhoodRange").textContent = series[0].month + " – " + series.at(-1).month + " · " + period + "개 계약월 (이번 달 포함)";
    renderChart("neighborhoodChart", series, ["price"], "선택 동네 월별 실거래 중앙값 · 억원. 거래 없는 월은 연결하지 않습니다.", { price: c?.legalDong || "동네" });
    const available = series.filter(p => p.price != null), latest = available.at(-1);
    const count = series.reduce((sum, p) => sum + p.count, 0);
    $("neighborhoodMetrics").innerHTML = '<div><span>최근 거래월 중앙값</span><b>' + money(latest?.price) + '<small> 억원</small></b><small>' + (latest ? latest.month + " · " + latest.count + "건" + (latest.count < 3 ? " · 거래 부족" : "") : "거래 부족") + '</small></div><div><span>선택 기간 거래</span><b>' + count.toLocaleString("ko-KR") + '<small> 건</small></b><small>거래가 있는 달 ' + available.length + '/' + period + '개월</small></div>';
    $("neighborhoodRows").innerHTML = series.map((p, i) => '<tr><td><button class="link-button" type="button" data-month="' + i + '">' + p.month + '</button>' + (p.partial ? '<small> 집계 중</small>' : '') + '</td><td>' + money(p.price) + '</td><td>' + p.count + (p.count < 3 ? ' · 거래 부족' : '') + '</td><td>' + p.complexCount + '</td></tr>').join("");
    showPoint(latest ? series.indexOf(latest) : series.length - 1);
    $("neighborhoodSource").textContent = mode ? "샘플 가상 거래 · 실제 동네 시세가 아닙니다." : "출처: 국토교통부 아파트 매매 실거래가 · 선택 시군구 갱신 " + stamp(current.updatedAt) + (Date.now() - new Date(current.updatedAt).getTime() > 48 * 3600000 ? " · 48시간 이상 지난 자료" : "");
  }
  function setCurrent(value) {
    current = value;
    const dongs = [...new Map(value.complexes.filter(c => c.districtCode === district && c.comparisonEligible !== false).map(c => [c.legalDongCode, c.legalDong])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
    if (!dongs.some(([code]) => code === dong)) dong = dongs[0]?.[0] || "";
    $("neighborhoodDong").innerHTML = dongs.map(([code, name]) => '<option value="' + code + '">' + escape(name) + '</option>').join("") || '<option value="">매매 단지 자료 없음</option>';
    $("neighborhoodDong").value = dong;
    $("neighborhoodDong").disabled = !dongs.length;
    render();
  }
  async function load(force = false) {
    const token = ++request, code = district;
    current = null;
    $("neighborhoodDong").disabled = true;
    empty("동네 거래를 불러오는 중…");
    $("neighborhoodSource").textContent = "선택한 시군구 자료만 불러옵니다.";
    if (mode) {
      setCurrent({ complexes: source.complexes, trades: source.payload?.trades || [] });
      return;
    }
    try {
      let value = cache.get(code);
      if (!value || force) value = checkNeighborhoodPayload(await getJSON("./data/nationwide/" + code + ".json"), code);
      cache.set(code, value);
      if (token !== request) return;
      setCurrent(value);
    } catch {
      if (token !== request) return;
      const previous = cache.get(code);
      if (previous) setCurrent(previous);
      else { empty("동네 자료를 불러오지 못했습니다."); $("neighborhoodDong").innerHTML = '<option value="">자료 연결 실패</option>'; }
      $("neighborhoodSource").textContent = "동네 자료 수신 실패 · " + (previous ? "마지막 정상 자료 유지 (갱신 " + stamp(previous.updatedAt) + ")" : "새로고침 버튼으로 다시 시도하세요. 다른 시군구도 선택할 수 있습니다.");
    }
  }
  async function start() {
    try {
      const value = await getJSON("./data/districts.json");
      if (!Array.isArray(value.districts) || !value.districts.length || !value.districts.every(d => /^\d{5}$/.test(d.code) && typeof d.name === "string")) throw new Error();
      $("neighborhoodDistrict").innerHTML = value.districts.map(d => '<option value="' + d.code + '">' + escape(d.name) + '</option>').join("");
      $("neighborhoodDistrict").value = district;
      initialized = true;
      await load();
    } catch {
      empty("지역 명부를 불러오지 못했습니다.");
      $("neighborhoodSource").textContent = "동네 새로고침을 눌러 다시 시도하세요. 관심 단지 비교는 계속 사용할 수 있습니다.";
    }
  }
  $("neighborhoodDistrict").addEventListener("change", () => { district = $("neighborhoodDistrict").value; load(); });
  $("neighborhoodDong").addEventListener("change", () => { dong = $("neighborhoodDong").value; render(); });
  $("neighborhoodArea").addEventListener("change", render);
  $("neighborhoodPeriods").addEventListener("click", e => {
    const button = e.target.closest("[data-period]");
    if (!button) return;
    period = Number(button.dataset.period);
    $("neighborhoodPeriods").querySelectorAll("button").forEach(b => { b.classList.toggle("selected", b === button); b.setAttribute("aria-pressed", String(b === button)); });
    render();
  });
  $("neighborhoodRefresh").addEventListener("click", () => initialized ? load(true) : start());
  $("neighborhoodRows").addEventListener("click", e => { const b = e.target.closest("[data-month]"); if (b) showPoint(Number(b.dataset.month)); });
  for (const event of ["click", "focusin"]) $("neighborhoodChart").addEventListener(event, e => {
    const point = e.target.closest("[data-month-index]");
    if (point) showPoint(Number(point.dataset.monthIndex));
  });
  return { update(value) {
    if (source?.demo === value.demo && source?.payload === value.payload) return;
    source = value; mode = value.demo;
    if (!initialized) start(); else load();
  } };
}
