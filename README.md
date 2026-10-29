# buggy-site-taskline: Taskline

Taskline is a team task tracker (dashboard, Kanban board, task table, task panel, timesheet, team and roles,
projects, reports, settings, notifications, search) with **44 functional bugs planted on purpose**, to measure how
many the AI QA Scanner finds. It is the harder companion to
[buggy-site](https://github.com/Chaman-Raghav-Inno/buggy-site) (Lumen Goods, 39 bugs): many of its bugs need a role
switch, a reload, a second page to compare, a keyboard path, a double-click or an edge-case value.

[BUGS.md](BUGS.md) is the answer key: for each bug, the steps to reproduce, what should happen, what happens, its
severity, how hard it is to notice and where it is in the code. The app never serves that file, and nothing it serves
(pages, scripts, CSS) names or hints at a bug, so a scan cannot read the answers.

## Run it

```sh
python -m buggy_tasks          # http://localhost:8081 (PORT changes the port)
```

Standard library only (Python 3.11+); no install step.

- Accounts (password `Taskline@2026`, shown on the login page): `alex@taskline.test` (Admin and owner),
  `sam@taskline.test` (Member), `viv@taskline.test` (Viewer, read only). Several bugs only show for a member or a
  viewer.
- Every visitor (cookie) gets a private copy of the demo workspace, dated around today, so parallel scans never see
  each other's changes and every new session starts from the same data. A restart or redeploy resets everything.

## Deploy on Railway

New service → GitHub repo → this repository, then **Generate domain** under Networking. `railway.json` sets the
start command and health check (`/healthz`); no variables or volume are needed. Give the domain to the scanner, and
avoid redeploying while a scan runs.

## Scoring a scan

Go through [BUGS.md](BUGS.md) and tick each bug the scan reported. Bugs are graded Easy (shows on one screen),
Medium (needs a flow or a comparison) and Hard (needs a role switch, a reload, arithmetic, two pages compared, a
keyboard path, a double-click or an edge-case value), so the result shows how deep the scanner gets, not only how
many it finds. The answer key also lists what is not a planted bug.

## Development

```sh
pip install ruff pytest
ruff check . && ruff format --check .
pytest -q
```

`tests/test_buggy_tasks.py` keeps the server-side bugs in place (a planted bug fixed by accident changes the
benchmark) and checks that nothing served gives a bug away. Server-side code marks each bug with a `BUG-nn` comment;
the served files must not.
