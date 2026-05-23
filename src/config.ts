import * as vscode from 'vscode';

const API_KEY_SECRET = 'deepseek-completion-apiKey';

/**
 * DeepSeek 扩展的配置管理
 * API 密钥通过 SecretStorage 安全存储（OS 凭据管理器），
 * 其他配置通过 VS Code 设置存储。
 */
export class DeepSeekConfig {
    private static readonly SECTION = 'deepseek-completion';
    private static secrets: vscode.SecretStorage | null = null;

    /**
     * 初始化（传入 ExtensionContext.secrets）
     */
    static initialize(secrets: vscode.SecretStorage): void {
        this.secrets = secrets;
    }

    /**
     * 获取 DeepSeek API 密钥（从安全存储读取）
     */
    static async getApiKey(): Promise<string> {
        if (!this.secrets) return '';
        return (await this.secrets.get(API_KEY_SECRET)) || '';
    }

    /**
     * 设置 DeepSeek API 密钥（存入安全存储）
     */
    static async setApiKey(key: string): Promise<void> {
        if (!this.secrets) throw new Error('SecretStorage 未初始化');
        await this.secrets.store(API_KEY_SECRET, key);
    }

    /**
     * 清除 DeepSeek API 密钥
     */
    static async clearApiKey(): Promise<void> {
        if (!this.secrets) return;
        await this.secrets.delete(API_KEY_SECRET);
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
        return vscode.workspace.getConfiguration(this.SECTION).get<number>('maxTokens', 4096);
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
    static async validateConfig(): Promise<{ valid: boolean; message?: string }> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            return {
                valid: false,
                message: '请先配置 DeepSeek API 密钥。在命令面板中执行 "DeepSeek: 设置 API 密钥"。'
            };
        }
        return { valid: true };
    }
}
