# 发布与收录

当前包名 `dsh-lark-studio`，版本 `1.1.0`。已具备：

- `dsh.bundle.patch`（可被 `dsh plugin add` 安装）
- `engines.dsh`
- `locale/en.json` + `locale/zh.json`（中英标题/简介）
- `icon.svg` 和 `assets/icon-256.png`
- `LICENSE`（MIT）
- `README.md` 中的 `dsh plugin` 安装命令

还差：公开 GitHub 仓库、`repository` / `homepage`、npm 发布。

## 1. 建公开仓库

GitHub → New repository → 名称 `dsh-lark-studio` → **Public**，不要勾选初始化 README。
然后在本目录执行（把 `<owner>` 换成你的 GitHub 用户名）：

```bash
git init -b main
git add -A
git commit -m "dsh-lark-studio 1.1.0"
git remote add origin https://github.com/<owner>/dsh-lark-studio.git
git push -u origin main
```

## 2. 加 GitHub topic

仓库主页 → About 右侧齿轮 → Topics 填 `dsh-plugin` → Save。

dsh-plugin.org 会扫这个 topic；dshopen.org 等社区索引也以它为主要入口。

## 3. 补 package.json

在 `repository` 和 `homepage` 写入真实地址（dsh-market 靠它关联 GitHub Stars）：

```json
"repository": {
  "type": "git",
  "url": "https://github.com/<owner>/dsh-lark-studio.git"
},
"homepage": "https://github.com/<owner>/dsh-lark-studio#readme"
```

## 4. 发布到 npm

本机 npm registry 当前是 `https://registry.npmmirror.com`（只读镜像），发布必须显式指定官方源：

```bash
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

发布前可先用 `npm pack --dry-run` 检查包内容。

## 5. 提交 awesome-dsh-plugin

在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，新增
`data/plugins/<owner>__dsh-lark-studio.yml`：

```yaml
url: https://github.com/<owner>/dsh-lark-studio
name: <owner>/dsh-lark-studio
category: tools
description:
  en: A Feishu/Lark workbench for DeepSeek Harness: build a Base from one sentence and operate calendar, tasks, chat, mail, and contacts from the sidebar.
  zh: 飞书智能工作台：一句话生成多维表格，并在侧栏处理日程、待办、群聊、邮件与通讯录。
```

可选图标（GitHub 托管的 PNG/JPG/WebP，SVG 会被拒）：

```yaml
icon: https://raw.githubusercontent.com/<owner>/dsh-lark-studio/main/assets/icon-256.png
```

收录要求：仓库公开、`package.json` 声明 `dsh.bundle`、仓库创建满 1 天、描述与代码一致。

## 6. 验证

```bash
dsh plugin --profile desktop add dsh-lark-studio
```

装完重启 DSH，确认左侧栏出现「飞书工作台」，并检查插件详情里的中英文标题、简介和图标。
