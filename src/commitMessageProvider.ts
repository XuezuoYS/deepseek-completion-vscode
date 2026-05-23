import * as vscode from 'vscode';
import { DeepSeekAPI } from './deepseekApi';
import { DeepSeekConfig } from './config';

/**
 * Git 提交信息生成器
 * 使用 DeepSeek 分析暂存区的更改并生成提交信息
 */
export class CommitMessageProvider {
    private api: DeepSeekAPI;
    private abortController: AbortController | null = null;

    constructor() {
        this.api = new DeepSeekAPI();
    }

    /**
     * 生成提交信息
     */
    async generateCommitMessage(): Promise<void> {
        const validation = await DeepSeekConfig.validateConfig();
        if (!validation.valid) {
            vscode.window.showErrorMessage(validation.message!, { modal: true });
            return;
        }

        try {
            // 获取 Git 扩展实例
            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (!gitExtension) {
                vscode.window.showErrorMessage('未找到 Git 扩展');
                return;
            }

            const gitAPI = gitExtension.getAPI(1);
            const repository = gitAPI.repositories[0];

            if (!repository) {
                vscode.window.showErrorMessage('未找到 Git 仓库');
                return;
            }

            // 显示进度通知
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'DeepSeek 正在生成提交信息...',
                cancellable: true
            }, async (progress, token) => {
                this.abortController = new AbortController();
                token.onCancellationRequested(() => {
                    this.abortController?.abort();
                });

                // 优先获取暂存的更改，若没有则获取未暂存的更改
                let diff = await this.getStagedChanges(repository);
                let changeType = '暂存';

                if (!diff) {
                    diff = await this.getUnstagedChanges(repository);
                    changeType = '未暂存';
                }

                if (!diff) {
                    vscode.window.showInformationMessage('没有检测到任何代码更改。请先修改代码后再试。');
                    return;
                }

                progress.report({ message: `正在分析${changeType}的更改...` });

                // 获取最近的提交历史作为上下文
                const recentCommits = await this.getRecentCommits(repository);

                // 构建提示词
                const prompt = this.buildCommitPrompt(diff, recentCommits, changeType);

                // 更新系统提示词，告知变更类型
                const systemPrompt = this.getSystemPrompt(changeType);

                // 先清空 SCM 输入框，准备流式写入
                repository.inputBox.value = '';

                let result = '';
                await this.api.chat(
                    [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: prompt }
                    ],
                    {
                        temperature: 0.3,
                        maxTokens: 500,
                        stream: true,
                        onToken: (token) => {
                            result += token;
                            // 流式写入：实时更新 SCM 输入框，让用户看到逐字出现的效果
                            // 使用轻量清理（仅去除前后空白），保持实时性
                            repository.inputBox.value = result.trim();
                        },
                        signal: this.abortController.signal
                    }
                );

                if (result) {
                    // 流结束后，做最终格式化清理（去代码块标记、去前缀、截断等）
                    const commitMessage = this.formatCommitMessage(result);
                    repository.inputBox.value = commitMessage;
                    await this.showSuccessStatus();
                }
            });

        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('abort')) {
                return;
            }
            vscode.window.showErrorMessage(`生成提交信息失败: ${error.message}`);
        }
    }

    /**
     * 获取暂存的更改内容
     */
    private async getStagedChanges(repository: any): Promise<string | null> {
        try {
            // 使用 git diff --cached 获取暂存区更改
            const diff = await repository.diff(true); // true = cached
            if (!diff || diff.trim().length === 0) {
                return null;
            }
            return diff;
        } catch {
            return null;
        }
    }

    /**
     * 获取最近的提交历史
     */
    private async getRecentCommits(repository: any, count: number = 3): Promise<string> {
        try {
            const commits = await repository.log({ maxEntries: count });
            return commits.map((commit: any, index: number) => {
                const lines = commit.message.trim().split('\n');
                const title = lines[0];
                const body = lines.slice(1).filter((l: string) => l.trim()).join('\n');
                let entry = `提交 ${index + 1}: ${title}`;
                if (body) {
                    entry += `\n   详细: ${body.substring(0, 200)}`;
                }
                return entry;
            }).join('\n\n');
        } catch {
            return '';
        }
    }

    /**
     * 获取未暂存的更改内容（工作区更改）
     */
    private async getUnstagedChanges(repository: any): Promise<string | null> {
        try {
            // 使用 git diff 获取未暂存的工作区更改
            const diff = await repository.diff(false); // false = unstaged
            if (!diff || diff.trim().length === 0) {
                return null;
            }
            return diff;
        } catch {
            return null;
        }
    }

    /**
     * 构建系统提示词
     */
    private getSystemPrompt(changeType: string = '暂存'): string {
        const language = DeepSeekConfig.getCommitLanguage();
        const useEmoji = DeepSeekConfig.useCommitEmoji();
        const maxLength = DeepSeekConfig.getCommitMaxLength();

        let langInstruction = '';
        if (language === 'zh-CN') {
            langInstruction = '请使用中文生成提交信息。';
        } else if (language === 'en') {
            langInstruction = 'Please generate commit messages in English.';
        } else {
            langInstruction = '根据代码更改的内容自动选择语言（中文或英文）生成提交信息。';
        }

        let emojiInstruction = '';
        if (useEmoji) {
            emojiInstruction = '请在提交信息类型前加上合适的 emoji（如 feat: 前加 ✨, fix: 前加 🐛, docs: 前加 📝 等）。';
        }

        const autoAddNote = changeType === '未暂存'
            ? '\n注意：这些更改尚未暂存（git add），请在生成提交信息后手动执行 git add 再提交。'
            : '';

        return `你是一个专业的 Git 提交信息生成器。你的任务是根据${changeType}的代码更改生成清晰、简洁、规范的提交信息。

要求：
1. 提交信息格式为：<type>: <description>
2. 类型包括：feat（新功能）、fix（修复）、docs（文档）、style（样式）、refactor（重构）、ui（用户界面）、perf（性能）、test（测试）、chore（杂项）、ci（CI/CD）
3. 第一行是标题，不超过 ${maxLength} 个字符
4. 如果需要，空一行后添加详细描述
5. 详细描述说明更改的原因和影响
6. ${langInstruction}
7. ${emojiInstruction}
8. 分析更改的文件名和代码差异来理解更改的意图
9. 不要包含无意义的描述
10. **最重要的是：仔细分析下面提供的最近提交历史，严格模仿其措辞风格、详细程度、标点使用、大小写习惯和整体格式**${autoAddNote}`;
    }

    /**
     * 构建用户提示词
     */
    private buildCommitPrompt(diff: string, recentCommits: string, changeType: string = '暂存'): string {
        const recentCommitsSection = recentCommits 
            ? `\n\n以下是最近的提交历史，请仔细分析它们的风格（措辞、语气、详略、格式），并严格按照此风格生成新的提交信息：\n${recentCommits}`
            : '';

        return `请分析以下${changeType}的代码更改，生成一条规范的 Git 提交信息。\n\n\`\`\`diff\n${diff}\n\`\`\`${recentCommitsSection}`;
    }

    /**
     * 格式化提交信息
     */
    private formatCommitMessage(raw: string): string {
        // 移除可能的 markdown 代码块标记
        let message = raw.replace(/```[\s\S]*?```/g, (match) => {
            return match.replace(/```\w*\n?/g, '').trim();
        });

        // 移除可能的前缀如 "Commit Message:" 等
        message = message.replace(/^(提交信息|Commit Message|commit message|message):?\s*/i, '').trim();

        // 确保第一行不超过最大长度
        const lines = message.split('\n');
        const maxLength = DeepSeekConfig.getCommitMaxLength();
        if (lines[0].length > maxLength) {
            // 如果标题太长，尝试在合理位置截断
            const truncated = lines[0].substring(0, maxLength - 3) + '...';
            lines[0] = truncated;
        }

        return lines.join('\n').trim();
    }

    /**
     * 在状态栏显示生成成功提示
     */
    private async showSuccessStatus(): Promise<void> {
        const statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        statusBarItem.text = "$(check) DeepSeek 提交信息已生成";
        statusBarItem.show();
        
        setTimeout(() => {
            statusBarItem.dispose();
        }, 5000);
    }
}
