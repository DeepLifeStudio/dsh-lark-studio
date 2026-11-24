# dsh-lark-studio

[English](README_EN.md) | [简体中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-lark-studio.svg)](https://www.npmjs.com/package/dsh-lark-studio)
[![dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/deeplifestudio/dsh-lark-studio)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Feishu / Lark plugin for DeepSeek Harness. Built on top of the official [`lark-cli`](https://www.npmjs.com/package/@larksuite/cli), it lets you create and edit Lark Bitables in plain language and handle calendar, tasks, chats, mail, contacts, and approvals directly from chat or the sidebar workbench.

## What it does

### 1. Build a Bitable from a single sentence

Describe what you want to track without worrying about column types upfront:

- *"Track customer leads with company, contact, budget, and deal stage"*
- *"Make a team expense reimbursement table"*
- *"Track engineering bugs and feature requests"*

The model drafts the schema (fields, select options, Kanban view, and sample rows). In the sidebar workbench, you can review the draft before creating the live Bitable in your personal Lark workspace.

You can also trigger it directly from the DSH chat composer:

```text
/lark Customer leads: company, contact, deal stage, next follow-up
```

### 2. Edit existing tables in conversation

Once a table is created, keep modifying its schema and rows through chat:

- *"Add a status column with options: Pending, In Review, Paid"*
- *"Rename priority options Low / Medium / High to P0 / P1 / P2"*
- *"Add a Kanban view grouped by status"*
- *"Add a record: Company Acme, Contact Alice, Budget $50,000"*
- *"Move the deadline of all in-progress tasks to next Friday"*

Destructive changes (deleting columns, views, options, or records) always pause and ask for confirmation before executing.

### 3. Daily Lark collaboration

Beyond Bitables, you can run everyday Lark workflows in chat:

- **Calendar**: check today's agenda, look up free/busy slots, create/update/cancel meetings
- **Tasks**: list open tasks, create tasks, assign owners, mark items complete
- **IM & Chats**: search group chats, read message history, send messages
- **Mail**: summarize inbox, read messages, send mail or save drafts
- **Contacts**: look up teammates by name, department, or employee ID
- **Approvals & Docs**: query pending approvals, approve/reject requests, read/write Docs and Wiki

When a required Lark Open Platform scope is missing, the plugin tells you which scope is needed and gives you a direct link to enable it.

<details>
<summary>Full feature list (Bitable + Lark collaboration CRUD)</summary>

#### Bitable

- **Tables**: create table (`add_table`), rename table (`rename_table`), inspect Base metadata and schema (`readSchema`)
- **Fields**:
  - Text: plain text, multiline, URL, phone, email, barcode
  - Numeric: integer/float, currency (CNY/USD/etc.), percentage, progress bar
  - Select: single select, multi select, with incremental option updates (`add_options` / `remove_options`)
  - Other: formatted date/time, user, checkbox, auto-number, formula, link/lookup
  - Schema edits: rename field (`rename_field`), delete field (`delete_field`)
- **Views**: Grid, Kanban, Gallery, Calendar, Gantt; create/rename/delete views and control per-view visible fields (`set_view_visible_fields`)
- **Records**: batch insert, conditional or ID-targeted update/delete, quick peek of the first 20 rows (`peek`)
- **Permissions & extensions**: toggle advanced permissions, create/update/delete custom roles (`create_role` / `update_role` / `delete_role`), field AI extensions, dashboards, forms

#### Lark collaboration (via `lark-cli`)

- **Calendar**
  - Create: schedule events/meetings (`calendar +create`), join events (`+join-event`)
  - Update: edit time/location/attendees (`calendar +update`), RSVP (`+rsvp`), transfer organizer (`+transfer`)
  - Delete: cancel/delete events (`calendar +delete`, including recurring events)
  - Read: agenda (`+agenda`), event details (`+get`), search (`+search-event`), free/busy (`+freebusy`), room finder (`+room-find`), attendees (`+list-attendees`), meeting notes (`+meeting`)
- **Tasks**
  - Create: tasks (`task +create`), task lists (`+tasklist-create`), subtasks (`subtasks create`), comments (`+comment`), attachments (`+upload-attachment`)
  - Update: complete (`+complete`), reopen (`+reopen`), assign (`+assign`), edit due date/details (`+update`), followers (`+followers`), reminders (`+reminder`)
  - Delete: delete tasks (`task tasks delete`), delete lists (`tasklists delete`), remove members (`members remove`)
  - Read: my tasks (`+get-my-tasks`), related tasks (`+get-related-tasks`), search tasks (`+search`), search lists (`+tasklist-search`)
- **IM & Chats**
  - Create / Send: text/Markdown/card messages (`im +messages-send`), thread replies (`+messages-reply`), create chats (`+chat-create`), flag (`+flag-create`), pin (`pins create`)
  - Update: edit sent messages (`+messages-edit`), update chat info (`+chat-update`), moderation settings (`chat.moderation update`)
  - Delete: recall/delete messages (`im messages delete`), unflag (`+flag-cancel`), unpin (`pins delete`)
  - Read: list chats (`+chat-list`), search chats (`+chat-search`), members (`+chat-members-list`), history (`+chat-messages-list`), global search (`+messages-search`), read receipts (`+message-read-users`), flagged list (`+flag-list`)
- **Mail**
  - Create: send mail (`mail +send`), create drafts (`+draft-create`), rules (`+rule-create`), templates (`+template-create`)
  - Update: reply / reply all (`+reply` / `+reply-all`), forward (`+forward`), edit/send drafts (`+draft-edit` / `+draft-send`), label/move/mark read (`+message-modify`), update/toggle rules (`+rule-update` / `+rule-enable` / `+rule-disable`)
  - Delete: move to trash (`+message-trash` / `+thread-trash`), delete rules (`+rule-delete`), discard drafts (`user_mailbox.drafts delete`)
  - Read: inbox triage (`+triage`), messages & attachments (`+message` / `+messages`), threads (`+thread`), folders (`user_mailbox.folders list`), rules (`+rule-list`), signatures (`+signature`)
- **Contacts**
  - Read: search users by name/ID/department (`contact +search-user`), get profile (`+get-user`), search bots (`+search-bot`), batch query profiles (`user_profiles batch_query`)
  - Enterprise ops: department creation, profile updates, and offboarding when using enterprise admin credentials
- **Approvals**
  - Initiate / Cancel: create approval instances (`approval instances create`), cancel own requests (`approval instances cancel`)
  - Actions: `approve`, `reject`, `transfer`, `add_sign`, `rollback`, `remind`
  - Read: pending tasks (`approval tasks query`), instance details (`approval instances get`), initiated requests (`approval instances initiated`), search definitions (`approval approvals search`)
- **Docs / Drive / Wiki / Markdown**
  - Create, read, and update doc blocks; upload, download, move, and delete Drive files; manage Wiki spaces/nodes and sharing permissions; create native Drive Markdown files
- **Scopes Inspector**
  - Checks granted scopes across Lark Open Platform domains and surfaces a direct console link with your App ID whenever an action lacks permission

</details>

## Sidebar Workbench

The plugin adds a **Lark Workbench** tab to the DSH right sidebar:

- **Setup wizard**: checks for `lark-cli`, helps bind your Lark app (`App ID` / `App Secret`), and runs browser OAuth login.
- **Schema preview**: displays drafted columns, options, and sample rows before creating the table.
- **Live thinking stream**: streams the model's reasoning during planning and edits so you can see how fields were chosen.
- **Split-pane view**: chat on the left, live embedded Lark Bitable on the right.
- **Scope inspector**: shows which Lark permission domains are granted and links directly to the developer console for missing ones.

## Installation

### Prerequisites

- Node.js `>= 18.0.0`
- DeepSeek Harness `>= 0.2.2-rc.1 < 0.3.0-0`
- Official Lark CLI installed globally:

```bash
npm install -g @larksuite/cli
```

### Install the plugin

Install from npm to your active profile (`web` or `desktop`):

```bash
# Web profile
dsh plugin --profile web add dsh-lark-studio

# Desktop profile
dsh plugin --profile desktop add dsh-lark-studio
```

You can also search for `dsh-lark-studio` in `dsh-market` inside DSH.

When running the Web UI, pass `--patch` so the sidebar workbench loads:

```bash
dsh start --patch
```

### Update

```bash
dsh plugin --profile web update dsh-lark-studio
# Or update all installed plugins
dsh plugin update
```

> Prefer installing via npm rather than `git clone` or a GitHub URL, so `dsh plugin update` can detect and install new releases.

### First-time setup

Open **Lark Workbench** from the DSH right sidebar and follow the three steps:

1. Verify `lark-cli` is installed;
2. Bind your Lark app's `App ID` and `App Secret` (or create one via the guided link);
3. Complete OAuth login in your browser.

## Agent tools & commands

If you prefer working from the main DSH chat, the plugin registers:

| Entry | Kind | Purpose |
| :--- | :--- | :--- |
| `/lark <description>` | Slash command | Create a Bitable from a short prompt |
| `lark_base_build` | Agent tool | Plan and build a Bitable (supports `preview: true`) |
| `lark_base_adjust` | Agent tool | Modify columns, options, views, and records on an existing Base |
| `lark_collab` | Agent tool | Run calendar, task, chat, mail, contact, and approval actions |

## FAQ

**Do I need to install `lark-cli`?**  
Yes. The plugin never stores your Lark password; all API calls go through your local `lark-cli` using your own OAuth session.

**Where are created Bitables stored?**  
In your own Lark account under **My Space** (private by default). Use the share button in Lark whenever you want to invite teammates.

**Will casual chat accidentally create tables?**  
No. Normal greetings and questions stay in conversation; table planning only runs when you ask to build a table or use `/lark`.

**Distribution**  
Published on [npm](https://www.npmjs.com/package/dsh-lark-studio) and indexed on [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) (synced to `dsh-market`), [DeepSeek 1024](https://deepseek1024.com/plugins/DeepLifeStudio/dsh-lark-studio), [DSH Plugin Hub](https://dsh-plugin.org/plugins/deeplifestudio/dsh-lark-studio), and [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions/14154).

## License

[MIT](LICENSE)
