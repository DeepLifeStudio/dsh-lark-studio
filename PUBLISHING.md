# 发布与收录

当前状态（2026-11-19）：

- 公开仓库：<https://github.com/DeepLifeStudio/dsh-lark-studio>
- `main` 已推送，GitHub topic 已加：`dsh-plugin`
- npm 包名 `dsh-lark-studio`，版本 `1.1.0`
- `package.json` 已含 `repository` / `homepage` / `engines.dsh` / `dsh.bundle`
- 还差：npm 发布；awesome-dsh-plugin 需要仓库创建满 1 天后才能过 CI（最早 2026-11-20 07:27 UTC）

## 1. 发布到 npm

本机 npm 当前未登录，且默认 registry 是 `https://registry.npmmirror.com`（只读镜像）。发布必须走官方源：

```bash
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

> 账号开了 2FA 时，`npm publish` 会要求输入 6 位验证码；网页登录拿到的 token 不能绕过发布 2FA。
> 如果 CLI 直接报 403，重新在终端执行并在提示时输入验证码，或使用带 **Bypass 2FA** 的 Granular Access Token。

发布前可用 `npm pack --dry-run` 检查包内容。

## 2. 提交 awesome-dsh-plugin

仓库满 1 天后，在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，新增
`data/plugins/DeepLifeStudio__dsh-lark-studio.yml`：

```yaml
url: https://github.com/DeepLifeStudio/dsh-lark-studio
name: DeepLifeStudio/dsh-lark-studio
category: tools
icon: https://raw.githubusercontent.com/DeepLifeStudio/dsh-lark-studio/main/assets/icon-256.png
description:
  en: A Feishu/Lark workbench for DeepSeek Harness: build a Base from one sentence and operate calendar, tasks, chat, mail, and contacts from the sidebar.
  zh: 飞书智能工作台：一句话生成多维表格，并在侧栏处理日程、待办、群聊、邮件与通讯录。
```

dshmarket.com 和 awesome-dsh-plugin.com 读的是同一份列表。

## 3. dsh-plugin.org

它扫描 GitHub topic `dsh-plugin`，无需 PR；加 topic 后等待下一次刷新即可。如果几天后仍未出现，可在
[dsh-plugin-hub issues](https://github.com/dshplugin/dsh-plugin-hub/issues) 用提交模板开一个 issue。

## 4. 验证

```bash
dsh plugin --profile desktop add dsh-lark-studio
```

装完重启 DSH，确认左侧栏出现「飞书工作台」，并检查插件详情里的中英文标题、简介和图标。
