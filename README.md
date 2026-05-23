# deepseek 代码和 git 补全 🤖

**deepseek 代码和 git 补全** 是一个 VS Code 扩展，利用 DeepSeek V4 AI 的强大能力，为您提供智能化的 Git 提交信息生成和代码补全功能。

## ✨ 功能特性

### 📝 智能 Git 提交信息生成

- 自动分析暂存区文件更改，生成规范的 Git 提交信息
- 支持 Conventional Commits 规范（feat, fix, refactor 等类型）
- 可配置提交信息的语言（中文/英文/自动）
- 支持 emoji 前缀（如 ✨, 🐛, 📝）
- 在源代码管理视图直接触发，一键生成

### 💡 AI 代码补全

- 基于 DeepSeek 的智能代码补全建议
- 自动分析上下文代码，提供精准的补全
- 支持所有编程语言
- 可调节触发延迟，避免过度请求

### 📋 提交解释

- 选择历史提交，DeepSeek 会为您详细解释其变更内容

## 🚀 快速开始

### 1. 安装扩展

在 VS Code 扩展商店搜索 "deepseek 代码和 git 补全" 或手动安装 VSIX 文件。

### 2. 配置 API 密钥

1. 前往 [DeepSeek 平台](https://platform.deepseek.com/) 注册并获取 API 密钥
2. 在 VS Code 中打开设置（`Ctrl + ,`）
3. 搜索 `deepseek.apiKey`
4. 输入您的 API 密钥

### 3. 开始使用

#### 生成提交信息

1. 在项目中做代码更改
2. 使用 `git add` 暂存更改
3. 在源代码管理视图（`Ctrl + Shift + G`）中点击 "DeepSeek: 生成 Git 提交信息" 按钮
4. 或使用快捷键 `Ctrl + Shift + G` 然后按 `C`
5. 或者命令面板（`Ctrl + Shift + P`）中输入 `DeepSeek: 生成 Git 提交信息`

#### 代码补全

只需正常编写代码，DeepSeek 会在您输入时自动提供补全建议，按 `Tab` 接受建议。

## ⚙️ 配置选项

| 设置项 | 描述 | 默认值 |
|--------|------|--------|
| `deepseek.apiKey` | DeepSeek API 密钥 | `""` |
| `deepseek.apiEndpoint` | API 端点地址 | `https://api.deepseek.com` |
| `deepseek.model` | 模型选择 (deepseek-v4-flash / deepseek-v4-pro) | `deepseek-v4-flash` |
| `deepseek.enableThinking` | 开启思考模式（展示内部推理过程） | `false` |
| `deepseek.maxTokens` | 最大生成 token 数 | `4096` |
| `deepseek.temperature` | 生成温度 (0.0 - 2.0) | `0.8` |
| `deepseek.enableCompletion` | 启用代码补全 | `true` |
| `deepseek.completionDelay` | 补全触发延迟 (毫秒) | `500` |
| `deepseek.commitLanguage` | 提交信息语言 (auto/zh-CN/en) | `auto` |
| `deepseek.commitEmoji` | 使用 emoji 前缀 | `false` |
| `deepseek.commitMaxLength` | 提交信息标题最大字符数 | `72` |

## 🎯 命令

| 命令 | 描述 | 快捷键 |
|------|------|--------|
| `DeepSeek: 生成 Git 提交信息` | 分析暂存更改并生成提交信息 | `Ctrl+Shift+G c` |
| `DeepSeek: 为暂存更改生成提交信息` | 同上（显式命令） | - |
| `DeepSeek: 解释所选提交` | 解释历史提交的内容 | - |

## 🔧 技术实现

- 使用 VS Code 的 `InlineCompletionItemProvider` API 实现代码补全
- 使用 Git 扩展 API 获取暂存区更改和提交历史
- 流式 API 调用实现实时的提交信息生成体验
- 请求防抖和取消机制避免资源浪费

## 📄 许可证

MIT License
