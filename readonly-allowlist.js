/**
 * Strict read-only subcommand and flag allowlist for lark-cli (@larksuite/cli v1.0.100).
 * Generated and verified against actual CLI --help schemas.
 *
 * Every command in this allowlist is strictly read-only, excludes local file
 * writes (--output, --output-dir, --output-path, --overwrite, --download-resources),
 * excludes raw escape hatches (api, apps, event, --params, @file, --page-all),
 * and explicitly validates boolean vs value flags to prevent positional injection.
 */

const SHARED_BOOL_FLAGS = new Set(['--json'])
const SHARED_VALUE_FLAGS = new Set(['--format', '--jq'])
const ALLOWED_FORMATS = new Set(['json', 'ndjson', 'table', 'csv', 'pretty', 'data'])

// Raw schema entries: { b: boolean flags, v: value flags }
const RAW_ALLOWLIST = {
  "approval approvals get": {
    "b": [],
    "v": [
      "--approval-code",
      "--locale"
    ]
  },
  "approval approvals search": {
    "b": [],
    "v": [
      "--data"
    ]
  },
  "approval instances get": {
    "b": [],
    "v": [
      "--instance-code",
      "--locale",
      "--user-id-type"
    ]
  },
  "approval instances initiated": {
    "b": [],
    "v": [
      "--definition-code",
      "--end-timestamp",
      "--keyword",
      "--locale",
      "--page-size",
      "--page-token",
      "--start-timestamp",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "approval tasks query": {
    "b": [],
    "v": [
      "--topic",
      "--definition-code",
      "--end-timestamp",
      "--keyword",
      "--locale",
      "--page-size",
      "--page-token",
      "--start-timestamp",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "attendance user_tasks query": {
    "b": [
      "--ignore-invalid-users",
      "--include-terminated-user"
    ],
    "v": [
      "--employee-type",
      "--data"
    ]
  },
  "base +app-get": {
    "b": [],
    "v": [
      "--app-token"
    ]
  },
  "base +app-page-list": {
    "b": [],
    "v": [
      "--app-token",
      "--page-size",
      "--page-token"
    ]
  },
  "base +app-page-get": {
    "b": [],
    "v": [
      "--app-token",
      "--page-id"
    ]
  },
  "base +app-block-list": {
    "b": [],
    "v": [
      "--app-token",
      "--page-id",
      "--page-size",
      "--page-token"
    ]
  },
  "base +app-block-get": {
    "b": [],
    "v": [
      "--app-token",
      "--block-id",
      "--page-id"
    ]
  },
  "base +app-block-get-data": {
    "b": [],
    "v": [
      "--app-token",
      "--base-token",
      "--block-id"
    ]
  },
  "base +base-get": {
    "b": [],
    "v": [
      "--base-token"
    ]
  },
  "base +base-block-list": {
    "b": [],
    "v": [
      "--base-token",
      "--parent-id",
      "--type"
    ]
  },
  "base +button-rule-get": {
    "b": [],
    "v": [
      "--base-token",
      "--field-id",
      "--table-id"
    ]
  },
  "base +table-list": {
    "b": [],
    "v": [
      "--base-token"
    ]
  },
  "base +table-get": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id"
    ]
  },
  "base +table-copy-status": {
    "b": [],
    "v": [
      "--base-token",
      "--task-id"
    ]
  },
  "base +field-list": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id"
    ]
  },
  "base +field-get": {
    "b": [],
    "v": [
      "--base-token",
      "--field-id",
      "--table-id"
    ]
  },
  "base +field-extension-get": {
    "b": [],
    "v": [
      "--base-token",
      "--field-id",
      "--table-id"
    ]
  },
  "base +field-search-options": {
    "b": [],
    "v": [
      "--base-token",
      "--field-id",
      "--keyword",
      "--limit",
      "--offset",
      "--table-id"
    ]
  },
  "base +view-list": {
    "b": [],
    "v": [
      "--base-token",
      "--limit",
      "--offset",
      "--table-id"
    ]
  },
  "base +view-get": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--view-id"
    ]
  },
  "base +view-get-card": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--view-id"
    ]
  },
  "base +view-get-filter": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--view-id"
    ]
  },
  "base +view-get-group": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--view-id"
    ]
  },
  "base +view-get-sort": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--view-id"
    ]
  },
  "base +view-get-timebar": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--view-id"
    ]
  },
  "base +view-get-visible-fields": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--view-id"
    ]
  },
  "base +record-list": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--field-id",
      "--view-id",
      "--filter-json",
      "--sort-json",
      "--offset",
      "--limit"
    ]
  },
  "base +record-get": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--record-id",
      "--field-id"
    ]
  },
  "base +record-search": {
    "b": [],
    "v": [
      "--base-token",
      "--table-id",
      "--keyword",
      "--search-field",
      "--field-id",
      "--view-id",
      "--filter-json",
      "--sort-json",
      "--offset",
      "--limit"
    ]
  },
  "base +record-history-list": {
    "b": [],
    "v": [
      "--base-token",
      "--max-version",
      "--page-size",
      "--record-id",
      "--table-id"
    ]
  },
  "base +data-query": {
    "b": [],
    "v": [
      "--base-token",
      "--dsl"
    ]
  },
  "base +role-list": {
    "b": [],
    "v": [
      "--base-token"
    ]
  },
  "base +role-get": {
    "b": [],
    "v": [
      "--base-token",
      "--role-id"
    ]
  },
  "base +dashboard-list": {
    "b": [],
    "v": [
      "--base-token",
      "--page-size",
      "--page-token"
    ]
  },
  "base +dashboard-get": {
    "b": [],
    "v": [
      "--base-token",
      "--dashboard-id"
    ]
  },
  "base +dashboard-share-get": {
    "b": [],
    "v": [
      "--base-token",
      "--dashboard-id"
    ]
  },
  "base +dashboard-block-list": {
    "b": [],
    "v": [
      "--base-token",
      "--dashboard-id",
      "--page-size",
      "--page-token"
    ]
  },
  "base +dashboard-block-get": {
    "b": [],
    "v": [
      "--base-token",
      "--block-id",
      "--dashboard-id",
      "--user-id-type"
    ]
  },
  "base +dashboard-block-get-data": {
    "b": [],
    "v": [
      "--base-token",
      "--block-id"
    ]
  },
  "base +form-list": {
    "b": [],
    "v": [
      "--base-token",
      "--page-size",
      "--table-id"
    ]
  },
  "base +form-get": {
    "b": [],
    "v": [
      "--base-token",
      "--form-id",
      "--table-id"
    ]
  },
  "base +form-detail": {
    "b": [],
    "v": [
      "--share-token"
    ]
  },
  "base +form-questions-list": {
    "b": [],
    "v": [
      "--base-token",
      "--form-id",
      "--table-id"
    ]
  },
  "base +form-share-get": {
    "b": [],
    "v": [
      "--base-token",
      "--form-id",
      "--table-id"
    ]
  },
  "base +workflow-list": {
    "b": [],
    "v": [
      "--base-token",
      "--page-size",
      "--status"
    ]
  },
  "base +workflow-get": {
    "b": [],
    "v": [
      "--base-token",
      "--user-id-type",
      "--workflow-id"
    ]
  },
  "base +title-resolve": {
    "b": [],
    "v": [
      "--title"
    ]
  },
  "base +url-resolve": {
    "b": [],
    "v": [
      "--url"
    ]
  },
  "base +template-categories": {
    "b": [],
    "v": []
  },
  "base +template-list": {
    "b": [],
    "v": [
      "--category-key",
      "--limit",
      "--offset"
    ]
  },
  "base +template-search": {
    "b": [],
    "v": [
      "--keyword",
      "--limit",
      "--offset"
    ]
  },
  "base +workspace-entity-list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--type",
      "--workspace-token"
    ]
  },
  "calendar +agenda": {
    "b": [],
    "v": [
      "--calendar-id",
      "--end",
      "--start"
    ]
  },
  "calendar +freebusy": {
    "b": [],
    "v": [
      "--end",
      "--min-duration",
      "--start",
      "--type",
      "--user-id"
    ]
  },
  "calendar +get": {
    "b": [],
    "v": [
      "--calendar-id",
      "--event-id"
    ]
  },
  "calendar +list-attendees": {
    "b": [],
    "v": [
      "--calendar-id",
      "--event-id",
      "--page-size",
      "--page-token",
      "--type"
    ]
  },
  "calendar +meeting": {
    "b": [],
    "v": [
      "--calendar-id",
      "--event-ids"
    ]
  },
  "calendar +room-find": {
    "b": [],
    "v": [
      "--attendee-ids",
      "--building",
      "--city",
      "--event-rrule",
      "--floor",
      "--max-capacity",
      "--min-capacity",
      "--room-name",
      "--slot",
      "--timezone"
    ]
  },
  "calendar +search-event": {
    "b": [],
    "v": [
      "--attendee-ids",
      "--calendar-id",
      "--end",
      "--page-size",
      "--page-token",
      "--query",
      "--start"
    ]
  },
  "calendar +suggestion": {
    "b": [],
    "v": [
      "--attendee-ids",
      "--duration-minutes",
      "--end",
      "--event-rrule",
      "--exclude",
      "--start",
      "--timezone"
    ]
  },
  "calendar calendars get": {
    "b": [],
    "v": [
      "--calendar-id"
    ]
  },
  "calendar calendars list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--sync-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "calendar calendars primary": {
    "b": [],
    "v": [
      "--op-user-id",
      "--user-id-type",
      "--data"
    ]
  },
  "calendar calendars search": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--data",
      "--page-delay",
      "--page-limit"
    ]
  },
  "calendar events get": {
    "b": [
      "--need-attendee",
      "--need-meeting-settings"
    ],
    "v": [
      "--calendar-id",
      "--event-id",
      "--max-attendee-num",
      "--op-user-id",
      "--user-id-type"
    ]
  },
  "calendar events instance_view": {
    "b": [],
    "v": [
      "--calendar-id",
      "--end-time",
      "--start-time",
      "--user-id-type"
    ]
  },
  "calendar events search_event": {
    "b": [],
    "v": [
      "--calendar-id",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--data",
      "--page-delay",
      "--page-limit"
    ]
  },
  "calendar events share_info": {
    "b": [],
    "v": [
      "--calendar-id",
      "--event-id",
      "--data"
    ]
  },
  "calendar event.attendees list": {
    "b": [
      "--need-resource-customization"
    ],
    "v": [
      "--calendar-id",
      "--event-id",
      "--op-user-id",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "calendar freebusys list": {
    "b": [],
    "v": [
      "--user-id-type",
      "--data"
    ]
  },
  "contact +get-user": {
    "b": [],
    "v": [
      "--user-id",
      "--user-id-type"
    ]
  },
  "contact +search-user": {
    "b": [
      "--exclude-external-users",
      "--has-chatted",
      "--has-enterprise-email",
      "--left-organization"
    ],
    "v": [
      "--lang",
      "--page-size",
      "--queries",
      "--query",
      "--user-ids"
    ]
  },
  "contact +search-bot": {
    "b": [
      "--has-chatted"
    ],
    "v": [
      "--chat-ids",
      "--page-size",
      "--queries",
      "--query"
    ]
  },
  "contact user_profiles batch_query": {
    "b": [],
    "v": [
      "--user-id-type",
      "--data"
    ]
  },
  "docs +fetch": {
    "b": [],
    "v": [
      "--context-after",
      "--context-before",
      "--detail",
      "--doc",
      "--doc-format",
      "--end-block-id",
      "--keyword",
      "--lang",
      "--max-depth",
      "--revision-id",
      "--scope",
      "--start-block-id"
    ]
  },
  "docs +search": {
    "b": [],
    "v": [
      "--filter",
      "--page-size",
      "--page-token",
      "--query"
    ]
  },
  "docs +history-list": {
    "b": [],
    "v": [
      "--doc",
      "--page-size",
      "--page-token"
    ]
  },
  "docs +history-revert-status": {
    "b": [],
    "v": [
      "--doc",
      "--task-id"
    ]
  },
  "drive +inspect": {
    "b": [],
    "v": [
      "--type",
      "--url"
    ]
  },
  "drive +search": {
    "b": [
      "--created-by-me",
      "--mine",
      "--only-comment",
      "--only-title"
    ],
    "v": [
      "--chat-ids",
      "--commented-since",
      "--commented-until",
      "--created-since",
      "--created-until",
      "--creator-ids",
      "--doc-types",
      "--edited-since",
      "--edited-until",
      "--folder-tokens",
      "--opened-since",
      "--opened-until",
      "--original-creator-ids",
      "--page-size",
      "--page-token",
      "--query",
      "--sharer-ids",
      "--sort",
      "--space-ids"
    ]
  },
  "drive +list-comments": {
    "b": [
      "--need-reaction",
      "--need-relation"
    ],
    "v": [
      "--comment-scope",
      "--page-size",
      "--page-token",
      "--solved-status",
      "--token",
      "--type",
      "--url"
    ]
  },
  "drive +list-replies": {
    "b": [
      "--need-reaction"
    ],
    "v": [
      "--comment-id",
      "--page-size",
      "--page-token",
      "--token",
      "--type",
      "--url"
    ]
  },
  "drive +batch-query-comments": {
    "b": [
      "--need-reaction",
      "--need-relation"
    ],
    "v": [
      "--comment-ids",
      "--token",
      "--type",
      "--url"
    ]
  },
  "drive +member-list": {
    "b": [],
    "v": [
      "--fields",
      "--perm-type",
      "--token",
      "--type"
    ]
  },
  "drive +permission-get-setting": {
    "b": [],
    "v": [
      "--token",
      "--type"
    ]
  },
  "drive +version-history": {
    "b": [],
    "v": [
      "--cursor",
      "--file-token",
      "--limit"
    ]
  },
  "drive +secure-label-list": {
    "b": [],
    "v": [
      "--lang",
      "--page-size",
      "--page-token"
    ]
  },
  "drive +task_result": {
    "b": [],
    "v": [
      "--file-token",
      "--scenario",
      "--task-id",
      "--ticket"
    ]
  },
  "drive files list": {
    "b": [],
    "v": [
      "--direction",
      "--folder-token",
      "--option",
      "--order-by",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "drive file.comments list": {
    "b": [
      "--is-solved",
      "--is-whole",
      "--need-reaction",
      "--need-relation"
    ],
    "v": [
      "--file-token",
      "--file-type",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "drive file.comments batch_query": {
    "b": [],
    "v": [
      "--file-token",
      "--file-type",
      "--user-id-type",
      "--data"
    ]
  },
  "drive file.comment.replys list": {
    "b": [
      "--need-reaction"
    ],
    "v": [
      "--comment-id",
      "--file-token",
      "--file-type",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "drive file.statistics get": {
    "b": [],
    "v": [
      "--file-token",
      "--file-type"
    ]
  },
  "drive file.view_records list": {
    "b": [],
    "v": [
      "--file-token",
      "--file-type",
      "--page-size",
      "--page-token",
      "--viewer-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "drive metas batch_query": {
    "b": [],
    "v": [
      "--user-id-type",
      "--data"
    ]
  },
  "drive permission.members auth": {
    "b": [],
    "v": [
      "--action",
      "--token",
      "--type"
    ]
  },
  "drive permission.public get": {
    "b": [],
    "v": [
      "--token",
      "--type"
    ]
  },
  "drive quota_details get": {
    "b": [],
    "v": [
      "--quota-detail-id"
    ]
  },
  "drive user subscription_status": {
    "b": [],
    "v": [
      "--event-type"
    ]
  },
  "im +chat-list": {
    "b": [
      "--exclude-muted"
    ],
    "v": [
      "--page-delay",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--sort",
      "--types",
      "--user-id-type"
    ]
  },
  "im +chat-search": {
    "b": [
      "--disable-search-by-user",
      "--exclude-muted",
      "--is-manager"
    ],
    "v": [
      "--chat-modes",
      "--member-ids",
      "--page-delay",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--query",
      "--search-types",
      "--sort"
    ]
  },
  "im +chat-members-list": {
    "b": [],
    "v": [
      "--chat-id",
      "--member-id-type",
      "--member-types",
      "--page-delay",
      "--page-limit",
      "--page-size",
      "--page-token"
    ]
  },
  "im +chat-messages-list": {
    "b": [
      "--concise",
      "--no-reactions"
    ],
    "v": [
      "--chat-id",
      "--end",
      "--order",
      "--page-delay",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--start",
      "--user-id"
    ]
  },
  "im +messages-mget": {
    "b": [
      "--no-reactions"
    ],
    "v": [
      "--message-ids"
    ]
  },
  "im +messages-search": {
    "b": [
      "--is-at-me",
      "--no-reactions"
    ],
    "v": [
      "--at-chatter-ids",
      "--chat-id",
      "--chat-type",
      "--end",
      "--exclude-sender-type",
      "--include-attachment-type",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--query",
      "--sender",
      "--sender-type",
      "--start"
    ]
  },
  "im +messages-read-status": {
    "b": [],
    "v": [
      "--message-ids"
    ]
  },
  "im +message-read-users": {
    "b": [],
    "v": [
      "--message-id",
      "--page-delay",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--user-id-type"
    ]
  },
  "im +threads-messages-list": {
    "b": [
      "--concise",
      "--no-reactions"
    ],
    "v": [
      "--order",
      "--page-delay",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--thread"
    ]
  },
  "im +feed-group-list": {
    "b": [],
    "v": [
      "--end-time",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--start-time"
    ]
  },
  "im +feed-group-list-item": {
    "b": [],
    "v": [
      "--end-time",
      "--feed-group-id",
      "--page-limit",
      "--page-size",
      "--page-token",
      "--start-time"
    ]
  },
  "im +feed-group-query-item": {
    "b": [],
    "v": [
      "--feed-group-id",
      "--feed-id"
    ]
  },
  "im +feed-shortcut-list": {
    "b": [
      "--no-detail"
    ],
    "v": [
      "--page-token"
    ]
  },
  "im +flag-list": {
    "b": [
      "--enrich-feed-thread"
    ],
    "v": [
      "--page-limit",
      "--page-size",
      "--page-token"
    ]
  },
  "im chats get": {
    "b": [],
    "v": [
      "--chat-id",
      "--user-id-type"
    ]
  },
  "im chat.members bots": {
    "b": [],
    "v": [
      "--chat-id"
    ]
  },
  "im chat.members get": {
    "b": [
      "--check-security-conf"
    ],
    "v": [
      "--chat-id",
      "--member-id-type",
      "--page-size",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "im chat.join_requests list": {
    "b": [],
    "v": [
      "--chat-id",
      "--member-id-type",
      "--page-size",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "im chat.moderation get": {
    "b": [],
    "v": [
      "--chat-id",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "im chat.nickname get": {
    "b": [],
    "v": [
      "--chat-id"
    ]
  },
  "im chat.user_setting batch_query": {
    "b": [],
    "v": [
      "--data"
    ]
  },
  "im feed.groups batch_query": {
    "b": [],
    "v": [
      "--user-id-type",
      "--data"
    ]
  },
  "im files folder": {
    "b": [
      "--recursive"
    ],
    "v": [
      "--file-key",
      "--srcid",
      "--srctype"
    ]
  },
  "im messages read_status": {
    "b": [],
    "v": [
      "--data"
    ]
  },
  "im messages read_users": {
    "b": [],
    "v": [
      "--message-id",
      "--user-id-type",
      "--page-size",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "im pins list": {
    "b": [],
    "v": [
      "--chat-id",
      "--end-time",
      "--page-size",
      "--page-token",
      "--start-time",
      "--page-delay",
      "--page-limit"
    ]
  },
  "im reactions list": {
    "b": [],
    "v": [
      "--message-id",
      "--page-size",
      "--page-token",
      "--reaction-type",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "im reactions batch_query": {
    "b": [],
    "v": [
      "--user-id-type",
      "--data"
    ]
  },
  "mail +triage": {
    "b": [
      "--is-unread",
      "--labels",
      "--print-filter-schema"
    ],
    "v": [
      "--filter",
      "--folder",
      "--folder-id",
      "--mailbox",
      "--max",
      "--page-token",
      "--query"
    ]
  },
  "mail +message": {
    "b": [
      "--html",
      "--print-output-schema"
    ],
    "v": [
      "--mailbox",
      "--message-id"
    ]
  },
  "mail +messages": {
    "b": [
      "--html",
      "--print-output-schema"
    ],
    "v": [
      "--mailbox",
      "--message-ids"
    ]
  },
  "mail +thread": {
    "b": [
      "--html",
      "--include-spam-trash",
      "--print-output-schema"
    ],
    "v": [
      "--mailbox",
      "--thread-id"
    ]
  },
  "mail +rule-list": {
    "b": [],
    "v": [
      "--name-contains",
      "--user-mailbox-id"
    ]
  },
  "mail +rule-get": {
    "b": [],
    "v": [
      "--rule-id",
      "--user-mailbox-id"
    ]
  },
  "mail +signature": {
    "b": [],
    "v": [
      "--detail",
      "--from"
    ]
  },
  "mail user_mailbox.messages list": {
    "b": [
      "--only-unread"
    ],
    "v": [
      "--page-size",
      "--user-mailbox-id",
      "--folder-id",
      "--label-id",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "mail user_mailbox.messages get": {
    "b": [],
    "v": [
      "--message-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.messages send_status": {
    "b": [],
    "v": [
      "--message-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.threads list": {
    "b": [
      "--only-unread"
    ],
    "v": [
      "--page-size",
      "--user-mailbox-id",
      "--folder-id",
      "--label-id",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "mail user_mailbox.threads get": {
    "b": [
      "--include-spam-trash"
    ],
    "v": [
      "--thread-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.folders list": {
    "b": [],
    "v": [
      "--user-mailbox-id",
      "--folder-type"
    ]
  },
  "mail user_mailbox.folders get": {
    "b": [],
    "v": [
      "--folder-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.labels list": {
    "b": [],
    "v": [
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.labels get": {
    "b": [],
    "v": [
      "--label-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.drafts list": {
    "b": [],
    "v": [
      "--user-mailbox-id",
      "--page-size",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "mail user_mailbox.drafts get": {
    "b": [],
    "v": [
      "--draft-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.rules list": {
    "b": [],
    "v": [
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.mail_contacts list": {
    "b": [],
    "v": [
      "--page-size",
      "--user-mailbox-id",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "mail user_mailbox.sent_messages get_recall_detail": {
    "b": [],
    "v": [
      "--message-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.settings send_as": {
    "b": [],
    "v": [
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.templates list": {
    "b": [],
    "v": [
      "--user-mailbox-id"
    ]
  },
  "mail user_mailbox.templates get": {
    "b": [],
    "v": [
      "--template-id",
      "--user-mailbox-id"
    ]
  },
  "mail user_mailboxes accessible_mailboxes": {
    "b": [],
    "v": [
      "--user-mailbox-id"
    ]
  },
  "mail user_mailboxes profile": {
    "b": [],
    "v": [
      "--user-mailbox-id"
    ]
  },
  "mindnotes nodes list": {
    "b": [],
    "v": [
      "--mindnote-id",
      "--user-id-type"
    ]
  },
  "minutes +search": {
    "b": [],
    "v": [
      "--end",
      "--owner-ids",
      "--page-size",
      "--page-token",
      "--participant-ids",
      "--query",
      "--start"
    ]
  },
  "minutes +detail": {
    "b": [
      "--chapter",
      "--keyword",
      "--summary",
      "--todo"
    ],
    "v": [
      "--minute-tokens"
    ]
  },
  "minutes minutes get": {
    "b": [],
    "v": [
      "--minute-token",
      "--user-id-type"
    ]
  },
  "note +detail": {
    "b": [],
    "v": [
      "--note-id"
    ]
  },
  "note +transcript": {
    "b": [],
    "v": [
      "--locale",
      "--note-id",
      "--transcript-format"
    ]
  },
  "okr +cycle-list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--time-range",
      "--user-id",
      "--user-id-type"
    ]
  },
  "okr +cycle-detail": {
    "b": [],
    "v": [
      "--cycle-id",
      "--style"
    ]
  },
  "okr +comment-list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--style",
      "--target-id",
      "--target-type",
      "--user-id-type"
    ]
  },
  "okr +comment-get": {
    "b": [],
    "v": [
      "--comment-id",
      "--style",
      "--user-id-type"
    ]
  },
  "okr +comment-detail": {
    "b": [],
    "v": [
      "--cycle-id",
      "--style"
    ]
  },
  "okr +progress-list": {
    "b": [],
    "v": [
      "--department-id-type",
      "--page-size",
      "--page-token",
      "--target-id",
      "--target-type",
      "--user-id-type"
    ]
  },
  "okr +progress-get": {
    "b": [],
    "v": [
      "--progress-id",
      "--style",
      "--user-id-type"
    ]
  },
  "okr cycles list": {
    "b": [],
    "v": [
      "--user-id",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "okr cycle.objectives list": {
    "b": [],
    "v": [
      "--cycle-id",
      "--department-id-type",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "okr objectives get": {
    "b": [],
    "v": [
      "--objective-id",
      "--department-id-type",
      "--user-id-type"
    ]
  },
  "okr objective.key_results list": {
    "b": [],
    "v": [
      "--objective-id",
      "--department-id-type",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "okr objective.indicators list": {
    "b": [],
    "v": [
      "--objective-id",
      "--department-id-type",
      "--user-id-type"
    ]
  },
  "okr objective.alignments list": {
    "b": [],
    "v": [
      "--objective-id",
      "--align-type",
      "--department-id-type",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "okr key_results get": {
    "b": [],
    "v": [
      "--key-result-id",
      "--department-id-type",
      "--user-id-type"
    ]
  },
  "okr key_result.indicators list": {
    "b": [],
    "v": [
      "--key-result-id",
      "--department-id-type",
      "--user-id-type"
    ]
  },
  "okr alignments get": {
    "b": [],
    "v": [
      "--alignment-id",
      "--department-id-type",
      "--user-id-type"
    ]
  },
  "okr categories list": {
    "b": [],
    "v": [
      "--owner-type",
      "--page-size",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "sheets +workbook-info": {
    "b": [],
    "v": [
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +sheet-info": {
    "b": [],
    "v": [
      "--include",
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +cells-get": {
    "b": [
      "--skip-hidden"
    ],
    "v": [
      "--include",
      "--max-chars",
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +cells-search": {
    "b": [
      "--include-formulas",
      "--match-case",
      "--match-entire-cell",
      "--regex"
    ],
    "v": [
      "--find",
      "--offset",
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +table-get": {
    "b": [
      "--no-header"
    ],
    "v": [
      "--max-chars",
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +csv-get": {
    "b": [
      "--include-row-prefix",
      "--skip-hidden"
    ],
    "v": [
      "--max-chars",
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +chart-list": {
    "b": [],
    "v": [
      "--chart-id",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +cond-format-list": {
    "b": [],
    "v": [
      "--rule-id",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +cond-format-result-get": {
    "b": [],
    "v": [
      "--max-chars",
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +dropdown-get": {
    "b": [],
    "v": [
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +filter-list": {
    "b": [],
    "v": [
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +filter-view-list": {
    "b": [],
    "v": [
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url",
      "--view-id"
    ]
  },
  "sheets +float-image-list": {
    "b": [],
    "v": [
      "--float-image-id",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +formula-verify": {
    "b": [
      "--ai-only",
      "--exit-on-error"
    ],
    "v": [
      "--max-locations",
      "--range",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +history-list": {
    "b": [],
    "v": [
      "--end-version",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +history-revert-status": {
    "b": [],
    "v": [
      "--spreadsheet-token",
      "--transaction-id",
      "--url"
    ]
  },
  "sheets +pivot-list": {
    "b": [],
    "v": [
      "--pivot-table-id",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +revision-get": {
    "b": [],
    "v": [
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +sparkline-list": {
    "b": [],
    "v": [
      "--group-id",
      "--sheet-id",
      "--sheet-name",
      "--spreadsheet-token",
      "--url"
    ]
  },
  "sheets +changeset-get": {
    "b": [],
    "v": [
      "--end-revision",
      "--spreadsheet-token",
      "--start-revision",
      "--url"
    ]
  },
  "slides +history-list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--presentation"
    ]
  },
  "slides +history-revert-status": {
    "b": [],
    "v": [
      "--presentation",
      "--task-id"
    ]
  },
  "slides xml_presentations get": {
    "b": [
      "--remove-attr-id"
    ],
    "v": [
      "--xml-presentation-id",
      "--revision-id"
    ]
  },
  "slides xml_presentation.slide get": {
    "b": [],
    "v": [
      "--xml-presentation-id",
      "--revision-id",
      "--slide-id",
      "--slide-number"
    ]
  },
  "slides xml_presentation.slide_image list": {
    "b": [],
    "v": [
      "--xml-presentation-id",
      "--data"
    ]
  },
  "slides xml_presentation.history list": {
    "b": [],
    "v": [
      "--xml-presentation-id",
      "--page-size",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "slides xml_presentation.history revert_status": {
    "b": [],
    "v": [
      "--task-id",
      "--xml-presentation-id"
    ]
  },
  "task +get-my-tasks": {
    "b": [
      "--complete"
    ],
    "v": [
      "--created_at",
      "--due-end",
      "--due-start",
      "--page-limit",
      "--page-token",
      "--query"
    ]
  },
  "task +get-related-tasks": {
    "b": [
      "--created-by-me",
      "--followed-by-me",
      "--include-complete"
    ],
    "v": [
      "--page-limit",
      "--page-token"
    ]
  },
  "task +search": {
    "b": [
      "--completed"
    ],
    "v": [
      "--assignee",
      "--creator",
      "--due",
      "--follower",
      "--page-limit",
      "--page-token",
      "--query"
    ]
  },
  "task +tasklist-search": {
    "b": [],
    "v": [
      "--create-time",
      "--creator",
      "--page-limit",
      "--page-token",
      "--query"
    ]
  },
  "task tasks list": {
    "b": [
      "--completed"
    ],
    "v": [
      "--agent-task-status",
      "--page-size",
      "--page-token",
      "--type",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task tasks get": {
    "b": [],
    "v": [
      "--task-guid",
      "--user-id-type"
    ]
  },
  "task tasklists list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task tasklists get": {
    "b": [],
    "v": [
      "--tasklist-guid",
      "--user-id-type"
    ]
  },
  "task tasklists tasks": {
    "b": [
      "--completed"
    ],
    "v": [
      "--tasklist-guid",
      "--created-from",
      "--created-to",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task subtasks list": {
    "b": [],
    "v": [
      "--task-guid",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task sections list": {
    "b": [],
    "v": [
      "--resource-type",
      "--page-size",
      "--page-token",
      "--resource-id",
      "--update-msec",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task sections get": {
    "b": [],
    "v": [
      "--section-guid",
      "--user-id-type"
    ]
  },
  "task sections tasks": {
    "b": [
      "--completed"
    ],
    "v": [
      "--section-guid",
      "--created-from",
      "--created-to",
      "--page-size",
      "--page-token",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task comments list": {
    "b": [],
    "v": [
      "--resource-id",
      "--direction",
      "--page-size",
      "--page-token",
      "--resource-type",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task comments get": {
    "b": [],
    "v": [
      "--comment-id",
      "--user-id-type"
    ]
  },
  "task custom_fields list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--resource-id",
      "--resource-type",
      "--update-msec",
      "--user-id-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "task custom_fields get": {
    "b": [],
    "v": [
      "--custom-field-guid",
      "--user-id-type"
    ]
  },
  "vc +detail": {
    "b": [],
    "v": [
      "--meeting-ids"
    ]
  },
  "vc +search": {
    "b": [],
    "v": [
      "--end",
      "--organizer-ids",
      "--page-size",
      "--page-token",
      "--participant-ids",
      "--query",
      "--room-ids",
      "--start"
    ]
  },
  "vc +meeting-events": {
    "b": [],
    "v": [
      "--end",
      "--meeting-id",
      "--page-size",
      "--page-token",
      "--start"
    ]
  },
  "vc +meeting-list-active": {
    "b": [],
    "v": [
      "--user-id"
    ]
  },
  "vc +recording": {
    "b": [],
    "v": [
      "--calendar-event-ids",
      "--meeting-ids"
    ]
  },
  "vc meeting get": {
    "b": [
      "--with-meeting-ability",
      "--with-participants"
    ],
    "v": [
      "--meeting-id",
      "--query-mode",
      "--user-id-type"
    ]
  },
  "wiki +space-list": {
    "b": [],
    "v": [
      "--page-limit",
      "--page-size",
      "--page-token"
    ]
  },
  "wiki +node-list": {
    "b": [],
    "v": [
      "--page-limit",
      "--page-size",
      "--page-token",
      "--parent-node-token",
      "--space-id"
    ]
  },
  "wiki +node-get": {
    "b": [],
    "v": [
      "--node-token",
      "--space-id"
    ]
  },
  "wiki +member-list": {
    "b": [],
    "v": [
      "--page-limit",
      "--page-size",
      "--page-token",
      "--space-id"
    ]
  },
  "wiki spaces list": {
    "b": [],
    "v": [
      "--page-size",
      "--page-token",
      "--space-type",
      "--page-delay",
      "--page-limit"
    ]
  },
  "wiki spaces get": {
    "b": [],
    "v": [
      "--space-id",
      "--lang"
    ]
  },
  "wiki spaces get_node": {
    "b": [],
    "v": [
      "--token",
      "--obj-type"
    ]
  },
  "wiki nodes list": {
    "b": [],
    "v": [
      "--space-id",
      "--page-size",
      "--page-token",
      "--parent-node-token",
      "--page-delay",
      "--page-limit"
    ]
  },
  "wiki members list": {
    "b": [],
    "v": [
      "--space-id",
      "--page-size",
      "--page-token",
      "--page-delay",
      "--page-limit"
    ]
  }
}

export const READONLY_SKILL_COMMANDS = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_ALLOWLIST).map(([key, def]) => [
      key,
      Object.freeze({
        boolFlags: new Set([...SHARED_BOOL_FLAGS, ...(def.b || [])]),
        valueFlags: new Set([...SHARED_VALUE_FLAGS, ...(def.v || [])]),
      }),
    ]),
  ),
)

function hasControlChars(token) {
  return typeof token !== 'string' || token.length === 0 || /[\r\n\0]/.test(token)
}

function isPlainJsonObjectOrArray(raw) {
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '-' || trimmed.startsWith('@')) return false
  try {
    const parsed = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}

/**
 * Validates that a model-generated lark-cli argv array matches an explicit
 * read-only subcommand and allowed read-only flags only.
 */
export function validateReadonlySkillArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, reason: 'empty argv' }
  }
  if (!argv.every((tok) => !hasControlChars(tok))) {
    return { ok: false, reason: 'invalid token' }
  }

  const head = argv[0].toLowerCase()
  if (head === 'whoami') {
    if (argv.length === 1 || (argv.length === 2 && argv[1] === '--json')) {
      return { ok: true, commandKey: 'whoami', prefixLen: 1 }
    }
    return { ok: false, reason: 'unexpected args for whoami' }
  }
  if (head === 'schema') {
    if (argv.length <= 2 && (!argv[1] || /^[a-z0-9._-]+$/i.test(argv[1]))) {
      return { ok: true, commandKey: 'schema', prefixLen: 1 }
    }
    return { ok: false, reason: 'unexpected args for schema' }
  }
  if (head === 'skills') {
    const sub = argv[1]
    if (sub === 'list' && argv.length === 2) {
      return { ok: true, commandKey: 'skills list', prefixLen: 2 }
    }
    if (sub === 'read' && argv.length === 3 && /^[a-z0-9_./-]+$/i.test(argv[2]) && !argv[2].includes('..')) {
      return { ok: true, commandKey: 'skills read', prefixLen: 2 }
    }
    return { ok: false, reason: 'disallowed skills subcommand' }
  }

  // Match either 3-token resource command ("domain resource method") or 2-token shortcut ("domain +shortcut")
  let prefixLen = 0
  let commandKey = ''
  if (argv.length >= 3 && !argv[1].startsWith('-') && !argv[2].startsWith('-')) {
    const k3 = `${head} ${argv[1]} ${argv[2]}`
    if (Object.prototype.hasOwnProperty.call(READONLY_SKILL_COMMANDS, k3)) {
      prefixLen = 3
      commandKey = k3
    }
  }
  if (!commandKey && argv.length >= 2 && !argv[1].startsWith('-')) {
    const k2 = `${head} ${argv[1]}`
    if (Object.prototype.hasOwnProperty.call(READONLY_SKILL_COMMANDS, k2)) {
      prefixLen = 2
      commandKey = k2
    }
  }
  if (!commandKey) {
    return { ok: false, reason: `command not in read-only allowlist: ${argv.slice(0, 3).join(' ')}` }
  }

  const schema = READONLY_SKILL_COMMANDS[commandKey]
  for (let i = prefixLen; i < argv.length; i++) {
    const tok = argv[i]
    if (!tok.startsWith('--')) {
      return { ok: false, reason: `disallowed positional or short arg: ${tok}` }
    }
    const eqIdx = tok.indexOf('=')
    const flagName = eqIdx === -1 ? tok : tok.slice(0, eqIdx)
    const inlineVal = eqIdx === -1 ? undefined : tok.slice(eqIdx + 1)

    if (schema.boolFlags.has(flagName)) {
      if (inlineVal !== undefined && inlineVal !== 'true' && inlineVal !== 'false') {
        return { ok: false, reason: `invalid boolean flag value for ${flagName}` }
      }
      continue
    }

    if (schema.valueFlags.has(flagName)) {
      let val = inlineVal
      if (val === undefined) {
        if (i + 1 >= argv.length) {
          return { ok: false, reason: `missing value for ${flagName}` }
        }
        const nextTok = argv[i + 1]
        // Reject omitted value where the next token is actually another known flag
        if (nextTok.startsWith('--')) {
          const nextName = nextTok.includes('=') ? nextTok.slice(0, nextTok.indexOf('=')) : nextTok
          if (schema.boolFlags.has(nextName) || schema.valueFlags.has(nextName)) {
            return { ok: false, reason: `missing value before flag ${nextName}` }
          }
        }
        val = nextTok
        i++
      }
      if (!val || val.startsWith('@') || val === '-') {
        return { ok: false, reason: `disallowed file/stdin value for ${flagName}` }
      }
      if (flagName === '--data' && !isPlainJsonObjectOrArray(val)) {
        return { ok: false, reason: `--data must be inline JSON object/array` }
      }
      if (flagName === '--format' && !ALLOWED_FORMATS.has(val.toLowerCase())) {
        return { ok: false, reason: `disallowed output format: ${val}` }
      }
      continue
    }

    return { ok: false, reason: `flag not allowlisted for ${commandKey}: ${flagName}` }
  }

  return { ok: true, commandKey, prefixLen }
}

const KNOWN_TOP_DOMAINS = new Set([
  'application', 'approval', 'apps', 'attendance', 'base', 'calendar', 'contact',
  'docs', 'drive', 'event', 'im', 'mail', 'markdown', 'mindnotes', 'minutes',
  'note', 'okr', 'sheets', 'slides', 'task', 'vc', 'whiteboard', 'wiki',
  'api', 'schema', 'skills', 'whoami', 'auth', 'config', 'update', 'upgrade',
])

const SKILL_DOMAIN_CANDIDATES = {
  'lark-approval': ['approval'],
  'lark-apps': ['apps'],
  'lark-attendance': ['attendance'],
  'lark-base': ['base'],
  'lark-calendar': ['calendar'],
  'lark-contact': ['contact'],
  'lark-doc': ['docs'],
  'lark-drive': ['drive'],
  'lark-event': ['event'],
  'lark-im': ['im'],
  'lark-mail': ['mail'],
  'lark-markdown': ['markdown'],
  'lark-meeting': ['vc', 'minutes', 'note'],
  'lark-minutes': ['minutes'],
  'lark-note': ['note', 'minutes'],
  'lark-okr': ['okr'],
  'lark-sheets': ['sheets'],
  'lark-slides': ['slides'],
  'lark-task': ['task'],
  'lark-vc': ['vc'],
  'lark-vc-agent': ['vc'],
  'lark-whiteboard': ['whiteboard'],
  'lark-wiki': ['wiki'],
  'lark-workflow-meeting-summary': ['minutes', 'vc', 'note'],
  'lark-workflow-standup-report': ['calendar', 'task'],
}

/**
 * Official SKILL.md tables often omit the CLI domain prefix (e.g. "tasks query"
 * instead of "approval tasks query", or "+cycle-list" instead of "okr +cycle-list").
 * Prepends the matching domain prefix when the model omits it.
 */
export function normalizeSkillArgvWithDomain(argv, skillName) {
  if (!Array.isArray(argv) || argv.length === 0) return argv
  const head = String(argv[0] || '').toLowerCase()
  if (KNOWN_TOP_DOMAINS.has(head)) return argv

  const candidates = SKILL_DOMAIN_CANDIDATES[skillName] || []
  for (const domain of candidates) {
    const withDomain = [domain, ...argv]
    if (validateReadonlySkillArgv(withDomain).ok) return withDomain
  }
  if (candidates.length === 1 && argv[0] && !argv[0].startsWith('-')) {
    return [candidates[0], ...argv]
  }
  return argv
}
