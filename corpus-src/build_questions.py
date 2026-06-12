#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_questions.py — 세계 모델에서 질문셋과 골든 답을 파생.
mode:
  sql      단일 골든 SQL (alt 허용 시 둘 다 정답)
  clarify  도메인/입도 미지정 — D8 3단 채점: 확인요청=정답 / 가정명시+한쪽=부분 / 무가정단일=오답
  missing  의도된 결손 — 기대 행동은 '정직한 보고', world_sql은 평가 전용 참고
expected_ops: '조회 행동 적절성' 지표의 골든 (이 질문이 정상적으로 요구하는 레이어 연산)
"""
import json, os, sqlite3

OUT = "/home/claude/worldgen/out"
DB = os.path.join(OUT, "world.db")

Q = [
# ============ NORMAL — 역할·코드사전·메트릭·조인 ============
dict(id="N01", cat="normal", text="대출 연체 중인 계좌 목록을 계좌번호·고객번호·연체일수와 함께 보여줘",
     tags=["stored_as"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT LOAN_ACCT_NO, CUST_NO, DLNQ_DAYS FROM LOAN_ACCT_MST WHERE DLNQ_FLG='Y' ORDER BY DLNQ_DAYS DESC, LOAN_ACCT_NO"),
dict(id="N02", cat="normal", text="대출 연체율이 얼마야?",
     tags=["measured_by","metric_trap"], expected_ops=["resolve_terms","get_term","get_metric"],
     mode="sql", sql="SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS rate FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD NOT IN ('04','05')"),
dict(id="N03", cat="normal", text="기한이익상실 건의 대출잔액 총액은?",
     tags=["expressed_as","codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT SUM(LOAN_BAL_AMT) AS total FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD='03'"),
dict(id="N04", cat="normal", text="대출잔액 합계 기준 상위 10명 고객과 그 잔액을 보여줘",
     tags=["identified_by"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT CUST_NO, SUM(LOAN_BAL_AMT) AS bal FROM LOAN_ACCT_MST GROUP BY CUST_NO ORDER BY bal DESC, CUST_NO LIMIT 10"),
dict(id="N05", cat="normal", text="면세(Y)로 처리된 대출 신청의 면제 사유별 건수 분포는?",
     tags=["attribute_of","codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT TAX_EXMP_RSN_CD, COUNT(*) AS cnt FROM LOAN_APPL_HIST WHERE TAX_EXMP_FLG='Y' GROUP BY TAX_EXMP_RSN_CD ORDER BY TAX_EXMP_RSN_CD"),
dict(id="N06", cat="normal", text="2026년 4월에 신청된 대출은 몇 건이야?",
     tags=["dated_by"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM LOAN_APPL_HIST WHERE LOAN_APPL_DT BETWEEN '2026-04-01' AND '2026-04-30'"),
dict(id="N07", cat="normal", text="2026년 안에 만기가 도래하는 대출 계좌는 몇 개야?",
     tags=["dated_by","dated_trap"], expected_ops=["resolve_terms","get_term"],
     mode="sql",
     sql="SELECT COUNT(*) AS cnt FROM LOAN_ACCT_MST WHERE LOAN_EXP_DT LIKE '2026-%' AND ACCT_STAT_CD NOT IN ('04','05')",
     alt=["SELECT COUNT(*) AS cnt FROM LOAN_ACCT_MST WHERE LOAN_EXP_DT LIKE '2026-%'"]),
dict(id="N08", cat="normal", text="지역별 고객 수를 보여줘",
     tags=["segmented_by","codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT REGION_CD, COUNT(*) AS cnt FROM CUST_BASE_INFO GROUP BY REGION_CD ORDER BY REGION_CD"),
dict(id="N09", cat="normal", text="2026년 1분기 업종별 카드 매출 총액은? (취소 건 제외)",
     tags=["segmented_by","join"], expected_ops=["resolve_terms","get_term","get_join_path","resolve_code"],
     mode="sql", sql="SELECT m.BIZ_TYPE_CD, SUM(s.SLS_AMT) AS amt FROM CARD_SLS_HIST s JOIN MRCHT_INFO m ON s.MRCHT_NO=m.MRCHT_NO WHERE s.APRV_DT BETWEEN '2026-01-01' AND '2026-03-31' AND s.CNCL_YN='N' GROUP BY m.BIZ_TYPE_CD ORDER BY m.BIZ_TYPE_CD"),
dict(id="N10", cat="normal", text="리볼빙으로 결제되는 청구 비중이 얼마나 돼?",
     tags=["expressed_as","measured_by"], expected_ops=["resolve_terms","get_term","get_metric"],
     mode="sql", sql="SELECT ROUND(COUNT(CASE WHEN RPYMT_MTHD_CD='3' THEN 1 END)*1.0/COUNT(*),4) AS rate FROM CARD_BILL_HIST"),
dict(id="N11", cat="normal", text="2026년 5월의 입금 총액과 출금 총액을 각각 알려줘",
     tags=["expressed_as","codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT TXN_TYPE_CD, SUM(TXN_AMT) AS amt FROM DEP_TXN_HIST WHERE TXN_DT BETWEEN '2026-05-01' AND '2026-05-31' GROUP BY TXN_TYPE_CD ORDER BY TXN_TYPE_CD",
     alt=["SELECT SUM(CASE WHEN TXN_TYPE_CD='D' THEN TXN_AMT ELSE 0 END) AS d_amt, SUM(CASE WHEN TXN_TYPE_CD='W' THEN TXN_AMT ELSE 0 END) AS w_amt FROM DEP_TXN_HIST WHERE TXN_DT BETWEEN '2026-05-01' AND '2026-05-31'"]),
dict(id="N12", cat="normal", text="대출 승인율이 얼마야?",
     tags=["measured_by","metric_trap"], expected_ops=["resolve_terms","get_term","get_metric"],
     mode="sql", sql="SELECT ROUND(COUNT(CASE WHEN APPL_STAT_CD='03' THEN 1 END)*1.0/COUNT(CASE WHEN APPL_STAT_CD IN ('03','04') THEN 1 END),4) AS rate FROM LOAN_APPL_HIST"),
dict(id="N13", cat="normal", text="방카슈랑스 동의율은?",
     tags=["measured_by","metric_trap"], expected_ops=["resolve_terms","get_term","get_metric"],
     mode="sql", sql="SELECT ROUND(COUNT(CASE WHEN BNS_CD='Y' THEN 1 END)*1.0/COUNT(CASE WHEN BNS_CD<>'X' THEN 1 END),4) AS rate FROM LOAN_APPL_HIST"),
dict(id="N14", cat="normal", text="현재 운용 중인 대출의 평균 금리는?",
     tags=["measured_by","metric_trap"], expected_ops=["resolve_terms","get_term","get_metric"],
     mode="sql", sql="SELECT ROUND(AVG(INT_RATE),3) AS avg_rate FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD NOT IN ('04','05')"),
dict(id="N15", cat="normal", text="담보 유형별 담보 평가액 합계를 보여줘",
     tags=["segmented_by","codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT CLTRL_TYPE_CD, SUM(CLTRL_VAL_AMT) AS amt FROM LOAN_CLTRL_INFO GROUP BY CLTRL_TYPE_CD ORDER BY CLTRL_TYPE_CD"),
dict(id="N16", cat="normal", text="2026년에 만기 연장이 처리된 건수는?",
     tags=["dated_by"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM LOAN_EXTN_HIST WHERE EXTN_DT LIKE '2026-%'"),
dict(id="N17", cat="normal", text="2026년 월별 중도상환 건수 추이를 보여줘",
     tags=["dated_by"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT substr(ERLY_RPYMT_DT,1,7) AS ym, COUNT(*) AS cnt FROM LOAN_ERLY_RPYMT_HIST WHERE ERLY_RPYMT_DT LIKE '2026-%' GROUP BY ym ORDER BY ym"),
dict(id="N18", cat="normal", text="VIP 고객들의 대출잔액 총액은?",
     tags=["expressed_as","join"], expected_ops=["resolve_terms","get_term","resolve_code","get_join_path"],
     mode="sql", sql="SELECT SUM(l.LOAN_BAL_AMT) AS total FROM LOAN_ACCT_MST l JOIN CUST_BASE_INFO c ON l.CUST_NO=c.CUST_NO WHERE c.CUST_GRD_CD='V'"),
dict(id="N19", cat="normal", text="2026년 5월 기준 충당금 산정 총액은?",
     tags=["stored_as"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT SUM(PROV_AMT) AS total FROM PROV_CALC_HIST WHERE CALC_YM='202605'"),
dict(id="N20", cat="normal", text="2025년 이후 탐지된 이상거래 중 보이스피싱은 몇 건이야?",
     tags=["expressed_as","codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM FRAUD_DTCT_HIST WHERE DTCT_TYPE_CD='03' AND DTCT_DT>='2025-01-01'"),
dict(id="N21", cat="normal", text="신용등급 3등급 이내(우량)로 평가된 신용평가 건수는?",
     tags=["codedict","ordinal"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM CRDT_EVAL_HIST WHERE CAST(CRDT_GRD_CD AS INTEGER)<=3"),
dict(id="N22", cat="normal", text="고객별 최신 신용평가 점수가 높은 상위 5명을 점수와 함께 보여줘",
     tags=["identified_by","groupwise"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT e.CUST_NO, e.CRDT_SCR FROM CRDT_EVAL_HIST e WHERE e.EVAL_DT=(SELECT MAX(EVAL_DT) FROM CRDT_EVAL_HIST x WHERE x.CUST_NO=e.CUST_NO) GROUP BY e.CUST_NO ORDER BY e.CRDT_SCR DESC, e.CUST_NO LIMIT 5"),
dict(id="N23", cat="normal", text="정책대출 상품으로 실행된 대출 계좌 수는?",
     tags=["expressed_as","join"], expected_ops=["resolve_terms","get_term","resolve_code","get_join_path"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM LOAN_ACCT_MST l JOIN LOAN_PRDT_MST p ON l.PRDT_CD=p.PRDT_CD WHERE p.PRDT_TYPE_CD='04'"),
dict(id="N24", cat="normal", text="마케팅 수신에 동의한 비율이 얼마야?",
     tags=["measured_by","metric_trap"], expected_ops=["resolve_terms","get_term","get_metric"],
     mode="sql", sql="SELECT ROUND(COUNT(CASE WHEN CNSNT_YN='Y' THEN 1 END)*1.0/COUNT(*),4) AS rate FROM CUST_CNSNT_INFO WHERE CNSNT_ITEM_CD='01'"),
dict(id="N25", cat="normal", text="2026년 들어 새로 발생한 대출 연체는 몇 건이야?",
     tags=["dated_by"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM LOAN_DLNQ_HIST WHERE DLNQ_OCUR_DT LIKE '2026-%'"),

# ============ FAMILY — 충돌 패밀리 (모호성) ============
dict(id="F01", cat="family", text="연체율이 어떻게 돼?",
     tags=["F5_dlnq","clarify"], expected_ops=["resolve_terms","get_term"],
     mode="clarify", interps=[
        dict(label="대출연체율", sql="SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS rate FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD NOT IN ('04','05')"),
        dict(label="카드연체율", sql="SELECT ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS rate FROM CARD_BILL_HIST")]),
dict(id="F02", cat="family", text="해지된 계좌가 총 몇 개야?",
     tags=["F2_status","clarify"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="clarify", interps=[
        dict(label="수신계좌 해지", sql="SELECT COUNT(*) AS cnt FROM DEP_ACCT_MST WHERE ACCT_STAT_CD='40'"),
        dict(label="카드 해지", sql="SELECT COUNT(*) AS cnt FROM CARD_MST WHERE CARD_STAT_CD='T'")]),
dict(id="F03", cat="family", text="골드 등급인 고객이 몇 명이야?",
     tags=["F1_grade","clarify"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="clarify", interps=[
        dict(label="고객등급 골드", sql="SELECT COUNT(*) AS cnt FROM CUST_BASE_INFO WHERE CUST_GRD_CD='G'"),
        dict(label="골드 카드 보유 고객", sql="SELECT COUNT(DISTINCT CUST_NO) AS cnt FROM CARD_MST WHERE CARD_GRD_CD='G'")]),
dict(id="F04", cat="family", text="상환방식별 건수 분포를 보여줘",
     tags=["F3_repayment","clarify"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="clarify", interps=[
        dict(label="대출 상환방식", sql="SELECT RPYMT_MTHD_CD, COUNT(*) AS cnt FROM LOAN_ACCT_MST GROUP BY RPYMT_MTHD_CD ORDER BY RPYMT_MTHD_CD"),
        dict(label="카드 결제방식", sql="SELECT RPYMT_MTHD_CD, COUNT(*) AS cnt FROM CARD_BILL_HIST GROUP BY RPYMT_MTHD_CD ORDER BY RPYMT_MTHD_CD")]),
dict(id="F05", cat="family", text="전체 잔액 합계가 얼마야?",
     tags=["F6_balance","clarify"], expected_ops=["resolve_terms","get_term"],
     mode="clarify", interps=[
        dict(label="대출잔액 총계(완제 제외)", sql="SELECT SUM(LOAN_BAL_AMT) AS total FROM LOAN_ACCT_MST WHERE ACCT_STAT_CD <> '05'"),
        dict(label="예금잔액 총계(해지 제외)", sql="SELECT SUM(ACCT_BAL_AMT) AS total FROM DEP_ACCT_MST WHERE ACCT_STAT_CD <> '40'")]),
dict(id="F06", cat="family", text="거래중지 상태인 수신계좌 목록을 보여줘",
     tags=["F2_status","precision"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT DEP_ACCT_NO, CUST_NO, ACCT_BAL_AMT FROM DEP_ACCT_MST WHERE ACCT_STAT_CD='30' ORDER BY DEP_ACCT_NO"),
dict(id="F07", cat="family", text="정지된 카드는 몇 장이야?",
     tags=["F2_status","precision"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM CARD_MST WHERE CARD_STAT_CD='S'"),
dict(id="F08", cat="family", text="2026년 6월에 만기가 돌아오는 건이 몇 개야?",
     tags=["F7_maturity","clarify"], expected_ops=["resolve_terms","get_term"],
     mode="clarify", interps=[
        dict(label="대출 만기", sql="SELECT COUNT(*) AS cnt FROM LOAN_ACCT_MST WHERE LOAN_EXP_DT LIKE '2026-06-%' AND ACCT_STAT_CD NOT IN ('04','05')"),
        dict(label="예금 만기", sql="SELECT COUNT(*) AS cnt FROM DEP_ACCT_MST WHERE MTRT_DT LIKE '2026-06-%' AND ACCT_STAT_CD <> '40'")]),

# ============ GRANULARITY — 입도 함정 ============
dict(id="G01", cat="granularity", text="대출금액 총액이 얼마야?",
     tags=["clarify"], expected_ops=["resolve_terms","get_term"],
     mode="clarify", interps=[
        dict(label="신청금액 기준", sql="SELECT SUM(LOAN_AMT) AS total FROM LOAN_APPL_HIST"),
        dict(label="실행금액 기준", sql="SELECT SUM(DSBR_AMT) AS total FROM LOAN_ACCT_MST")]),
dict(id="G02", cat="granularity", text="승인된 대출 신청이 몇 건이야?",
     tags=["precision"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="sql", sql="SELECT COUNT(*) AS cnt FROM LOAN_APPL_HIST WHERE APPL_STAT_CD='03'"),
dict(id="G03", cat="granularity", text="대출 상태별 건수 분포를 보여줘",
     tags=["clarify"], expected_ops=["resolve_terms","get_term"],
     mode="clarify", interps=[
        dict(label="신청상태 기준", sql="SELECT APPL_STAT_CD, COUNT(*) AS cnt FROM LOAN_APPL_HIST GROUP BY APPL_STAT_CD ORDER BY APPL_STAT_CD"),
        dict(label="계좌상태 기준", sql="SELECT ACCT_STAT_CD, COUNT(*) AS cnt FROM LOAN_ACCT_MST GROUP BY ACCT_STAT_CD ORDER BY ACCT_STAT_CD")]),
dict(id="G04", cat="granularity", text="가장 최근에 신용평가를 받은 10건의 고객번호와 등급을 보여줘",
     tags=["broad_term"], expected_ops=["resolve_terms","get_term"],
     mode="sql", sql="SELECT CUST_NO, CRDT_GRD_CD FROM CRDT_EVAL_HIST ORDER BY EVAL_DT DESC, EVAL_NO DESC LIMIT 10"),

# ============ BOUNDARY — 의도된 결손 ============
dict(id="B01", cat="boundary", text="모바일 채널로 신청된 대출이 몇 건이야?",
     tags=["no_codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="missing",
     expected="CHNL_CD의 코드값 사전이 레이어에 없음 — '모바일'에 해당하는 코드값을 추측하지 말고 사전 부재를 보고하거나 값 라벨 확인을 요청해야 함",
     world_sql="SELECT COUNT(*) AS cnt FROM LOAN_APPL_HIST WHERE CHNL_CD='02'"),
dict(id="B02", cat="boundary", text="접촉 유형별 고객 상담 건수 분포를 보여줘",
     tags=["no_codedict"], expected_ops=["resolve_terms","get_term","resolve_code"],
     mode="missing",
     expected="CNTC_TYPE_CD의 코드값 사전이 레이어에 없음 — 유형별 코드는 셀 수 있으나 각 코드의 의미 라벨을 지어내면 안 됨(코드 그대로 제시+의미 미상 고지는 부분 정답)",
     world_sql="SELECT CNTC_TYPE_CD, COUNT(*) AS cnt FROM CUST_CNTC_HIST GROUP BY CNTC_TYPE_CD ORDER BY CNTC_TYPE_CD"),
dict(id="B03", cat="boundary", text="중도상환수수료로 들어온 수입 총액은?",
     tags=["no_term","fallback"], expected_ops=["resolve_terms","search_columns"],
     mode="missing",
     expected="Term 미등재 — search_columns 폴백으로 ERLY_RPYMT_FEE 컬럼(Description 존재)에 도달 가능. 답하되 Link 부재로 낮은 신뢰도를 명시해야 함. 무신뢰도 단정은 부분 정답",
     world_sql="SELECT SUM(ERLY_RPYMT_FEE) AS total FROM LOAN_ERLY_RPYMT_HIST"),
dict(id="B04", cat="boundary", text="휴면계좌가 몇 개나 돼?",
     tags=["no_term","absent"], expected_ops=["resolve_terms","search_columns"],
     mode="missing",
     expected="개념 완전 부재(Term도 컬럼도 분류 기준도 없음) — 지어내지 않고 레이어에 해당 개념이 없음을 보고해야 함. 임의 기준(예: 최근 N개월 미거래)으로 답하면 오답",
     world_sql=None),

# ============ JOIN — 다홉 경로 ============
dict(id="J01", cat="join", text="서울 지역 고객의 대출 연체율은?",
     tags=["join","metric_trap","codedict"], expected_ops=["resolve_terms","get_term","resolve_code","get_join_path","get_metric"],
     mode="sql", sql="SELECT ROUND(COUNT(CASE WHEN l.DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS rate FROM LOAN_ACCT_MST l JOIN CUST_BASE_INFO c ON l.CUST_NO=c.CUST_NO WHERE c.REGION_CD='SE' AND l.ACCT_STAT_CD NOT IN ('04','05')"),
dict(id="J02", cat="join", text="플래티넘 카드를 보유한 고객들의 수신계좌 평균 잔액은? (해지 계좌 제외)",
     tags=["join","multihop"], expected_ops=["resolve_terms","get_term","resolve_code","get_join_path"],
     mode="sql", sql="SELECT ROUND(AVG(d.ACCT_BAL_AMT),0) AS avg_bal FROM DEP_ACCT_MST d WHERE d.ACCT_STAT_CD <> '40' AND d.CUST_NO IN (SELECT DISTINCT CUST_NO FROM CARD_MST WHERE CARD_GRD_CD='P')"),
dict(id="J03", cat="join", text="보증이 붙은 대출과 없는 대출의 연체율을 비교해줘",
     tags=["join","exists","metric_trap"], expected_ops=["resolve_terms","get_term","get_join_path","get_metric"],
     mode="sql", sql="SELECT CASE WHEN EXISTS (SELECT 1 FROM LOAN_GRNT_INFO g WHERE g.LOAN_ACCT_NO=l.LOAN_ACCT_NO) THEN '보증있음' ELSE '보증없음' END AS grp, ROUND(COUNT(CASE WHEN DLNQ_FLG='Y' THEN 1 END)*1.0/COUNT(*),4) AS rate FROM LOAN_ACCT_MST l WHERE ACCT_STAT_CD NOT IN ('04','05') GROUP BY grp ORDER BY grp"),
]

# ---------- 실행: 골든 답 산출 ----------
con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
def run(sql, cap=30):
    rows = [dict(r) for r in con.execute(sql).fetchall()]
    return dict(row_count=len(rows), rows=rows[:cap], truncated=len(rows) > cap)

out, errs = [], []
for q in Q:
    item = {k: q[k] for k in ("id","cat","text","tags","mode","expected_ops")}
    try:
        if q["mode"] == "sql":
            item["golden"] = dict(sql=q["sql"], answer=run(q["sql"]))
            if q.get("alt"):
                item["golden"]["alternatives"] = [dict(sql=a, answer=run(a)) for a in q["alt"]]
        elif q["mode"] == "clarify":
            item["golden"] = dict(
                policy="확인요청=정답 · 가정명시+한쪽답=부분정답 · 무가정단일답=오답 (D8)",
                interpretations=[dict(label=i["label"], sql=i["sql"], answer=run(i["sql"]))
                                 for i in q["interps"]])
        else:  # missing
            item["golden"] = dict(expected_behavior=q["expected"],
                                  world_truth=(dict(sql=q["world_sql"], answer=run(q["world_sql"]))
                                               if q.get("world_sql") else None))
    except Exception as e:
        errs.append(f"{q['id']}: {e}")
    out.append(item)

if errs:
    print("[SQL 오류]"); [print(" -", e) for e in errs]; raise SystemExit(1)

json.dump(out, open(os.path.join(OUT, "questions.json"), "w"), ensure_ascii=False, indent=1)

cats = {}
for q in out: cats[q["cat"]] = cats.get(q["cat"], 0) + 1
print(f"[질문셋] {len(out)}문항 — " + " · ".join(f"{k} {v}" for k, v in cats.items()))
ROLES = ["stored_as","measured_by","identified_by","attribute_of","dated_by","segmented_by","expressed_as"]
cover = {r: sum(1 for q in Q if r in q["tags"]) for r in ROLES}
print("[역할 커버리지]", cover)
missing = [r for r, n in cover.items() if n == 0]
if missing: print("!! 커버 안 된 역할:", missing); raise SystemExit(1)
print("[OK] 모든 역할이 질문셋에 등장")
