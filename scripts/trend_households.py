"""Match official apartment household counts to trade identities by parcel and name."""
import csv
import hashlib
import http.cookiejar
import io
import json
import re
import urllib.parse
import urllib.request
from collections import defaultdict

import update

SOURCE = 'https://www.data.go.kr/data/15106861/fileData.do'
MIN_HOUSEHOLDS = 300
PORTAL = 'https://www.data.go.kr'
NAME_COLUMNS = ('단지명_공시가격', '단지명_건축물대장', '단지명_도로명주소')
# Pre-2026 Hwaseong parcel codes still occur in the REB file. Keep the exact
# parcel and name check, including Neung-dong where the new district is split.
# https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=122595
DONGTAN_LEGACY = {
    '4159011800': '4159710100',  # 능동 (parcel must match the Dongtan trade)
    '4159012700': '4159710200',  # 반송동
    '4159012800': '4159710300',  # 석우동
    '4159012900': '4159711500',  # 오산동 → 여울동
    '4159013000': '4159710500',  # 청계동
    '4159013100': '4159710600',  # 영천동
    '4159013300': '4159710800',  # 신동
    '4159013400': '4159710900',  # 목동
    '4159013500': '4159711000',  # 산척동
    '4159013600': '4159711100',  # 장지동
    '4159013700': '4159711200',  # 송동
}


def read_households(text):
    index = defaultdict(set)
    reader = csv.DictReader(io.StringIO(text))
    required = {'필지고유번호', '단지고유번호', '단지종류', '세대수', *NAME_COLUMNS}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('세대수 CSV 컬럼 오류')
    for row in reader:
        if row['단지종류'].strip() != '1':
            continue
        parcel_code = row['필지고유번호'].strip()
        source_id = row['단지고유번호'].strip()
        count = row['세대수'].strip().replace(',', '')
        if not re.fullmatch(r'\d{10}1\d{8}', parcel_code) or not source_id or not count.isdigit() or int(count) <= 0:
            continue
        main, sub = int(parcel_code[11:15]), int(parcel_code[15:19])
        parcel = f'{main}-{sub}' if sub else str(main)
        for field in NAME_COLUMNS:
            name = update.normalize_name(row[field])
            if name:
                dong = parcel_code[:10]
                match = (source_id, int(count))
                index[(dong, parcel, name)].add(match)
                if dong in DONGTAN_LEGACY:
                    index[(DONGTAN_LEGACY[dong], parcel, name)].add(match)
    if not index:
        raise ValueError('아파트 세대수 CSV가 비어 있습니다')
    return index


def household_count(complex_, index):
    verified = complex_.get('households')
    if isinstance(verified, int) and verified > 0:
        return verified
    names = {update.normalize_name(n) for n in [complex_['name'], *complex_.get('aliases', [])]}
    matches = set()
    for jibun in complex_['jibuns']:
        for name in names:
            matches.update(index.get((complex_['legalDongCode'], update.normalize_jibun(jibun), name), ()))
    return next(iter(matches))[1] if len(matches) == 1 else None


def counts_by_trade_id(index, registry):
    counts = {}
    for (dong, parcel, name), matches in index.items():
        if len(matches) != 1:
            continue
        identity = '|'.join((dong, name, parcel))
        trade_id = 'n-' + hashlib.sha256(identity.encode()).hexdigest()[:20]
        counts[trade_id] = next(iter(matches))[1]
    for complex_ in registry['complexes']:
        count = household_count(complex_, index)
        if count is not None:
            counts[complex_['id']] = count
    return counts


def stored_household_counts(trends):
    cache = trends / 'households.json'
    if cache.is_file():
        return json.loads(cache.read_text(encoding='utf-8'))
    # The old monthly files still contain verified identities, even though their
    # price summaries cannot be reused for the new population.
    counts = defaultdict(set)
    for path in trends.glob('[0-9]*.json'):
        state = json.loads(path.read_text(encoding='utf-8'))
        for month in state['months']:
            for identity, _, _, count in month.get('members', []):
                if type(count) is int and count > 0:
                    counts[identity].add(count)
    return {identity: next(iter(values)) for identity, values in counts.items() if len(values) == 1}


def filter_snapshot(snapshot, counts):
    complexes = []
    for complex_ in snapshot['complexes']:
        count = complex_.get('households')
        if type(count) is not int or count <= 0:
            count = counts.get(complex_['id'])
        if type(count) is int and count >= MIN_HOUSEHOLDS:
            complexes.append(dict(complex_, households=count))
    result = dict(snapshot, complexes=complexes)
    if 'trades' in snapshot:
        ids = {complex_['id'] for complex_ in complexes}
        result['trades'] = [trade for trade in snapshot['trades'] if trade['complexId'] in ids]
    return result


def download_households():
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def post(path, values):
        request = urllib.request.Request(PORTAL + path, data=urllib.parse.urlencode(values).encode(), headers={'Referer': SOURCE})
        with opener.open(request, timeout=30) as response:
            return json.load(response)

    with opener.open(SOURCE, timeout=30) as response:
        page = response.read().decode('utf-8')
    detail = re.search(r"fn_fileDataDown\('15106861', '(uddi:[a-f0-9-]+)'", page)
    if not detail:
        raise ValueError('세대수 파일 정보 없음')
    file_info = post('/tcs/dss/selectFileDataDownload.do', {
        'publicDataPk': '15106861', 'publicDataDetailPk': detail[1],
        'atchFileId': '', 'fileDetailSn': '1', 'publicDataTyCode': 'PR0051'})
    if file_info.get('status') is not True:
        raise ValueError('세대수 파일 정보 오류')
    fields = {key: file_info[key] for key in ('atchFileId', 'fileDetailSn')}
    limit = post('/cmm/cmm/check-limit.json', fields)
    if limit.get('needCaptcha') is not False:
        raise ValueError('세대수 파일 다운로드 확인 필요')
    request = urllib.request.Request(PORTAL + '/cmm/cmm/fileDownload.do?' + urllib.parse.urlencode(fields), headers={'Referer': SOURCE})
    with opener.open(request, timeout=60) as response:
        body = response.read(65_000_001)
    if len(body) > 65_000_000:
        raise ValueError('세대수 파일 용량 제한 초과')
    try:
        csv_text = body.decode('utf-8-sig')
    except UnicodeDecodeError:
        csv_text = body.decode('cp949')
    return read_households(csv_text)
