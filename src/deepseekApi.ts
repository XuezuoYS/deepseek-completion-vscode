import * as vscode from 'vscode';
import { DeepSeekConfig } from './config';

/**
 * DeepSeek API 响应接口（Chat）
 */
interface DeepSeekResponse {
    id: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * DeepSeek FIM 补全响应接口
 */
interface FIMResponse {
    id: string;
    choices: Array<{
        text: string;
        index: number;
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * FIM 补全选项
 */
interface FIMOptions {
    prompt: string;
    suffix?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
}

/**
 * DeepSeek API 客户端
 * 处理与 DeepSeek API 的通信
 */
export class DeepSeekAPI {
    private abortController: AbortController | null = null;

    /**
     * 向 DeepSeek API 发送聊天请求
     */
    async chat(
        messages: Array<{ role: string; content: string }>,
        options?: {
            maxTokens?: number;
            temperature?: number;
            stream?: boolean;
            onToken?: (token: string) => void;
            signal?: AbortSignal;
        }
    ): Promise<string> {
        const apiKey = await DeepSeekConfig.getApiKey();
        const endpoint = DeepSeekConfig.getApiEndpoint();
        const model = DeepSeekConfig.getModel();

        if (!apiKey) {
            throw new Error('DeepSeek API 密钥未配置');
        }

        const url = `${endpoint}/chat/completions`;
        const maxTokens = options?.maxTokens ?? DeepSeekConfig.getMaxTokens();
        const temperature = options?.temperature ?? DeepSeekConfig.getTemperature();
        const stream = options?.stream ?? false;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                stream,
                ...(DeepSeekConfig.isThinkingEnabled() 
                    ? { thinking: { type: "enabled" }, reasoning_effort: "high" } 
                    : {})
            }),
            signal: options?.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage: string;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message || errorText;
            } catch {
                errorMessage = errorText;
            }
            throw new Error(`DeepSeek API 错误 (${response.status}): ${errorMessage}`);
        }

        if (stream && options?.onToken) {
            return await this.handleStreamResponse(response, options.onToken, options.signal);
        }

        const data = await response.json() as DeepSeekResponse;
        return data.choices[0]?.message?.content || '';
    }

    /**
     * 向 DeepSeek API 发送 FIM 补全请求
     * 使用 /beta/completions 端点，支持 prompt + suffix 模式
     */
    async fim(
        options: FIMOptions
    ): Promise<string> {
        const apiKey = await DeepSeekConfig.getApiKey();
        const endpoint = DeepSeekConfig.getCompletionEndpoint();
        const model = DeepSeekConfig.getModel();

        if (!apiKey) {
            throw new Error('DeepSeek API 密钥未配置');
        }

        const url = `${endpoint}/completions`;
        const maxTokens = options.maxTokens ?? 256;
        const temperature = options.temperature ?? 0.2;

        const body: Record<string, any> = {
            model,
            prompt: options.prompt,
            max_tokens: maxTokens,
            temperature,
            stop: ["\n\n"]
        };
        if (options.suffix) {
            body.suffix = options.suffix;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal: options.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage: string;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message || errorText;
            } catch {
                errorMessage = errorText;
            }
            throw new Error(`DeepSeek FIM API 错误 (${response.status}): ${errorMessage}`);
        }

        const data = await response.json() as FIMResponse;
        return data.choices[0]?.text || '';
    }

    /**
     * 处理流式响应
     */
    private async handleStreamResponse(
        response: Response,
        onToken: (token: string) => void,
        signal?: AbortSignal
    ): Promise<string> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('无法读取响应流');
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        try {
            while (true) {
                if (signal?.aborted) {
                    break;
                }

                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

                    const dataStr = trimmedLine.slice(6);
                    if (dataStr === '[DONE]') continue;

                    try {
                        const jsonData = JSON.parse(dataStr);
                        const content = jsonData.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullContent += content;
                            onToken(content);
                        }
                    } catch {
                        // 跳过无法解析的行
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return fullContent;
    }

    /**
     * 取消正在进行的请求
     */
    cancelRequest(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}
