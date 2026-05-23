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
        // 检查是否启用了补全
        if (!DeepSeekConfig.isCompletionEnabled()) {
            return undefined;
        }

        const apiKey = await DeepSeekConfig.getApiKey();
        if (!apiKey) {
            return undefined;
        }

        // 只有在用户主动触发或输入时提供补全
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            // 检查是否是在输入字符时触发
            const lineText = document.lineAt(position).text;
            const linePrefix = lineText.substring(0, position.character);

            // 如果当前行太空或只是空白，不触发补全
            if (!linePrefix.trim() || linePrefix.trim().length < 2) {
                return undefined;
            }
        }

        // 生成文件唯一键用于去重
        const fileKey = `${document.uri.toString()}:${position.line}`;

        // 取消之前的请求
        const existingController = this.requestQueue.get(fileKey);
        if (existingController) {
            existingController.abort();
        }

        // 延迟触发，避免频繁请求
        const delay = DeepSeekConfig.getCompletionDelay();
        if (delay > 0 && context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            return await new Promise((resolve) => {
                const existingTimer = this.debounceTimers.get(fileKey);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                }

                const timer = setTimeout(async () => {
                    this.debounceTimers.delete(fileKey);
                    const result = await this.getCompletion(document, position, token);
                    resolve(result);
                }, delay);

                this.debounceTimers.set(fileKey, timer);

                // 如果 token 被取消，清理定时器
                token.onCancellationRequested(() => {
                    const t = this.debounceTimers.get(fileKey);
                    if (t) {
                        clearTimeout(t);
                        this.debounceTimers.delete(fileKey);
                    }
                    resolve(undefined);
                });
            });
        }

        return this.getCompletion(document, position, token);
    }

    /**
     * 获取 AI 补全建议
     */
    private async getCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const abortController = new AbortController();
        const fileKey = `${document.uri.toString()}:${position.line}`;
        this.requestQueue.set(fileKey, abortController);

        token.onCancellationRequested(() => {
            abortController.abort();
            this.requestQueue.delete(fileKey);
        });

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
                    maxTokens: 128,
                    signal: abortController.signal
                }
            );

            if (!result || token.isCancellationRequested) {
                return undefined;
            }

            // 清理结果
            const cleaned = this.cleanCompletionResult(result, document, position);

            if (!cleaned) {
                return undefined;
            }

            // 计算范围: 从当前行光标位置到建议的最后
            const lines = cleaned.split('\n');
            const range = new vscode.Range(
                position,
                position.translate(lines.length - 1, lines[lines.length - 1].length)
            );

            const item = new vscode.InlineCompletionItem(cleaned, range);
            return [item];

        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('abort')) {
                return undefined;
            }
            // 静默失败，不打扰用户
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
        // 清除所有定时器
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        // 取消所有请求
        for (const controller of this.requestQueue.values()) {
            controller.abort();
        }
        this.requestQueue.clear();
    }
}
