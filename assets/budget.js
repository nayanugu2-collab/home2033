import { MIN_HOUSEHOLDS, meetsHouseholdMinimum } from "./core.js?v=300-households";

const REGIONS = ["11", "41", "26", "27", "30"];
const PAGE_SIZE = 12;
const PRICE_WINDOW_MANWON = 20000;
const money = value => (value / 10000).toLocaleString("ko-KR", {maximumFractionDigits: 4}) + "억 원";
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

export function budgetInManwon(value) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 10000 + Number((match[2] || "").padEnd(4, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function naverComplexSearchURL(districtName, dongName, complexName, mobile = false) {
  if (mobile) {
    return `https://fin.land.naver.com/search?q=${encodeURIComponent(complexName)}`;
  }
  const query = `${districtName} ${dongName} ${complexName}`;
  return `https://new.land.naver.com/search?sk=${encodeURIComponent(query)}`;
}

export function districtsWithinBudget(districts, limit, area, range = "near") {
  const minimum = minimumPrice(limit, range);
  const byCloseness = (a, b) => b.price - a.price || b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "ko");
  const matches = [];
  for (const district of districts) {
    const districtIds = new Set();
    const dongs = [];
    for (const dong of district.dongs) {
      const complexes = new Map();
      for (const [id, name, band, sales, households] of dong.sales) {
        if (!meetsHouseholdMinimum({households})) continue;
        if (area !== "all" && area !== band) continue;
        const match = sales.find(([price]) => price <= limit && price > minimum);
        if (!match) continue;
        const [price, date, size, contractCount] = match;
        const trade = {id, name, price, date, size, households, contractCount};
        if (!complexes.has(id) || byCloseness(trade, complexes.get(id)) < 0) complexes.set(id, trade);
        districtIds.add(id);
      }
      if (!complexes.size) continue;
      const candidates = [...complexes.values()].sort(byCloseness);
      dongs.push({code: dong.code, name: dong.name, count: candidates.length, closest: candidates[0], candidates});
    }
    if (!districtIds.size) continue;
    dongs.sort((a, b) => byCloseness(a.closest, b.closest) || b.count - a.count);
    matches.push({code: district.code, name: district.name, asOf: district.asOf, from: district.from, count: districtIds.size, dongs, closest: dongs[0].closest});
  }
  return matches.sort((a, b) => byCloseness(a.closest, b.closest) || b.count - a.count);
}

function minimumPrice(limit, range) {
  return range === "all" ? 0 : Math.max(0, limit - PRICE_WINDOW_MANWON);
}

export function initBudget(getJSON, { watchState, saveResult, openResult }) {
  const $ = id => document.getElementById(id);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const cache = new Map(), visibleTrades = new Map(), visibleDistricts = new Map();
  const results = $('budgetResults'), officialContent = $('budgetOfficialContent');
  let request = 0, matches = [], rendered = 0;

  function renderTrade(trade, district, dong) {
    visibleTrades.set(trade.id, {trade, district});
    const url = naverComplexSearchURL(district.name, dong.name, trade.name, mobile);
    const count = Number.isSafeInteger(trade.contractCount) && trade.contractCount > 0
      ? ` · 동일 면적 ${trade.contractCount.toLocaleString('ko-KR')}건` : "";
    return `<div class="budget-trade" data-budget-id="${escape(trade.id)}">
      <p class="budget-trade-name"><b>${escape(trade.name)}</b><span>${trade.households.toLocaleString('ko-KR')}세대</span></p>
      <p class="small"><strong>${money(trade.price)}</strong> · 계약일 ${escape(trade.date)}</p>
      <p class="small budget-trade-basis">최근 6개월 실거래 · 전용 ${trade.size.toLocaleString('ko-KR', {maximumFractionDigits: 6})}㎡${count}</p>
      <div class="budget-result-actions" role="group" aria-label="${escape(trade.name)} 단지 작업">
        <button type="button" class="outline-button" data-budget-action="detail">단지 상세</button>
        <button type="button" class="outline-button" data-budget-action="save">관심 저장</button>
        <button type="button" class="outline-button" data-budget-action="calculate">이 가격으로 계산</button>
        <a class="outline-button" href="${escape(url)}" target="_blank" rel="noopener noreferrer">네이버 부동산 ↗</a>
      </div>
      <p class="small budget-action-status" role="status"></p>
    </div>`;
  }

  function updateWatch() {
    for (const button of results.querySelectorAll('[data-budget-action="save"]')) {
      const state = watchState(button.closest('[data-budget-id]').dataset.budgetId);
      button.textContent = state === "base" ? "기준 주택" : state === "saved" ? "관심 저장됨" : "관심 저장";
      button.disabled = Boolean(state) || button.getAttribute("aria-busy") === "true";
    }
  }

  function showMore() {
    const cards = matches.slice(rendered, rendered + PAGE_SIZE).map(district => {
      visibleDistricts.set(district.code, district);
      return `<article class="budget-card"><h3>${escape(district.name)}</h3>
        <p><strong>${district.count.toLocaleString('ko-KR')}개 단지</strong> · ${district.dongs.length}개 법정동</p>
        <p class="small muted">집계 기간 ${escape(district.from)} ~ ${escape(district.asOf)}</p>
        <p class="small budget-trade-dong">${escape(district.dongs[0].name)} · 상한에 가장 가까운 거래</p>
        ${renderTrade(district.closest, district, district.dongs[0])}
        ${district.count > 1 ? `<details data-budget-district="${escape(district.code)}">
          <summary>다른 후보 ${(district.count - 1).toLocaleString('ko-KR')}개 보기</summary>
          <div class="budget-other-results"></div>
        </details>` : ""}
      </article>`;
    });
    results.insertAdjacentHTML('beforeend', cards.join(""));
    rendered += cards.length;
    $('budgetMore').hidden = rendered >= matches.length;
    if (!$('budgetMore').hidden) $('budgetMore').textContent = `더 보기 (${rendered}/${matches.length})`;
    updateWatch();
  }

  results.addEventListener("toggle", event => {
    const details = event.target;
    if (!details.open || !details.dataset.budgetDistrict) return;
    const container = details.querySelector(".budget-other-results");
    if (container.hasChildNodes()) return;
    const district = visibleDistricts.get(details.dataset.budgetDistrict);
    if (!district) return;
    container.innerHTML = district.dongs.map(dong => {
      const candidates = dong.candidates.filter(trade => trade.id !== district.closest.id);
      return candidates.length ? `<div class="budget-dong"><h4>${escape(dong.name)}</h4>
        ${candidates.map(trade => renderTrade(trade, district, dong)).join("")}</div>` : "";
    }).join("");
    updateWatch();
  }, true);

  results.addEventListener("click", async event => {
    const button = event.target.closest("[data-budget-action]");
    if (!button || button.disabled) return;
    const row = button.closest("[data-budget-id]");
    const {trade, district} = visibleTrades.get(row.dataset.budgetId);
    const status = row.querySelector(".budget-action-status");
    const action = button.dataset.budgetAction;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "단지 자료를 불러오는 중…";
    try {
      status.textContent = action === "save" ? await saveResult(trade, district.code) :
        await openResult(trade, district.code, action, () => row.isConnected);
    } catch (error) {
      status.textContent = error.message || "단지 자료를 불러오지 못했습니다. 다시 시도하세요.";
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = false;
      updateWatch();
    }
  });

  $('budgetAmount').addEventListener('input', () => $('budgetAmount').setCustomValidity(''));
  $('budgetMore').addEventListener('click', showMore);
  $('budgetRange').addEventListener('change', () => {
    if (request) $('budgetForm').requestSubmit();
  });
  $('budgetForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (officialContent.hidden) return;
    const limit = budgetInManwon($('budgetAmount').value);
    if (limit === null) {
      $('budgetAmount').setCustomValidity('0보다 큰 예산을 억 원 단위로 입력하세요. 예: 12.5');
      $('budgetAmount').reportValidity();
      return;
    }
    const region = $('budgetRegion').value;
    const area = $('budgetArea').value;
    const priceRange = $('budgetRange').value;
    const regions = REGIONS.includes(region) ? [region] : REGIONS;
    const id = ++request;
    results.innerHTML = '';
    visibleTrades.clear();
    visibleDistricts.clear();
    $('budgetMore').hidden = true;
    $('budgetStatus').textContent = '선택한 가격 범위의 실거래를 찾는 중입니다.';
    const responses = await Promise.allSettled(regions.map(async code => {
      if (cache.has(code)) return cache.get(code);
      const data = await getJSON(`./data/budget/${code}.json`);
      if (data?.schemaVersion !== 3 || data.minimumHouseholds !== MIN_HOUSEHOLDS || data.region !== code || !Array.isArray(data.districts)) throw new Error('Budget data');
      cache.set(code, data);
      return data;
    }));
    if (id !== request) return;
    const loaded = responses.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!loaded.length) {
      $('budgetStatus').textContent = '지역 거래 자료를 읽지 못했습니다. 다시 조회해 주세요.';
      return;
    }
    const districts = loaded.flatMap(data => data.districts);
    matches = districtsWithinBudget(districts, limit, area, priceRange);
    rendered = 0;
    const coverage = loaded.length < regions.length || districts.length < loaded.reduce((n, data) => n + data.districtCount, 0)
      ? ' · 일부 지역 자료 누락' : '';
    const minimum = minimumPrice(limit, priceRange);
    const range = minimum > 0 ? `${money(minimum)} 초과 ~ ${money(limit)} 이하` : `${money(limit)} 이하`;
    $('budgetStatus').textContent = `${range} · ${area === 'all' ? '전체 면적' : area + '㎡급'} · ` +
      (matches.length ? `실거래가 있었던 시·군·구 ${matches.length}곳` : '조건에 맞는 실거래 없음') + coverage;
    showMore();
  });
  return {
    updateWatch,
    setSampleMode(sample) {
      officialContent.hidden = sample;
      $('budgetSampleNotice').hidden = !sample;
    }
  };
}
