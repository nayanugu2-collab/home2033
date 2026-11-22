# home2033 작업 안내

이 저장소는 GitHub Pages에 배포하는 아파트 실거래 대시보드다. GitHub의 기본 브랜치는 `main`이다. 작업 전에 `git status`와 원격 기준을 확인한다. 실거래·추세 자료는 Actions가 별도 커밋으로 갱신할 수 있다. 프로젝트 현황과 업데이트 계획은 [README](README.md)에 있다.

## 출퇴근시간 점수

- 실행 순서와 검수 기준은 [출퇴근시간 점수 PRD](docs/commute-prd.md)에 있다. 첫 작업은 동천센트럴자이·파크뷰·봇들마을7단지·잠실엘스와 네 업무지의 보행·차량 기준점을 대조하는 것이다. 단지 ID와 법정동 코드는 `data/complexes.json`을 기준으로 한다. 좌표 확인은 [기준점 명부](data/commute/endpoints.json)와 [확인 기록](docs/commute-endpoint-verification.md)에서 이어간다.
- 오전 08:00 출근을 먼저 검증한다. 저녁 퇴근은 업무지에서 단지로 이동하는 역방향 표본을 별도로 모은다. 오후 18:30은 퇴근 검증 후보 시각이다.
- 업무지 가중치는 삼성·판교·광화문·여의도 순으로 100·20·50·50이다. 지하철·자차와 출근·퇴근을 각각 계산한다. 네 업무지 중 하나라도 비면 해당 점수는 비워 두고, 확보한 개별 시간과 상태를 보여준다.
- 반복 수집에는 실제 계정의 호출 한도와 공급사의 저장·공개 범위를 확인한 경로를 사용한다. API 키는 Actions Secret에 두고, 공개 요약에는 날짜·출처·기준점 버전을 남긴다.
- 화면을 연결할 때는 `assets/app.js`의 단지 상세와 `assets/budget.js`의 가격·면적 필터 및 후보 목록을 사용한다. 출퇴근순은 예산 조건을 적용한 후보 안에서 정렬한다. 정적 데이터 배포 경로는 `scripts/build_site.py`에 있다.

## 검증

- Python과 정적 빌드 검사 — `python -m unittest discover -s tests -p 'test_*.py'`
- JavaScript 검사 — `npm test`
- 사이트 미리보기 — `npm run build` 후 `python -m http.server 8000 --directory site`
