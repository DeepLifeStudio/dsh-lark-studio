# dsh-lark-studio

[简体中文](README.md) | [English](README_EN.md)

[![npm version](https://img.shields.io/npm/v/dsh-lark-studio.svg)](https://www.npmjs.com/package/dsh-lark-studio)
[![dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/deeplifestudio/dsh-lark-studio)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness 的飞书插件。底层调用飞书官方 [`lark-cli`](https://www.npmjs.com/package/@larksuite/cli)，可以直接在聊天或右侧工作台里用自然语言建多维表格、改表结构和记录，顺带处理日程、待办、群消息、邮件、通讯录和审批。

## 能做什么

### 1. 一句话建多维表格

不用先想清楚字段类型，直接说你想记什么，比如：

- `我想记一下客户，公司、联系人、谈到哪一步`
- `做一个部门报销记录表`
- `研发需求和 Bug 跟踪`

模型会先生成一份包含字段、选项、看板视图和示例数据的草稿。在侧边栏工作台里确认没问题后，点一下就会在你的飞书个人空间创建真实的多维表格并返回链接。

也可以直接在 DSH 聊天输入框里用斜杠命令：

```text
/lark 客户往来记录，谁在跟、预算多少、谈到哪一步
```

### 2. 对话改表（不用切回飞书后台）

表建好之后，继续用自然语言改结构或数据：

- `加一列报销状态，选项是未提交、审批中、已打款`
- `把优先级的低/中/高改成 P0/P1/P2`
- `按状态建一个看板视图`
- `新增一条记录：公司字节跳动，联系人张三，预算 50 万`
- `把所有进行中的任务截止日期延到下周五`

涉及删列、删视图、删选项或删记录等不可撤销的操作时，会先列出影响项，等你确认后再执行。

### 3. 飞书日常协同

除了多维表格，也可以在对话里直接查和改飞书日常事务：

- **日程**：查今天日程、看某人忙闲、建/改/取消会议
- **待办**：看未完成任务、建任务、指派负责人、标记完成
- **消息与群聊**：搜群聊、查历史消息、给指定群或同事发消息
- **邮件**：看收件箱摘要、读邮件、发邮件或草稿
- **通讯录**：按姓名、部门或工号查同事信息
- **审批与文档**：查待审批单、发起/通过/驳回审批、读写云文档和知识库

如果当前飞书应用缺少某项权限，插件会直接给出对应权限名和飞书开放平台的跳转链接，不会只报一串错误码。

<details>
<summary>查看完整功能清单（多维表格 + 飞书协同 CRUD）</summary>

#### 多维表格

- **多表管理**：新建数据表（`add_table`）、重命名数据表（`rename_table`）、读取库元数据与表结构（`readSchema`）
- **字段类型**：
  - 文本：普通文本、多行文本、超链接（URL）、电话、邮箱、条形码
  - 数值：整数/浮点数、货币（CNY/USD 等）、百分比、进度条
  - 选项：单选、多选，支持增量加选项（`add_options`）与删选项（`remove_options`）
  - 其他：自定义格式日期时间、人员（User）、复选框、自动编号、公式、关联与查找引用（Link / Lookup）
  - 字段变更：重命名列（`rename_field`）、删除列（`delete_field`）
- **视图管理**：表格（Grid）、看板（Kanban）、画册（Gallery）、日历（Calendar）、甘特（Gantt）；支持新建/重命名/删除视图，以及按视图控制字段显隐（`set_view_visible_fields`）
- **记录操作**：批量新增记录、按条件或指定 Record ID 更新与删除记录、快速抽样查看前 20 条数据（`peek`）
- **权限与扩展**：开关高级权限、自定义角色增删改（`create_role` / `update_role` / `delete_role`）、字段 AI 扩展、仪表盘、收集表

#### 飞书协同（对应 `lark-cli` 能力）

- **日历与会议（Calendar）**
  - 新增：创建日程与会议（`calendar +create`）、加入日程（`+join-event`）
  - 修改：修改时间/地点/参会人（`calendar +update`）、回复邀请（`+rsvp`）、转让组织者（`+transfer`）
  - 删除：取消或删除日程（`calendar +delete`，支持周期日程）
  - 查询：当日/指定日期议程（`+agenda`）、日程详情（`+get`）、搜索日程（`+search-event`）、忙闲查询（`+freebusy`）、找会议室（`+room-find`）、参会人状态（`+list-attendees`）、会议信息与纪要（`+meeting`）
- **任务与待办（Task）**
  - 新增：建任务（`task +create`）、建清单（`+tasklist-create`）、建子任务（`subtasks create`）、评论（`+comment`）、上传附件（`+upload-attachment`）
  - 修改：标记完成（`+complete`）、重开（`+reopen`）、指派负责人（`+assign`）、改截止时间与描述（`+update`）、加关注人（`+followers`）、设提醒（`+reminder`）
  - 删除：删任务（`task tasks delete`）、删清单（`tasklists delete`）、移成员（`members remove`）
  - 查询：我的待办（`+get-my-tasks`）、相关任务（`+get-related-tasks`）、搜任务（`+search`）、搜清单（`+tasklist-search`）
- **消息与群聊（IM）**
  - 新增/发送：发文本/Markdown/卡片消息（`im +messages-send`）、回复消息（`+messages-reply`）、建群（`+chat-create`）、星标（`+flag-create`）、置顶（`pins create`）
  - 修改：编辑已发消息（`+messages-edit`）、改群名与公告（`+chat-update`）、群发言权限（`chat.moderation update`）
  - 删除：撤回/删除消息（`im messages delete`）、取消星标（`+flag-cancel`）、取消置顶（`pins delete`）
  - 查询：群聊列表（`+chat-list`）、搜群（`+chat-search`）、群成员（`+chat-members-list`）、聊天记录（`+chat-messages-list`）、跨群搜消息（`+messages-search`）、已读列表（`+message-read-users`）、星标列表（`+flag-list`）
- **飞书邮箱（Mail）**
  - 新增：发邮件（`mail +send`）、新建草稿（`+draft-create`）、建收信规则（`+rule-create`）、建模板（`+template-create`）
  - 修改：回复/全部回复（`+reply` / `+reply-all`）、转发（`+forward`）、编辑与发送草稿（`+draft-edit` / `+draft-send`）、标已读/移文件夹/打标签（`+message-modify`）、更新与启停规则（`+rule-update` / `+rule-enable` / `+rule-disable`）
  - 删除：移入废纸篓（`+message-trash` / `+thread-trash`）、删规则（`+rule-delete`）、删草稿（`user_mailbox.drafts delete`）
  - 查询：收件箱摘要（`+triage`）、读邮件与附件（`+message` / `+messages`）、完整会话（`+thread`）、文件夹（`user_mailbox.folders list`）、规则列表（`+rule-list`）、签名（`+signature`）
- **通讯录（Contact）**
  - 查询：按姓名/工号/部门搜同事（`contact +search-user`）、查个人资料（`+get-user`）、搜机器人（`+search-bot`）、批量查资料（`user_profiles batch_query`）
  - 组织管理：持有企业管理员凭据时支持部门创建、成员更新与离职归档
- **审批（Approval）**
  - 发起与撤销：发起审批单（`approval instances create`）、撤销本人申请（`approval instances cancel`）
  - 审批动作：通过（`approve`）、驳回（`reject`）、转交（`transfer`）、加签（`add_sign`）、回退（`rollback`）、催办（`remind`）
  - 查询：待我审批（`approval tasks query`）、审批详情（`approval instances get`）、我发起的（`approval instances initiated`）、搜审批定义（`approval approvals search`）
- **云文档与知识库（Docs / Drive / Wiki / Markdown）**
  - 支持创建、读取、追加/更新内容块、上传/下载/移动/删除云盘文件、维护知识库节点与协作权限，以及创建 Drive 原生 Markdown 文件
- **权限自检（Scopes Inspector）**
  - 检测当前账号在各开放平台领域的已授权状态；调用未授权接口时拦截报错并给出带 App ID 的直达授权链接

</details>

## 右侧边栏工作台

插件会在 DSH 右侧边栏注册一个「飞书工作台」标签页，相比纯聊天多了几件顺手的事：

- **首次连接向导**：自动检查本地有没有装 `lark-cli`，引导配置飞书应用 `App ID / App Secret` 和浏览器 OAuth 授权。
- **建表前预览**：用卡片展示字段、选项和示例数据，确认后再真正落盘。
- **思考过程实时流**：建表与改表规划时实时展示模型的推理过程，方便核对字段推导是否符合预期。
- **分屏联动**：左侧发指令改表，右侧直接内嵌飞书多维表格页面实时查看效果。
- **权限自检**：集中查看各模块权限开通状态，缺哪项点链接去开就行。

## 安装

### 前置条件

- Node.js `>= 18.0.0`
- DeepSeek Harness `>= 0.2.2-rc.1 < 0.3.0-0`
- 全局安装飞书官方 CLI：

```bash
npm install -g @larksuite/cli
```

### 安装插件

通过 npm 安装到你使用的 profile（`web` 或 `desktop`）：

```bash
# Web 模式
dsh plugin --profile web add dsh-lark-studio

# Desktop 模式
dsh plugin --profile desktop add dsh-lark-studio
```

也可以在 DSH 内置的 `dsh-market` 插件市场里搜 `dsh-lark-studio` 直接安装。

Web 模式下启动 DSH 需要带上 `--patch`，侧边栏工作台才会加载：

```bash
dsh start --patch
```

### 更新

```bash
dsh plugin --profile web update dsh-lark-studio
# 或更新全部插件
dsh plugin update
```

> 建议直接用 npm 安装，不要用 `git clone` 或 GitHub 仓库地址安装，否则 `dsh plugin update` 不会检测和拉取新版本。

### 首次使用

安装后在 DSH 右侧边栏打开「飞书工作台」，按页面提示走完三步即可：

1. 检测 `lark-cli`（未安装会给出安装命令）；
2. 绑定飞书自建应用的 `App ID` 和 `App Secret`（或按引导新建一个）；
3. 浏览器打开飞书授权页完成登录。

## 暴露给 Agent 的工具与命令

如果你习惯直接在主对话里让 Agent 自动调度，插件注册了以下入口：

| 入口 | 类型 | 用途 |
| :--- | :--- | :--- |
| `/lark <描述>` | 斜杠命令 | 一句话直接创建多维表格 |
| `lark_base_build` | Agent 工具 | 规划并创建多维表格（支持 `preview` 先预览） |
| `lark_base_adjust` | Agent 工具 | 对已有表格增删改字段、选项、视图与记录 |
| `lark_collab` | Agent 工具 | 执行日程、待办、消息、邮件、通讯录、审批等协同操作 |

## 常见问题

**一定要装 `lark-cli` 吗？**  
是的。插件不保存你的飞书账号密码，所有开放平台调用都通过本地的 `lark-cli` 和你本人的 OAuth 授权完成。

**建出来的表存在哪里？**  
默认在你授权登录的飞书账号「我的空间」下，默认仅自己可见，需要协作时再点飞书右上角分享即可。

**平时聊天会误触发建表吗？**  
不会。普通问候或日常问答不会触发建表；只有在你明确表达建表需求或调用 `/lark` 时才会进入规划流程。

**收录与发布渠道**  
已发布至 [npm](https://www.npmjs.com/package/dsh-lark-studio)，并收录于 [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（同步至 `dsh-market`）、[DeepSeek 1024](https://deepseek1024.com/plugins/DeepLifeStudio/dsh-lark-studio)、[DSH Plugin Hub](https://dsh-plugin.org/plugins/deeplifestudio/dsh-lark-studio) 及 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions/14154)。

## License

[MIT](LICENSE)
