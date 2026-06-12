#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_db.py — 세계 모델에서 mock 행을 파생 (SQLite, seed=42 결정적).
정합성 규약(질문셋이 의존):
  - DLNQ_FLG='Y' ⇔ LOAN ACCT_STAT ∈ {02 연체, 03 기이상}; DLNQ_DAYS 정합
  - 상각(04)·완제(05) 잔액 0
  - TAX_EXMP_RSN='XX' ⇔ FLG ∈ {N, X}
  - 해지(DEP '40') ⇔ DEP_ACCT_CLS_HIST 1행 존재, 잔액 0
  - 정기예금/적금만 MTRT_DT 보유
"""
import os, random, sqlite3, datetime as dt
from inventory import TABLES, DATA_START, DATA_END

OUT = "/home/claude/worldgen/out"; DB = os.path.join(OUT, "world.db")
if os.path.exists(DB): os.remove(DB)
random.seed(42)
con = sqlite3.connect(DB); cur = con.cursor()

def sqltype(t):
    t = t.upper()
    if t.startswith("DECIMAL"): return "REAL"
    if t in ("SMALLINT", "INTEGER"): return "INTEGER"
    return "TEXT"

for t, s in TABLES.items():
    defs = [f"{c['n']} {sqltype(c['t'])}" + (" PRIMARY KEY" if c.get("pk") else "") for c in s["cols"]]
    cur.execute(f"CREATE TABLE {t} ({', '.join(defs)})")

D0, D1 = dt.date.fromisoformat(DATA_START), dt.date.fromisoformat(DATA_END)
def rdate(a=D0, b=D1):
    if a > b: a = b
    return (a + dt.timedelta(days=random.randint(0, (b - a).days))).isoformat()
def w(pairs):
    r, acc = random.random(), 0.0
    for v, p in pairs:
        acc += p
        if r <= acc: return v
    return pairs[-1][0]
def ts(d): return d + " 09:00:00"
def ins(t, rows):
    if rows: cur.executemany(f"INSERT INTO {t} VALUES ({','.join('?'*len(rows[0]))})", rows)

# ---------- 상품 ----------
loan_prdts = []
LP = [("직장인 신용대출","01"),("프리미엄 신용대출","01"),("비상금 소액대출","01"),
      ("주택담보대출 30년","02"),("주택담보대출 15년","02"),("상가담보대출","02"),
      ("전세자금대출","03"),("청년 전월세보증금 대출","03"),
      ("정책서민금융 대출","04"),("소상공인 정책대출","04"),
      ("자동차 구입자금 대출","01"),("전문직 신용대출","01")]
rows = []
for i, (nm, ty) in enumerate(LP):
    p = f"L{i+1:03d}"; loan_prdts.append((p, ty))
    rows.append((p, nm, ty, random.choice([5e7,1e8,3e8,7e8]), round(random.uniform(3.0,5.5),3),
                 rdate(dt.date(2020,1,1), dt.date(2023,6,1)), None, ts(rdate()), None))
ins("LOAN_PRDT_MST", rows)

card_prdts = [f"C{i+1:03d}" for i in range(8)]
ins("CARD_PRDT_MST", [(p, f"카드상품{i+1}", random.choice([0,10000,30000,100000]), ts(rdate()), None)
                      for i, p in enumerate(card_prdts)])
dep_prdts = []
rows = []
for i, ty in enumerate(["10","10","10","20","20","20","30","30","30"]):
    p = f"D{i+1:03d}"; dep_prdts.append((p, ty))
    rows.append((p, f"수신상품{i+1}", ty, round(random.uniform(0.5,4.0),3), ts(rdate()), None))
ins("DEP_PRDT_MST", rows)

# ---------- 고객 ----------
REGION_W = [("SE",.34),("GG",.25),("BS",.12),("IC",.08),("DG",.07),("ETC",.14)]
GRD_W = [("V",.04),("G",.16),("S",.30),("N",.50)]
custs, rows = [], []
for i in range(1500):
    cno = f"CU{i+1:06d}"; grd, reg = w(GRD_W), w(REGION_W)
    custs.append(dict(no=cno, grd=grd, reg=reg))
    rows.append((cno, f"고객{i+1}", rdate(dt.date(1955,1,1), dt.date(2004,12,31)),
                 w([("M",.51),("F",.49)]), w([("01",.55),("02",.2),("03",.08),("04",.07),("05",.1)]),
                 f"user{i+1}@mail.test" if random.random()<.8 else None,
                 f"010-{random.randint(1000,9999)}-{random.randint(1000,9999)}" if random.random()<.9 else None,
                 reg, grd, rdate(dt.date(2010,1,1), D1), ts(rdate()), None))
ins("CUST_BASE_INFO", rows)
ins("CORP_CUST_INFO", [(f"CO{i+1:05d}", f"법인{i+1}", f"{random.randint(100,999)}-81-{random.randint(10000,99999)}",
                        f"대표{i+1}", rdate(dt.date(1990,1,1), dt.date(2022,1,1)), w(REGION_W), ts(rdate()), None)
                       for i in range(100)])
rows = []
for i in range(700):
    c = random.choice(custs); a, b = random.sample(["V","G","S","N"], 2)
    rows.append((f"GH{i+1:06d}", c["no"], a, b, w([("01",.4),("02",.25),("03",.35)]), rdate(), ts(rdate()), None))
ins("CUST_GRD_HIST", rows)
ins("CUST_ADDR_HIST", [(f"AH{i+1:06d}", random.choice(custs)["no"], f"주소 {i+1}",
                        f"{random.randint(10000,63999):05d}", w(REGION_W), rdate(), ts(rdate()), None)
                       for i in range(900)])
rows, k = [], 0
for c in custs:
    for item in random.sample(["01","02","03"], random.randint(1,3)):
        k += 1
        rows.append((f"CN{k:06d}", c["no"], item, w([("Y",.62),("N",.38)]), rdate(),
                     rdate(dt.date(2026,6,1), dt.date(2028,12,31)) if random.random()<.5 else None,
                     ts(rdate()), None))
ins("CUST_CNSNT_INFO", rows)
ins("CUST_CNTC_HIST", [(f"CT{i+1:06d}", random.choice(custs)["no"],
                        w([("01",.45),("02",.15),("03",.25),("04",.15)]), rdate(), None, ts(rdate()), None)
                       for i in range(2500)])

# ---------- 대출 신청 ----------
APPL_STAT_W = [("01",.03),("02",.04),("03",.62),("04",.26),("05",.05)]
appls, rows = [], []
for i in range(6000):
    c = random.choice(custs); pr, pty = random.choice(loan_prdts)
    ano, ad, st = f"LA{i+1:07d}", rdate(), w(APPL_STAT_W)
    tax = w([("Y",.07),("N",.82),("P",.03),("X",.08)])
    rsn = w([("01",.2),("02",.35),("03",.3),("04",.15)]) if tax in ("Y","P") else "XX"
    amt = round(random.uniform(3e6, 5e8), -4)
    term = random.choice([12,24,36,60,120,240,360])
    dcsn = (dt.date.fromisoformat(ad)+dt.timedelta(days=random.randint(2,20))).isoformat() if st in ("03","04") else None
    appls.append(dict(no=ano, cust=c, prdt=pr, pty=pty, dt=ad, st=st, amt=amt, term=term))
    rows.append((ano, c["no"], pr, ad, amt, term, st, tax, rsn,
                 w([("Y",.3),("N",.45),("X",.25)]), w([("01",.3),("02",.42),("03",.18),("04",.1)]),
                 str(random.randint(1,10)), dcsn, ts(ad), None))
ins("LOAN_APPL_HIST", rows)

# ---------- 대출 계좌 ----------
ACCT_STAT_W = [("01",.82),("02",.06),("03",.015),("04",.01),("05",.095)]
accts, rows, k = [], [], 0
for a in appls:
    if a["st"] != "03" or random.random() > .92: continue
    dsbr = dt.date.fromisoformat(a["dt"]) + dt.timedelta(days=random.randint(3,25))
    if dsbr > D1: continue
    k += 1; lno = f"LN{k:07d}"; st = w(ACCT_STAT_W)
    dsbr_amt = round(a["amt"]*random.uniform(0.7,1.0), -4)
    bal = 0.0 if st in ("04","05") else round(dsbr_amt*random.uniform(0.2,0.98), -3)
    dflg = "Y" if st in ("02","03") else "N"
    ddays = random.randint(5,90) if st=="02" else (random.randint(91,400) if st=="03" else 0)
    exp = (dsbr + dt.timedelta(days=30*a["term"])).isoformat()
    accts.append(dict(no=lno, appl=a, dsbr=dsbr.isoformat(), st=st, bal=bal, dflg=dflg,
                      ddays=ddays, exp=exp, dsbr_amt=dsbr_amt, pty=a["pty"]))
    rows.append((lno, a["no"], a["cust"]["no"], a["prdt"], dsbr.isoformat(), dsbr_amt, bal,
                 round(random.uniform(3.2,9.8),3), a["term"], exp,
                 w([("01",.55),("02",.25),("03",.2)]), st, dflg, ddays, ts(dsbr.isoformat()), None))
ins("LOAN_ACCT_MST", rows)

# ---------- 스케줄(회차 ≤12 단순화)·상환 ----------
sch, rp, k1, k2 = [], [], 0, 0
for ac in accts:
    n_inst = min(ac["appl"]["term"], 12)
    base = dt.date.fromisoformat(ac["dsbr"])
    paid_until = random.randint(0, n_inst)
    if ac["st"] in ("02","03"): paid_until = max(0, paid_until - random.randint(1,4))
    if ac["st"] == "05": paid_until = n_inst
    for j in range(n_inst):
        k1 += 1
        due = base + dt.timedelta(days=30*(j+1))
        paid = "Y" if (j < paid_until and due <= D1) else "N"
        prn = round(ac["dsbr_amt"]/max(ac["appl"]["term"],1), -2)
        itr = round(ac["dsbr_amt"]*0.004, -1)
        sch.append((f"SC{k1:08d}", ac["no"], j+1, due.isoformat(), prn, itr, paid, ts(ac["dsbr"]), None))
        if paid == "Y":
            k2 += 1
            rp.append((f"RP{k2:08d}", ac["no"], due.isoformat(), prn+itr, prn, itr, ts(due.isoformat()), None))
ins("LOAN_RPYMT_SCHD", sch); ins("LOAN_RPYMT_HIST", rp)

# ---------- 중도상환 ----------
rows = []
for i, ac in enumerate(random.sample(accts, 600)):
    d = rdate(dt.date.fromisoformat(ac["dsbr"]), D1)
    amt = round(ac["dsbr_amt"]*random.uniform(0.1,0.5), -3)
    rows.append((f"ER{i+1:06d}", ac["no"], d, amt, round(amt*0.012,-1), ts(d), None))
ins("LOAN_ERLY_RPYMT_HIST", rows)

# ---------- 연체 이력 ----------
rows, i = [], 0
for ac in accts:
    if ac["st"] in ("02","03"):
        i += 1
        oc = (D1 - dt.timedelta(days=ac["ddays"])).isoformat()
        rows.append((f"DQ{i:06d}", ac["no"], oc, None, round(max(ac["bal"],1e5)*.1,-3), ts(oc), None))
normal_accts = [a for a in accts if a["st"]=="01"]
for ac in random.sample(normal_accts, min(400, len(normal_accts))):  # 과거 발생→해소
    i += 1
    oc_d = dt.date.fromisoformat(rdate(dt.date.fromisoformat(ac["dsbr"]), D1 - dt.timedelta(days=40)))
    rls = (oc_d + dt.timedelta(days=random.randint(5,35))).isoformat()
    rows.append((f"DQ{i:06d}", ac["no"], oc_d.isoformat(), rls, round(ac["bal"]*.08,-3), ts(oc_d.isoformat()), None))
ins("LOAN_DLNQ_HIST", rows)

# ---------- 담보·보증·금리변경·연장·상각·이자발생 ----------
rows, i = [], 0
for ac in accts:
    if ac["pty"] in ("02","03") and random.random() < .9:
        i += 1
        rows.append((f"CL{i:06d}", ac["no"], w([("01",.5),("02",.15),("03",.1),("04",.1),("05",.15)]),
                     round(ac["dsbr_amt"]*random.uniform(1.1,1.8),-4),
                     rdate(dt.date.fromisoformat(ac["dsbr"])-dt.timedelta(days=20), dt.date.fromisoformat(ac["dsbr"])),
                     ts(ac["dsbr"]), None))
ins("LOAN_CLTRL_INFO", rows)
rows = []
gr_pool = [a for a in accts if a["pty"] == "04"] + random.sample(accts, 250)
for i, ac in enumerate(gr_pool[:520]):
    rows.append((f"GR{i+1:06d}", ac["no"], random.choice(["신용보증기금","주택금융공사","서울신용보증재단"]),
                 round(ac["dsbr_amt"]*random.uniform(.5,.9),-4), round(random.uniform(50,90),2),
                 ac["dsbr"], ts(ac["dsbr"]), None))
ins("LOAN_GRNT_INFO", rows)
rows = []
for i, ac in enumerate(random.sample(accts, 900)):
    b = round(random.uniform(3.2,9.0),3); a2 = round(b + random.uniform(-1.2,1.5),3)
    rows.append((f"RC{i+1:06d}", ac["no"], b, a2, rdate(dt.date.fromisoformat(ac["dsbr"]), D1),
                 w([("01",.55),("02",.3),("03",.15)]), ts(rdate()), None))
ins("LOAN_RATE_CHG_HIST", rows)
rows = []
for i, ac in enumerate(random.sample(accts, 300)):
    bfr = dt.date.fromisoformat(ac["exp"])
    aft = bfr + dt.timedelta(days=365)
    ed = rdate(max(dt.date.fromisoformat(ac["dsbr"]), bfr - dt.timedelta(days=900)), min(bfr, D1))
    rows.append((f"EX{i+1:06d}", ac["no"], bfr.isoformat(), aft.isoformat(), ed, ts(ed), None))
ins("LOAN_EXTN_HIST", rows)
rows = []
for i, ac in enumerate([a for a in accts if a["st"]=="04"]):
    d = rdate(dt.date.fromisoformat(ac["dsbr"])+dt.timedelta(days=200), D1)
    rows.append((f"WO{i+1:05d}", ac["no"], d, round(ac["dsbr_amt"]*random.uniform(.3,.8),-4), ts(d), None))
ins("LOAN_WRTOFF_HIST", rows)
rows, k = [], 0
months = ["202512","202601","202602","202603","202604","202605"]
for ac in accts:
    if ac["st"] in ("01","02","03"):
        for m in months:
            k += 1
            rows.append((f"IA{k:08d}", ac["no"], m, round(ac["bal"]*random.uniform(.003,.007),-1), ts(rdate(dt.date(2026,1,1),D1)), None))
ins("LOAN_INT_ACRL_HIST", rows)

# ---------- 카드 ----------
ins("CARD_APPL_HIST", [(f"CA{i+1:06d}", random.choice(custs)["no"], random.choice(card_prdts),
                        rdate(), w([("Y",.85),("N",.15)]), ts(rdate()), None) for i in range(2600)])
cards, rows = [], []
for i in range(2200):
    cno = f"CD{i+1:07d}"; c = random.choice(custs)
    st = w([("A",.84),("S",.05),("T",.09),("L",.02)])
    grd = w([("P",.12),("G",.35),("C",.53)])
    isu = rdate(dt.date(2021,1,1), D1)
    cards.append(dict(no=cno, cust=c, st=st, grd=grd))
    rows.append((cno, c["no"], random.choice(card_prdts), grd, st,
                 round(random.choice([3e6,5e6,1e7,2e7,3e7])*random.uniform(.8,1.2),-5),
                 isu, "2028" + f"{random.randint(1,12):02d}", ts(isu), None))
ins("CARD_MST", rows)
mrchts, rows = [], []
for i in range(800):
    m = f"MR{i+1:06d}"
    bt = w([("01",.3),("02",.25),("03",.1),("04",.1),("05",.18),("06",.05),("07",.02)])
    mrchts.append(dict(no=m, bt=bt))
    rows.append((m, f"가맹점{i+1}", bt, w(REGION_W), ts(rdate()), None))
ins("MRCHT_INFO", rows)
rows = []
active_cards = [c for c in cards if c["st"] in ("A","S")]
for i in range(40000):
    cd = random.choice(active_cards); mr = random.choice(mrchts)
    instl = w([(0,.78),(3,.12),(6,.07),(12,.03)])
    rows.append((f"SL{i+1:08d}", cd["no"], mr["no"], rdate(dt.date(2025,1,1), D1),
                 round(random.uniform(5e3, 2.5e6),-2), instl, w([("N",.97),("Y",.03)]), ts(rdate()), None))
ins("CARD_SLS_HIST", rows)
bill_rows, bills, k = [], [], 0
BMS = ["202506","202507","202508","202509","202510","202511","202512","202601","202602","202603","202604","202605"]
for cd in active_cards:
    for m in BMS:
        if random.random() < .85:
            k += 1; bno = f"BL{k:08d}"
            mthd = w([("1",.70),("2",.18),("3",.12)])
            dflg = w([("N",.96),("Y",.04)])
            amt = round(random.uniform(5e4, 4e6), -2)
            bd = f"{m[:4]}-{m[4:]}-15"
            bills.append(dict(no=bno, dflg=dflg))
            bill_rows.append((bno, cd["no"], m, bd, amt, mthd, dflg,
                              round(amt*0.1,-2) if mthd=="3" else 0.0, ts(bd), None))
ins("CARD_BILL_HIST", bill_rows)
rows, k = [], 0
for b in bills:
    if b["dflg"] == "N":
        k += 1
        rows.append((f"CR{k:08d}", b["no"], rdate(dt.date(2025,6,20), D1),
                     round(random.uniform(5e4, 4e6),-2), ts(rdate()), None))
ins("CARD_RPYMT_HIST", rows)
rows = []
for i in range(1000):
    cd = random.choice(cards)
    b = round(random.choice([3e6,5e6,1e7,2e7]),-5); a2 = round(b*random.uniform(.6,1.6),-5)
    rows.append((f"LC{i+1:06d}", cd["no"], b, a2, w([("01",.5),("02",.2),("03",.3)]), rdate(), ts(rdate()), None))
ins("CARD_LMT_HIST", rows)

# ---------- 수신 ----------
deps, rows = [], []
for i in range(3800):
    dno = f"DP{i+1:07d}"; c = random.choice(custs)
    pr, ty = random.choice(dep_prdts)
    st = w([("10",.05),("20",.78),("30",.07),("40",.10)])
    bal = 0.0 if st == "40" else round(random.uniform(1e4, 2e8), -3)
    op = rdate(dt.date(2019,1,1), D1)
    mt = (dt.date.fromisoformat(op)+dt.timedelta(days=random.choice([365,730,1095]))).isoformat() if ty in ("20","30") else None
    deps.append(dict(no=dno, st=st, op=op))
    rows.append((dno, c["no"], pr, st, bal, op, mt, ts(op), None))
ins("DEP_ACCT_MST", rows)
rows = []
open_deps = [d for d in deps if d["st"] != "40"]
for i in range(50000):
    d = random.choice(open_deps)
    rows.append((f"TX{i+1:08d}", d["no"], rdate(dt.date(2025,1,1), D1),
                 w([("D",.52),("W",.48)]), round(random.uniform(1e3, 5e6),-2),
                 round(random.uniform(1e4, 2e8),-3), ts(rdate()), None))
ins("DEP_TXN_HIST", rows)
ins("DEP_INT_PAY_HIST", [(f"IP{i+1:07d}", random.choice(open_deps)["no"], rdate(dt.date(2025,1,1), D1),
                          round(random.uniform(1e3, 8e5),-1), ts(rdate()), None) for i in range(7000)])
rows = []
for i, d in enumerate([x for x in deps if x["st"]=="40"]):
    cd = rdate(dt.date.fromisoformat(d["op"]), D1)
    rows.append((f"CS{i+1:06d}", d["no"], cd, w([("01",.6),("02",.3),("03",.1)]),
                 round(random.uniform(1e4, 1.5e8),-3), ts(cd), None))
ins("DEP_ACCT_CLS_HIST", rows)

# ---------- 리스크 ----------
rows = []
for i in range(5200):
    c = random.choice(custs)
    g = random.randint(1,10)
    rows.append((f"EV{i+1:07d}", c["no"], rdate(), str(g), max(0, min(1000, int(1000-90*g+random.gauss(0,40)))),
                 random.choice(["v2.1","v2.3","v3.0"]), ts(rdate()), None))
ins("CRDT_EVAL_HIST", rows)
ins("CRDT_LMT_INFO", [(f"LM{i+1:06d}", random.choice(custs)["no"],
                       round(random.choice([2e7,5e7,1e8,3e8]),-5), round(random.uniform(0,1)*5e7,-4),
                       rdate(dt.date(2024,1,1), D1), ts(rdate()), None) for i in range(1500)])
rows, k = [], 0
for m in ["202603","202604","202605"]:
    for c in random.sample(custs, 500):
        k += 1
        rows.append((f"EP{k:06d}", c["no"], round(random.uniform(1e6, 4e8),-4), m, ts(rdate()), None))
ins("RISK_EXPSR_INFO", rows)
ins("FRAUD_DTCT_HIST", [(f"FD{i+1:05d}", random.choice(custs)["no"], rdate(dt.date(2025,1,1), D1),
                         w([("01",.35),("02",.2),("03",.3),("04",.15)]),
                         w([("01",.2),("02",.25),("03",.4),("04",.15)]), ts(rdate()), None)
                        for i in range(320)])
rows, k = [], 0
bad = [a for a in accts if a["st"] in ("02","03","04")]
for m in ["202601","202602","202603","202604","202605"]:
    for ac in bad:
        k += 1
        rt = {"02": 20.0, "03": 55.0, "04": 100.0}[ac["st"]] + random.uniform(-5,5)
        rows.append((f"PV{k:06d}", ac["no"], m, round(max(ac["dsbr_amt"]*rt/100*0.5,1e5),-3), round(rt,2), ts(rdate(dt.date(2026,1,1),D1)), None))
ins("PROV_CALC_HIST", rows)

con.commit()
print("[DB] 생성 완료 — 행 수:")
for t in TABLES:
    n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"  {t:<22} {n:>7,}")
con.close()
