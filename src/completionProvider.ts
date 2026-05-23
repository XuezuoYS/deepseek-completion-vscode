import * as vscode from 'vscode';
import { DeepSeekAPI } from './deepseekApi';
import { DeepSeekConfig } from './config';

/**
 * DeepSeek 内联代码补全提供器
 * 在用户编辑代码时提供 AI 驱动的代码建议
 */
export class DeepSeekCompletionProvider implements vscode.InlineCompletionItemProvider {
    private api: DeepSeekAPI;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private requestQueue: Map<string, AbortController> = new Map();
    private apiKeyWarningShown = false;
    // 持久化状态栏：在补全等待期间持续显示旋转图标
    private statusBarItem: vscode.StatusBarItem | null = null;

    constructor() {
        this.api = new DeepSeekAPI();
    }

    /**
     * 提供内联补全项
     */
    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        const isAuto = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;

        // 检查是否启用了补全
        if (!DeepSeekConfig.isCompletionEnabled()) {
            return undefined;
        }

        const apiKey = await DeepSeekConfig.getApiKey();
        if (!apiKey) {
            if (!this.apiKeyWarningShown) {
                this.apiKeyWarningShown = true;
                const setNow = '设置 API 密钥';
                vscode.window.showWarningMessage(
                    '⚠️ DeepSeek API 密钥未配置，代码补全无法使用。',
                    setNow
                ).then(selection => {
                    if (selection === setNow) {
                        vscode.commands.executeCommand('deepseek-completion.setApiKey');
                    }
                });
            }
            return undefined;
        }
        this.apiKeyWarningShown = false;

        // 自动触发时：检查行前缀长度
        if (isAuto) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            if (!linePrefix.trim() || linePrefix.trim().length < 2) {
                return undefined;
            }
        }

        // 文件唯一键（用于去重/防抖）
        const fileKey = `${document.uri.toString()}:${position.line}`;

        // === 取消同一文件+行上正在进行的旧请求和旧定时器 ===
        const existing = this.requestQueue.get(fileKey);
        if (existing) {
            existing.abort();
        }
        const existingTimer = this.debounceTimers.get(fileKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // 显示持续状态栏（旋转图标直到补全返回）
        this.showBusyStatus(position, isAuto);

        const delay = isAuto ? DeepSeekConfig.getCompletionDelay() : 0;

        if (delay > 0) {
            // ---- 自动触发：防抖延迟，但完全不受 VS Code CancellationToken 影响 ----
            return new Promise<vscode.InlineCompletionItem[] | undefined>((resolve) => {
                const ctrl = new AbortController();
                this.requestQueue.set(fileKey, ctrl);

                const timer = setTimeout(async () => {
                    this.debounceTimers.delete(fileKey);
                    console.log('[DeepSeek 自动] 防抖结束 (' + delay + 'ms)，发起 API 请求', fileKey);
                    const result = await this.getCompletion(document, position, ctrl.signal);
                    console.log('[DeepSeek 自动] API 返回', fileKey, 'hasResult:', !!result);
                    this.hideBusyStatus();
                    resolve(result);
                }, delay);

                this.debounceTimers.set(fileKey, timer);

                // ⚠️ 关键：不在 token.onCancellationRequested 中清理定时器或中止请求
                // VS Code 可能在防抖期间取消 token（自动触发的超时约 200-300ms），
                // 但我们的防抖可能比超时短（默认 50ms），定时器会先触发；即便超时先到，
                // 也不应杀死请求——VS Code 收到结果后仍有可能显示虚影
            });
        }

        // ---- 手动触发：无防抖，直接请求（token 可用于取消） ----
        const ctrl = new AbortController();
        this.requestQueue.set(fileKey, ctrl);
        token.onCancellationRequested(() => {
            ctrl.abort();
            this.requestQueue.delete(fileKey);
        });

        console.log('[DeepSeek 手动] 发起 API 请求', fileKey);
        const result = await this.getCompletion(document, position, ctrl.signal);
        console.log('[DeepSeek 手动] API 返回', fileKey, 'hasResult:', !!result);
        this.hideBusyStatus();
        return result;
    }

    /** 显示忙碌状态栏（旋转图标，持续到补全返回） */
    private showBusyStatus(position: vscode.Position, isAuto: boolean): void {
        if (!this.statusBarItem) {
            this.statusBarItem = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                99
            );
        }
        const label = isAuto ? '自动' : '手动';
        this.statusBarItem.text = `$(loading~spin) DeepSeek 补全中（${label}）行 ${position.line + 1}`;
        this.statusBarItem.tooltip = 'DeepSeek 正在请求代码补全...';
        this.statusBarItem.show();
    }

    /** 隐藏忙碌状态栏 */
    private hideBusyStatus(): void {
        if (this.statusBarItem) {
            this.statusBarItem.hide();
        }
    }

    /**
     * 获取 AI 补全建议
     */
    private async getCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        signal: AbortSignal
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const fileKey = `${document.uri.toString()}:${position.line}`;

        try {
            // 获取上下文代码
            const contextCode = this.extractContext(document, position);
            const languageId = document.languageId;
            const filePath = vscode.workspace.asRelativePath(document.uri);

            const systemPrompt = `你是一个智能代码补全助手。你的任务是根据上下文提供精确的代码补全建议。

规则：
1. 只返回需要补全的代码，不要包含任何解释
2. 保持代码风格与上下文一致
3. 补全内容要简洁、准确
4. 不要重复用户已经输入的代码
5. 考虑缩进和语法正确性
6. 关注光标位置的代码逻辑`;

            const prompt = `文件: ${filePath}
语言: ${languageId}

当前光标在位置 ${position.line + 1}:${position.character + 1}

上下文代码（光标位置用 <CURSOR> 标记）:
\`\`\`${languageId}
${contextCode}
\`\`\`

请生成光标位置之后最合适的代码补全。只返回需要补全的代码部分。`;

            const result = await this.api.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                {
                    temperature: 0.2,
                    maxTokens: 256,
                    signal
                }
            );

            if (!result || signal.aborted) {
                return undefined;
            }

            // 清理结果
            const cleaned = this.cleanCompletionResult(result, document, position);

            if (!cleaned) {
                return undefined;
            }

            // 计算范围：VS Code 要求 InlineCompletionItem.range 必须在同一行内
            // 多行 range 会被 VS Code 静默拒绝导致虚影文本无法显示
            // 使用零长度 range（仅标记插入点），VS Code 会自动在光标位置渲染多行虚影
            const range = new vscode.Range(position, position);

            const item = new vscode.InlineCompletionItem(cleaned, range);
            return [item];

        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('abort')) {
                return undefined;
            }
            // 非中止类错误：通知用户，方便排查问题
            const shortMsg = error.message?.length > 120
                ? error.message.substring(0, 120) + '...'
                : error.message || '未知错误';
            vscode.window.showErrorMessage(`🔴 DeepSeek 补全请求失败: ${shortMsg}`);
            return undefined;
        } finally {
            this.requestQueue.delete(fileKey);
        }
    }

    /**
     * 提取光标周围的上下文代码
     */
    private extractContext(document: vscode.TextDocument, position: vscode.Position): string {
        const maxContextLines = 50;
        const maxPrefixLines = 30;
        const maxSuffixLines = 10;

        // 获取光标前的代码（前缀）
        const startLine = Math.max(0, position.line - maxPrefixLines);
        const prefixRange = new vscode.Range(startLine, 0, position.line, position.character);
        const prefix = document.getText(prefixRange);

        // 获取光标后的代码（后缀）
        const endLine = Math.min(document.lineCount - 1, position.line + maxSuffixLines);
        const suffixRange = new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length);
        const suffix = document.getText(suffixRange);

        // 截断过长的行
        const truncateLine = (line: string, maxLen: number = 200): string => {
            if (line.length > maxLen) {
                return line.substring(0, maxLen) + ' // ...';
            }
            return line;
        };

        const truncatedPrefix = prefix.split('\n').map(l => truncateLine(l)).join('\n');
        const truncatedSuffix = suffix.split('\n').map(l => truncateLine(l)).join('\n');

        return `${truncatedPrefix}<CURSOR>${truncatedSuffix}`;
    }

    /**
     * 清理补全结果
     */
    private cleanCompletionResult(
        result: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): string | null {
        let cleaned = result.trim();

        // 移除可能的 markdown 代码块
        cleaned = cleaned.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();

        // 如果结果太长，限制长度
        const maxCompletionLength = 500;
        if (cleaned.length > maxCompletionLength) {
            cleaned = cleaned.substring(0, maxCompletionLength);
        }

        // 如果结果为空或只有空白，返回 null
        if (!cleaned) {
            return null;
        }

        // 检查当前行已有的内容，避免重复
        const currentLineText = document.lineAt(position).text;
        const currentLinePrefix = currentLineText.substring(0, position.character);
        const currentLineSuffix = currentLineText.substring(position.character);

        // 如果补全内容已存在于当前行后缀中
        if (currentLineSuffix && cleaned.startsWith(currentLineSuffix)) {
            return null; // 内容已存在，不需要补全
        }

        return cleaned;
    }

    /**
     * 清理资源
     */
    dispose(): void {
        // 清除所有防抖定时器
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        // 取消所有请求
        for (const controller of this.requestQueue.values()) {
            controller.abort();
        }
        this.requestQueue.clear();
        // 销毁状态栏
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
            this.statusBarItem = null;
        }
    }
}
