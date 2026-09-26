#!/usr/bin/env python3
"""Job OS core: the one place where the job-search rules live.

The dashboard and the Hermes agent change data only by running this file.
Stdlib only. Data lives in $JOB_OS_DIR (default: ./workspace), never in git.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import unicodedata
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))
REPO_DIR = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")

STATUSES = ("discovered", "drafted", "reviewed", "applied", "interview", "offer",
            "rejected", "withdrawn", "closed")
END_STATES = {"rejected", "withdrawn", "closed"}
ACTIVE_STATES = {"drafted", "reviewed", "applied", "interview", "offer"}
EVIDENCE_REQUIRED = {"applied", "interview", "offer", "rejected"}
MIN_NOTE_CHARS = 15
ALLOWED = {
    "discovered": {"drafted", "rejected", "withdrawn", "closed"},
    "drafted": {"drafted", "reviewed", "withdrawn", "closed"},
    "reviewed": {"drafted", "reviewed", "applied", "withdrawn", "closed"},
    "applied": {"interview", "offer", "rejected", "withdrawn", "closed"},
    "interview": {"interview", "offer", "rejected", "withdrawn"},
    "offer": {"withdrawn", "closed"},
    # End states may be corrected (with evidence) but never reopened as a new draft.
    "rejected": {"applied", "interview", "offer", "withdrawn", "closed"},
    "withdrawn": {"applied", "interview", "offer", "rejected", "closed"},
    "closed": {"applied", "interview", "offer", "rejected", "withdrawn"},
}


class JobOSError(Exception):
    """A rule was broken. The message is shown to the user as-is."""


# ---------------------------------------------------------------- storage

def base_dir() -> Path:
    return Path(os.environ.get("JOB_OS_DIR") or REPO_DIR / "workspace").expanduser()


def load_json(name: str, default):
    path = base_dir() / name
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  company_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  posting TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'discovered',
  stage TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_kind TEXT NOT NULL DEFAULT 'task',
  due_at TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '[]',
  preferred TEXT NOT NULL DEFAULT '[]',
  prescreen TEXT NOT NULL DEFAULT '{}',
  override_reason TEXT NOT NULL DEFAULT '',
  sent_version INTEGER,
  calendar_event_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_company_key ON jobs(company_key);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  at TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id);
"""


def connect() -> sqlite3.Connection:
    data = base_dir() / "data"
    data.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(data / "job_os.sqlite3", timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def now_jst() -> datetime:
    return datetime.now(JST)


def iso(dt: datetime) -> str:
    return dt.astimezone(JST).isoformat(timespec="seconds")


def parse_due(text: str) -> datetime:
    """Parse a due time. A time without an offset is taken as JST."""
    try:
        dt = datetime.fromisoformat(text.strip().replace(" ", "T"))
    except ValueError as e:
        raise JobOSError(f"Due time '{text}' is not ISO format, e.g. 2026-10-03T14:00") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt.astimezone(JST)


def check_id(job_id: str) -> str:
    if not ID_RE.match(job_id or ""):
        raise JobOSError(f"Job id '{job_id}' must match {ID_RE.pattern}")
    return job_id


def get_job(conn: sqlite3.Connection, job_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (check_id(job_id),)).fetchone()
    if row is None:
        raise JobOSError(f"No job with id '{job_id}'. Run `job_os.py list` to see ids.")
    return row


def log_event(conn, job_id: str, status: str, note: str) -> None:
    conn.execute("INSERT INTO events (job_id, at, status, note) VALUES (?, ?, ?, ?)",
                 (job_id, iso(now_jst()), status, note))


# ---------------------------------------------------------------- companies

COMPANY_SUFFIXES = [
    "株式会社", "(株)", "（株）", "㈱", "合同会社", "有限会社",
    "inc.", "inc", "k.k.", "kk", "co., ltd.", "co.,ltd.", "co. ltd.", "ltd.", "ltd",
    "corporation", "corp.", "corp", "llc", "g.k.",
]


def company_key(name: str, companies: dict | None = None) -> str:
    s = unicodedata.normalize("NFKC", name).lower().strip()
    for suf in sorted(COMPANY_SUFFIXES, key=len, reverse=True):
        s = s.replace(unicodedata.normalize("NFKC", suf), " ")
    s = re.sub(r"[\s,.・\-_/()（）]+", "", s)
    companies = companies if companies is not None else load_json("companies.json", {})
    for key, info in companies.items():
        if key.startswith("_"):
            continue
        variants = {key.replace("-", "")} | {
            re.sub(r"[\s,.・\-_/]+", "", unicodedata.normalize("NFKC", a).lower())
            for a in info.get("aliases", [])
        }
        if s in variants:
            return key
    return s


def slugify(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60].strip("-")


# ---------------------------------------------------------------- prescreen

LEVELS = {"native": 5, "N1": 4, "N2": 3, "N3": 2, "N4": 1, "N5": 0}

JP_NATIVE = re.compile(r"(日本語|japanese)[^。\n]{0,12}(ネイティブ|native)|ネイティブレベル|native[- ]level japanese|母国語", re.I)
JP_BUSINESS = re.compile(r"ビジネスレベル|business[- ]level japanese|jlpt ?n1|日本語能力試験 ?n1", re.I)
JP_N2 = re.compile(r"jlpt ?n2|日本語能力試験 ?n2", re.I)
CS_MAJOR = re.compile(r"情報系(学部|学科|専攻)|情報(工学|科学)(部|科|専攻)|computer science (degree|major)|cs (degree|major)|degree in computer science", re.I)
SCIENCE_MAJOR = re.compile(r"理系(学部|学生|出身|限定)?|理工系|stem (degree|major)", re.I)
EXPERIENCE = re.compile(r"(?:実務)?経験\s*(\d+)\s*年以上|(\d+)\+?\s*years?(?: of)?(?: professional| work| relevant)? experience", re.I)
GRAD_YEAR = re.compile(r"(20)?(\d{2})\s*年?卒|(?:class of|graduat\w* in)\s*(20\d{2})", re.I)
PAIZA = re.compile(r"paiza[^。\n]{0,20}(ランク|rank)\s*([a-s])", re.I)


def prescreen(posting: str, company: str, job_id: str | None, conn, profile: dict,
              companies: dict) -> dict:
    """Return {'verdict': PASS|WARN|BLOCK, 'reasons': [{level, rule, detail}]}."""
    text = unicodedata.normalize("NFKC", posting)
    elig = profile.get("eligibility", {})
    reasons: list[dict] = []

    def add(level, rule, detail):
        reasons.append({"level": level, "rule": rule, "detail": detail})

    my_level = LEVELS.get(str(elig.get("japanese_level", "N1")), 4)
    if JP_NATIVE.search(text) and my_level < LEVELS["native"]:
        add("BLOCK", "japanese", "Posting asks for native-level Japanese.")
    elif JP_BUSINESS.search(text) and my_level < LEVELS["N1"]:
        add("BLOCK", "japanese", "Posting asks for business-level Japanese (N1).")
    elif JP_N2.search(text) and my_level < LEVELS["N2"]:
        add("BLOCK", "japanese", "Posting asks for JLPT N2.")

    if CS_MAJOR.search(text) and not elig.get("cs_major"):
        add("BLOCK", "major", "Posting requires a CS / 情報系 major.")
    elif SCIENCE_MAJOR.search(text) and not (elig.get("science_major") or elig.get("cs_major")):
        add("WARN", "major", "Posting prefers 理系 / STEM majors.")

    my_years = float(elig.get("experience_years", 0))
    for m in EXPERIENCE.finditer(text):
        years = int(m.group(1) or m.group(2))
        if years > my_years:
            add("BLOCK", "experience", f"Posting asks for {years}+ years of experience.")
            break

    grad = profile.get("graduation", {}).get("year")
    if grad:
        years_seen = set()
        for m in GRAD_YEAR.finditer(text):
            if m.group(3):
                years_seen.add(int(m.group(3)))
            elif m.group(2):
                years_seen.add(2000 + int(m.group(2)))
        years_seen = {y for y in years_seen if 2020 <= y <= 2035}
        if years_seen and grad not in years_seen:
            add("BLOCK", "graduation", f"Posting targets {', '.join(str(y) for y in sorted(years_seen))} graduates; you graduate in {grad}.")

    m = PAIZA.search(text)
    if m:
        add("WARN", "paiza", f"Posting mentions a Paiza rank {m.group(2).upper()} criterion; check yours.")

    key = company_key(company, companies)
    rows = conn.execute("SELECT id, status FROM jobs WHERE company_key = ?", (key,)).fetchall()
    for r in rows:
        if r["id"] != job_id and r["status"] in ACTIVE_STATES:
            add("BLOCK", "in-process", f"Already in process with this company ({r['id']}: {r['status']}).")
    info = companies.get(key, {})
    until = info.get("cooldown_until")
    if until and now_jst().date().isoformat() <= until:
        add("WARN", "history", f"Past result with this company; cooldown until {until}.")
    for h in info.get("history", []):
        add("WARN", "history", f"{h.get('year', '')} {h.get('stage', '')} {h.get('result', '')}: {h.get('note', '')}".strip())

    verdict = "PASS"
    if any(r["level"] == "WARN" for r in reasons):
        verdict = "WARN"
    if any(r["level"] == "BLOCK" for r in reasons):
        verdict = "BLOCK"
    return {"verdict": verdict, "reasons": reasons, "at": iso(now_jst())}


# ---------------------------------------------------------------- skill graph

def norm_skill(s: str, graph: dict) -> str:
    k = unicodedata.normalize("NFKC", s).strip().lower()
    return graph.get("aliases", {}).get(k, k)


def match_requirements(requirements: list[str], profile: dict, graph: dict) -> list[dict]:
    """Match each requirement to reviewed claims directly or via reviewed implies-edges."""
    edges: dict[str, list[str]] = {}
    for e in graph.get("implies", []):
        if e.get("reviewed") is True:
            edges.setdefault(norm_skill(e["from"], graph), []).append(norm_skill(e["to"], graph))
    claims = [c for c in profile.get("claims", []) if c.get("reviewed") is True]
    out = []
    for req in requirements:
        target = norm_skill(req, graph)
        hits = []
        for c in claims:
            skills = [norm_skill(s, graph) for s in c.get("skills", [])]
            if target in skills:
                hits.append({"claim": c["id"], "kind": "direct", "path": [target]})
                continue
            # BFS from each claim skill along reviewed edges.
            best = None
            for start in skills:
                seen, q = {start}, deque([[start]])
                while q:
                    path = q.popleft()
                    if path[-1] == target:
                        if best is None or len(path) < len(best):
                            best = path
                        break
                    for nxt in edges.get(path[-1], []):
                        if nxt not in seen:
                            seen.add(nxt)
                            q.append(path + [nxt])
            if best:
                hits.append({"claim": c["id"], "kind": "inferred", "path": best})
        kind = "direct" if any(h["kind"] == "direct" for h in hits) else ("inferred" if hits else "none")
        out.append({"requirement": req, "skill": target, "match": kind, "claims": hits})
    return out


# ---------------------------------------------------------------- commands

def cmd_init(args) -> dict:
    d = base_dir()
    d.mkdir(parents=True, exist_ok=True)
    copied = []
    if args.example:
        for name in ("profile.json", "skills_graph.json", "companies.json"):
            dest = d / name
            if not dest.exists():
                shutil.copy(REPO_DIR / "examples" / name, dest)
                copied.append(name)
    connect().close()
    return {"dir": str(d), "copied": copied}


def split_list(s: str | None) -> list[str]:
    if not s:
        return []
    return [x.strip() for x in re.split(r"[,、\n]", s) if x.strip()]


def cmd_add(args) -> dict:
    conn = connect()
    profile, companies = load_json("profile.json", {}), load_json("companies.json", {})
    posting = args.posting or ""
    if args.posting_file:
        posting = Path(args.posting_file).read_text(encoding="utf-8")
    key = company_key(args.company, companies)
    job_id = args.id or slugify(f"{key}-{args.title}") or f"job-{int(now_jst().timestamp())}"
    check_id(job_id)
    for r in conn.execute("SELECT id, title, status FROM jobs WHERE company_key = ?", (key,)):
        same_title = slugify(r["title"]) == slugify(args.title)
        if same_title and r["status"] in END_STATES:
            raise JobOSError(f"'{r['id']}' already ended ({r['status']}). A finished job can't be reopened as a new posting.")
        if same_title or r["id"] == job_id:
            raise JobOSError(f"Duplicate: this posting is already tracked as '{r['id']}' ({r['status']}).")
    if conn.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone():
        raise JobOSError(f"Job id '{job_id}' is taken. Pass --id.")
    screen = prescreen(posting, args.company, job_id, conn, profile, companies)
    ts = iso(now_jst())
    with conn:
        conn.execute(
            """INSERT INTO jobs (id, company, company_key, title, url, posting, requirements,
               preferred, prescreen, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (job_id, args.company, key, args.title, args.url or "", posting,
             json.dumps(split_list(args.requirements), ensure_ascii=False),
             json.dumps(split_list(args.preferred), ensure_ascii=False),
             json.dumps(screen, ensure_ascii=False), ts, ts))
        log_event(conn, job_id, "discovered", f"Added. Prescreen: {screen['verdict']}")
    return {"id": job_id, "company_key": key, "prescreen": screen}


def cmd_prescreen(args) -> dict:
    conn = connect()
    job = get_job(conn, args.id)
    screen = prescreen(job["posting"], job["company"], job["id"], conn,
                       load_json("profile.json", {}), load_json("companies.json", {}))
    with conn:
        conn.execute("UPDATE jobs SET prescreen = ?, updated_at = ? WHERE id = ?",
                     (json.dumps(screen, ensure_ascii=False), iso(now_jst()), job["id"]))
    return {"id": job["id"], "prescreen": screen}


def cmd_override(args) -> dict:
    reason = (args.reason or "").strip()
    if len(reason) < MIN_NOTE_CHARS:
        raise JobOSError(f"Give a real override reason (at least {MIN_NOTE_CHARS} characters).")
    conn = connect()
    job = get_job(conn, args.id)
    with conn:
        conn.execute("UPDATE jobs SET override_reason = ?, updated_at = ? WHERE id = ?",
                     (reason, iso(now_jst()), job["id"]))
        log_event(conn, job["id"], job["status"], f"Prescreen override: {reason}")
    return {"id": job["id"], "override_reason": reason}


def job_match(job) -> list[dict]:
    profile, graph = load_json("profile.json", {}), load_json("skills_graph.json", {})
    reqs = json.loads(job["requirements"])
    prefs = json.loads(job["preferred"])
    res = match_requirements(reqs + prefs, profile, graph)
    for i, r in enumerate(res):
        r["preferred"] = i >= len(reqs)
    return res


def cmd_match(args) -> dict:
    conn = connect()
    job = get_job(conn, args.id)
    return {"id": job["id"], "match": job_match(job)}


def drafts_dir(job_id: str) -> Path:
    return base_dir() / "drafts" / job_id


def versions(job_id: str) -> list[int]:
    d = drafts_dir(job_id)
    if not d.exists():
        return []
    return sorted(int(m.group(1)) for p in d.glob("v*.json") if (m := re.match(r"v(\d+)\.json$", p.name)))


def cmd_draft(args) -> dict:
    conn = connect()
    job = get_job(conn, args.id)
    screen = json.loads(job["prescreen"] or "{}")
    if screen.get("verdict") == "BLOCK" and not job["override_reason"]:
        detail = "; ".join(r["detail"] for r in screen.get("reasons", []) if r["level"] == "BLOCK")
        raise JobOSError(f"Prescreen is BLOCK ({detail}). Drafting refused. Record a reason with `override {job['id']} --reason ...` first.")
    if job["status"] in END_STATES or job["status"] in {"applied", "interview", "offer"}:
        raise JobOSError(f"Job is '{job['status']}'; drafts are only for discovered, drafted or reviewed jobs.")
    profile = load_json("profile.json", {})
    claims = {c["id"]: c for c in profile.get("claims", []) if c.get("reviewed") is True}
    match = job_match(job)
    picked: dict[str, dict] = {}
    for m in match:
        for h in m["claims"]:
            entry = picked.setdefault(h["claim"], {"claim": h["claim"], "covers": [], "score": 0})
            entry["covers"].append({"requirement": m["requirement"], "kind": h["kind"], "path": h["path"]})
            entry["score"] += (1 if m["preferred"] else 3) + (1 if h["kind"] == "direct" else 0)
    ordered = sorted(picked.values(), key=lambda e: (-e["score"], e["claim"]))
    manifest_claims = []
    for e in ordered:
        why = ", ".join(
            f"{c['requirement']} ({c['kind']}{': ' + ' → '.join(c['path']) if c['kind'] == 'inferred' else ''})"
            for c in e["covers"])
        manifest_claims.append({"claim": e["claim"], "text": claims[e["claim"]]["text"], "why": why,
                                "has_evidence": bool(claims[e["claim"]].get("evidence"))})
    unmatched = [m["requirement"] for m in match if m["match"] == "none"]
    n = (versions(job["id"]) or [0])[-1] + 1
    d = drafts_dir(job["id"])
    d.mkdir(parents=True, exist_ok=True)
    manifest = {"job": job["id"], "version": n, "created_at": iso(now_jst()),
                "claims": manifest_claims, "unmatched": unmatched}
    (d / f"v{n}.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [f"# {job['company']} — {job['title']} (v{n})", "", "## Selected experience", ""]
    lines += [f"- {c['text']}" for c in manifest_claims]
    if unmatched:
        lines += ["", "<!-- Not covered by any reviewed claim: " + ", ".join(unmatched) + " -->"]
    (d / f"v{n}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    with conn:
        if job["status"] == "discovered":
            conn.execute("UPDATE jobs SET status = 'drafted' WHERE id = ?", (job["id"],))
        conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (iso(now_jst()), job["id"]))
        log_event(conn, job["id"], "drafted", f"Draft v{n}: {len(manifest_claims)} claims, {len(unmatched)} unmatched")
    return manifest


def cmd_record(args) -> dict:
    status = args.status
    if status not in STATUSES:
        raise JobOSError(f"Unknown status '{status}'. Use one of: {', '.join(STATUSES)}")
    note = (args.note or "").strip()
    if status in EVIDENCE_REQUIRED and len(note) < MIN_NOTE_CHARS:
        raise JobOSError(f"Record the confirmation (quote the email or page) in --note. '{status}' needs evidence of at least {MIN_NOTE_CHARS} characters.")
    if len(note) > 2000:
        raise JobOSError("Note is too long (2000 characters max).")
    conn = connect()
    job = get_job(conn, args.id)
    cur = job["status"]
    if status not in ALLOWED[cur]:
        if cur in END_STATES and status in {"discovered", "drafted", "reviewed"}:
            raise JobOSError(f"'{job['id']}' has ended ({cur}) and can't move back to {status}.")
        raise JobOSError(f"Can't move from '{cur}' to '{status}'. Allowed: {', '.join(sorted(ALLOWED[cur])) or 'none'}.")
    updates = {"status": status, "updated_at": iso(now_jst())}
    if args.stage is not None:
        updates["stage"] = args.stage.strip()[:40]
    if status == "applied":
        vs = versions(job["id"])
        if args.version is not None:
            if args.version not in vs:
                raise JobOSError(f"Draft v{args.version} doesn't exist. Versions: {vs or 'none'}.")
            updates["sent_version"] = args.version
        elif vs:
            updates["sent_version"] = vs[-1]
    if status in END_STATES:
        updates.update(next_action="", due_at="", next_kind="task")
    sets = ", ".join(f"{k} = ?" for k in updates)
    with conn:
        conn.execute(f"UPDATE jobs SET {sets} WHERE id = ?", (*updates.values(), job["id"]))
        log_event(conn, job["id"], status, note)
    return {"id": job["id"], "from": cur, **updates}


def cmd_schedule(args) -> dict:
    action = (args.action or "").strip()
    if not action or len(action) > 200:
        raise JobOSError("Next action must be 1–200 characters.")
    due = parse_due(args.due)
    conn = connect()
    job = get_job(conn, args.id)
    if job["status"] in END_STATES:
        raise JobOSError(f"'{job['id']}' has ended ({job['status']}); nothing to schedule.")
    kind = args.kind or "task"
    with conn:
        conn.execute("UPDATE jobs SET next_action = ?, due_at = ?, next_kind = ?, updated_at = ? WHERE id = ?",
                     (action, iso(due), kind, iso(now_jst()), job["id"]))
        log_event(conn, job["id"], job["status"], f"Next: {action} (due {iso(due)})")
    return {"id": job["id"], "next_action": action, "due_at": iso(due), "next_kind": kind}


def job_summary(row) -> dict:
    screen = json.loads(row["prescreen"] or "{}")
    due = row["due_at"]
    overdue = bool(due) and parse_due(due) < now_jst()
    return {"id": row["id"], "company": row["company"], "title": row["title"], "status": row["status"],
            "stage": row["stage"], "next_action": row["next_action"], "next_kind": row["next_kind"],
            "due_at": due, "overdue": overdue, "verdict": screen.get("verdict", ""),
            "override": bool(row["override_reason"])}


def cmd_list(args) -> dict:
    conn = connect()
    rows = conn.execute("SELECT * FROM jobs ORDER BY updated_at DESC").fetchall()
    return {"jobs": [job_summary(r) for r in rows]}


def due_items(conn) -> list[dict]:
    rows = conn.execute("SELECT * FROM jobs WHERE due_at != '' ORDER BY due_at").fetchall()
    items = [job_summary(r) for r in rows if r["status"] not in END_STATES]
    return sorted(items, key=lambda j: (not j["overdue"], j["due_at"]))


def cmd_due(args) -> dict:
    return {"now": iso(now_jst()), "due": due_items(connect())}


def claims_status(profile: dict) -> list[dict]:
    out = []
    for c in profile.get("claims", []):
        out.append({"id": c["id"], "text": c["text"], "reviewed": c.get("reviewed") is True,
                    "evidence": c.get("evidence", []), "has_evidence": bool(c.get("evidence")),
                    "skills": c.get("skills", [])})
    return out


def build_prep(job) -> dict:
    profile, companies = load_json("profile.json", {}), load_json("companies.json", {})
    claims = {c["id"]: c for c in profile.get("claims", [])}
    sent = None
    if job["sent_version"]:
        p = drafts_dir(job["id"]) / f"v{job['sent_version']}.json"
        if p.exists():
            sent = json.loads(p.read_text(encoding="utf-8"))
    probe = []
    for c in (sent or {}).get("claims", []):
        full = claims.get(c["claim"], {})
        probe.append({"claim": c["claim"], "text": c["text"], "evidence": full.get("evidence", []),
                      "missing_evidence": not full.get("evidence"),
                      "questions": full.get("probe_questions", [])})
    info = companies.get(job["company_key"], {})
    return {"job": job_summary(job), "sent_version": job["sent_version"], "sent": sent,
            "probe": probe, "history": info.get("history", []), "lessons": info.get("lessons", []),
            "match": job_match(job)}


def prep_markdown(prep: dict) -> str:
    j = prep["job"]
    lines = [f"# Interview prep: {j['company']} — {j['title']}", ""]
    if j["due_at"]:
        lines += [f"**Next:** {j['next_action']} · {j['due_at']}", ""]
    lines += ["## What they received", ""]
    if prep["sent"]:
        lines += [f"Résumé v{prep['sent_version']}:", ""] + [f"- {c['text']}" for c in prep["sent"]["claims"]]
    else:
        lines.append("No sent version recorded. Mark the job applied to pin one.")
    lines += ["", "## Claims they may probe", ""]
    for p in prep["probe"]:
        warn = " — **NO CODE EVIDENCE: fix before the interview**" if p["missing_evidence"] else ""
        lines.append(f"### {p['claim']}{warn}")
        lines.append(p["text"])
        for e in p["evidence"]:
            lines.append(f"- Code: {e['url']} ({e.get('note', '')})")
        for q in p["questions"]:
            lines.append(f"- Q: {q}")
        lines.append("")
    if prep["history"] or prep["lessons"]:
        lines += ["## History and lessons", ""]
        lines += [f"- {h.get('year', '')} {h.get('stage', '')} {h.get('result', '')}: {h.get('note', '')}" for h in prep["history"]]
        lines += [f"- Lesson: {l}" for l in prep["lessons"]]
    return "\n".join(lines).rstrip() + "\n"


def cmd_prep(args) -> dict:
    conn = connect()
    prep = build_prep(get_job(conn, args.id))
    md = prep_markdown(prep)
    d = base_dir() / "prep"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{args.id}.md").write_text(md, encoding="utf-8")
    (base_dir() / "interview_prep.md").write_text(md, encoding="utf-8")
    return {"id": args.id, "markdown": md, **prep}


def cmd_verify(args) -> dict:
    claims = claims_status(load_json("profile.json", {}))
    reviewed = [c for c in claims if c["reviewed"]]
    missing = [c["id"] for c in reviewed if not c["has_evidence"]]
    return {"reviewed": len(reviewed), "linked": len(reviewed) - len(missing), "missing_evidence": missing}


# ---------------------------------------------------------------- JSON views for the dashboard

def api_today(conn) -> dict:
    now = now_jst()
    active = [r for r in conn.execute("SELECT * FROM jobs").fetchall() if r["status"] not in END_STATES]
    interviews = sorted((job_summary(r) for r in active
                         if r["next_kind"] == "interview" and r["due_at"] and parse_due(r["due_at"]) >= now),
                        key=lambda j: j["due_at"])
    horizon = now + timedelta(days=14)
    upcoming = [j for j in due_items(conn) if j["overdue"] or parse_due(j["due_at"]) <= horizon]
    profile = load_json("profile.json", {})
    v = cmd_verify(None)
    waiting = []
    for r in active:
        if r["status"] == "drafted":
            waiting.append({"kind": "review", "job": r["id"], "text": f"Review the draft for {r['company']}"})
        screen = json.loads(r["prescreen"] or "{}")
        if r["status"] == "discovered" and screen.get("verdict") != "BLOCK":
            waiting.append({"kind": "triage", "job": r["id"], "text": f"Decide on {r['company']} — {r['title']}"})
    for cid in v["missing_evidence"]:
        waiting.append({"kind": "evidence", "claim": cid, "text": f"Claim '{cid}' has no code link"})
    counts = {s: 0 for s in STATUSES}
    for r in conn.execute("SELECT status, COUNT(*) n FROM jobs GROUP BY status"):
        counts[r["status"]] = r["n"]
    return {"now": iso(now), "next_interview": interviews[0] if interviews else None,
            "upcoming": upcoming, "waiting": waiting, "counts": counts,
            "evidence": {"reviewed": v["reviewed"], "linked": v["linked"]},
            "profile_loaded": bool(profile)}


def api_pipeline(conn) -> dict:
    groups = {s: [] for s in STATUSES}
    for r in conn.execute("SELECT * FROM jobs ORDER BY updated_at DESC"):
        groups[r["status"]].append(job_summary(r))
    return {"order": list(STATUSES), "groups": groups}


def api_job(conn, job_id: str) -> dict:
    job = get_job(conn, job_id)
    profile = load_json("profile.json", {})
    claims = {c["id"]: c for c in profile.get("claims", [])}
    match = job_match(job)
    for m in match:
        for h in m["claims"]:
            h["text"] = claims.get(h["claim"], {}).get("text", "")
    events = [dict(r) for r in conn.execute("SELECT at, status, note FROM events WHERE job_id = ? ORDER BY id DESC", (job_id,))]
    vs = []
    for n in versions(job_id):
        m = json.loads((drafts_dir(job_id) / f"v{n}.json").read_text(encoding="utf-8"))
        vs.append({"version": n, "created_at": m["created_at"], "claims": len(m["claims"]),
                   "unmatched": m["unmatched"], "sent": job["sent_version"] == n})
    return {"job": {**job_summary(job), "url": job["url"], "posting": job["posting"],
                    "override_reason": job["override_reason"], "sent_version": job["sent_version"]},
            "prescreen": json.loads(job["prescreen"] or "{}"), "match": match,
            "versions": vs, "events": events, "allowed_next": sorted(ALLOWED[job["status"]])}


def api_readiness(conn) -> dict:
    profile = load_json("profile.json", {})
    claims = claims_status(profile)
    gaps: dict[str, int] = {}
    for r in conn.execute("SELECT * FROM jobs").fetchall():
        if r["status"] in END_STATES:
            continue
        for m in job_match(r):
            if m["match"] == "none":
                gaps[m["requirement"]] = gaps.get(m["requirement"], 0) + 1
    v = cmd_verify(None)
    return {"claims": claims, "evidence": v,
            "gaps": sorted(({"requirement": k, "jobs": n} for k, n in gaps.items()), key=lambda g: -g["jobs"])}


def cmd_api(args) -> dict:
    conn = connect()
    view = args.view
    if view == "today":
        return api_today(conn)
    if view == "pipeline":
        return api_pipeline(conn)
    if view == "readiness":
        return api_readiness(conn)
    if view in ("job", "prep"):
        if not args.id:
            raise JobOSError(f"`api {view}` needs a job id.")
        if view == "job":
            return api_job(conn, args.id)
        return cmd_prep(args)
    raise JobOSError(f"Unknown view '{view}'.")


# ---------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="job_os.py", description="Job OS core. Every write goes through here.")
    p.add_argument("--json", action="store_true", help="print JSON (default for `api`)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="create the data dir and database")
    s.add_argument("--example", action="store_true", help="copy the synthetic example config")
    s.set_defaults(fn=cmd_init)

    s = sub.add_parser("add", help="add a posting and prescreen it")
    s.add_argument("--company", required=True)
    s.add_argument("--title", required=True)
    s.add_argument("--id")
    s.add_argument("--url")
    s.add_argument("--posting", help="posting text")
    s.add_argument("--posting-file")
    s.add_argument("--requirements", help="comma-separated required skills")
    s.add_argument("--preferred", help="comma-separated preferred skills")
    s.set_defaults(fn=cmd_add)

    for name, fn in (("prescreen", cmd_prescreen), ("match", cmd_match), ("draft", cmd_draft), ("prep", cmd_prep)):
        s = sub.add_parser(name)
        s.add_argument("id")
        s.set_defaults(fn=fn)

    s = sub.add_parser("override", help="record why you are drafting despite a BLOCK")
    s.add_argument("id")
    s.add_argument("--reason", required=True)
    s.set_defaults(fn=cmd_override)

    s = sub.add_parser("record", help="change status (evidence note required for applied/interview/offer/rejected)")
    s.add_argument("id")
    s.add_argument("--status", required=True, choices=STATUSES)
    s.add_argument("--note", default="")
    s.add_argument("--stage")
    s.add_argument("--version", type=int, help="draft version sent (applied only)")
    s.set_defaults(fn=cmd_record)

    s = sub.add_parser("schedule", help="set the next action and its due time (JST if no offset)")
    s.add_argument("id")
    s.add_argument("--action", required=True)
    s.add_argument("--due", required=True)
    s.add_argument("--kind", choices=("task", "interview"), default="task")
    s.set_defaults(fn=cmd_schedule)

    for name, fn in (("list", cmd_list), ("due", cmd_due), ("verify", cmd_verify)):
        sub.add_parser(name).set_defaults(fn=fn)

    s = sub.add_parser("api", help="JSON views for the dashboard")
    s.add_argument("view", choices=("today", "pipeline", "job", "prep", "readiness"))
    s.add_argument("id", nargs="?")
    s.set_defaults(fn=cmd_api, json_out=True)
    return p


def human(cmd: str, out: dict) -> str:
    if cmd == "list":
        return "\n".join(f"{j['id']:<40} {j['status']:<10} {j['verdict']:<5} {j['due_at']}" for j in out["jobs"]) or "No jobs."
    if cmd == "due":
        return "\n".join(f"{'OVERDUE ' if j['overdue'] else ''}{j['due_at']}  {j['id']}: {j['next_action']}" for j in out["due"]) or "Nothing due."
    if cmd == "prep":
        return out["markdown"]
    return json.dumps(out, ensure_ascii=False, indent=2)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        out = args.fn(args)
    except JobOSError as e:
        if args.json or getattr(args, "json_out", False):
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
        else:
            print(f"error: {e}", file=sys.stderr)
        return 2
    if args.json or getattr(args, "json_out", False):
        print(json.dumps(out, ensure_ascii=False))
    else:
        print(human(args.cmd, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
