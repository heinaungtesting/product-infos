import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import job_os  # noqa: E402


def run(*argv):
    """Run the CLI with --json and return (exit code, parsed output)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
        code = job_os.main(["--json", *argv])
    return code, json.loads(buf.getvalue())


class JobOSTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["JOB_OS_DIR"] = self.tmp.name
        code, _ = run("init", "--example")
        self.assertEqual(code, 0)

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop("JOB_OS_DIR", None)

    def add(self, company="Acme", title="Frontend Engineer", posting="", req="typescript,react", **kw):
        args = ["add", "--company", company, "--title", title, "--posting", posting, "--requirements", req]
        for k, v in kw.items():
            args += [f"--{k}", v]
        return run(*args)

    # --- dedupe / company keys
    def test_company_key_folds_suffixes_and_aliases(self):
        self.assertEqual(job_os.company_key("株式会社Acme"), job_os.company_key("Acme Inc."))
        self.assertEqual(job_os.company_key("ACME K.K."), "acme")
        self.assertEqual(job_os.company_key("エグザンプルテック株式会社"), "example-tech")

    def test_duplicate_posting_refused(self):
        self.assertEqual(self.add()[0], 0)
        code, out = self.add(company="株式会社Acme")
        self.assertEqual(code, 2)
        self.assertIn("Duplicate", out["error"])

    def test_ended_job_cannot_be_readded(self):
        _, out = self.add()
        run("record", out["id"], "--status", "rejected", "--note", "Email 10/1: 今回は見送り")
        code, err = self.add()
        self.assertEqual(code, 2)
        self.assertIn("can't be reopened", err["error"])

    # --- prescreen
    def test_prescreen_blocks_native_japanese(self):
        _, out = self.add(posting="応募条件：日本語ネイティブレベルの方")
        self.assertEqual(out["prescreen"]["verdict"], "BLOCK")
        self.assertEqual(out["prescreen"]["reasons"][0]["rule"], "japanese")

    def test_prescreen_passes_business_japanese_with_n1(self):
        _, out = self.add(posting="ビジネスレベルの日本語 (JLPT N1)")
        self.assertEqual(out["prescreen"]["verdict"], "PASS")

    def test_prescreen_blocks_cs_major_experience_and_grad_year(self):
        _, out = self.add(posting="情報系学部の方。実務経験3年以上。2026年卒業予定の方")
        rules = {r["rule"] for r in out["prescreen"]["reasons"] if r["level"] == "BLOCK"}
        self.assertEqual(rules, {"major", "experience", "graduation"})

    def test_prescreen_blocks_company_already_in_process(self):
        _, a = self.add()
        run("draft", a["id"])
        _, b = self.add(title="Backend Engineer")
        self.assertEqual(b["prescreen"]["verdict"], "BLOCK")
        self.assertEqual(b["prescreen"]["reasons"][0]["rule"], "in-process")

    def test_prescreen_warns_on_company_history(self):
        _, out = self.add(company="ExampleTech")
        self.assertEqual(out["prescreen"]["verdict"], "WARN")

    # --- drafting
    def test_draft_refused_on_block_until_override(self):
        _, out = self.add(posting="日本語ネイティブの方")
        code, err = run("draft", out["id"])
        self.assertEqual(code, 2)
        self.assertIn("BLOCK", err["error"])
        self.assertEqual(run("override", out["id"], "--reason", "Recruiter said N1 is fine by phone")[0], 0)
        self.assertEqual(run("draft", out["id"])[0], 0)

    def test_draft_versions_and_manifest(self):
        _, out = self.add(req="javascript,react,go")
        _, v1 = run("draft", out["id"])
        _, v2 = run("draft", out["id"])
        self.assertEqual((v1["version"], v2["version"]), (1, 2))
        ids = [c["claim"] for c in v1["claims"]]
        self.assertIn("shop-offline-sync", ids)
        self.assertNotIn("draft-unreviewed", ids)  # unreviewed claims never reach a résumé
        self.assertEqual(v1["unmatched"], ["go"])
        self.assertIn("typescript → javascript", v1["claims"][0]["why"])

    # --- skill graph
    def test_match_direct_inferred_and_unreviewed_edges(self):
        _, out = self.add(req="react,javascript,backend,go")
        _, m = run("match", out["id"])
        kinds = {r["requirement"]: r["match"] for r in m["match"]}
        self.assertEqual(kinds, {"react": "direct", "javascript": "inferred", "backend": "none", "go": "none"})

    # --- status rules
    def test_status_needs_evidence_note(self):
        _, out = self.add()
        run("draft", out["id"])
        run("record", out["id"], "--status", "reviewed")
        code, err = run("record", out["id"], "--status", "applied", "--note", "sent")
        self.assertEqual(code, 2)
        self.assertIn("confirmation", err["error"])
        code, rec = run("record", out["id"], "--status", "applied", "--note", "マイナビ: 応募が完了しました 9/28")
        self.assertEqual(code, 0)
        self.assertEqual(rec["sent_version"], 1)  # latest draft pinned

    def test_end_state_cannot_go_back(self):
        _, out = self.add()
        run("record", out["id"], "--status", "closed")
        code, err = run("record", out["id"], "--status", "drafted")
        self.assertEqual(code, 2)
        self.assertIn("can't move back", err["error"])

    def test_invalid_id_rejected(self):
        code, err = run("record", "../etc", "--status", "closed")
        self.assertEqual(code, 2)
        self.assertIn("must match", err["error"])

    # --- deadlines and views
    def test_schedule_jst_and_overdue_first(self):
        _, a = self.add()
        _, b = self.add(company="Beta")
        run("schedule", a["id"], "--action", "Send ES", "--due", "2099-01-01T10:00")
        past = (job_os.now_jst() - timedelta(hours=1)).replace(tzinfo=None).isoformat(timespec="minutes")
        run("schedule", b["id"], "--action", "Reply to recruiter", "--due", past)
        _, due = run("due")
        self.assertEqual(due["due"][0]["id"], b["id"])
        self.assertTrue(due["due"][0]["overdue"])
        self.assertTrue(due["due"][1]["due_at"].endswith("+09:00"))

    def test_today_prep_and_readiness_views(self):
        _, out = self.add()
        run("draft", out["id"])
        run("record", out["id"], "--status", "reviewed")
        run("record", out["id"], "--status", "applied", "--note", "応募完了メール受信 2026-09-28")
        run("record", out["id"], "--status", "interview", "--note", "面接日程確定のメール 10/3 14:00", "--stage", "1次")
        run("schedule", out["id"], "--action", "1次面接", "--due", "2099-10-03T14:00", "--kind", "interview")
        _, today = run("api", "today")
        self.assertEqual(today["next_interview"]["id"], out["id"])
        self.assertTrue(any(w["kind"] == "evidence" for w in today["waiting"]))
        _, prep = run("api", "prep", out["id"])
        self.assertIn("NO CODE EVIDENCE", prep["markdown"])  # shop-csrf has no link
        _, ready = run("api", "readiness")
        self.assertEqual(ready["evidence"]["missing_evidence"], ["shop-csrf"])


if __name__ == "__main__":
    unittest.main()
