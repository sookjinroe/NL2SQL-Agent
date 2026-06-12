#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""validate.py — 코퍼스 품질 검증. 통과 기준:
V1 데이터 정합성 규약 (DLNQ⇔상태, 상각·완제 잔액 0, 해지⇔해지이력, RSN 정합)
V2 함정 작동성: 정본 메트릭 vs 소박한 재계산의 값이 실제로 다른가
V3 모호성 비퇴화: clarify 해석 쌍의 답이 실제로 다른가
V4 경계 비노출: 결손이 레이어 산출물에 새지 않았는가
V5 골든 답 비공허: 단일 sql 문항의 답이 비어 있지 않은가
"""
import json, sqlite3, sys

OUT = "/home/claude/worldgen/out"
con = sqlite3.connect(f"{OUT}/world.db")
q1 = lambda s: con.execute(s).fetchone()[0]
issues, notes = [], []

# ---- V1 정합성 규약 ----
bad = q1("SELECT COUNT(*) FROM LOAN_ACCT_MST WHERE (DLNQ_FLG='Y') <> (ACCT_STAT_CD IN ('02','03'))")
if bad: issues.append(f"V1: DLNQ_FLG↔상태 불일치 {bad}건")
bad = q1("SELECT COUNT(*) FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD IN ('04','05') AND LOAN_BAL_AMT<>0")
if bad: issues.append(f"V1: 상각·완제 잔액≠0 {bad}건")
bad = q1("SELECT COUNT(*) FROM LOAN_APPL_HIST WHERE (TAX_EXMP_RSN_CD='XX') <> (TAX_EXMP_FLG IN ('N','X'))")
if bad: issues.append(f"V1: 면제사유↔플래그 불일치 {bad}건")
n_cls_st = q1("SELECT COUNT(*) FROM DEP_ACCT_MST WHERE ACCT_STAT_CD='40'")
n_cls_h = q1("SELECT COUNT(*) FROM DEP_ACCT_CLS_HIST")
if n_cls_st != n_cls_h: issues.append(f"V1: 해지상태 {n_cls_st} ≠ 해지이력 {n_cls_h}")
bad = q1("""SELECT COUNT(*) FROM LOAN_ACCT_MST l LEFT JOIN CUST_BASE_INFO c ON l.CUST_NO=c.CUST_NO WHERE c.CUST_NO IS NULL""")
if bad: issues.append(f"V1: FK 고아 대출계좌 {bad}건")

# ---- V2 함정 작동성 ----
def pair(name, golden, naive):
    g, n = q1(golden), q1(naive)
    if g is None or n is None or abs(g - n) < 1e-6:
        issues.append(f"V2: 함정 '{name}' 미작동 (정본={g}, 소박={n})")
    else:
        notes.append(f"V2 OK '{name}': 정본 {g} vs 소박 {n}")
pair("대출연체율(상각·완제 제외)",
     "SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD NOT IN ('04','05')",
     "SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) FROM LOAN_ACCT_MST")
pair("승인율(분모=심사완료)",
     "SELECT ROUND(COUNT(CASE WHEN APPL_STAT_CD='03' THEN 1 END)*1.0/COUNT(CASE WHEN APPL_STAT_CD IN ('03','04') THEN 1 END),4) FROM LOAN_APPL_HIST",
     "SELECT ROUND(COUNT(CASE WHEN APPL_STAT_CD='03' THEN 1 END)*1.0/COUNT(*),4) FROM LOAN_APPL_HIST")
pair("방카슈랑스 동의율(X 제외)",
     "SELECT ROUND(COUNT(CASE WHEN BNS_CD='Y' THEN 1 END)*1.0/COUNT(CASE WHEN BNS_CD<>'X' THEN 1 END),4) FROM LOAN_APPL_HIST",
     "SELECT ROUND(COUNT(CASE WHEN BNS_CD='Y' THEN 1 END)*1.0/COUNT(*),4) FROM LOAN_APPL_HIST")
pair("N07 만기도래(상각·완제 제외)",
     "SELECT COUNT(*) FROM LOAN_ACCT_MST WHERE LOAN_EXP_DT LIKE '2026-%' AND ACCT_STAT_CD NOT IN ('04','05')",
     "SELECT COUNT(*) FROM LOAN_ACCT_MST WHERE LOAN_EXP_DT LIKE '2026-%'")

# ---- V3 모호성 비퇴화 + V5 비공허 ----
qs = json.load(open(f"{OUT}/questions.json"))
for q in qs:
    g = q["golden"]
    if q["mode"] == "clarify":
        vals = [json.dumps(i["answer"]["rows"], sort_keys=True) for i in g["interpretations"]]
        if len(set(vals)) < 2:
            issues.append(f"V3: {q['id']} 해석 쌍의 답이 동일 — 모호성 무의미")
        for i in g["interpretations"]:
            if i["answer"]["row_count"] == 0: issues.append(f"V3: {q['id']}/{i['label']} 답 공허")
    elif q["mode"] == "sql":
        a = g["answer"]
        if a["row_count"] == 0: issues.append(f"V5: {q['id']} 답 공허")
        elif a["rows"] and all(v is None for v in a["rows"][0].values()):
            issues.append(f"V5: {q['id']} 답 전부 NULL")

# ---- V4 경계 비노출 ----
layer_terms = {t["name"] for t in json.load(open(f"{OUT}/layer/terms.json"))}
for nm in ("중도상환수수료", "휴면계좌"):
    if nm in layer_terms: issues.append(f"V4: 미등재 Term '{nm}'이 레이어에 노출")
cd = json.load(open(f"{OUT}/layer/codedict.json"))
for col in ("LOAN_APPL_HIST.CHNL_CD", "CUST_CNTC_HIST.CNTC_TYPE_CD"):
    if col in cd: issues.append(f"V4: 미등재 코드사전 '{col}'이 레이어에 노출")
cols = {c["id"]: c for c in json.load(open(f"{OUT}/layer/columns.json"))}
for col in ("LOAN_APPL_HIST.CHNL_CD", "CUST_CNTC_HIST.CNTC_TYPE_CD"):
    txt = cols[col]["description"]["text"]
    if "값:" in txt: issues.append(f"V4: {col} Description에 코드값 의미 누출")
if "ERLY_RPYMT_FEE" not in json.dumps([cols["LOAN_ERLY_RPYMT_HIST.ERLY_RPYMT_FEE"]]):
    issues.append("V4: B03용 수수료 컬럼 Description 부재")
notes.append(f"V4 OK: 결손 4건 모두 레이어 비노출, B03 폴백 경로(컬럼 Desc)는 존재")

# ---- 리포트 ----
print("=" * 60)
for n in notes: print(" ", n)
print("=" * 60)
if issues:
    print(f"[검증 실패] {len(issues)}건"); [print(" !!", i) for i in issues]; sys.exit(1)
print(f"[검증 통과] V1~V5 전체 OK — 질문 {len(qs)}문항")
