"""Taskline's demo workspace: members, projects, tasks, time, notifications and activity, dated from today.

Every visitor gets a fresh copy (see server.Store), so scans never disturb each other.
"""

import datetime as dt
import hashlib

PASSWORD = "Taskline@2026"
SALT = b"taskline-demo-salt"
SEATS = 8
WIP_LIMIT = 3  # cards allowed in "In progress" on a project's board

STATUSES = ["todo", "doing", "review", "done"]
PRIORITIES = ["urgent", "high", "medium", "low"]

# id, name, email, role, avatar colour
MEMBERS = [
    (1, "Alex Rivera", "alex@taskline.test", "admin", "#4b5f9e"),
    (2, "Sam Patel", "sam@taskline.test", "member", "#2f7a68"),
    (3, "Viv Chen", "viv@taskline.test", "viewer", "#8a5a9e"),
    (4, "Priya Nair", "priya@taskline.test", "member", "#b5532d"),
    (5, "Jordan Lee", "jordan@taskline.test", "member", "#6b7a22"),
    (6, "Mei Tanaka", "mei@taskline.test", "member", "#c0623f"),
]
OWNER_ID = 1

PROJECTS = [
    ("WEB", "Website redesign", "#4b5f9e"),
    ("MOB", "Mobile app", "#2f7a68"),
    ("OPS", "Operations", "#b5532d"),
]

# project, title, status, assignee, priority, due (days from today, None: no date), completed (days ago), created
TASKS = [
    ("WEB", "Audit current site navigation", "done", 4, "medium", -20, 26, 40),
    ("WEB", "Define new colour palette", "done", 6, "low", -15, 20, 38),
    ("WEB", "Homepage hero redesign", "doing", 2, "high", 3, None, 30),
    ("WEB", "Pricing page copy", "review", 4, "medium", 1, None, 28),
    ("WEB", "Accessibility pass on forms", "todo", None, "high", -3, None, 25),
    ("WEB", "Set up analytics events", "doing", 5, "medium", 0, None, 22),
    ("WEB", "Blog post template", "done", 6, "low", -45, 41, 60),
    ("WEB", "Fix broken footer links", "done", 2, "urgent", -5, 3, 12),
    ("WEB", "Image compression pipeline", "doing", 1, "medium", 5, None, 18),
    ("WEB", "Cookie consent banner", "todo", 2, "urgent", -1, None, 10),
    ("WEB", "404 page illustration", "todo", None, "low", None, None, 9),
    ("WEB", "Migrate contact form", "review", 5, "high", 7, None, 8),
    ("WEB", "SEO meta tags review", "done", 4, "medium", -8, 9, 20),
    ("WEB", "Launch checklist", "todo", 1, "high", 14, None, 5),
    ("MOB", "Onboarding screens", "doing", 6, "high", 2, None, 35),
    ("MOB", "Push notification opt-in", "todo", 5, "medium", 0, None, 21),
    ("MOB", "Offline mode spike", "todo", None, "low", None, None, 19),
    ("MOB", "Crash on Android 12 login", "review", 2, "urgent", -2, None, 6),
    ("MOB", "App store screenshots", "todo", 4, "low", 1, None, 15),
    ("MOB", "Dark theme for settings", "todo", 6, "medium", 12, None, 14),
    ("MOB", "Biometric login", "doing", 1, "high", 6, None, 17),
    ("MOB", "Release 2.3 notes", "done", 4, "low", -4, 5, 11),
    ("MOB", "Deep links for invites", "todo", None, "medium", -6, None, 16),
    ("MOB", "Reduce cold start time", "doing", 5, "high", 9, None, 13),
    ("MOB", "Fix Android back button", "done", 2, "medium", -30, 33, 45),
    ("MOB", "Tablet layout", "todo", 4, "low", 20, None, 4),
    ("OPS", "Renew SSL certificates", "done", 5, "urgent", -10, 12, 30),
    ("OPS", "Rotate API keys", "done", 1, "high", -3, 2, 9),
    ("OPS", "Quarterly access review", "doing", 1, "medium", 4, None, 7),
    ("OPS", "Backup restore drill", "done", 4, "high", -50, 55, 70),
    ("OPS", "Update on-call rota", "done", 2, "low", -60, 61, 75),
    ("OPS", "Vendor invoice audit", "todo", 6, "medium", 8, None, 6),
    ("OPS", "Laptop refresh orders", "done", 5, "low", -45, 48, 65),
    ("OPS", "Office wifi upgrade", "todo", 1, "low", 15, None, 3),
    ("OPS", "Incident postmortem template", "done", 6, "medium", None, 1, 8),
    ("OPS", "Status page setup", "review", 2, "high", 2, None, 5),
]

SUBTASKS = {
    "WEB-3": [("Wireframe", True), ("Headline copy", True), ("Visual design", False), ("Responsive check", False)],
    "MOB-1": [("Welcome screen", True), ("Permissions screen", False), ("Account screen", False)],
    "OPS-3": [("Export user list", True), ("Send to team leads", True), ("Collect answers", True), ("Revoke", False)],
    "WEB-14": [("Content freeze", False), ("Redirect map", False), ("Final QA", False)],
}

# task: (author id, text, minutes ago)
COMMENTS = {
    "WEB-3": [(1, "Let's keep the hero image under 200 KB.", 2900), (2, "Draft is in the design file now.", 260)],
    "MOB-4": [(2, "Reproduced on a Pixel 4a, looking at the auth callback.", 1500)],
    "OPS-3": [(4, "Marketing has answered, waiting on support.", 600)],
}

# minutes ago, member, text, task
ACTIVITY = [
    (4, 2, "moved WEB-3 to In progress", "WEB-3"),
    (35, 4, "commented on OPS-3", "OPS-3"),
    (95, 1, "completed OPS-2", "OPS-2"),
    (180, 5, "created MOB-12", "MOB-12"),
    (400, 6, "assigned MOB-1 to themselves", "MOB-1"),
    (1500, 2, "commented on MOB-4", "MOB-4"),
    (2900, 1, "commented on WEB-3", "WEB-3"),
    (4400, 4, "moved WEB-4 to In review", "WEB-4"),
]

NOTIFICATIONS = [  # text, task, read, minutes ago
    ("Sam Patel mentioned you on WEB-3", "WEB-3", False, 260),
    ("Priya Nair moved WEB-4 to In review", "WEB-4", False, 4400),
    ("Priya Nair commented on OPS-3", "OPS-3", True, 600),
    ("MOB-7 is due in 6 days", "MOB-7", True, 2000),
]

LAST_WEEK = [8, 7.5, 8, 6, 7, 0, 2.5]  # Monday to Sunday
THIS_WEEK = [7.5, 8, 6.5, 7, 8, 0, 0]  # only the days before today are seeded

DESCRIPTIONS = {
    "WEB": "Part of the website redesign. Keep the brand guide and the accessibility checklist in mind.",
    "MOB": "Mobile app work for the 2.4 release. Test on both iOS and Android before moving to review.",
    "OPS": "Operations work. Note anything that changes access or costs in the ops log.",
}


def password_hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 20_000).hex()


DEMO_HASH = password_hash(PASSWORD, SALT)


def week_start(day: dt.date) -> dt.date:
    return day - dt.timedelta(days=day.weekday())


def workspace(today: dt.date, now: float) -> dict:
    """A fresh workspace, dated around `today` (dates as YYYY-MM-DD, times as epoch seconds)."""

    def day(offset):
        return None if offset is None else (today + dt.timedelta(days=offset)).isoformat()

    def ago(minutes):
        return int(now - minutes * 60)

    members = [
        {
            "id": i,
            "name": name,
            "email": email,
            "role": role,
            "color": color,
            "salt": SALT.hex(),
            "hash": DEMO_HASH,
            "prefs": {"date_format": "DMY", "theme": "light", "notify_assign": True, "notify_comment": True},
        }
        for i, name, email, role, color in MEMBERS
    ]
    numbers: dict[str, int] = {}
    tasks = []
    for project, title, status, assignee, priority, due, completed, created in TASKS:
        numbers[project] = numbers.get(project, 0) + 1
        key = f"{project}-{numbers[project]}"
        tasks.append(
            {
                "key": key,
                "project": project,
                "title": title,
                "description": DESCRIPTIONS[project],
                "status": status,
                "assignee": assignee,
                "priority": priority,
                "due": day(due),
                "created": ago(created * 1440),
                "updated": ago(min(created, completed or created) * 1440),
                "completed": ago(completed * 1440) if completed is not None else None,
                "subtasks": [{"text": t, "done": d} for t, d in SUBTASKS.get(key, [])],
                "comments": [],
            }
        )
    by_key = {t["key"]: t for t in tasks}
    next_comment = 1
    for key, comments in COMMENTS.items():
        for author, text, minutes in comments:
            by_key[key]["comments"].append(
                {"id": next_comment, "author": author, "text": text, "created": ago(minutes)}
            )
            next_comment += 1

    time_entries = []
    monday = week_start(today)
    for m in members:
        if m["role"] == "viewer":
            continue
        mine = [t["key"] for t in tasks if t["assignee"] == m["id"] and t["status"] != "done"] or [tasks[0]["key"]]
        for week, hours_by_day in ((monday - dt.timedelta(days=7), LAST_WEEK), (monday, THIS_WEEK)):
            for i, hours in enumerate(hours_by_day):
                date = week + dt.timedelta(days=i)
                if hours and date < today:
                    time_entries.append(
                        {
                            "id": len(time_entries) + 1,
                            "member": m["id"],
                            "task": mine[i % len(mine)],
                            "date": date.isoformat(),
                            "hours": hours,
                            "note": "",
                        }
                    )

    notifications = {
        m["id"]: [
            {"id": i + 1, "text": text, "task": task, "read": read, "created": ago(minutes)}
            for i, (text, task, read, minutes) in enumerate(NOTIFICATIONS)
        ]
        for m in members
    }
    return {
        "members": members,
        "projects": [{"key": k, "name": n, "color": c} for k, n, c in PROJECTS],
        "tasks": tasks,
        "time": time_entries,
        "invites": [{"email": "noah@taskline.test", "role": "member", "sent": day(-2)}],
        "notifications": notifications,
        "activity": [
            {"member": member, "text": text, "task": task, "at": ago(minutes)}
            for minutes, member, text, task in ACTIVITY
        ],
        "next_comment": next_comment,
        "next_time": len(time_entries) + 1,
    }
