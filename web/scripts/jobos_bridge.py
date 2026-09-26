#!/usr/bin/env python3
"""Dashboard bridge for Job OS v4.

The dashboard was written against an older CLI that exposed `api <view>`. Job OS v4
(JOB_OS_PY) has no such command, so this script imports v4 as a library and returns
the JSON shapes in web/lib/types.ts.

Rules kept from v4:
- Reads open the database read-only and never write prep files or rebuild graphs.
- Status changes go through v4 `status_change` (transition table, evidence notes,
  résumé-version verification). `drafted` is refused here: drafting creates a
  versioned résumé and belongs to `job_os.py draft`, not a status flip.
- Absolute filesystem paths are stripped from anything returned to the browser.

If JOB_OS_PY points at the legacy CLI (it has `api`), calls are passed straight through.
Output is always JSON: {"error": ...} for rule refusals (exit 0), exit 1 for system failures.
"""

import argparse
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

STATUS_ORDER = ["discovered", "drafted", "reviewed", "applied", "interview", "offer", "rejected", "withdrawn", "closed"]
ENDED = {"rejected", "withdrawn", "closed"}
INTERVIEW_WORDS = re.compile(r"面接|面談|interview|選考会", re.I)
CODE_EVIDENCE = {"file", "commit"}
# Windows drive paths or common Unix roots, only at a word boundary and never inside a URL (https://…).
PATH_RE = re.compile(r"(?<![\w/:.])(?:[A-Za-z]:[\\/]|/(?:home|Users|root|tmp|var|mnt)/)[^\s|]*")


class Rule(Exception):
    pass


def load_v4(path):
    spec = importlib.util.spec_from_file_location("job_os_v4", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def is_legacy(path):
    try:
        text = Path(path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return "def cmd_api(" in text and "def graph_build(" not in text


# ---------------------------------------------------------------- helpers

def ro_db(v4):
    db = sqlite3.connect(f"file:{Path(v4.DB).as_posix()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    return db


def scrub(v4, text):
    root = str(Path(v4.ROOT))
    text = (text or "").replace(root + os.sep, "").replace(root, "job-os")
    return PATH_RE.sub(lambda m: re.split(r"[\\/]", m.group(0).rstrip("\\/"))[-1], text)


def verdict_of(job):
    v = (job.get("prescreen") or {}).get("verdict", "")
    return v if v in ("PASS", "WARN", "BLOCK") else ""


def next_kind(job):
    if job["status"] == "interview" or INTERVIEW_WORDS.search(job.get("next_action") or ""):
        return "interview"
    return "task"


def summary(v4, job, now, due_at=None, action=None):
    due = due_at if due_at is not None else (job.get("due_at") or "")
    t = v4.parse_time(due) if due else None
    return {
        "id": job["id"], "company": job["company"], "title": job["title"], "status": job["status"],
        "stage": job.get("stage") or "", "next_action": action if action is not None else (job.get("next_action") or ""),
        "next_kind": next_kind(job), "due_at": due,
        "overdue": bool(t and t < now and job["status"] not in ENDED),
        "verdict": verdict_of(job), "override": False,
    }


def all_jobs(v4, db):
    return [v4.job_dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY updated_at DESC")]


def project_claims(profile):
    return [c for c in profile.get("claims", []) if c.get("kind") == "project"]


def has_code(claim):
    """A file/commit link exists (may still be pending review)."""
    return any(e.get("type") in CODE_EVIDENCE for e in claim.get("evidence") or [])


def has_verified_code(claim):
    """v4 evidence_status == verified for a file/commit link — the only state that counts as backed."""
    return any(e.get("type") in CODE_EVIDENCE and e.get("verified") is True for e in claim.get("evidence") or [])


def evidence_links(claim):
    return [{"url": e["ref"], "note": e.get("type", "link") + ("" if e.get("verified") else " · unverified")}
            for e in claim.get("evidence") or [] if str(e.get("ref", "")).startswith("http")]


def evidence_counts(profile):
    reviewed = [c for c in project_claims(profile) if c.get("reviewed")]
    missing = [c["id"] for c in reviewed if not has_code(c)]
    verified = sum(1 for c in reviewed if has_verified_code(c))
    return {"reviewed": len(reviewed), "linked": len(reviewed) - len(missing), "verified": verified,
            "missing_evidence": missing}


def match_rows(v4, job, profile, graph):
    """Same traversal as v4 graph_build, in memory (no writes)."""
    claims = [c for c in profile.get("claims", []) if c.get("reviewed")]
    rows = []
    for req in v4.requirement_records(job):
        target = v4.norm(graph.canon(req["normalized"]))
        hits = []
        for claim in claims:
            best = None
            for tag in claim["tags"]:
                p = graph.reach(tag).get(target)
                if p and (best is None or len(p) < len(best)):
                    best = p
            if best:
                hits.append({"claim": claim["id"], "kind": "direct" if len(best) == 1 else "inferred",
                             "path": best, "text": claim.get("en") or claim.get("ja", "")})
        hits.sort(key=lambda h: (h["kind"] != "direct", len(h["path"])))
        kind = "direct" if any(h["kind"] == "direct" for h in hits) else "inferred" if hits else "none"
        rows.append({"requirement": req["raw"] or req["normalized"], "skill": req["normalized"], "match": kind,
                     "preferred": req["level"] == "preferred", "claims": hits})
    return rows


def manifests(v4, job_id):
    folder = Path(v4.APPS) / job_id
    out = []
    for p in sorted(folder.glob("v*"), key=lambda p: int(p.name[1:]) if p.name[1:].isdigit() else -1):
        m = p / "claim_manifest.json"
        if p.name[1:].isdigit() and m.is_file():
            try:
                out.append((int(p.name[1:]), json.loads(m.read_text(encoding="utf-8"))))
            except (OSError, json.JSONDecodeError):
                continue
    return out


def get(v4, db, job_id):
    row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        raise Rule(f"No job '{job_id}'.")
    return v4.job_dict(row)


# ---------------------------------------------------------------- views

def api_today(v4, db, profile, now):
    jobs = all_jobs(v4, db)
    live = [j for j in jobs if j["status"] not in ENDED]
    upcoming = []
    for j in live:
        if j.get("due_at"):
            upcoming.append(summary(v4, j, now))
        if j.get("deadline") and j["status"] in v4.ACTIVE:
            dl = v4.deadline_time(j["deadline"])
            if not j.get("due_at") or v4.parse_time(j["due_at"]) != dl:
                upcoming.append(summary(v4, j, now, dl.isoformat(timespec="seconds"),
                                        "Application deadline" + (" (time unconfirmed)" if len(j["deadline"]) == 10 else "")))
    horizon = now + timedelta(days=14)
    upcoming = sorted((u for u in upcoming if u["overdue"] or v4.parse_time(u["due_at"]) <= horizon),
                      key=lambda u: v4.parse_time(u["due_at"]))
    interviews = [u for u in upcoming if u["next_kind"] == "interview" and not u["overdue"]]
    if not interviews:
        interviews = sorted((summary(v4, j, now) for j in live if j.get("due_at") and next_kind(j) == "interview"
                             and v4.parse_time(j["due_at"]) >= now), key=lambda u: v4.parse_time(u["due_at"]))
    ev = evidence_counts(profile)
    waiting = []
    for j in live:
        if j["status"] == "drafted":
            waiting.append({"kind": "review", "job": j["id"], "company": j["company"], "title": j["title"],
                            "text": f"Review the draft for {j['company']}"})
    for j in live:
        if j["status"] == "discovered" and verdict_of(j) != "BLOCK" and not j.get("next_action"):
            waiting.append({"kind": "triage", "job": j["id"], "company": j["company"], "title": j["title"],
                            "verdict": verdict_of(j), "text": f"Decide on {j['company']} — {j['title']}"})
    for cid in ev["missing_evidence"]:
        waiting.append({"kind": "evidence", "claim": cid, "text": f"Claim '{cid}' has no file-level code link"})
    counts = {s: 0 for s in STATUS_ORDER}
    for j in jobs:
        counts[j["status"]] = counts.get(j["status"], 0) + 1
    return {"now": now.isoformat(timespec="seconds"), "next_interview": interviews[0] if interviews else None,
            "upcoming": upcoming, "waiting": waiting, "counts": counts, "alerts": alerts(v4, jobs, now),
            "evidence": {"reviewed": ev["reviewed"], "linked": ev["linked"]}, "profile_loaded": bool(profile)}


def alerts(v4, jobs, now, hours=72):
    """Same rule as `job_os.py alerts --hours 72` (the 09:00 deadline-ping cron), with job ids kept."""
    horizon = now + timedelta(hours=hours)
    out = []
    for j in jobs:
        if j["status"] in ENDED:
            continue
        cands = []
        if j.get("due_at"):
            cands.append((v4.parse_time(j["due_at"]), j.get("next_action") or "Next action", False))
        if j.get("deadline") and j["status"] in v4.ACTIVE:
            cands.append((v4.deadline_time(j["deadline"]), "Application deadline", len(j["deadline"]) == 10))
        for t, action, date_only in cands:
            if t > horizon:
                continue
            out.append({"job": j["id"], "company": j["company"], "status": j["status"], "action": action,
                        "at": t.isoformat(timespec="seconds"), "time_unconfirmed": date_only, "overdue": t < now,
                        "text": f"{action} — {j['company']}"})
    out.sort(key=lambda a: (not a["overdue"], a["at"]))
    return out


def api_pipeline(v4, db, now):
    groups = {s: [] for s in STATUS_ORDER}
    for j in all_jobs(v4, db):
        groups.setdefault(j["status"], []).append(summary(v4, j, now))
    return {"order": STATUS_ORDER, "groups": groups}


def allowed_next(v4, status):
    nxt = set(v4.TRANSITIONS.get(status, set())) - {"drafted"}
    if status != "interview":
        nxt.discard(status)
    return [s for s in STATUS_ORDER if s in nxt]


def api_job(v4, db, profile, graph, job_id, now):
    job = get(v4, db, job_id)
    screen = job.get("prescreen") or {}
    reasons = [{"level": "BLOCK", "rule": "block", "detail": x} for x in screen.get("block", [])] + \
              [{"level": "WARN", "rule": "warn", "detail": x} for x in screen.get("warn", [])] + \
              [{"level": "PASS", "rule": "info", "detail": x} for x in screen.get("info", [])]
    versions = [{"version": n, "created_at": m.get("generated_at", ""), "claims": len(m.get("selected_claims", [])),
                 "unmatched": [u.get("requirement", "") for u in (m.get("match") or {}).get("unmatched", [])],
                 "sent": job.get("sent_version") == n} for n, m in manifests(v4, job_id)]
    events = [{"at": r["at"], "status": r["status"], "note": scrub(v4, r["note"])}
              for r in db.execute("SELECT at, status, note FROM events WHERE job_id = ? ORDER BY id DESC", (job_id,))]
    debriefs = []
    for r in db.execute("SELECT at, stage, data FROM debriefs WHERE job_id = ? ORDER BY id DESC", (job_id,)):
        try:
            d = json.loads(r["data"])
        except json.JSONDecodeError:
            continue
        qs = [{"q": q.get("q", ""), "claim": q.get("claim", ""), "stuck": bool(q.get("stuck")),
               "better_answer": q.get("better_answer", "")} for q in d.get("questions", []) if isinstance(q, dict)]
        debriefs.append({"at": r["at"], "stage": r["stage"], "date": d.get("date", ""), "questions": qs,
                         "stuck": sum(q["stuck"] for q in qs), "went_well": d.get("went_well", ""),
                         "next_time": d.get("next_time", "")})
    claim_opts = [{"id": c["id"], "label": c["id"]} for c in profile.get("claims", [])
                  if c.get("reviewed") and c.get("kind") == "project"]
    return {"job": {**summary(v4, job, now), "url": job.get("url", ""), "posting": job.get("requirements_text", ""),
                    "override_reason": "", "sent_version": job.get("sent_version")},
            "prescreen": {"verdict": verdict_of(job), "reasons": reasons},
            "match": match_rows(v4, job, profile, graph), "versions": versions, "events": events,
            "debriefs": debriefs, "claims": claim_opts,
            "allowed_next": allowed_next(v4, job["status"])}


def api_prep(v4, db, profile, graph, job_id, now):
    job = get(v4, db, job_id)
    claims = {c["id"]: c for c in profile.get("claims", [])}
    version = job.get("sent_version")
    sent_manifest = dict(manifests(v4, job_id)).get(version) if version else None
    if sent_manifest:
        ids = [c["id"] for c in sent_manifest.get("selected_claims", [])]
        sent = {"claims": [{"claim": c["id"], "text": c.get("text", ""), "why": "; ".join(c.get("why", []))}
                           for c in sent_manifest.get("selected_claims", [])]}
    else:
        ids = [c["id"] for c in v4.select_claims(job, profile, v4.match(job, profile, graph))[0]]
        sent = None
    probe = []
    for cid in ids:
        c = claims.get(cid)
        if not c:
            continue
        probe.append({"claim": cid, "text": c.get("ja") or c.get("en", ""), "evidence": evidence_links(c),
                      "missing_evidence": c.get("kind") == "project" and not has_code(c),
                      "questions": list(c.get("probe_questions", []))})
    history = []
    idx = v4.company_index()
    key = v4.raw_company_key(job["company"])
    if key in idx:
        h = idx[key][1]
        history.append({"stage": h.get("stage", ""), "result": h.get("outcome", ""), "note": h.get("via", "")})
    lessons = [f"{l.get('from', '')}: {l.get('lesson', '')}" for l in profile.get("interview_lessons", [])]
    lessons += v4.lessons_from_debriefs(db)
    return {"markdown": "", "job": summary(v4, job, now), "sent_version": version, "sent": sent,
            "probe": probe, "history": history, "lessons": lessons}


def api_readiness(v4, db, profile, graph):
    out = [{"id": c["id"], "text": c.get("en") or c.get("ja", ""), "reviewed": bool(c.get("reviewed")),
            "has_evidence": has_code(c), "verified": has_verified_code(c),
            "evidence": evidence_links(c), "skills": list(c.get("tags", []))}
           for c in project_claims(profile)]
    gaps = {}
    for j in all_jobs(v4, db):
        if j["status"] in ENDED:
            continue
        for m in match_rows(v4, j, profile, graph):
            if m["match"] == "none":
                gaps[m["skill"]] = gaps.get(m["skill"], 0) + 1
    return {"claims": out, "evidence": evidence_counts(profile),
            "gaps": sorted(({"requirement": k, "jobs": n} for k, n in gaps.items()), key=lambda g: (-g["jobs"], g["requirement"]))}


# ---------------------------------------------------------------- writes (through v4 rules)

def do_record(v4, a):
    if a.status == "drafted":
        raise Rule("Drafting creates a versioned résumé — ask Hermes to run `draft`; it can't be set by hand.")
    if a.status not in v4.STATUSES:
        raise Rule(f"Unknown status '{a.status}'.")
    db = v4.connect()
    try:
        v4.get_job(db, a.id)
    except ValueError:
        raise Rule(f"No job '{a.id}'.")
    v4.status_change(db, a.id, a.status, a.note or "", stage=a.stage or None,
                     external_submission=bool(a.external_submission) and a.status == "applied")
    return {"ok": True}


def do_schedule(v4, a):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", a.due or ""):
        raise Rule("Pick a due date and time.")
    action = (a.action or "").strip()
    if not action or len(action) > 200:
        raise Rule("Next action must be 1–200 characters.")
    db = v4.connect()
    try:
        v4.get_job(db, a.id)
    except ValueError:
        raise Rule(f"No job '{a.id}'.")
    v4.schedule(db, a.id, action, f"{a.due}:00+09:00")
    return {"ok": True}


CLAIM_ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
KEEP_ACTION = "Draft application (ask Hermes)"


def do_triage(v4, a):
    db = v4.connect()
    try:
        job = v4.get_job(db, a.id)
    except ValueError:
        raise Rule(f"No job '{a.id}'.")
    if job["status"] != "discovered":
        raise Rule("Only undecided (discovered) jobs can be kept or skipped.")
    if a.decision == "keep":
        due = (datetime.now(v4.JST) + timedelta(days=3)).replace(hour=18, minute=0, second=0, microsecond=0)
        v4.schedule(db, a.id, KEEP_ACTION, due.isoformat(timespec="seconds"))
        return {"ok": True}
    reason = (a.reason or "").strip()
    if not reason:
        raise Rule("Give a short reason for skipping.")
    if len(reason) > 300:
        raise Rule("Reason is too long (300).")
    v4.status_change(db, a.id, "withdrawn", f"Skipped at triage: {reason}")
    return {"ok": True}


def do_evidence(v4, a):
    if not CLAIM_ID_RE.fullmatch(a.claim or ""):
        raise Rule("Unknown claim.")
    url = (a.url or "").strip()
    if not re.fullmatch(r"https://github\.com/[\w.-]+/[\w.-]+/blob/[0-9a-f]{7,40}/[^\s]+", url):
        raise Rule("Use a GitHub commit permalink: open the file, select lines, press 'y', copy the URL "
                   "(…/blob/<commit>/path#L10-L40). Branch links move, so they aren't accepted.")
    if len(url) > 500 or len(a.note or "") > 120:
        raise Rule("Link (500) or note (120) is too long.")
    if not a.confirm:
        raise Rule("Confirm that this code implements the claim before saving.")
    claims = {c["id"] for c in (v4.read_json(v4.PROFILE, {}) or {}).get("claims", [])}
    if a.claim not in claims:
        raise Rule(f"Unknown claim '{a.claim}'.")
    return {"ok": True, "result": v4.add_evidence(a.claim, url, (a.note or "").strip())}


def do_debrief(v4, a):
    raw = sys.stdin.buffer.read(200_001).decode("utf-8", "replace") if a.data == "-" else (a.data or "")
    if len(raw) > 200_000:
        raise Rule("Debrief is too long.")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise Rule("Debrief data is not valid JSON.")
    if not isinstance(data, dict):
        raise Rule("Debrief data must be an object.")
    qs = data.get("questions")
    if isinstance(qs, list):
        data["questions"] = [q for q in qs if isinstance(q, dict) and str(q.get("q", "")).strip()]
        if len(data["questions"]) > 30:
            raise Rule("At most 30 questions per debrief.")
    db = v4.connect()
    try:
        v4.get_job(db, a.id)
    except ValueError:
        raise Rule(f"No job '{a.id}'.")
    n = v4.save_debrief(db, a.id, data)
    return {"ok": True, "questions": n}


def main(argv=None):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    argv = list(sys.argv[1:] if argv is None else argv)
    target = os.environ.get("JOB_OS_PY") or ""
    if not target or not Path(target).is_file():
        print("JOB_OS_PY is not set to an existing job_os.py", file=sys.stderr)
        return 1
    if is_legacy(target):
        return subprocess.run([sys.executable, target, *argv]).returncode

    p = argparse.ArgumentParser(prog="jobos_bridge.py")
    p.add_argument("--json", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("api")
    s.add_argument("view", choices=["today", "pipeline", "job", "prep", "readiness"])
    s.add_argument("id", nargs="?")
    s = sub.add_parser("record")
    s.add_argument("id"); s.add_argument("--status", required=True); s.add_argument("--note", default="")
    s.add_argument("--stage", default=""); s.add_argument("--external-submission", action="store_true")
    s = sub.add_parser("schedule")
    s.add_argument("id"); s.add_argument("--action", required=True); s.add_argument("--due", required=True)
    s.add_argument("--kind", choices=["task", "interview"], default="task")
    s = sub.add_parser("triage")
    s.add_argument("id"); s.add_argument("--decision", choices=["keep", "skip"], required=True)
    s.add_argument("--reason", default="")
    s = sub.add_parser("evidence")
    s.add_argument("claim"); s.add_argument("--url", required=True); s.add_argument("--note", default="")
    s.add_argument("--confirm", action="store_true")
    s = sub.add_parser("debrief")
    s.add_argument("id"); s.add_argument("--data", required=True)
    sub.add_parser("verify")
    a = p.parse_args(argv)

    v4 = load_v4(target)
    try:
        if a.cmd == "verify":
            result = evidence_counts(v4.read_json(v4.PROFILE, {}) or {})
        elif a.cmd == "record":
            result = do_record(v4, a)
        elif a.cmd == "schedule":
            result = do_schedule(v4, a)
        elif a.cmd == "triage":
            result = do_triage(v4, a)
        elif a.cmd == "evidence":
            result = do_evidence(v4, a)
        elif a.cmd == "debrief":
            result = do_debrief(v4, a)
        else:
            if a.view in ("job", "prep") and not a.id:
                raise Rule(f"`api {a.view}` needs a job id.")
            now = datetime.now(v4.JST)
            db = ro_db(v4)
            try:
                profile = v4.read_json(v4.PROFILE, {}) or {}
                graph = v4.SkillGraph()
                if a.view == "today":
                    result = api_today(v4, db, profile, now)
                elif a.view == "pipeline":
                    result = api_pipeline(v4, db, now)
                elif a.view == "readiness":
                    result = api_readiness(v4, db, profile, graph)
                elif a.view == "job":
                    result = api_job(v4, db, profile, graph, a.id, now)
                else:
                    result = api_prep(v4, db, profile, graph, a.id, now)
            finally:
                db.close()
    except (Rule, ValueError) as e:
        result = {"error": scrub(v4, str(e))}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
