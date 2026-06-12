#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_layer.py — ①참조 무결성 검증 ②골든 레이어 JSON ③평가 전용 ground_truth.
의도된 결손은 레이어에서 '보이지 않게' 빠지고, 진실은 eval/ground_truth.json에만 남는다.
"""
import json, os, sys
from inventory import (TABLES, CODE_SYSTEMS, CONCEPTS, DISTRACTOR_TERMS, METRICS,
                       CORPUS_AS_OF, DATA_START, DATA_END, auto_desc)

OUT = "/home/claude/worldgen/out"
LAYER = os.path.join(OUT, "layer"); EV = os.path.join(OUT, "eval")
os.makedirs(LAYER, exist_ok=True); os.makedirs(EV, exist_ok=True)

# ---------- 검증 ----------
COLS = {f"{t}.{c['n']}" for t, s in TABLES.items() for c in s["cols"]}
MET = {m["id"] for m in METRICS}
errs = []
for t, s in TABLES.items():
    for c in s["cols"]:
        if c.get("fk") and c["fk"] not in COLS: errs.append(f"fk {t}.{c['n']} → {c['fk']} 부재")
        if c.get("cs") and c["cs"] not in CODE_SYSTEMS: errs.append(f"cs {t}.{c['n']} → {c['cs']} 부재")
for con in CONCEPTS:
    for role, v in (con.get("real") or {}).items():
        for x in (v if isinstance(v, list) else [v]):
            if role == "measured_by":
                if x not in MET: errs.append(f"{con['name']} metric {x} 부재")
            elif role == "expressed_as":
                if x["column"] not in COLS: errs.append(f"{con['name']} expr 컬럼 {x['column']} 부재")
            else:
                if x not in COLS: errs.append(f"{con['name']} {role} {x} 부재")
if errs:
    print("[검증 실패]"); [print(" -", e) for e in errs]; sys.exit(1)
print(f"[검증 OK] 테이블 {len(TABLES)} 컬럼 {len(COLS)} 개념 {len(CONCEPTS)}")

# ---------- tables.json ----------
tables_j = [dict(name=t, domain=s["domain"], grain=s["grain"],
                 columns=[c["n"] for c in s["cols"]],
                 fk_edges=[{"from": f"{t}.{c['n']}", "to": c["fk"]} for c in s["cols"] if c.get("fk")])
            for t, s in TABLES.items()]

# ---------- columns.json (cs 등재 시 값 의미를 설명에 증강 = '증강 완료된 레이어' 상태) ----------
columns_j = []
for t, s in TABLES.items():
    for c in s["cols"]:
        authored = "d" in c
        text = c["d"] if authored else auto_desc(t, c["n"])
        csn = c.get("cs"); reg = bool(csn and CODE_SYSTEMS[csn].get("layer", True))
        if reg:
            m = CODE_SYSTEMS[csn]["map"]
            text += " 값: " + ", ".join(f"{k}={v}" for k, v in m.items()) + "."
            if CODE_SYSTEMS[csn].get("note"): text += f" ({CODE_SYSTEMS[csn]['note']})"
        columns_j.append(dict(id=f"{t}.{c['n']}", table=t, type=c["t"],
                              nullable=bool(c.get("null")), pk=bool(c.get("pk")), fk=c.get("fk"),
                              description=dict(text=text,
                                               confidence="HIGH" if authored else "MEDIUM",
                                               source="authored" if authored else "auto"),
                              classification=c.get("cls"),
                              code_system=csn if reg else None))

# ---------- codedict.json (등재분만) ----------
codedict_j = {f"{t}.{c['n']}": CODE_SYSTEMS[c["cs"]]["map"]
              for t, s in TABLES.items() for c in s["cols"]
              if c.get("cs") and CODE_SYSTEMS[c["cs"]].get("layer", True)}

# ---------- terms.json ----------
def links_of(con):
    L = []
    for role, v in (con.get("real") or {}).items():
        for x in (v if isinstance(v, list) else [v]):
            if role == "expressed_as":
                L.append(dict(asset=x["column"], role=role, value=x["value"],
                              domain=x.get("domain"), confidence="HIGH"))
            elif role == "measured_by":
                L.append(dict(asset=x, role=role, kind="metric", confidence="HIGH"))
            else:
                L.append(dict(asset=x, role=role, confidence="HIGH"))
    return L

terms_j = []
for con in CONCEPTS:
    if con.get("layer") == "EXCLUDED": continue
    vv = CODE_SYSTEMS[con["cs"]]["map"] if con.get("cs") and CODE_SYSTEMS[con["cs"]].get("layer", True) else None
    terms_j.append(dict(name=con["name"], domain=con["domain"], definition=con["d"],
                        synonyms=con.get("syn", []), family=con.get("family"),
                        valid_values=vv, links=links_of(con)))
for n, d, df in DISTRACTOR_TERMS:
    terms_j.append(dict(name=n, domain=d, definition=df, synonyms=[], family=None,
                        valid_values=None, links=[]))

metrics_j = [dict(id=m["id"], name=m["name"], grain=m["grain"], expr=m["expr"],
                  base_filters=m["base_filters"], note=m.get("note")) for m in METRICS]

meta_j = dict(corpus_as_of=CORPUS_AS_OF, data_range=[DATA_START, DATA_END],
              counts=dict(tables=len(tables_j), columns=len(columns_j),
                          terms=len(terms_j), metrics=len(metrics_j),
                          codedict_columns=len(codedict_j)))

for fn, o in [("tables.json", tables_j), ("columns.json", columns_j), ("terms.json", terms_j),
              ("metrics.json", metrics_j), ("codedict.json", codedict_j), ("meta.json", meta_j)]:
    json.dump(o, open(os.path.join(LAYER, fn), "w"), ensure_ascii=False, indent=1)

# ---------- 평가 전용 ground truth (레이어 비공개) ----------
gt = dict(
    excluded_terms=[dict(name=c["name"], domain=c["domain"], world_def=c["d"],
                         real=c.get("real"), expected=c.get("expected"))
                    for c in CONCEPTS if c.get("layer") == "EXCLUDED"],
    excluded_codedicts=[dict(column=f"{t}.{c['n']}", map=CODE_SYSTEMS[c["cs"]]["map"],
                             expected=next((x.get("expected") for x in CONCEPTS
                                            if (x.get("real") or {}).get("stored_as") == f"{t}.{c['n']}"
                                            or (x.get("real") or {}).get("segmented_by") == f"{t}.{c['n']}"), None))
                        for t, s in TABLES.items() for c in s["cols"]
                        if c.get("cs") and not CODE_SYSTEMS[c["cs"]].get("layer", True)],
    ambiguous_terms=[c["name"] for c in CONCEPTS if c.get("ambiguous")],
)
json.dump(gt, open(os.path.join(EV, "ground_truth.json"), "w"), ensure_ascii=False, indent=1)
print(f"[레이어] terms {len(terms_j)} · columns {len(columns_j)} · codedict {len(codedict_j)} · metrics {len(metrics_j)}")
print(f"[GT] 미등재 Term {len(gt['excluded_terms'])} · 미등재 코드사전 {len(gt['excluded_codedicts'])} · 모호 Term {len(gt['ambiguous_terms'])}")
