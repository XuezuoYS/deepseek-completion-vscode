import * as vscode from 'vscode';
import { DeepSeekConfig } from './config';

/**
 * DeepSeek API 响应接口
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
        const apiKey = DeepSeekConfig.getApiKey();
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
                stream
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
