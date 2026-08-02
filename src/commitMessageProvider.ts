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
        console.log('[DeepSeek Commit] 开始生成提交信息');
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

            // 在 SCM 标题栏显示 VS Code 原生加载动画
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.SourceControl,
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
                console.log(`[DeepSeek Commit] 暂存区 diff 长度: ${diff?.length ?? 0}`);

                if (!diff) {
                    diff = await this.getUnstagedChanges(repository);
                    changeType = '未暂存';
                    console.log(`[DeepSeek Commit] 未暂存区 diff 长度: ${diff?.length ?? 0}`);
                }

                if (!diff) {
                    console.log('[DeepSeek Commit] 未检测到任何代码更改');
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
                console.log(`[DeepSeek Commit] prompt 总长度: ${systemPrompt.length + prompt.length}`);

                // 清空 SCM 输入框
                repository.inputBox.value = '';

                // 流式生成提交信息，返回空则自动重试（最多 3 次）
                let rawResult = '';
                const MAX_ATTEMPTS = 3;
                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                    progress.report({ message: `正在生成提交信息（第 ${attempt}/${MAX_ATTEMPTS} 次尝试）...` });
                    console.log(`[DeepSeek Commit] 发起 API 请求，第 ${attempt}/${MAX_ATTEMPTS} 次`);
                    const attemptStart = Date.now();
                    const content = await this.requestCommitMessage(systemPrompt, prompt, (token) => {
                        rawResult += token;
                        // 流式写入：实时更新 SCM 输入框，让用户看到逐字出现的效果
                        repository.inputBox.value = rawResult.trim();
                    });
                    console.log(`[DeepSeek Commit] 第 ${attempt} 次返回，耗时 ${Date.now() - attemptStart}ms，内容长度 ${content?.length ?? 0}`);

                    if (content && content.trim()) {
                        rawResult = content;
                        break;
                    }

                    console.log(`[DeepSeek Commit] 第 ${attempt} 次返回空内容`);
                    if (attempt < MAX_ATTEMPTS) {
                        // 清空输入框，准备下一次尝试
                        rawResult = '';
                        repository.inputBox.value = '';
                        // 明确告知用户正在自动重试，避免误以为生成时间过长
                        vscode.window.showInformationMessage(
                            `DeepSeek 第 ${attempt} 次生成返回空内容，正在自动重试（第 ${attempt + 1}/${MAX_ATTEMPTS} 次）...`
                        );
                    }
                }

                // 多次尝试后仍为空 → 明确提示
                if (!rawResult || !rawResult.trim()) {
                    console.log('[DeepSeek Commit] 多次尝试后仍返回空内容');
                    vscode.window.showErrorMessage(`DeepSeek 连续 ${MAX_ATTEMPTS} 次返回空内容，请稍后重试`);
                    return;
                }

                // 格式修复（去代码块、去前缀、处理 type 重复、截断、emoji 映射）
                const commitMessage = this.formatCommitMessage(rawResult);

                // 返回非空但格式修复后为空 → 单独提示
                if (!commitMessage || !commitMessage.trim()) {
                    console.log('[DeepSeek Commit] 原始内容非空但格式化后为空');
                    vscode.window.showErrorMessage('DeepSeek 返回内容格式异常，无法生成有效提交信息，请重试');
                    return;
                }

                repository.inputBox.value = commitMessage;
                console.log(`[DeepSeek Commit] 已填入提交信息: ${commitMessage}`);
                await this.showSuccessStatus();
            });

        } catch (error: any) {
            console.error('[DeepSeek Commit] 生成失败:', error);
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
    private async getRecentCommits(repository: any, count?: number): Promise<string> {
        count = count ?? DeepSeekConfig.getCommitHistoryMaxCount();
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
        const maxLength = DeepSeekConfig.getCommitMaxLength();

        let langInstruction = '';
        if (language === 'zh-CN') {
            langInstruction = '请使用中文生成提交信息。';
        } else if (language === 'en') {
            langInstruction = 'Please generate commit messages in English.';
        } else {
            langInstruction = '根据代码更改的内容自动选择语言（中文或英文）生成提交信息。';
        }

        const autoAddNote = changeType === '未暂存'
            ? '这些更改尚未暂存（git add），生成后请手动执行 git add 再提交。'
            : '';

        return `你是一个 Git 提交信息生成器。请根据${changeType}的代码更改，直接输出一条规范的 Git 提交信息。

格式：第一行为 <type>: <标题>，标题不超过 ${maxLength} 个字符；如需补充说明，空一行后写详细描述。
type 取值：feat、fix、docs、style、refactor、ui、perf、test、chore、ci 等；若无法确定类型则使用 chore。
${langInstruction}
${autoAddNote}

严格要求：
1. 直接输出提交信息本身，不要输出任何解释、不要用代码块包裹、不要加引号
2. 严禁返回空内容或空白，即使更改难以理解也必须给出一个合理的提交信息
3. 分析代码差异理解意图，并模仿下面最近提交历史的措辞风格和格式`;
    }

    /**
     * 构建用户提示词
     */
    private buildCommitPrompt(diff: string, recentCommits: string, changeType: string = '暂存'): string {
        // 限制 diff 长度，防止超长 prompt 导致模型输出异常（如返回空）
        const MAX_DIFF_LENGTH = 10000;
        let diffSection = diff;
        if (diff.length > MAX_DIFF_LENGTH) {
            diffSection = diff.substring(0, MAX_DIFF_LENGTH) + '\n...（diff 过长已截断，请基于以上内容生成）';
        }

        const recentCommitsSection = recentCommits 
            ? `\n\n以下是最近的提交历史，请分析并模仿其措辞风格和格式生成新的提交信息：\n${recentCommits}`
            : '';

        return `请分析以下${changeType}的代码更改，生成一条规范的 Git 提交信息。\n\n\`\`\`diff\n${diffSection}\n\`\`\`${recentCommitsSection}`;
    }

    /**
     * 请求生成提交信息（流式输出）
     */
    private async requestCommitMessage(
        systemPrompt: string,
        prompt: string,
        onToken: (token: string) => void
    ): Promise<string> {
        return this.api.chat(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            {
                temperature: 0.3,
                maxTokens: 1024,
                stream: true,
                onToken,
                thinking: false,
                signal: this.abortController?.signal
            }
        );
    }

    /**
     * 格式化提交信息：去代码块、去前缀、处理 type 重复、标题截断、emoji 映射
     * 若返回空字符串，说明原始内容非空但无法修复为有效提交信息
     */
    private formatCommitMessage(raw: string): string {
        // 移除可能的 markdown 代码块标记
        let message = raw.replace(/```[\s\S]*?```/g, (match) => {
            return match.replace(/```\w*\n?/g, '').trim();
        });

        // 移除可能的前缀如 "Commit Message:" 等
        message = message.replace(/^(提交信息|Commit Message|commit message|message):?\s*/i, '').trim();

        // 处理 "type: type: xxx" 重复（如 "ci: ci: xxx" → "ci: xxx"）
        message = message.replace(/^([a-zA-Z]+):\s*\1\s*:\s*/i, '$1: ').trim();

        // 确保第一行不超过最大长度
        const lines = message.split('\n');
        const maxLength = DeepSeekConfig.getCommitMaxLength();
        if (lines[0].length > maxLength) {
            lines[0] = lines[0].substring(0, maxLength - 3) + '...';
        }

        let result = lines.join('\n').trim();

        // emoji：由扩展端按 type 映射（模型已带 emoji 则不重复加）
        if (DeepSeekConfig.useCommitEmoji()) {
            const typeMatch = result.match(/^([a-zA-Z]+):/);
            if (typeMatch) {
                const emoji = this.getEmojiForType(typeMatch[1].toLowerCase());
                if (emoji && !result.startsWith(emoji)) {
                    result = `${emoji} ${result}`;
                }
            }
        }

        return result;
    }

    /**
     * 根据提交类型获取 emoji 前缀（由扩展端映射，保证可控）
     */
    private getEmojiForType(type: string): string {
        const emojiMap: Record<string, string> = {
            feat: '✨',
            fix: '🐛',
            docs: '📝',
            style: '💄',
            refactor: '♻️',
            ui: '🎨',
            perf: '⚡',
            test: '✅',
            chore: '🔧',
            ci: '👷'
        };
        return emojiMap[type] || '';
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
