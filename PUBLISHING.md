# 发布与收录

当前状态（2026-11-19）：

- GitHub：<https://github.com/DeepLifeStudio/dsh-lark-studio>
- npm：<https://www.npmjs.com/package/dsh-lark-studio>（`1.1.0`，`latest`）
- 首次发布产生的 `0.0.0-stage` 占位版本已 deprecate
- dsh-plugin.org：等它扫描 `dsh-plugin` topic
- awesome-dsh-plugin：仓库创建满 1 天后（2026-11-20 15:27 北京时间）提 PR

## 以后发新版本

```bash
cd lark-workbench
npm version patch
npm publish --access public --registry=https://registry.npmjs.org
```

账号开了 2FA 时，`npm publish` 需要用带 **Bypass 2FA** 的 Granular Access Token，或在终端输入 6 位验证码。
网页登录拿到的 token 不能直接发布；`Read and write (stage only)` 的 token 只能 `npm stage publish`。

## 提交 awesome-dsh-plugin

仓库满 1 天后，在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，新增
`data/plugins/DeepLifeStudio__dsh-lark-studio.yml`：

```yaml
url: https://github.com/DeepLifeStudio/dsh-lark-studio
name: DeepLifeStudio/dsh-lark-studio
category: tools
icon: https://raw.githubusercontent.com/DeepLifeStudio/dsh-lark-studio/main/assets/icon-256.png
description:
  en: 'A Feishu/Lark workbench for DeepSeek Harness: build a Base from one sentence and operate calendar, tasks, chat, mail, and contacts from the sidebar.'
  zh: '飞书智能工作台：一句话生成多维表格，并在侧栏处理日程、待办、群聊、邮件与通讯录。'
```

dshmarket.com 和 awesome-dsh-plugin.com 读的是同一份列表。

## dsh-plugin.org

它扫描 GitHub topic `dsh-plugin`，无需 PR；加 topic 后等待下一次刷新即可。如果几天后仍未出现，可在
[dsh-plugin-hub issues](https://github.com/dshplugin/dsh-plugin-hub/issues) 用提交模板开一个 issue。

## 验证

```bash
dsh plugin --profile desktop add dsh-lark-studio
```

装完重启 DSH，确认左侧栏出现「飞书工作台」，并检查插件详情里的中英文标题、简介和图标。
