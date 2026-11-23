# 发布与收录

## 五大生态源与发布渠道收录状态

本插件作为 DeepSeek Harness 生态的核心应用，已同步收录并支持在以下 5 个源中检索与分发：

1. **dsh-plugin.org**：<https://dsh-plugin.org/plugins/DeepLifeStudio/dsh-lark-studio>（已收录上线）
2. **awesome-dsh-plugin**：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>（收录于 tools 类目）
3. **dshmarket.com**：<https://dshmarket.com>（DSH 插件应用市场，同源同步收录）
4. **dsh-plugin-catalog (npm 官方索引)**：<https://www.npmjs.com/package/dsh-lark-studio>（标准 npm 分发）
5. **dshopen.org**：<https://dshopen.org>（DSH 开放开源生态门户收录）

---

## 历史与当前状态

- GitHub：<https://github.com/DeepLifeStudio/dsh-lark-studio>
- npm：<https://www.npmjs.com/package/dsh-lark-studio>（`1.1.4`）
- `1.1.4` 全面切换至官方 DSH Connection 路由机制 (`/api/dsh-lark/*`)，彻底移除 `desktop-workbench` 静态 bypass，完成 Peer 身份原生鉴权，并通过 33 项全功能全链路自动化测试。
- 中英文 README 均已同步更新五大生态市场与索引源说明。

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
