const REGIONS = ["11", "41", "26", "27", "30"];
const PAGE_SIZE = 12;
const money = value => (value / 10000).toLocaleString("ko-KR", {maximumFractionDigits: 4}) + "억 원";
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

export function budgetInManwon(value) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 10000 + Number((match[2] || "").padEnd(4, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function districtsWithinBudget(districts, limit, area) {
  const byPriceThenDate = (a, b) => a.price - b.price || b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "ko");
  const matches = [];
  for (const district of districts) {
    const districtIds = new Set();
    const dongs = [];
    for (const dong of district.dongs) {
      const complexes = new Map();
      for (const [id, name, band, price, date, size] of dong.sales) {
        if ((area !== "all" && area !== band) || price > limit) continue;
        const trade = {name, price, date, size};
        if (!complexes.has(id) || byPriceThenDate(trade, complexes.get(id)) < 0) complexes.set(id, trade);
        districtIds.add(id);
      }
      if (!complexes.size) continue;
      dongs.push({code: dong.code, name: dong.name, count: complexes.size, lowest: [...complexes.values()].sort(byPriceThenDate)[0]});
    }
    if (!districtIds.size) continue;
    dongs.sort((a, b) => b.count - a.count || byPriceThenDate(a.lowest, b.lowest));
    const lowest = dongs.map(dong => dong.lowest).sort(byPriceThenDate)[0];
    matches.push({code: district.code, name: district.name, asOf: district.asOf, from: district.from, count: districtIds.size, dongs, lowest});
  }
  return matches.sort((a, b) => b.count - a.count || byPriceThenDate(a.lowest, b.lowest));
}

export function initBudget(getJSON) {
  const $ = id => document.getElementById(id);
  const cache = new Map();
  let request = 0, matches = [], rendered = 0;
  function example(trade) {
    return `<strong>${money(trade.price)}</strong> · ${escape(trade.name)} · ${trade.size.toLocaleString('ko-KR')}㎡ · ${escape(trade.date)}`;
  }
  function showMore() {
    const cards = matches.slice(rendered, rendered + PAGE_SIZE).map(district =>
      `<article class="budget-card"><h4>${escape(district.name)}</h4>
        <p><strong>${district.count.toLocaleString('ko-KR')}개 단지</strong> · ${district.dongs.length}개 법정동</p>
        <p class="small budget-example">최저 거래 ${example(district.lowest)}</p>
        <p class="small muted">집계 기간 ${escape(district.from)} ~ ${escape(district.asOf)}</p>
        <details><summary>동네별 실거래 보기</summary><ul>${district.dongs.map(dong =>
          `<li><b>${escape(dong.name)}</b> · ${dong.count}개 단지<br><span class="small">${example(dong.lowest)}</span></li>`).join('')}</ul></details>
      </article>`);
    $('budgetResults').insertAdjacentHTML('beforeend', cards.join(''));
    rendered += cards.length;
    $('budgetMore').hidden = rendered >= matches.length;
    if (!$('budgetMore').hidden) $('budgetMore').textContent = `더 보기 (${rendered}/${matches.length})`;
  }
  $('budgetAmount').addEventListener('input', () => $('budgetAmount').setCustomValidity(''));
  $('budgetMore').addEventListener('click', showMore);
  $('budgetForm').addEventListener('submit', async event => {
    event.preventDefault();
    const limit = budgetInManwon($('budgetAmount').value);
    if (limit === null) {
      $('budgetAmount').setCustomValidity('0보다 큰 예산을 억 원 단위로 입력하세요. 예: 12.5');
      $('budgetAmount').reportValidity();
      return;
    }
    const region = $('budgetRegion').value;
    const area = $('budgetArea').value;
    const regions = REGIONS.includes(region) ? [region] : REGIONS;
    const id = ++request;
    $('budgetResults').innerHTML = '';
    $('budgetMore').hidden = true;
    $('budgetStatus').textContent = '실거래 자료에서 예산 이하 거래를 찾는 중입니다.';
    const responses = await Promise.allSettled(regions.map(async code => {
      if (cache.has(code)) return cache.get(code);
      const data = await getJSON(`./data/budget/${code}.json`);
      if (data?.schemaVersion !== 1 || data.region !== code || !Array.isArray(data.districts)) throw new Error('Budget data');
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
    matches = districtsWithinBudget(districts, limit, area);
    rendered = 0;
    const coverage = loaded.length < regions.length || districts.length < loaded.reduce((n, data) => n + data.districtCount, 0)
      ? ' · 일부 지역 자료 누락' : '';
    $('budgetStatus').textContent = `${money(limit)} 이하 · ${area === 'all' ? '전체 면적' : area + '㎡급'} · ` +
      (matches.length ? `실거래가 있었던 시·군·구 ${matches.length}곳` : '조건에 맞는 실거래 없음') + coverage;
    showMore();
  });
}
