"""Taskline's server-side planted bugs stay planted (BUGS.md) and nothing it serves gives them away."""

import http.cookiejar
import json
import re
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from buggy_tasks import data, server

PW = data.PASSWORD


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Client:
    """One browser: keeps its session cookie, so it has its own workspace."""

    def __init__(self, base: str):
        self.base = base
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())

    def request(self, path: str, body: dict | None = None) -> tuple[int, bytes, dict]:
        payload = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=payload, headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(req) as resp:
                return resp.status, resp.read(), dict(resp.headers)
        except urllib.error.HTTPError as err:
            return err.code, err.read(), dict(err.headers)

    def get(self, path: str) -> tuple[int, dict]:
        status, raw, _ = self.request(path)
        return status, json.loads(raw)

    def post(self, path: str, body: dict | None = None) -> tuple[int, dict]:
        status, raw, _ = self.request(path, body or {})
        return status, json.loads(raw)

    def login(self, who: str = "alex", password: str = PW) -> int:
        return self.post("/api/login", {"email": f"{who}@taskline.test", "password": password})[0]

    def ws(self) -> dict:
        return self.get("/api/workspace")[1]


@pytest.fixture
def base_url():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.Store()))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


@pytest.fixture
def as_user(base_url):
    def make(who: str = "alex") -> Client:
        c = Client(base_url)
        assert c.login(who) == 200
        return c

    return make


def test_pages_need_a_login(base_url):
    c = Client(base_url)
    status, _, headers = c.request("/tasks?status=done")
    assert status == 302 and headers["Location"] == "/login?next=%2Ftasks%3Fstatus%3Ddone"
    assert c.request("/login")[0] == 200 and c.request("/forgot")[0] == 200
    assert c.request("/nope")[0] == 404
    assert c.get("/api/workspace")[0] == 401
    assert c.login("alex", "wrong") == 401
    assert c.login() == 200
    for path in server.PAGES:
        status, body, headers = c.request(path)
        assert status == 200 and b"<main" in body and headers["Content-Type"].startswith("text/html"), path
    assert c.request("/static/core.js")[0] == 200 and c.request("/healthz")[1] == b"ok"


def test_answer_key_is_never_served_or_hinted(as_user):
    c = as_user()
    for path in ("/BUGS.md", "/static/../BUGS.md", "/server.py", "/data.py", "/static/../server.py"):
        assert c.request(path)[0] == 404, path
    for folder in (server.STATIC_DIR, server.PAGES_DIR):
        for f in folder.iterdir():
            text = f.read_text()
            assert not re.search(r"bug|planted", text, re.I), f.name


def test_each_browser_has_its_own_workspace(as_user):
    a, b = as_user(), as_user()
    a.post("/api/tasks", {"title": "Only in A", "project": "OPS"})
    assert any(t["title"] == "Only in A" for t in a.ws()["tasks"])
    assert not any(t["title"] == "Only in A" for t in b.ws()["tasks"])
    assert len(b.ws()["tasks"]) == len(data.TASKS)


def test_forgot_password_crashes_on_plus(base_url):  # BUG-02
    c = Client(base_url)
    assert c.post("/api/forgot", {"email": "sam@taskline.test"})[0] == 200
    assert c.post("/api/forgot", {"email": "sam+qa@taskline.test"})[0] == 500
    assert c.post("/api/forgot", {"email": "nope"})[0] == 400


def test_password_change_hits_the_owner(as_user):  # BUG-03
    sam = as_user("sam")
    body = {"current": PW, "new": "Newpass123", "confirm": "Newpass123"}
    assert sam.post("/api/password", body)[0] == 200
    sam.post("/api/logout")
    assert sam.login("sam", "Newpass123") == 401 and sam.login("sam", PW) == 200
    assert sam.login("alex", PW) == 401 and sam.login("alex", "Newpass123") == 200
    assert sam.post("/api/password", {**body, "current": "wrong"})[0] == 400
    assert sam.post("/api/password", {"current": "Newpass123", "new": "short", "confirm": "short"})[0] == 400


def test_role_checks(as_user):
    viv = as_user("viv")
    assert viv.post("/api/tasks", {"title": "Viewer task"})[0] == 200  # BUG-04
    assert viv.post("/api/tasks/WEB-3", {"status": "review"})[1]["status"] == "review"  # BUG-06
    assert viv.post("/api/tasks/WEB-3", {"title": "Nope"})[0] == 403
    assert viv.post("/api/tasks/WEB-3/delete")[0] == 403
    assert viv.post("/api/members/6/remove")[0] == 403
    sam = as_user("sam")
    assert sam.post("/api/members/6/remove")[0] == 200  # BUG-05
    assert sam.post("/api/members/2/role", {"role": "admin"})[0] == 403
    assert sam.post("/api/invites", {"email": "x@example.com"})[0] == 403


def test_dashboard_numbers(as_user):
    c = as_user()
    d = c.get("/api/dashboard")[1]
    tasks = c.ws()["tasks"]
    today = server.today().isoformat()
    open_overdue = [t for t in tasks if t["due"] and t["due"] < today and t["status"] != "done"]
    due_today = [t for t in tasks if t["due"] == today and t["status"] != "done"]
    assert len(open_overdue) == 4 and d["tiles"]["overdue"] == 16  # BUG-07
    assert len(due_today) == 2 and d["tiles"]["due_today"] == 4  # BUG-08
    progress = {p["key"]: p["progress"] for p in d["projects"]}
    assert progress == {"WEB": 56, "MOB": 20, "OPS": 150}  # BUG-09


def test_task_updates(as_user):
    c = as_user()
    assert c.post("/api/tasks/WEB-14", {"column": "review"})[1]["status"] == "todo"  # BUG-11: what a drag sends
    assert c.post("/api/tasks/WEB-14", {"status": "review"})[1]["status"] == "review"
    assert c.post("/api/tasks/WEB-14", {"title": ""})[1]["title"] == ""  # BUG-22
    assert c.post("/api/tasks", {"title": ""})[0] == 400
    assert c.post("/api/tasks/WEB-14", {"due": "2026-02-30"})[0] == 400


def test_new_task_reuses_a_deleted_key(as_user):  # BUG-28
    c = as_user()
    assert c.post("/api/tasks", {"title": "First", "project": "WEB"})[1]["key"] == "WEB-15"
    c.post("/api/tasks/WEB-5/delete")
    assert c.post("/api/tasks", {"title": "Second", "project": "WEB"})[1]["key"] == "WEB-15"
    assert [t["key"] for t in c.ws()["tasks"]].count("WEB-15") == 2


def test_time_limits(as_user):
    c = as_user()
    day = server.today().isoformat()
    assert c.post("/api/time", {"task": "WEB-3", "date": day, "hours": 25})[0] == 400
    assert c.post("/api/time", {"task": "WEB-3", "date": day, "hours": 0.1})[0] == 400
    assert c.post("/api/time", {"task": "WEB-3", "date": day, "hours": 20})[0] == 200
    assert c.post("/api/time", {"task": "WEB-3", "date": day, "hours": 10})[0] == 200  # BUG-32: 30 h in a day
    week = c.get(f"/api/time?week={day}")[1]
    assert sum(e["hours"] for e in week["entries"] if e["date"] == day) == 30


def test_team(as_user):
    c = as_user()
    ws = c.ws()
    assert ws["seats"] == {"total": 8, "used": 6} and len(ws["invites"]) == 1  # BUG-35: pending not counted
    assert c.post("/api/invites", {"email": "sam@taskline.test"})[0] == 200  # BUG-34
    assert c.post("/api/invites", {"email": "sam@taskline.test"})[0] == 409
    for n in range(4):
        assert c.post("/api/invites", {"email": f"p{n}@example.com"})[0] == 200  # BUG-35: past 8 seats
    jordan = [t for t in c.ws()["tasks"] if t["assignee"] == 5]
    assert c.post("/api/members/5/remove")[0] == 200
    left = c.ws()["tasks"]
    assert len(jordan) == 6 and not any(t["key"] in {j["key"] for j in jordan} for t in left)  # BUG-36
    assert c.post("/api/members/1/remove")[0] == 400


def test_theme_is_saved_but_not_shown(as_user):  # BUG-37
    c = as_user()
    assert c.post("/api/settings", {"theme": "dark", "date_format": "MDY"})[1]["prefs"]["theme"] == "dark"
    page = c.request("/settings")[1]
    assert b'data-theme="light"' in page and b'data-date-format="MDY"' in page


def test_reports(as_user):
    c = as_user()
    week, quarter = c.get("/api/reports?days=7")[1], c.get("/api/reports?days=90")[1]
    assert week["completed"] == quarter["completed"] == 13  # BUG-39
    workload = {w["name"]: w["open"] for w in week["workload"]}
    assert workload["Alex Rivera"] == 9  # BUG-40: 5 of his own + 4 unassigned


def test_unread_counts_read_ones(as_user):  # BUG-41
    c = as_user()
    assert c.get("/api/me")[1]["unread"] == 4
    c.post("/api/notifications/read-all")
    assert c.get("/api/me")[1]["unread"] == 4
    assert b'id="unread-count" class="badge">4<' in c.request("/")[1]


def test_projects(as_user):
    c = as_user()
    assert c.post("/api/projects", {"name": "Website v2", "key": "WEB"})[0] == 500  # BUG-44
    assert c.post("/api/projects", {"name": "Data", "key": "D1"})[0] == 400
    assert c.post("/api/projects", {"name": "Data", "key": "DATA"})[1]["project"]["key"] == "DATA"


def test_export_filters_work_on_the_server(as_user):
    c = as_user()
    status, raw, headers = c.request("/api/export.csv?status=done")
    lines = raw.decode().strip().splitlines()
    assert status == 200 and headers["Content-Type"].startswith("text/csv") and len(lines) == 14
    assert len(c.request("/api/export.csv")[1].decode().strip().splitlines()) == 37


def test_bad_requests(as_user):
    c = as_user()
    assert c.get("/api/tasks/NOPE-1")[0] == 404
    assert c.get("/api/nothing")[0] == 404
    req = urllib.request.Request(c.base + "/api/tasks", data=b"not json")
    with pytest.raises(urllib.error.HTTPError) as err:
        c.opener.open(req)
    assert err.value.code == 400
