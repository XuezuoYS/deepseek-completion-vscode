import * as vscode from 'vscode';

/**
 * DeepSeek 扩展的配置管理
 */
export class DeepSeekConfig {
    private static readonly SECTION = 'deepseek';

    /**
     * 获取 DeepSeek API 密钥
     */
    static getApiKey(): string {
        return vscode.workspace.getConfiguration(this.SECTION).get<string>('apiKey', '');
    }

    /**
     * 获取 API 端点
     */
    static getApiEndpoint(): string {
        return vscode.workspace.getConfiguration(this.SECTION).get<string>('apiEndpoint', 'https://api.deepseek.com');
    }

    /**
     * 获取模型名称
     */
    static getModel(): string {
        return vscode.workspace.getConfiguration(this.SECTION).get<string>('model', 'deepseek-v4-flash');
    }

    /**
     * 获取最大 Token 数
     */
    static getMaxTokens(): number {
        return vscode.workspace.getConfiguration(this.SECTION).get<number>('maxTokens', 2048);
    }

    /**
     * 获取温度参数
     */
    static getTemperature(): number {
        return vscode.workspace.getConfiguration(this.SECTION).get<number>('temperature', 0.8);
    }

    /**
     * 是否启用代码补全
     */
    static isCompletionEnabled(): boolean {
        return vscode.workspace.getConfiguration(this.SECTION).get<boolean>('enableCompletion', true);
    }

    /**
     * 是否开启思考模式 (reasoning)
     */
    static isThinkingEnabled(): boolean {
        return vscode.workspace.getConfiguration(this.SECTION).get<boolean>('enableThinking', false);
    }

    /**
     * 获取补全触发延迟 (ms)
     */
    static getCompletionDelay(): number {
        return vscode.workspace.getConfiguration(this.SECTION).get<number>('completionDelay', 500);
    }

    /**
     * 获取提交信息语言
     */
    static getCommitLanguage(): string {
        return vscode.workspace.getConfiguration(this.SECTION).get<string>('commitLanguage', 'auto');
    }

    /**
     * 是否在提交信息中使用 emoji
     */
    static useCommitEmoji(): boolean {
        return vscode.workspace.getConfiguration(this.SECTION).get<boolean>('commitEmoji', false);
    }

    /**
     * 获取提交信息最大长度
     */
    static getCommitMaxLength(): number {
        return vscode.workspace.getConfiguration(this.SECTION).get<number>('commitMaxLength', 72);
    }

    /**
     * 验证 API 密钥是否已配置
     */
    static validateConfig(): { valid: boolean; message?: string } {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            return {
                valid: false,
                message: '请先配置 DeepSeek API 密钥。在设置中搜索 "deepseek.apiKey" 进行配置。'
            };
        }
        return { valid: true };
    }
}
