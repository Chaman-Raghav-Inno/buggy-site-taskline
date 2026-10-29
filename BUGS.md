# Taskline: answer key (44 planted bugs)

Taskline is a team task tracker (dashboard, Kanban board, task table, task panel, timesheet, team, projects,
reports, settings, notifications, search) with **functional bugs planted on purpose**, for checking what the AI QA
Scanner finds. It is the harder of the two sites: more of its bugs need a role switch, a reload, a second page to
compare with, a keyboard path, a double-click or an edge-case value.

This file is never served, and nothing Taskline serves (pages, scripts, CSS) names or hints at a bug. Server-side
code marks each one with a `BUG-nn` comment; `tests/test_buggy_tasks.py` keeps the server-side ones in place.

## Run it

- **Locally**: `python -m buggy_tasks` (port 8081, or `PORT`), then open http://localhost:8081.
- **Railway**: New service → GitHub repo → this repository, then **Generate domain** under Networking.
  `railway.json` sets the start command and health check; no variables or volume needed.

Every visitor (cookie) gets a private copy of the demo workspace, so parallel scans never see each other's changes,
and a new browser session starts from the original data. A restart or redeploy resets everything.

## Test data

| What | Value |
|---|---|
| Accounts (password `Taskline@2026`, listed on the login page) | `alex@taskline.test` Admin and workspace owner · `sam@taskline.test` Member · `viv@taskline.test` Viewer (read only) |
| Other members | Priya Nair, Jordan Lee, Mei Tanaka (members); 1 pending invite (`noah@taskline.test`); 8 seats |
| Projects | WEB Website redesign (14 tasks, 5 done) · MOB Mobile app (12, 2 done) · OPS Operations (10, 6 done) |
| Tasks | 36, 10 per page in the table; 23 open, 13 done; 4 open and overdue; 2 due today; 2 due tomorrow; 4 open and unassigned |
| Alex | 5 open tasks; 4 notifications, 2 unread; logged 39 h last week (2.5 h of it on Sunday) and 7.5, 8, 6.5, 7, 8 h on this week's days before today |
| Board rules | In progress holds at most 3 cards per project (WEB starts with 3) |
| Rules stated on the pages | Password: 8+ characters with a number · project key: 2 to 5 letters, unique · time: 0.25 to 24 h per entry and at most 24 h a day |

Dates are relative to the day a workspace is created, so the numbers above hold on any day. Difficulty is how hard
the bug is to notice: **Easy** shows on one screen, **Medium** needs a flow or a comparison, **Hard** needs a role
switch, a reload, arithmetic, two pages compared, a keyboard path, a double-click or an edge-case value.

Files in the **Where** column are under `buggy_tasks/`.

## The bugs

### Accounts and roles

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-01 | Login forgets where you were going | Logged out, open `/tasks?status=done` (redirected to `/login?next=…`) → log in | Lands on the Tasks page with that filter | Lands on the Dashboard | Medium | Medium | `static/auth.js` (ignores `next`) |
| BUG-02 | Password reset crashes for emails with `+` or `-` | Forgot password → `sam+qa@taskline.test` → Send reset link | "If an account exists… we've sent a reset link" (as for `sam@taskline.test`) | "Something went wrong. Please try again." (HTTP 500) | High | Hard | `server.py` `Store.forgot` |
| BUG-03 | Changing your password changes the owner's instead | Log in as Sam → Settings → change password (current `Taskline@2026`, new `Newpass123`) → log out → log in as Sam with `Newpass123` | Sam logs in with the new password | "Incorrect email or password"; Sam's old password still works, and Alex's password is now `Newpass123` | Critical | Hard | `server.py` `Store.change_password` |
| BUG-04 | A viewer can create tasks | Log in as Viv (Viewer) → Board → type in "+ Add a task" → Enter | No way to add tasks (New task is hidden for viewers) | Task created ("WEB-15 added.") | High | Medium | `static/board.js` (quick add shown); `server.py` `Store.create_task` (no role check) |
| BUG-05 | A member can remove teammates | Log in as Sam (Member) → Team → Remove on Mei → Remove | Only admins see Remove | Sam sees Remove on everyone but the owner and himself, and Mei is removed | High | Medium | `static/team.js`; `server.py` `Store.remove_member` (only refuses viewers) |
| BUG-06 | A viewer can change a task's status | Log in as Viv → open any task (fields are greyed out) → change Status → Save changes | Status is read-only too | "Saved." and the status really changes | Medium | Hard | `static/panel.js` (Status left enabled); `server.py` `Store.update_task` |

### Dashboard

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-07 | Overdue counts finished tasks | Dashboard "Overdue" tile, then Tasks → Due: Overdue | Same number (4) | Tile says 16: every task with a past due date, done or not | Medium | Hard | `server.py` `Store.dashboard` |
| BUG-08 | "Due today" includes tomorrow | Dashboard "Due today", then Tasks → Due: Due today | 2 | Tile says 4 (today's and tomorrow's) | Medium | Medium | `server.py` `Store.dashboard` |
| BUG-09 | Project progress goes over 100% | Dashboard → Projects (or the Projects page) | Operations 60% (6 of 10 done) | 150% (done ÷ not done); Website redesign 56% for 5 of 14 | Medium | Easy | `server.py` `Store.projects` |
| BUG-10 | Activity times are in the future | Dashboard → Recent activity (also comments, notifications) | "4 minutes ago", "yesterday" | "in 4 minutes", "tomorrow", "in 2 days" | Low | Easy | `static/core.js` `T.ago` |

### Board

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-11 | Drag and drop is not saved | Drag a card (e.g. WEB-14) from To do to In review → reload | Card stays in In review | Card moves, but is back in To do after a reload (the Move menu does save) | High | Hard | `static/board.js` drop handler (sends `column`, server reads `status`) |
| BUG-12 | Column counts don't update | Move a card to another column (drag or Move menu) | Both column counts change | Counts stay as they were until a reload | Low | Medium | `static/board.js` `place` |
| BUG-13 | The In progress limit lets a 4th card in | WEB board, In progress shows 3 / 3 → move a To do card to In progress | Refused: "In progress is full" | 4th card accepted (shows 3 / 3); only the 5th is refused | Medium | Medium | `static/board.js` `hasRoom` (`>` instead of `>=`) |
| BUG-14 | Quick add ignores the column | In "In review", type in "+ Add a task" → Enter | New card in In review | New card in To do | Medium | Medium | `static/board.js` quick add (no status sent) |
| BUG-15 | Switching project keeps the old cards | Board → project dropdown → Mobile app | Mobile app's cards | Title says "Mobile app board", cards are still Website redesign's (correct after a reload) | Medium | Medium | `static/board.js` project change (renders the old list) |

### Tasks table

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-16 | Priority sorts alphabetically | Tasks → click the Priority header | Urgent, High, Medium, Low | High, Low, Medium, Urgent | Medium | Medium | `static/tasks.js` sort `priority` |
| BUG-17 | Filtering on a later page shows nothing | Next → Next (page 3) → Status: Done | First page of the 13 done tasks | "No tasks match these filters." with "Page 3 of 2" | Medium | Medium | `static/tasks.js` (page not reset on filter change) |
| BUG-18 | "Mark as done" completes the whole page | Tick one task ("1 selected") → Mark as done | That task done | "Updated 10 tasks.": every task on the page is done | High | Medium | `static/tasks.js` `bulk` (all checkboxes, not the ticked ones) |
| BUG-19 | Search ignores task keys | Search `WEB-3` (placeholder "Search by title or key") | WEB-3 | "No tasks match these filters." | Medium | Easy | `static/tasks.js` `filtered` |
| BUG-20 | Export ignores the filters | Status: Done (13 tasks) → Export CSV | 13 rows | "Exported 36 tasks." and the file has all 36 | Medium | Medium | `static/tasks.js` export (no query sent) |
| BUG-21 | A shared filter link doesn't filter | Open `/tasks?status=done&priority=high` (what Copy link copies) | 2 matching tasks | Dropdowns show Done / High but all 36 tasks are listed, and the address loses the filters | Medium | Hard | `static/tasks.js` (`render` before `restoreFromUrl`) |

### Task panel (open any task)

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-22 | A task can be saved with no title | Clear the title → Save changes | "Give the task a title." (as New task says) | "Saved." and the task has a blank title | Medium | Medium | `static/panel.js`; `server.py` `Store.update_task` |
| BUG-23 | A new assignee doesn't show until reload | Change Assignee (e.g. WEB-3 Sam → Priya) → Save | Table row / board card shows Priya | Still shows Sam until the page is reloaded | Low | Medium | `static/tasks.js` / `static/board.js` `onSaved` |
| BUG-24 | Subtask progress never counts the last one | WEB-3 → tick all 4 subtasks | 4/4, full bar | 3/4 (the last subtask is never counted) | Low | Medium | `static/panel.js` `renderDetail` |
| BUG-25 | Editing a comment posts a copy | Edit your own comment → change text → Save | The comment is updated | A new comment is added; the original stays | Medium | Medium | `static/panel.js` (posts a new comment) |
| BUG-26 | Logged time loses its fraction | Time → Hours `1.5` → Log time | "Logged 1.5 h" | "Logged 1 h"; 0.5 is refused as 0 | High | Hard | `static/panel.js` (`parseInt`) |
| BUG-27 | Cancelling a delete deletes | Delete task → Cancel (or Esc) | Task kept | "WEB-11 deleted." | Critical | Easy | `static/panel.js` confirm dialog (ignores which button) |
| BUG-28 | New tasks reuse a deleted task's number | Delete any WEB task → New task in Website redesign | WEB-15 | WEB-14, which already exists: two tasks share the key and only one opens | High | Hard | `server.py` `Store.create_task` |
| BUG-29 | Double-clicking Create makes two tasks | New task → title → double-click Create task | One task | Two identical tasks | Medium | Hard | `static/panel.js` (button not disabled while saving) |

### Timesheet

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-30 | The week total leaves out Sunday | Last week's timesheet (Alex: 8 + 7.5 + 8 + 6 + 7 + 0 + 2.5) | 39 | 36.5 | High | Hard | `static/timesheet.js` (`slice(0, 6)`) |
| BUG-31 | "Previous week" goes back two weeks | Timesheet → Previous week | The week before | Two weeks before (Next week is right) | Medium | Easy | `static/timesheet.js` |
| BUG-32 | A day can pass 24 hours | Log 20 h, then 10 h, on the same day | Second entry refused (form: "at most 24 hours a day") | Both accepted: 30 h in one day | Medium | Hard | `server.py` `Store.log_time` |
| BUG-33 | The target percentage is upside down | Weekly target, e.g. with 22 h logged | "22 h of 40 h (55%)" | "22 h of 40 h (182%)" (40 ÷ 22); bar is right. Shows on any week with hours | Low | Easy | `static/timesheet.js` |

### Team

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-34 | Inviting an existing member works | As Alex, invite `sam@taskline.test` | "Sam is already a member" | "Invite sent" and a pending invite for Sam | Low | Medium | `server.py` `Store.invite` |
| BUG-35 | The seat limit is not enforced | Team header with 6 members + 1 pending invite; invite 3 more | "7 of 8 used", invites refused past 8 | "6 of 8 used" (pending ignored) and every invite accepted (10 seats) | High | Hard | `server.py` `Store.workspace_view`, `Store.invite` |
| BUG-36 | Removing someone deletes their tasks | As Alex, remove Jordan (6 tasks) | Jordan's tasks stay, unassigned | Jordan's 6 tasks disappear (36 → 30) | Critical | Hard | `server.py` `Store.remove_member` |

### Settings

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-37 | Dark theme is not kept | Settings → Theme: Dark → Save preferences → reload | Dark | Light again, while the setting still says Dark | Low | Medium | `server.py` `render` (reads the wrong preference) |
| BUG-38 | The date format is ignored in the Tasks table | Settings → Date format 12/31/2026 → Tasks | Due dates as month/day/year (the dashboard, board and timesheet do it) | Table still shows day/month/year | Low | Hard | `static/tasks.js` `dueText` |

### Reports

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-39 | The range changes nothing | Reports → Range: Last 7 days, 30, 90 | Completed 4, 8, 13 | 13 every time (created and average too) | Medium | Medium | `server.py` `Store.reports` |
| BUG-40 | Unassigned work is counted as Alex's | Reports → Open tasks by person | Alex 5 | Alex 9 (his 5 + the 4 unassigned) | Medium | Hard | `server.py` `Store.reports` |

### Header, search and projects

| ID | Bug | Steps to reproduce | Expected | Actual | Severity | Difficulty | Where |
|---|---|---|---|---|---|---|---|
| BUG-41 | The bell counts read notifications | Bell badge vs Notifications page; Mark all as read → reload | Badge 2, then none | Badge 4 (all notifications), still 4 after reading them | Low | Medium | `server.py` `Store.me`, `render` |
| BUG-42 | Enter opens the first result, not the highlighted one | Search `screen` → ↓ ↓ (App store screenshots highlighted) → Enter | MOB-5 | MOB-1 Onboarding screens | Medium | Hard | `static/core.js` search `keydown` |
| BUG-43 | Some characters break search | Search `c++`, `(` or `[` (e.g. type `scr(`) | Results or "No matching tasks" | JavaScript error "Invalid regular expression"; the list stops updating | Medium | Medium | `static/core.js` search (`new RegExp` with the raw query) |
| BUG-44 | A duplicate project key hangs the dialog | Projects → New project → key `WEB` → Create project | "That key is already used" | Button stuck on "Creating…", no message (HTTP 500) | Medium | Medium | `server.py` `Store.create_project`; `static/projects.js` |

## What is not a planted bug

- Console errors that come with a bug: HTTP 500 from `/api/forgot` (BUG-02) and `/api/projects` (BUG-44), the
  "Invalid regular expression" error (BUG-43), 401 after logging out, 404 on unknown pages.
- Date pickers show dates in the browser's own format (e.g. 11/01/2026), whatever the Date format setting says:
  that is the browser's native control.
- Each visitor has a private workspace: changes made in one browser session do not show in another.
- "Demo workspace for QA testing" in the sidebar and the demo accounts on the login page.

By area: accounts and roles 6, dashboard 4, board 5, tasks table 6, task panel 8, timesheet 4, team 3, settings 2,
reports 2, header, search and projects 4. By difficulty: Easy 6, Medium 22, Hard 16. By severity: Critical 3,
High 9, Medium 23, Low 9.
