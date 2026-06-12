#!/usr/bin/env python3
"""2단계: 질문 드라이런 — 양산 전, 역할 어휘가 실제 질문을 라우팅하는지 v0 슬라이스로 검증.
각 질문 스펙은 '필요한 라우팅 경로'를 선언한다:
  need_term: 질문 어휘가 닿아야 할 Term(동의어 포함 매칭)
  need_role: 그 Term에서 타야 할 역할
  need_code: 코드값 변환이 필요하면 (code_system, 의미라벨)
  need_dim:  segmented_by 차원의 값 수준 해석이 필요하면 그 값 라벨
부재 = 양산 단계에서 채워야 할 갭(finding).
"""
import yaml, sys, json

INV = yaml.safe_load(open("/mnt/user-data/uploads/concept-inventory-v0.yaml")) if False else \
      yaml.safe_load(open("/home/claude/worldgen/concept-inventory-v0.yaml"))

concepts = INV["concepts"]
cs = INV["code_systems"]
by_name = {}
for c in concepts:
    by_name[c["name"]] = c
    for s in c.get("syn") or []:
        by_name.setdefault(s, c)  # 동의어 → 첫 개념 (충돌은 의도)

# (질문, 필요 라우팅) — 역할 7개 전부 + 패밀리 + 경계 커버
SPECS = [
    ("연체된 대출 계좌 목록", dict(term="대출연체", role="stored_as")),
    ("대출 연체율이 얼마야", dict(term="대출연체", role="measured_by")),
    ("기한이익상실 건 총액", dict(term="기한이익상실", role="expressed_as")),
    ("고객별 대출잔액 상위 10명", dict(term="고객", role="identified_by")),
    ("세금 면제 사유별 신청 건수", dict(term="세금면제", role="attribute_of",
                                  code=("TAX_EXMP_RSN", None))),  # 사유코드의 코드체계 필요
    ("2026년 4월에 신청된 대출 건수", dict(term="대출신청", role="dated_by")),
    ("2026년 만기 도래 계좌 수", dict(term="만기", role="dated_by")),
    ("지역별 고객 수", dict(term="지역", role="segmented_by", code=("REGION", None))),
    ("업종별 카드 매출 총액", dict(term="업종", role="segmented_by", code=("BIZ_TYPE", None))),
    ("리볼빙 결제 비중", dict(term="리볼빙", role="expressed_as")),
    ("골드 등급이 몇 명이야", dict(term="고객등급", role="stored_as", ambiguous="카드등급")),
    ("잔액 총합 얼마야", dict(term="대출잔액", role="stored_as", ambiguous="예금잔액")),
    ("모바일로 신청된 대출 건수", dict(term="신청채널", role="stored_as",
                                  boundary="no_codedict")),
    ("중도상환수수료 수입 총액", dict(term="중도상환수수료", boundary="no_term")),
    ("서울 지역 고객의 대출 연체율", dict(term="지역", role="segmented_by",
                                   code=("REGION", "서울"), join=("CUSTOMER", "LOAN"))),
]

findings = []
ok = 0
for q, need in SPECS:
    c = by_name.get(need["term"])
    if not c:
        findings.append(f"[GAP] '{q}' — Term '{need['term']}' 부재"); continue
    if need.get("boundary") == "no_term":
        if c.get("layer") == "EXCLUDED": ok += 1
        else: findings.append(f"[GAP] '{q}' — 경계 개념인데 EXCLUDED 마킹 없음")
        continue
    role = need.get("role")
    real = c.get("real") or {}
    if role and role not in real:
        findings.append(f"[GAP] '{q}' — '{c['name']}'에 역할 {role} 미실현"); continue
    code = need.get("code")
    if code:
        sysname, label = code
        hit = [k for k in cs if sysname in k]
        if not hit:
            findings.append(f"[GAP] '{q}' — 코드체계 {sysname} 부재 (값 라벨 해석 불가)")
            continue
        if label:
            vals = cs[hit[0]]
            if isinstance(vals, dict) and label not in vals.values():
                findings.append(f"[GAP] '{q}' — {hit[0]}에 '{label}' 값 라벨 없음")
                continue
    ok += 1

# 구조적 점검: 역할 7개가 슬라이스 안에서 모두 한 번 이상 실현되는가
roles = ["stored_as","measured_by","identified_by","attribute_of","dated_by","segmented_by","expressed_as"]
realized = {r: 0 for r in roles}
for c in concepts:
    for r in (c.get("real") or {}): 
        if r in realized: realized[r] += 1

print(f"라우팅 통과: {ok}/{len(SPECS)}")
print("\n역할 실현 빈도:", json.dumps(realized, ensure_ascii=False))
print("\n=== Findings (양산 단계에 반영할 갭) ===")
for f in findings: print(f)
if not findings: print("(없음)")
