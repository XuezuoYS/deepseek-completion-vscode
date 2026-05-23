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

## 配置选项

| 设置项 | 描述 | 默认值 |
|--------|------|--------|
| `deepseek-completion.apiKeyStatus` | API 密钥配置状态（含设置/清除链接） | `❌ 未配置` |
| `deepseek-completion.apiEndpoint` | API 端点地址 | `https://api.deepseek.com` |
| `deepseek-completion.enableCompletion` | 启用 DeepSeek 代码补全 | `true` |
| `deepseek-completion.model` | 模型选择 (deepseek-v4-flash / deepseek-v4-pro) | `deepseek-v4-flash` |
| `deepseek-completion.enableThinking` | 开启思考模式（展示内部推理过程） | `false` |
| `deepseek-completion.maxTokens` | 最大生成 token 数 | `4096` |
| `deepseek-completion.temperature` | 生成温度 (0.0 - 2.0) | `0.8` |
| `deepseek-completion.completionDelay` | 补全触发延迟 (毫秒) | `50` |
| `deepseek-completion.commitLanguage` | 提交信息语言 (auto/zh-CN/en) | `auto` |
| `deepseek-completion.commitEmoji` | 使用 emoji 前缀 | `false` |
| `deepseek-completion.commitMaxLength` | 提交信息标题最大字符数 | `72` |

## 命令

| 命令 | 描述 | 快捷键 |
|------|------|--------|
| `DeepSeek: 生成 Git 提交信息` | 分析暂存更改并生成提交信息 | `Ctrl+Shift+G c` |
| `DeepSeek: 为暂存更改生成提交信息` | 同上（显式命令） | - |
| `DeepSeek: 解释所选提交` | 解释历史提交的内容 | - |

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

## 许可证

MIT License
