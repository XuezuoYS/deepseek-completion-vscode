# deepseek 代码和 git 补全

[Github](https://github.com/XuezuoYS/deepseek-completion-vscode)

**警告：此仓库基本由 Deepseek 大人开发，请谨慎使用**

> ~AI 编程太好用了，已经变成了离开 AI 大人就什么都不会的笨蛋了齁哦哦~

这是一个 VS Code 扩展，使用 Deepseek V4 提供 Git 提交信息生成和代码补全功能。

## 功能特性

### 智能 Git 提交信息生成

- 自动分析暂存区文件更改，生成规范的 Git 提交信息
- 支持 Conventional Commits 规范（feat, fix, refactor 等类型）
- 可配置提交信息的语言（中文/英文/自动）
- 支持 emoji 前缀（如 ✨, 🐛, 📝）
- 在源代码管理视图直接触发，一键生成

### AI 代码补全

- 基于 DeepSeek 的智能代码补全建议
- 自动分析上下文代码，提供精准的补全
- 支持所有编程语言
- 可调节触发延迟，避免过度请求

### 提交解释

- 选择历史提交，DeepSeek 会为您详细解释其变更内容

## 使用

### API 密钥

> 密钥通过 **操作系统凭据管理器** 加密存储（Windows 凭据管理器 / macOS Keychain），不会保存在 settings.json 中，也不会随 VS Code 设置同步。

在设置页中操作：
1. 打开设置 `Ctrl+,`，搜索 `deepseek-completion`
2. 在 `Api Key Status` 项中点击 **🔑 设置 API 密钥** 链接

### 生成提交信息

1. 暂存更改（若无暂存则自动使用未暂存的更改）
2. 在源代码管理视图（`Ctrl + Shift + G`）的工具栏点击 ✨ 按钮
3. 或使用快捷键 `Ctrl + Shift + G` 然后按 `C`
4. 或者在命令面板（`Ctrl + Shift + P`）中执行 `DeepSeek: 生成 Git 提交信息`

### 代码补全

只需正常编写代码，DeepSeek 会在您输入时自动提供补全建议，按 `Tab` 接受建议，或使用`Alt+\`手动触发。

## 命令

| 命令 | 描述 | 快捷键 |
|------|------|--------|
| `DeepSeek: 生成 Git 提交信息` | 分析暂存更改并生成提交信息 | `Ctrl+Shift+G c` |
| `DeepSeek: 为暂存更改生成提交信息` | 同上（显式命令） | - |

## 技术实现

- 使用 VS Code 的 `InlineCompletionItemProvider` API 实现代码补全
- 使用 Git 扩展 API 获取暂存区更改和提交历史
- 流式 API 调用实现实时的提交信息生成体验
- 请求防抖和取消机制避免资源浪费
- 使用 `SecretStorage` API 安全存储 API 密钥（系统凭据管理器）

## 从源码构建

克隆仓库后，按以下步骤构建和打包：

### 前置要求

- [Node.js](https://nodejs.org/) >= 18.x
- npm >= 9.x
- VS Code >= 1.85.0

### 构建步骤

```bash
# 1. 安装依赖（使用 lock 文件确保版本一致）
npm ci

# 2. 编译 TypeScript
npm run compile

# 3. （可选）监视模式 - 源码变化时自动重新编译
npm run watch

# 4. 打包为 VSIX 安装包
npx @vscode/vsce package --allow-missing-repository

# 打包后会在根目录生成 .vsix 文件，直接拖入 VS Code 扩展面板即可安装
```

### 在 VS Code 中调试运行

1. 在 VS Code 中打开本项目
2. 按 `F5` 启动扩展开发调试模式
3. 会打开一个新的 VS Code 窗口（扩展开发主机），DeepSeek 扩展已自动加载
4. 在该窗口中进行测试

### 项目结构

```
deepseek-completion/
├── .vscode/                  # VS Code 调试/任务配置
│   ├── launch.json           # F5 调试配置
│   └── tasks.json            # 构建任务
├── src/                      # TypeScript 源码
│   ├── extension.ts          # 扩展入口（激活/命令注册）
│   ├── config.ts             # 配置管理（SecretStorage + Settings）
│   ├── deepseekApi.ts        # DeepSeek API 客户端
│   ├── commitMessageProvider.ts  # Git 提交信息生成
│   └── completionProvider.ts     # 内联代码补全
├── out/                      # 编译输出（已 gitignore）
├── package.json              # 扩展清单
├── tsconfig.json             # TypeScript 配置
└── package-lock.json         # 锁定依赖版本（确保可复现）
```

### 构建产物清单

| 文件/目录 | 是否提交 | 说明 |
|-----------|---------|------|
| `src/` | ✅ 是 | TypeScript 源码 |
| `out/` | ❌ 否 | 编译输出，`npm run compile` 生成 |
| `node_modules/` | ❌ 否 | 依赖包，`npm ci` 安装 |
| `*.vsix` | ❌ 否 | 安装包，`vsce package` 生成 |
| `package-lock.json` | ✅ 是 | 锁定精确版本，保证可复现构建 |

> **可复现构建**：克隆仓库后，只需依次执行 `npm ci` → `npm run compile` → `npx @vscode/vsce package` 即可从源码生成完全一致的 VSIX 安装包。

## 自动发布（CI）

`.github/workflows/release.yml` 在向 `release` 分支推送**提交信息以 `bump version` 开头**的提交时自动执行：

1. 安装依赖 → 打包 VSIX（`vsce package`）
2. 从 `CHANGELOG.md` 提取当前版本条目作为 Release 说明
3. 发布到 **VS Code 插件市场**（`vsce publish --oidc`，已发布版本自动跳过）
4. 在 GitHub 创建对应的 Release 并附带 VSIX 产物

### 认证方式：OIDC 可信发布（无需 PAT）

发布使用 **OIDC 可信发布**：工作流申请 GitHub Actions OIDC 令牌（受众 `marketplace.visualstudio.com`），换取 Marketplace 的短期凭据后发布。仓库中**不需要保存任何长期令牌**（工作流已声明 `permissions: id-token: write`）。

> ⚠️ 不采用 Personal Access Token 的原因：Azure DevOps 的 Global PAT（跨所有组织的 PAT）将于 **2026-12-01 全部停用**，而 Marketplace 发布历史上要求 PAT 具备 “all accessible organizations” 权限，该方式即将失效。

### 首次配置

| 项目 | 要求 |
|------|------|
| 发布者 | `package.json` 中的 `publisher`（`xuezuoys`）需为插件市场中已创建的发布者 ID |
| 可信发布策略 | 在 [发布者管理页](https://marketplace.visualstudio.com/manage) 为该发布者配置 trusted publishing policy，填写本仓库（`<owner>/<repo>`）与工作流文件（`release.yml`） |

### 临时使用 PAT（可选）

若可信发布策略暂时无法配置，可退回 PAT 方式：在仓库 Secrets 中新增 `VSCE_PAT`（Azure DevOps → 选中组织 → 用户设置 → Personal Access Tokens → 新建令牌，Organization 选 `All accessible organizations`，Scopes 勾选 `Marketplace → Manage`），并将工作流中 `--oidc` 换成 `-p "$VSCE_PAT"`、同时为该步骤补上 `env: VSCE_PAT: ${{ secrets.VSCE_PAT }}`。

### 版本说明

`--oidc` 目前仅由 `vsce` 预发布版提供（稳定版 `3.9.2` 及以下无此参数），因此工作流通过 `VSCE_VERSION` 固定使用预发布版；待 `3.9.3` 稳定版发布后，可删除该变量并改回 `npx @vscode/vsce`。另外 vsce `3.9+` 要求 Node.js ≥ 22，工作流已相应调整。

## 许可证

MIT License
