"""Taskline: a team task tracker with planted functional bugs, for checking what the AI QA Scanner finds.

The bugs are listed in BUGS.md (the answer key), which is never served. Comments marking a planted
bug (BUG-nn) only appear in this server-side code; the pages and scripts the scanner reads carry none.

Each visitor (cookie) gets a private copy of the demo workspace, kept in memory, so parallel scans never see each
other's changes. A restart starts every workspace afresh.
"""

import csv
import datetime as dt
import hashlib
import hmac
import html
import io
import json
import os
import re
import secrets
import threading
import time
from collections import OrderedDict
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

from . import data

HERE = Path(__file__).resolve().parent
PAGES_DIR = HERE / "pages"
STATIC_DIR = HERE / "static"
STATIC_TYPES = {".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
    ),
}
MAX_BODY = 64 * 1024
MAX_SESSIONS = 1000
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
ROLES = ("admin", "member", "viewer")
DATE_FORMATS = ("DMY", "MDY", "ISO")
STATUS_NAMES = {"todo": "To do", "doing": "In progress", "review": "In review", "done": "Done"}

# path -> (page, title, extra scripts)
PAGES = {
    "/": ("dashboard", "Dashboard", []),
    "/board": ("board", "Board", ["panel"]),
    "/tasks": ("tasks", "Tasks", ["panel"]),
    "/timesheet": ("timesheet", "Timesheet", []),
    "/reports": ("reports", "Reports", []),
    "/projects": ("projects", "Projects", []),
    "/team": ("team", "Team", []),
    "/notifications": ("notifications", "Notifications", []),
    "/settings": ("settings", "Settings", []),
}
AUTH_PAGES = {"/login": ("login", "Log in"), "/forgot": ("forgot", "Reset your password")}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def today() -> dt.date:
    return dt.datetime.now(dt.UTC).date()


def _text(body: dict, key: str, limit: int = 200) -> str:
    value = body.get(key, "")
    return value.strip()[:limit] if isinstance(value, str) else ""


def _date(value) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not DATE.fullmatch(value):
        raise ApiError(400, "Dates look like YYYY-MM-DD.")
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        raise ApiError(400, "That date does not exist.") from None
    return value


def _check_password(member: dict, password) -> bool:
    if not isinstance(password, str):
        return False
    return hmac.compare_digest(member["hash"], data.password_hash(password, bytes.fromhex(member["salt"])))


def public_member(m: dict) -> dict:
    return {k: m[k] for k in ("id", "name", "email", "role", "color")}


def task_summary(t: dict) -> dict:
    out = {k: v for k, v in t.items() if k != "comments"}
    out["comment_count"] = len(t["comments"])
    return out


class Store:
    """Sessions, each with its own workspace once someone logs in."""

    def __init__(self):
        self.lock = threading.Lock()
        self.sessions: OrderedDict[str, dict] = OrderedDict()

    def session(self, sid: str | None) -> tuple[str, dict]:
        if sid and sid in self.sessions:
            self.sessions.move_to_end(sid)
            return sid, self.sessions[sid]
        sid = secrets.token_urlsafe(24)
        self.sessions[sid] = {"ws": None, "user": None}
        while len(self.sessions) > MAX_SESSIONS:
            self.sessions.popitem(last=False)
        return sid, self.sessions[sid]

    # lookups

    @staticmethod
    def workspace(sess: dict) -> dict:
        if sess["ws"] is None:
            sess["ws"] = data.workspace(today(), time.time())
        return sess["ws"]

    @staticmethod
    def member(ws: dict, mid) -> dict | None:
        return next((m for m in ws["members"] if m["id"] == mid), None)

    def user(self, sess: dict) -> dict | None:
        if sess["ws"] is None or sess["user"] is None:
            return None
        return self.member(sess["ws"], sess["user"])

    def signed_in(self, sess: dict) -> tuple[dict, dict]:
        user = self.user(sess)
        if not user:
            raise ApiError(401, "Please log in.")
        return sess["ws"], user

    @staticmethod
    def task(ws: dict, key: str) -> dict:
        t = next((t for t in ws["tasks"] if t["key"] == key), None)
        if not t:
            raise ApiError(404, "Task not found.")
        return t

    @staticmethod
    def can_edit(user: dict) -> None:
        if user["role"] == "viewer":
            raise ApiError(403, "Viewers can't change the workspace.")

    @staticmethod
    def log(ws: dict, user: dict, text: str, key: str | None) -> None:
        ws["activity"].insert(0, {"member": user["id"], "text": text, "task": key, "at": int(time.time())})
        del ws["activity"][50:]

    # workspace views

    def me(self, sess: dict) -> dict:
        ws, user = self.signed_in(sess)
        day = today()
        return {
            "user": public_member(user),
            "prefs": user["prefs"],
            "today": day.isoformat(),
            "week_start": data.week_start(day).isoformat(),
            "unread": len(ws["notifications"].get(user["id"], [])),  # BUG-41: read ones count too
        }

    def projects(self, ws: dict) -> list[dict]:
        out = []
        for p in ws["projects"]:
            tasks = [t for t in ws["tasks"] if t["project"] == p["key"]]
            done = sum(t["status"] == "done" for t in tasks)
            left = len(tasks) - done
            progress = round(100 * done / left) if left else 100  # BUG-09: done / not done, not done / all
            out.append({**p, "total": len(tasks), "done": done, "progress": progress})
        return out

    def workspace_view(self, sess: dict) -> dict:
        ws, user = self.signed_in(sess)
        return {
            **self.me(sess),
            "members": [public_member(m) for m in ws["members"]],
            "projects": self.projects(ws),
            "tasks": [task_summary(t) for t in ws["tasks"]],
            "invites": ws["invites"],
            "seats": {"total": data.SEATS, "used": len(ws["members"])},  # BUG-35: pending invites left out
            "wip_limit": data.WIP_LIMIT,
        }

    def dashboard(self, sess: dict) -> dict:
        ws, user = self.signed_in(sess)
        day = today()
        now_iso, tomorrow = day.isoformat(), (day + dt.timedelta(days=1)).isoformat()
        monday = dt.datetime.combine(data.week_start(day), dt.time(), tzinfo=dt.UTC).timestamp()
        open_tasks = [t for t in ws["tasks"] if t["status"] != "done"]
        due_today = [t for t in open_tasks if t["due"] and now_iso <= t["due"] <= tomorrow]  # BUG-08: and tomorrow
        overdue = [t for t in ws["tasks"] if t["due"] and t["due"] < now_iso]  # BUG-07: done tasks counted
        completed = [t for t in ws["tasks"] if t["status"] == "done" and (t["completed"] or 0) >= monday]
        mine = sorted(
            (t for t in open_tasks if t["assignee"] == user["id"]), key=lambda t: (t["due"] is None, t["due"] or "")
        )
        names = {m["id"]: m["name"] for m in ws["members"]}
        return {
            "tiles": {"open": len(open_tasks), "due_today": len(due_today), "overdue": len(overdue)}
            | {"completed_week": len(completed)},
            "my_tasks": [task_summary(t) for t in mine],
            "projects": self.projects(ws),
            "activity": [{**a, "name": names.get(a["member"], "Someone")} for a in ws["activity"][:8]],
        }

    def task_detail(self, sess: dict, key: str) -> dict:
        ws, user = self.signed_in(sess)
        t = self.task(ws, key)
        names = {m["id"]: m["name"] for m in ws["members"]}
        entries = [{**e, "name": names.get(e["member"], "Former member")} for e in ws["time"] if e["task"] == key]
        return {
            "task": {
                **t,
                "comments": [{**c, "name": names.get(c["author"], "Former member")} for c in t["comments"]],
            },
            "time": entries,
            "time_total": round(sum(e["hours"] for e in entries), 2),
            "activity": [{**a, "name": names.get(a["member"], "Someone")} for a in ws["activity"] if a["task"] == key],
        }

    # tasks

    def create_task(self, sess: dict, body: dict) -> dict:
        ws, user = self.signed_in(sess)  # BUG-04: viewers are not refused here
        title = _text(body, "title")
        if not title:
            raise ApiError(400, "Give the task a title.")
        project = _text(body, "project") or "WEB"
        if project not in {p["key"] for p in ws["projects"]}:
            raise ApiError(400, "Choose a project.")
        status = body.get("status") or "todo"
        priority = body.get("priority") or "medium"
        if status not in data.STATUSES or priority not in data.PRIORITIES:
            raise ApiError(400, "Choose a valid status and priority.")
        assignee = body.get("assignee") or None
        if assignee is not None and not self.member(ws, assignee):
            raise ApiError(400, "Choose someone in the workspace.")
        number = sum(t["project"] == project for t in ws["tasks"]) + 1  # BUG-28: reuses numbers after a delete
        now = int(time.time())
        t = {
            "key": f"{project}-{number}",
            "project": project,
            "title": title,
            "description": _text(body, "description", 4000),
            "status": status,
            "assignee": assignee,
            "priority": priority,
            "due": _date(body.get("due")),
            "created": now,
            "updated": now,
            "completed": now if status == "done" else None,
            "subtasks": [],
            "comments": [],
        }
        ws["tasks"].append(t)
        self.log(ws, user, f"created {t['key']}", t["key"])
        return task_summary(t)

    def update_task(self, sess: dict, key: str, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        t = self.task(ws, key)
        fields = ("title", "description", "status", "assignee", "priority", "due")
        changes = {k: body[k] for k in fields if k in body}  # BUG-11: the board's drag sends "column", ignored
        if user["role"] == "viewer" and set(changes) - {"status"}:  # BUG-06: status alone gets through
            raise ApiError(403, "Viewers can't edit tasks.")
        if "title" in changes:
            t["title"] = _text(changes, "title")  # BUG-22: an empty title is accepted when editing
        if "description" in changes:
            t["description"] = _text(changes, "description", 4000)
        if "status" in changes:
            if changes["status"] not in data.STATUSES:
                raise ApiError(400, "Choose a valid status.")
            if changes["status"] != t["status"]:
                t["completed"] = int(time.time()) if changes["status"] == "done" else None
                self.log(ws, user, f"moved {key} to {STATUS_NAMES[changes['status']]}", key)
            t["status"] = changes["status"]
        if "assignee" in changes:
            assignee = changes["assignee"] or None
            if assignee is not None and not self.member(ws, assignee):
                raise ApiError(400, "Choose someone in the workspace.")
            t["assignee"] = assignee
        if "priority" in changes:
            if changes["priority"] not in data.PRIORITIES:
                raise ApiError(400, "Choose a valid priority.")
            t["priority"] = changes["priority"]
        if "due" in changes:
            t["due"] = _date(changes["due"])
        t["updated"] = int(time.time())
        return task_summary(t)

    def delete_task(self, sess: dict, key: str) -> dict:
        ws, user = self.signed_in(sess)
        self.can_edit(user)
        t = self.task(ws, key)
        ws["tasks"].remove(t)
        self.log(ws, user, f"deleted {key}", None)
        return {"ok": True}

    def bulk(self, sess: dict, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        self.can_edit(user)
        keys = body.get("keys")
        if not isinstance(keys, list) or not keys:
            raise ApiError(400, "Select some tasks.")
        tasks = [t for t in ws["tasks"] if t["key"] in set(map(str, keys))]
        action = body.get("action")
        if action == "done":
            for t in tasks:
                if t["status"] != "done":
                    t.update(status="done", completed=int(time.time()), updated=int(time.time()))
        elif action == "delete":
            ws["tasks"] = [t for t in ws["tasks"] if t not in tasks]
        elif action == "assign":
            assignee = body.get("assignee") or None
            if assignee is not None and not self.member(ws, assignee):
                raise ApiError(400, "Choose someone in the workspace.")
            for t in tasks:
                t.update(assignee=assignee, updated=int(time.time()))
        else:
            raise ApiError(400, "Unknown action.")
        self.log(ws, user, f"updated {len(tasks)} tasks", None)
        return {"count": len(tasks)}

    def add_subtask(self, sess: dict, key: str, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        self.can_edit(user)
        t = self.task(ws, key)
        text = _text(body, "text")
        if not text:
            raise ApiError(400, "Write the subtask.")
        t["subtasks"] = (t["subtasks"] + [{"text": text, "done": False}])[:30]
        return self.task_detail(sess, key)

    def toggle_subtask(self, sess: dict, key: str, index: int, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        self.can_edit(user)
        t = self.task(ws, key)
        if not 0 <= index < len(t["subtasks"]):
            raise ApiError(404, "Subtask not found.")
        t["subtasks"][index]["done"] = bool(body.get("done"))
        return self.task_detail(sess, key)

    def add_comment(self, sess: dict, key: str, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        t = self.task(ws, key)
        text = _text(body, "text", 2000)
        if not text:
            raise ApiError(400, "Write a comment first.")
        t["comments"].append(
            {"id": ws["next_comment"], "author": user["id"], "text": text, "created": int(time.time())}
        )
        ws["next_comment"] += 1
        del t["comments"][:-100]
        self.log(ws, user, f"commented on {key}", key)
        return self.task_detail(sess, key)

    def edit_comment(self, sess: dict, key: str, cid: int, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        t = self.task(ws, key)
        c = next((c for c in t["comments"] if c["id"] == cid), None)
        if not c:
            raise ApiError(404, "Comment not found.")
        if c["author"] != user["id"]:
            raise ApiError(403, "You can only edit your own comments.")
        text = _text(body, "text", 2000)
        if not text:
            raise ApiError(400, "Write a comment first.")
        c["text"] = text
        return self.task_detail(sess, key)

    def export(self, sess: dict, query: dict) -> bytes:
        ws, user = self.signed_in(sess)
        q = (query.get("q") or [""])[0].strip().lower()
        want = {k: (query.get(k) or [""])[0] for k in ("project", "assignee", "status", "priority", "due")}
        day = today().isoformat()
        names = {m["id"]: m["name"] for m in ws["members"]}
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["Key", "Title", "Project", "Status", "Priority", "Assignee", "Due"])
        for t in ws["tasks"]:
            if q and q not in t["title"].lower() and q not in t["key"].lower():
                continue
            if want["project"] and t["project"] != want["project"]:
                continue
            if want["assignee"] and str(t["assignee"] or "none") != want["assignee"]:
                continue
            if want["status"] and t["status"] != want["status"]:
                continue
            if want["priority"] and t["priority"] != want["priority"]:
                continue
            if want["due"] == "overdue" and not (t["due"] and t["due"] < day and t["status"] != "done"):
                continue
            if want["due"] == "today" and t["due"] != day:
                continue
            row = [t["key"], t["title"], t["project"], STATUS_NAMES[t["status"]], t["priority"].title()]
            w.writerow(row + [names.get(t["assignee"], ""), t["due"] or ""])
        return out.getvalue().encode()

    # time

    def week(self, sess: dict, query: dict) -> dict:
        ws, user = self.signed_in(sess)
        start = _date((query.get("week") or [""])[0]) or data.week_start(today()).isoformat()
        monday = data.week_start(dt.date.fromisoformat(start))
        days = [(monday + dt.timedelta(days=i)).isoformat() for i in range(7)]
        entries = [e for e in ws["time"] if e["member"] == user["id"] and e["date"] in days]
        titles = {t["key"]: t["title"] for t in ws["tasks"]}
        return {
            "week_start": days[0],
            "days": days,
            "entries": [{**e, "title": titles.get(e["task"], "Deleted task")} for e in entries],
            "target": 40,
        }

    def log_time(self, sess: dict, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        self.can_edit(user)
        key = _text(body, "task")
        self.task(ws, key)
        date = _date(body.get("date")) or today().isoformat()
        hours = body.get("hours")
        if isinstance(hours, bool) or not isinstance(hours, int | float) or not 0.25 <= hours <= 24:
            raise ApiError(400, "Log between 0.25 and 24 hours.")
        # BUG-32: the rule is at most 24 h a day in total; only each entry is checked
        entry = {
            "id": ws["next_time"],
            "member": user["id"],
            "task": key,
            "date": date,
            "hours": round(float(hours), 2),
            "note": _text(body, "note"),
        }
        ws["next_time"] += 1
        ws["time"].append(entry)
        return entry

    def delete_time(self, sess: dict, eid: int) -> dict:
        ws, user = self.signed_in(sess)
        entry = next((e for e in ws["time"] if e["id"] == eid and e["member"] == user["id"]), None)
        if not entry:
            raise ApiError(404, "Entry not found.")
        ws["time"].remove(entry)
        return {"ok": True}

    # projects and team

    def create_project(self, sess: dict, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        self.can_edit(user)
        name, key = _text(body, "name", 60), _text(body, "key").upper()
        color = _text(body, "color") or "#4b5f9e"
        if not name:
            raise ApiError(400, "Name the project.")
        if not re.fullmatch(r"[A-Z]{2,5}", key):
            raise ApiError(400, "The key is 2 to 5 letters.")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ApiError(400, "Choose a colour.")
        if any(p["key"] == key for p in ws["projects"]):
            raise ValueError(f"duplicate project key {key}")  # BUG-44: a crash, not a 400 the page can show
        ws["projects"].append({"key": key, "name": name, "color": color})
        self.log(ws, user, f"created project {name}", None)
        return {"project": self.projects(ws)[-1]}

    def invite(self, sess: dict, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        if user["role"] != "admin":
            raise ApiError(403, "Only admins can invite people.")
        email, role = _text(body, "email").lower(), body.get("role") or "member"
        if not EMAIL.fullmatch(email):
            raise ApiError(400, "Enter a valid email address.")
        if role not in ROLES:
            raise ApiError(400, "Choose a role.")
        if any(i["email"] == email for i in ws["invites"]):
            raise ApiError(409, f"{email} has already been invited.")
        # BUG-34: an email that already belongs to a member is not refused
        # BUG-35: the seat limit is not checked
        ws["invites"].append({"email": email, "role": role, "sent": today().isoformat()})
        del ws["invites"][:-50]
        return {"invites": ws["invites"]}

    def invite_action(self, sess: dict, body: dict, action: str) -> dict:
        ws, user = self.signed_in(sess)
        if user["role"] != "admin":
            raise ApiError(403, "Only admins can manage invites.")
        email = _text(body, "email").lower()
        invite = next((i for i in ws["invites"] if i["email"] == email), None)
        if not invite:
            raise ApiError(404, "Invite not found.")
        if action == "revoke":
            ws["invites"].remove(invite)
        else:
            invite["sent"] = today().isoformat()
        return {"invites": ws["invites"]}

    def set_role(self, sess: dict, mid: int, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        if user["role"] != "admin":
            raise ApiError(403, "Only admins can change roles.")
        m = self.member(ws, mid)
        if not m:
            raise ApiError(404, "Member not found.")
        if m["id"] == data.OWNER_ID:
            raise ApiError(400, "The workspace owner is always an admin.")
        if body.get("role") not in ROLES:
            raise ApiError(400, "Choose a role.")
        m["role"] = body["role"]
        return {"member": public_member(m)}

    def remove_member(self, sess: dict, mid: int) -> dict:
        ws, user = self.signed_in(sess)
        self.can_edit(user)  # BUG-05: only admins should remove people
        m = self.member(ws, mid)
        if not m:
            raise ApiError(404, "Member not found.")
        if m["id"] in (data.OWNER_ID, user["id"]):
            raise ApiError(400, "You can't remove yourself or the workspace owner.")
        ws["members"].remove(m)
        ws["tasks"] = [t for t in ws["tasks"] if t["assignee"] != mid]  # BUG-36: should unassign, not delete
        ws["notifications"].pop(mid, None)
        self.log(ws, user, f"removed {m['name']}", None)
        return {"ok": True}

    # settings

    def settings(self, sess: dict, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        prefs = user["prefs"]
        if "name" in body:
            name = _text(body, "name", 60)
            if not name:
                raise ApiError(400, "Enter your name.")
            user["name"] = name
        if "date_format" in body:
            if body["date_format"] not in DATE_FORMATS:
                raise ApiError(400, "Choose a date format.")
            prefs["date_format"] = body["date_format"]
        if "theme" in body:
            if body["theme"] not in ("light", "dark"):
                raise ApiError(400, "Choose light or dark.")
            prefs["theme"] = body["theme"]
        for key in ("notify_assign", "notify_comment"):
            if key in body:
                prefs[key] = bool(body[key])
        return self.me(sess)

    def change_password(self, sess: dict, body: dict) -> dict:
        ws, user = self.signed_in(sess)
        new, confirm = body.get("new"), body.get("confirm")
        if not _check_password(user, body.get("current")):
            raise ApiError(400, "Your current password is not right.")
        if not isinstance(new, str) or len(new) < 8 or not re.search(r"\d", new):
            raise ApiError(400, "Use at least 8 characters, including a number.")
        if new != confirm:
            raise ApiError(400, "The new passwords don't match.")
        owner = self.member(ws, data.OWNER_ID)  # BUG-03: changes the owner's password, not the signed-in user's
        salt = secrets.token_bytes(16)
        owner.update(salt=salt.hex(), hash=data.password_hash(new[:200], salt))
        return {"ok": True}

    # notifications and reports

    def notifications(self, sess: dict) -> dict:
        ws, user = self.signed_in(sess)
        return {"notifications": sorted(ws["notifications"].get(user["id"], []), key=lambda n: -n["created"])}

    def read(self, sess: dict, nid: int | None) -> dict:
        ws, user = self.signed_in(sess)
        for n in ws["notifications"].get(user["id"], []):
            if nid is None or n["id"] == nid:
                n["read"] = True
        return self.notifications(sess)

    def reports(self, sess: dict, query: dict) -> dict:
        ws, user = self.signed_in(sess)
        try:
            days = int((query.get("days") or ["30"])[0])
        except ValueError:
            days = 30
        now = time.time()
        done = [t for t in ws["tasks"] if t["status"] == "done" and t["completed"]]
        created = list(ws["tasks"])
        # BUG-39: the range is never applied to the totals below
        durations = [(t["completed"] - t["created"]) / 86400 for t in done]
        monday = dt.datetime.combine(data.week_start(today()), dt.time(), tzinfo=dt.UTC).timestamp()
        weeks = []
        for i in range(7, -1, -1):
            start = monday - i * 7 * 86400
            label = dt.datetime.fromtimestamp(start, dt.UTC).date().isoformat()
            weeks.append({"week": label, "done": sum(start <= t["completed"] < start + 7 * 86400 for t in done)})
        workload = {m["id"]: 0 for m in ws["members"]}
        for t in ws["tasks"]:
            if t["status"] != "done":
                owner = t["assignee"] or ws["members"][0]["id"]  # BUG-40: unassigned work lands on the owner
                if owner in workload:
                    workload[owner] += 1
        return {
            "days": days,
            "completed": len(done),
            "created": len(created),
            "avg_days": round(sum(durations) / len(durations), 1) if durations else 0,
            "weeks": weeks,
            "workload": [{"name": m["name"], "open": workload[m["id"]]} for m in ws["members"]],
            "generated": int(now),
        }

    # accounts

    def login(self, sess: dict, body: dict) -> dict:
        ws = self.workspace(sess)
        email = _text(body, "email").lower()
        m = next((m for m in ws["members"] if m["email"] == email), None)
        if not m or not _check_password(m, body.get("password")):
            raise ApiError(401, "Incorrect email or password.")
        sess["user"] = m["id"]
        return self.me(sess)

    def forgot(self, body: dict) -> dict:
        email = _text(body, "email").lower()
        if not EMAIL.fullmatch(email):
            raise ApiError(400, "Enter a valid email address.")
        account = re.match(r"[\w.]+@", email).group(0)  # BUG-02: "+" or "-" before the @ crashes this
        token = hashlib.sha256((account + secrets.token_hex(8)).encode()).hexdigest()[:12]
        return {"ok": True, "message": f"If an account exists for {email}, we've sent a reset link.", "ref": token}


def _initials(name: str) -> str:
    return "".join(w[0] for w in name.split()[:2]).upper()


def render(path: str, user: dict | None, unread: int) -> bytes:
    page, title, extra = PAGES.get(path) or (*AUTH_PAGES.get(path, ("404", "Page not found")), [])
    if path in PAGES and user:
        layout = (PAGES_DIR / "_app.html").read_text()
        scripts = "".join(f'<script src="/static/{name}.js" defer></script>' for name in extra + [page])
    elif page == "404" and user:
        layout, scripts = (PAGES_DIR / "_app.html").read_text(), ""
    else:
        layout, scripts = (PAGES_DIR / "_auth.html").read_text(), '<script src="/static/auth.js" defer></script>'
    prefs = user["prefs"] if user else {}
    values = {
        "title": html.escape(title),
        "page": page,
        "scripts": scripts,
        "theme": "dark" if prefs.get("dark_mode") else "light",  # BUG-37: the setting is saved as "theme"
        "date_format": prefs.get("date_format", "DMY"),
        "role": user["role"] if user else "",
        "user_name": html.escape(user["name"]) if user else "",
        "initials": html.escape(_initials(user["name"])) if user else "",
        "user_color": user["color"] if user else "#888888",
        "unread": str(unread),
        "content": (PAGES_DIR / f"{page}.html").read_text(),
    }
    out = layout
    for k, v in values.items():
        out = out.replace("{{" + k + "}}", v)
    return out.encode()


def make_handler(store: Store | None = None):
    store = store or Store()
    static = {f.name: f for f in STATIC_DIR.iterdir() if f.is_file() and f.suffix in STATIC_TYPES}

    class Handler(BaseHTTPRequestHandler):
        server_version = "taskline"

        def log_message(self, fmt, *args):
            pass

        def _session(self) -> tuple[str, dict, bool]:
            sid = None
            try:
                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                sid = cookie["tl_sid"].value if "tl_sid" in cookie else None
            except CookieError:
                pass
            new_sid, sess = store.session(sid)
            return new_sid, sess, new_sid != sid

        def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in {**SECURITY_HEADERS, **(extra or {})}.items():
                self.send_header(k, v)
            if self._new_sid:
                secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
                self.send_header("Set-Cookie", f"tl_sid={self._sid}; Path=/; HttpOnly; SameSite=Lax{secure}")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status: int, payload: dict):
            self._send(status, json.dumps(payload).encode(), "application/json")

        def _body(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise ApiError(400, "Bad request.") from None
            if length > MAX_BODY:
                raise ApiError(413, "Request too large.")
            raw = self.rfile.read(length) if length > 0 else b""
            try:
                payload = json.loads(raw or b"{}")
            except ValueError:
                raise ApiError(400, "Send JSON.") from None
            if not isinstance(payload, dict):
                raise ApiError(400, "Send a JSON object.")
            return payload

        def do_HEAD(self):
            self._handle("GET")

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

        def _handle(self, method: str):
            self._sid, self._new_sid = None, False
            url = urlsplit(self.path)
            path = url.path.rstrip("/") or "/"
            try:
                if path == "/healthz":
                    return self._send(200, b"ok", "text/plain")
                if path == "/robots.txt":
                    return self._send(200, b"User-agent: *\nAllow: /\n", "text/plain")
                if path.startswith("/static/") and path[8:] in static:
                    f = static[path[8:]]
                    return self._send(200, f.read_bytes(), STATIC_TYPES[f.suffix])
                with store.lock:
                    self._sid, sess, self._new_sid = self._session()
                    if path.startswith("/api/"):
                        body = self._body() if method == "POST" else {}
                        result = self._api(sess, method, path, body, parse_qs(url.query))
                        if isinstance(result, bytes):
                            headers = {"Content-Disposition": 'attachment; filename="taskline-tasks.csv"'}
                            return self._send(200, result, "text/csv; charset=utf-8", headers)
                        return self._json(200, result)
                    if method != "GET":
                        return self._send(405, b"Method not allowed", "text/plain", {"Allow": "GET, HEAD"})
                    user = store.user(sess)
                    if path in PAGES and not user:
                        target = quote(path + (f"?{url.query}" if url.query else ""), safe="")
                        return self._send(302, b"", "text/plain", {"Location": f"/login?next={target}"})
                    status = 200 if path in PAGES or path in AUTH_PAGES else 404
                    unread = len(sess["ws"]["notifications"].get(user["id"], [])) if user else 0  # BUG-41
                    page = render(path if status == 200 else "/404", user if path not in AUTH_PAGES else None, unread)
                    return self._send(status, page, "text/html; charset=utf-8")
            except ApiError as err:
                return self._json(err.status, {"ok": False, "error": str(err)})
            except Exception:
                return self._json(500, {"ok": False, "error": "Internal Server Error"})

        def _api(self, sess: dict, method: str, path: str, body: dict, query: dict):
            if method == "GET":
                gets = {
                    "/api/me": lambda: store.me(sess),
                    "/api/workspace": lambda: store.workspace_view(sess),
                    "/api/dashboard": lambda: store.dashboard(sess),
                    "/api/time": lambda: store.week(sess, query),
                    "/api/notifications": lambda: store.notifications(sess),
                    "/api/reports": lambda: store.reports(sess, query),
                    "/api/export.csv": lambda: store.export(sess, query),
                }
                if path in gets:
                    return gets[path]()
                m = re.fullmatch(r"/api/tasks/([A-Z]{2,5}-\d+)", path)
                if m:
                    return store.task_detail(sess, m.group(1))
                raise ApiError(404, "Not found.")
            posts = {
                "/api/login": lambda: store.login(sess, body),
                "/api/logout": lambda: sess.update(user=None) or {"ok": True},
                "/api/forgot": lambda: store.forgot(body),
                "/api/tasks": lambda: store.create_task(sess, body),
                "/api/tasks/bulk": lambda: store.bulk(sess, body),
                "/api/time": lambda: store.log_time(sess, body),
                "/api/projects": lambda: store.create_project(sess, body),
                "/api/invites": lambda: store.invite(sess, body),
                "/api/invites/resend": lambda: store.invite_action(sess, body, "resend"),
                "/api/invites/revoke": lambda: store.invite_action(sess, body, "revoke"),
                "/api/settings": lambda: store.settings(sess, body),
                "/api/password": lambda: store.change_password(sess, body),
                "/api/notifications/read-all": lambda: store.read(sess, None),
            }
            if path in posts:
                return posts[path]()
            patterns = [
                (r"/api/tasks/([A-Z]{2,5}-\d+)", lambda k: store.update_task(sess, k, body)),
                (r"/api/tasks/([A-Z]{2,5}-\d+)/delete", lambda k: store.delete_task(sess, k)),
                (r"/api/tasks/([A-Z]{2,5}-\d+)/subtasks", lambda k: store.add_subtask(sess, k, body)),
                (r"/api/tasks/([A-Z]{2,5}-\d+)/comments", lambda k: store.add_comment(sess, k, body)),
                (r"/api/time/(\d+)/delete", lambda i: store.delete_time(sess, int(i))),
                (r"/api/members/(\d+)/role", lambda i: store.set_role(sess, int(i), body)),
                (r"/api/members/(\d+)/remove", lambda i: store.remove_member(sess, int(i))),
                (r"/api/notifications/(\d+)/read", lambda i: store.read(sess, int(i))),
            ]
            for pattern, run in patterns:
                m = re.fullmatch(pattern, path)
                if m:
                    return run(m.group(1))
            m = re.fullmatch(r"/api/tasks/([A-Z]{2,5}-\d+)/subtasks/(\d+)", path)
            if m:
                return store.toggle_subtask(sess, m.group(1), int(m.group(2)), body)
            m = re.fullmatch(r"/api/tasks/([A-Z]{2,5}-\d+)/comments/(\d+)", path)
            if m:
                return store.edit_comment(sess, m.group(1), int(m.group(2)), body)
            raise ApiError(404, "Not found.")

    return Handler


def serve(env: dict[str, str] | None = None) -> None:
    env = dict(os.environ if env is None else env)
    port = int(env.get("PORT", "8081"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), make_handler())
    print(f"Taskline listening on :{port}", flush=True)
    httpd.serve_forever()
