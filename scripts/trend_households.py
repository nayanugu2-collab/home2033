"""Match official apartment household counts to trade identities by parcel and name."""
import csv
import http.cookiejar
import io
import json
import re
import urllib.parse
import urllib.request
from collections import defaultdict

import update

SOURCE = 'https://www.data.go.kr/data/15106861/fileData.do'
PORTAL = 'https://www.data.go.kr'
NAME_COLUMNS = ('단지명_공시가격', '단지명_건축물대장', '단지명_도로명주소')


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
                index[(parcel_code[:10], parcel, name)].add((source_id, int(count)))
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
