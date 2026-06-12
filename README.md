# NL2SQL Agent — 시맨틱 레이어 소비 검증 (corpus-v1)

증강 에이전트(Render/Link, [semantic-layer-enrich-demo](https://github.com/sookjinroe/semantic-layer-enrich-demo))의 후속:
충분히 채워진 시맨틱 레이어가 주어졌을 때, 레이어 8연산만으로 자연어 질문을 SQL로 변환하는 에이전트를 중규모(테이블 37 · 컬럼 296 · 행 25.8만 · Term 100 · 질문 44)에서 검증한다.

## 실행
- **GitHub Pages**: 배포된 페이지에서 바로. NL 에이전트 탭은 화면의 키 입력(localStorage 저장, 리포에 미포함). 데이터 탐색 탭은 키 불필요.
- **로컬**: `python3 -m http.server 8080` 후 접속.

## 구성
- `js/` — layer-ops(8연산) · scorer(채점 v2: 의미동치+D8+환각 구조검출) · agent-core(루프) · nl-data(동결 프롬프트) · live-api · nl/explorer/app 화면
- `data/` — 골든 레이어 JSON · world.db(24MB, seed=42 결정적) · sql.js wasm
- `docs/` — 세계 모델 스펙 v0.1 · 빌드/회고 리포트 · 라벨 사전
- `corpus-src/` — 코퍼스 생성기(단일 원천 inventory.py) + 하니스 자가검증(oracle 44/44 + 결함 8종 검출)

## 1차 실측 요약
원점수 68% → 채점 보정·코퍼스 패치 후 86% (재실행 전 기준). 경계 4/4 · 환각 0건.
진짜 에이전트 오류 2건: 팬아웃 조인(J02), 증거 미활용(N19). 상세: docs/BUILD_REPORT.md 회고 5.
