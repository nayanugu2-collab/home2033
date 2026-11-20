import { checkNeighborhoodPayload, checkTrendPayload, koreaToday, rawRegionalPayload, regionalCoverage, regionalSeries } from "./core.js?v=300-households";

export function initNeighborhood({ getJSON }) {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
  const money = n => n == null ? "—" : n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const number = n => n.toLocaleString("ko-KR");
  const stamp = iso => iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "확인 필요";
  const quick = {"41135":"분당 전체", "41465":"수지 전체", "41597":"동탄 전체"};
  const trendRegions = [["11", "서울 25개 구"], ["41", "경기도"], ["26", "부산"], ["27", "대구"], ["30", "대전"]];
  const regionColors = ["#165dac", "#ae4800", "#007650", "#793894"];
  const areaDashes = {"59":"2 5", "74":"9 5", "84":"", all:"10 4 2 4"};
  let code="41135", dong="all", period=12, source=null, initialized=false, request=0;
  let districts=[], pinned=[], lines=[], scopes=[], hidden=new Set();
  const cache=new Map(), pending=new Map(), warnings=new Map();
  const scopeKey=s=>s.code+":"+s.dong;
  function colorIndex(scope) {
    const saved = pinned.find(item => scopeKey(item) === scopeKey(scope));
    return saved?.colorIndex ?? regionColors.findIndex((_, i) => !pinned.some(item => item.colorIndex === i));
  }
  const districtName=code=>districts.find(d=>d.code===code)?.name || code;
  const labelFor=(c,d)=>d==="all" ? (quick[c] || districtName(c)+" 전체") : districtName(c)+" · "+(cache.get(c)?.months.flatMap(m=>m.rows).find(r=>r.dongCode===d)?.dongName || d);
  const areaLabel=area=>area==="all"?"전체 면적":area+"㎡급";
  const day=()=>source?.demo ? source.payload.asOf : koreaToday();
  function bands() { const value=$("neighborhoodArea").value; return value==="compare"?["59","74","84"]:value==="all-series"?["all","59","74","84"]:[value]; }
  function clear(message) {
    $("neighborhoodChart").innerHTML='<div class="chart-empty">'+escape(message)+'</div>';
    $("neighborhoodRows").innerHTML=""; $("neighborhoodPoint").textContent="";
    $("neighborhoodMetrics").innerHTML=""; $("neighborhoodLegend").innerHTML="";
  }
  function setDongs() {
    const value=cache.get(code), names=new Map();
    for(const m of value?.months || []) for(const r of m.rows) if(r.dongCode!=="all") names.set(r.dongCode,r.dongName);
    if(dong!=="all" && !names.has(dong)) dong="all";
    $("neighborhoodDong").innerHTML='<option value="all">'+escape(quick[code] || "시·군·구 전체")+'</option>'+[...names].sort((a,b)=>a[1].localeCompare(b[1],"ko")).map(([key,name])=>'<option value="'+key+'">'+escape(name)+'</option>').join("");
    $("neighborhoodDong").value=dong; $("neighborhoodDong").disabled=!value;
  }
  function showPoint(li,mi) {
    const line=lines[li], p=line?.points[mi]; if(!p)return;
    $("neighborhoodPoint").textContent=line.label+" · "+p.month+" · "+(!p.available?"이 계약월은 아직 수집되지 않았습니다":p.price==null?"거래 없음":money(p.price)+"억원 · "+p.count+"건 / "+p.complexCount+"개 단지"+(p.count<3?" · 거래 부족":""))+(p.partial?" · 이번 달 집계 중":"");
  }
  function coverageCard(scope) {
    const value = cache.get(scope.code) || { months: [] };
    const points = regionalSeries(value, scope.dong, "all", day(), period);
    const available = points.filter(p => p.available).length;
    const {complexCount, households, unknown, coveredMonths} = regionalCoverage(value, scope.dong, bands(), points);
    const complete = coveredMonths === period;
    const title = escape(labelFor(scope.code, scope.dong));
    const complexText = coveredMonths ? (complete ? "" : "집계된 ") + number(complexCount) + "개 단지" : "단지 수 집계 중";
    const householdText = !coveredMonths || (complexCount > 0 && complexCount === unknown)
      ? "확인된 세대수 없음" : (complete && !unknown ? "총 " : "확인된 세대수 ") + number(households) + "세대";
    return `<div style="border-color:${regionColors[colorIndex(scope)]}"><span>${title} · 거래 반영</span><b>${complexText}</b><small class="trend-households">${householdText}</small>
      ${unknown ? `<small>세대수 미확인 ${number(unknown)}개 단지</small>` : ""}
      <small>가격 자료 ${available}/${period}개월${!complete ? ` · 단지 집계 ${coveredMonths}/${period}개월` : ""}</small></div>`;
  }
  function plot() {
    const visible=lines.filter(l=>!hidden.has(l.id));
    const prices=visible.flatMap(l=>l.points.map(p=>p.price)).filter(p=>p!=null);
    if(!visible.length){$("neighborhoodChart").innerHTML='<div class="chart-empty">범례에서 표시할 선을 선택하세요.</div>';return;}
    if(!prices.length){$("neighborhoodChart").innerHTML='<div class="chart-empty">거래 부족<p>선택 면적·동네의 거래 또는 수집 자료가 없습니다.</p></div>';return;}
    const W=760,H=310,L=56,R=16,T=20,B=38,min=Math.min(...prices),max=Math.max(...prices);
    const pad=Math.max((max-min)*.15,.5),low=Math.max(0,min-pad),high=max+pad;
    const x=i=>L+i*(W-L-R)/(period-1),y=v=>T+(high-v)*(H-T-B)/(high-low);
    let svg='';
    for(let i=0;i<5;i++){const value=low+(high-low)*i/4,yy=y(value);svg+='<line class="grid-line" x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'"/><text x="3" y="'+(yy+5)+'">'+value.toFixed(1)+'</text>';}
    for(let i=0;i<period;i++)if(i%Math.ceil((period-1)/5)===0 || i===period-1)svg+='<text text-anchor="middle" x="'+x(i)+'" y="'+(H-8)+'">'+lines[0].points[i].month.slice(2).replace('-','.')+'</text>';
    for(const line of visible){let path='',last=false;for(let i=0;i<period;i++){const p=line.points[i];if(p.price==null){last=false;continue;}path+=(last?' L ':' M ')+x(i)+' '+y(p.price);last=true;}
      svg+='<path d="'+path+'" fill="none" stroke="'+line.color+'" stroke-width="2.3" stroke-dasharray="'+line.dash+'" vector-effect="non-scaling-stroke"/>';
      line.points.forEach((p,i)=>{
        if(p.price==null)return;
        const description=line.label+' · '+p.month+' · '+money(p.price)+'억원 · '+p.count+'건'+(p.count<3?' · 거래 부족':'');
        const isolated = line.points[i-1]?.price == null && line.points[i+1]?.price == null;
        const fill = period <= 12 || isolated ? line.color : 'transparent';
        svg+='<circle tabindex="0" data-line="'+lines.indexOf(line)+'" data-month="'+i+'" cx="'+x(i)+'" cy="'+y(p.price)+'" r="4.5" fill="'+fill+'" aria-label="'+escape(description)+'"><title>'+escape(description)+'</title></circle>';
      });
    }
    $("neighborhoodChart").innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="지역·면적별 월별 실거래 중앙값, 억원. 빈 월은 연결하지 않습니다.">'+svg+'</svg>';
  }
  function render() {
    const current={code,dong};
    scopes=[current,...pinned.filter(s=>scopeKey(s)!==scopeKey(current))];
    $("neighborhoodTitle").textContent=(source?.demo?'[샘플] ':'')+labelFor(code,dong)+(scopes.length>1?' 외 '+(scopes.length-1)+'개 지역 비교':'');
    $("neighborhoodPins").innerHTML=pinned.map((s,i)=>'<button class="trend-pin" type="button" data-unpin="'+i+'" aria-label="'+escape(labelFor(s.code,s.dong))+' 비교 고정 해제"><i class="trend-region-dot" style="background:'+regionColors[s.colorIndex]+'" aria-hidden="true"></i>'+escape(labelFor(s.code,s.dong))+' ×</button>').join('');
    $("neighborhoodPin").disabled=pinned.some(s=>scopeKey(s)===scopeKey(current))||pinned.length>=3||!cache.has(code);
    lines=[];
    for(const s of scopes)for(const band of bands()){
      const value=cache.get(s.code); if(!value)continue;
      lines.push({id:scopeKey(s)+':'+band,label:labelFor(s.code,s.dong)+' · '+areaLabel(band),color:regionColors[colorIndex(s)],dash:areaDashes[band],points:regionalSeries(value,s.dong,band,day(),period)});
    }
    if(!lines.length){clear('동네 자료를 불러오지 못했습니다. 새로고침으로 다시 시도하세요.');$("neighborhoodRange").textContent='';}
    else{
      $("neighborhoodRange").textContent=lines[0].points[0].month+' – '+lines[0].points.at(-1).month+' · '+period+'개 계약월 (이번 달 포함) · 월별 중앙값 / 억원';
      $("neighborhoodLegend").innerHTML=lines.map(l=>{const latest=l.points.filter(p=>p.price!=null).at(-1);return '<button type="button" data-series="'+escape(l.id)+'" aria-pressed="'+!hidden.has(l.id)+'" class="trend-legend-button'+(hidden.has(l.id)?' dimmed':'')+'"><svg viewBox="0 0 34 8" aria-hidden="true"><line x1="0" x2="34" y1="4" y2="4" stroke="'+l.color+'" stroke-width="3" stroke-dasharray="'+l.dash+'"/></svg><span>'+escape(l.label)+'<small>'+(latest?latest.month+' · '+money(latest.price)+'억':'거래 부족')+'</small></span></button>';}).join('');
      $("neighborhoodMetrics").innerHTML=scopes.map(coverageCard).join('');
      $("neighborhoodRows").innerHTML=lines.flatMap((l,li)=>l.points.map((p,mi)=>'<tr><td>'+escape(l.label)+'</td><td><button class="link-button" type="button" data-line="'+li+'" data-month="'+mi+'">'+p.month+'</button>'+(p.partial?' · 집계 중':'')+'</td><td>'+money(p.price)+'</td><td>'+(!p.available?'미수집':p.count+(p.count<3?' · 거래 부족':''))+'</td><td>'+(p.complexCount??'—')+'</td></tr>')).join('');
      plot();const li=lines.findIndex(l=>!hidden.has(l.id));if(li>=0){const latest=lines[li].points.findLastIndex(p=>p.price!=null);showPoint(li,latest<0?period-1:latest);}else $("neighborhoodPoint").textContent='범례에서 표시할 선을 선택하세요.';
    }
    const firstMonth=lines[0]?.points[0].month;
    const conflictNotes=[...new Set(scopes.map(s=>s.code))].map(c=>{
      const n=(cache.get(c)?.months||[]).filter(m=>m.month>=firstMonth&&m.month<=day().slice(0,7)).reduce((n,m)=>n+(m.excludedIdentityConflicts||0),0);
      return n?districtName(c)+' 법정동 정보가 충돌한 '+n+'건은 집계에서 제외했습니다.':'';
    });
    const incomplete = lines.some(line => line.points.some(point => !point.available));
    $("neighborhoodCoverage").textContent=[...scopes.map(s=>warnings.get(s.code)), ...conflictNotes,
      incomplete ? '300세대 기준으로 재집계 중입니다. 집계된 계약월만 표시합니다.' : ''].filter(Boolean).join(' ');
    $("neighborhoodCoverage").hidden=!$("neighborhoodCoverage").textContent;
    $("neighborhoodSource").textContent=source?.demo?'샘플 가상 거래 · 실제 시세가 아닙니다.': '출처: 국토교통부 아파트 매매 실거래가 · '+scopes.map(s=>{const ms=cache.get(s.code)?.months||[],stamps=ms.map(m=>m.updatedAt).sort();return labelFor(s.code,s.dong)+': 최신 수집 '+stamp(stamps.at(-1))+' / 가장 오래된 월 검증 '+stamp(stamps[0]);}).join(' · ');
  }
  async function fetchData(c,force=false){
    if(cache.has(c)&&!force)return cache.get(c);
    const key=(source?.demo?'sample:':'official:')+c;
    if(pending.has(key))return pending.get(key);
    const snapshot=source;
    const promise=(async()=>{
      await Promise.resolve();
      try{
        let value, warning='';
        if(snapshot.demo)value=rawRegionalPayload({...snapshot.payload,complexes:snapshot.complexes},c);
        else{
          try{value=checkTrendPayload(await getJSON('./data/trends/'+c+'.json'),c);}
          catch{
            if(cache.has(c))throw new Error('refresh');
            const raw=checkNeighborhoodPayload(await getJSON('./data/nationwide/'+c+'.json'),c);
            value=rawRegionalPayload(raw,c);warning=districtName(c)+' 과거 통계 연결 실패 · 최근 자료로 임시 표시합니다.';
          }
        }
        if(snapshot.demo!==source.demo)return value;
        cache.set(c,value);
        if(value.failedMonths?.length)warnings.set(c,districtName(c)+' 일부 계약월 수집 실패 · 해당 월의 마지막 정상 자료를 유지합니다.');
        else if(warning)warnings.set(c,warning);
        else warnings.delete(c);
        return value;
      }catch{
        if(snapshot.demo===source.demo)warnings.set(c,districtName(c)+' 자료 수신 실패 · '+(cache.has(c)?'마지막 정상 자료 유지':'자료를 불러오지 못했습니다. 새로고침으로 재시도하세요.'));
        return cache.get(c)||null;
      }finally{pending.delete(key);}
    })();pending.set(key,promise);return promise;
  }
  async function load(force=false){
    const token=++request;$("neighborhoodDong").disabled=true;
    clear('지역·면적별 거래를 불러오는 중…');$("neighborhoodSource").textContent='선택 지역의 월별 통계만 불러옵니다.';
    await Promise.allSettled([...new Set([code,...pinned.map(s=>s.code)])].map(c=>fetchData(c,force)));
    if(token!==request)return;
    setDongs();render();
  }
  async function start(){
    try{
      const value=await getJSON('./data/districts.json');
      if(!Array.isArray(value.districts)||!value.districts.length||!value.districts.every(d=>/^\d{5}$/.test(d.code)&&typeof d.name==='string'))throw new Error();
      districts = value.districts.filter(d => trendRegions.some(([prefix]) => d.code.startsWith(prefix)));
      if (!districts.length) throw new Error();
      const options = list => list.map(d => `<option value="${d.code}">${escape(quick[d.code] || d.name)}</option>`).join('');
      const groups = [["빠른 선택", districts.filter(d => quick[d.code])], ...trendRegions.map(([prefix, label]) =>
        [label, districts.filter(d => !quick[d.code] && d.code.startsWith(prefix))])];
      $("neighborhoodDistrict").innerHTML = groups.filter(([, list]) => list.length)
        .map(([label, list]) => `<optgroup label="${label}">${options(list)}</optgroup>`).join('');
      if(!districts.some(d=>d.code===code))code=districts[0].code;
      $("neighborhoodDistrict").value=code;initialized=true;await load();
    }catch{clear('지역 명부를 불러오지 못했습니다.');$("neighborhoodSource").textContent='동네 새로고침을 눌러 다시 시도하세요.';}
  }
  $("neighborhoodDistrict").addEventListener('change',()=>{code=$("neighborhoodDistrict").value;dong='all';load();});
  $("neighborhoodDong").addEventListener('change',()=>{dong=$("neighborhoodDong").value;render();});
  $("neighborhoodArea").addEventListener('change',()=>{hidden.clear();render();});
  $("neighborhoodPeriods").addEventListener('click',e=>{const b=e.target.closest('[data-period]');if(!b)return;period=Number(b.dataset.period);$("neighborhoodPeriods").querySelectorAll('button').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});render();});
  $("neighborhoodPin").addEventListener('click',()=>{
    const scope = {code, dong};
    if (pinned.length >= 3 || pinned.some(item => scopeKey(item) === scopeKey(scope))) return;
    pinned.push({...scope, colorIndex: colorIndex(scope)});
    render();
  });
  $("neighborhoodPins").addEventListener('click',e=>{const b=e.target.closest('[data-unpin]');if(b){pinned.splice(Number(b.dataset.unpin),1);render();}});
  $("neighborhoodLegend").addEventListener('click',e=>{const b=e.target.closest('[data-series]');if(b){const id=b.dataset.series;hidden.has(id)?hidden.delete(id):hidden.add(id);render();}});
  $("neighborhoodRefresh").addEventListener('click',()=>initialized?load(true):start());
  for(const id of ['neighborhoodChart','neighborhoodRows'])for(const type of ['click','focusin'])$(id).addEventListener(type,e=>{const b=e.target.closest('[data-month]');if(b)showPoint(Number(b.dataset.line),Number(b.dataset.month));});
  return {update(value){if(source?.demo===value.demo&&source?.payload===value.payload)return;if(source?.demo!==value.demo){cache.clear();warnings.clear();}source=value;if(initialized)load(true);else start();}};
}
