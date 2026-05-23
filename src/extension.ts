import * as vscode from 'vscode';
import { CommitMessageProvider } from './commitMessageProvider';
import { DeepSeekCompletionProvider } from './completionProvider';
import { DeepSeekConfig } from './config';

/**
 * 扩展激活时的入口函数
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('DeepSeek 助手扩展已激活');

    // 初始化安全存储
    DeepSeekConfig.initialize(context.secrets);

    // 注册设置 API 密钥命令
    const setApiKeyCommand = vscode.commands.registerCommand(
        'deepseek-completion.setApiKey',
        async () => {
            const key = await vscode.window.showInputBox({
                prompt: '请输入 DeepSeek API 密钥',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'sk-xxx...',
                validateInput: (value: string) => {
                    if (!value || value.trim().length === 0) {
                        return 'API 密钥不能为空';
                    }
                    return null;
                }
            });
            if (key) {
                await DeepSeekConfig.setApiKey(key.trim());
                await updateApiKeyStatusInSettings();
                vscode.window.showInformationMessage('✅ DeepSeek API 密钥已安全存储');
            }
        }
    );

    // 注册清除 API 密钥命令
    const clearApiKeyCommand = vscode.commands.registerCommand(
        'deepseek-completion.clearApiKey',
        async () => {
            const confirm = await vscode.window.showWarningMessage(
                '确定要清除 DeepSeek API 密钥吗？',
                { modal: true },
                '确定'
            );
            if (confirm === '确定') {
                await DeepSeekConfig.clearApiKey();
                await updateApiKeyStatusInSettings();
                vscode.window.showInformationMessage('DeepSeek API 密钥已清除');
            }
        }
    );

    // 初始化提交信息提供器
    const commitProvider = new CommitMessageProvider();

    // 注册生成提交信息命令
    const generateCommitCommand = vscode.commands.registerCommand(
        'deepseek-completion.generateCommitMessage',
        async () => {
            await commitProvider.generateCommitMessage();
        }
    );

    const generateCommitStagedCommand = vscode.commands.registerCommand(
        'deepseek-completion.generateCommitMessageStaged',
        async () => {
            await commitProvider.generateCommitMessage();
        }
    );

    // 注册代码补全提供器
    const completionProvider = new DeepSeekCompletionProvider();
    const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        completionProvider
    );

    // 监听配置变化
    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('deepseek-completion')) {
            console.log('DeepSeek 配置已更新');
        }
    });

    // 注册状态栏项 - 显示补全状态
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = "$(symbol-key) DeepSeek";
    statusBarItem.tooltip = "DeepSeek 助手已激活";
    statusBarItem.command = {
        command: 'deepseek-completion.openSettings',
        title: '打开 DeepSeek 设置'
    };
    statusBarItem.show();

    // 注册打开设置命令
    const openSettingsCommand = vscode.commands.registerCommand(
        'deepseek-completion.openSettings',
        () => {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'deepseek-completion'
            );
        }
    );

    // 注册解释提交命令（用于右键菜单）
    const explainCommitCommand = vscode.commands.registerCommand(
        'deepseek-completion.explainCommit',
        async () => {
            await explainSelectedCommit();
        }
    );

    // 将所有订阅添加到 context.subscriptions
    context.subscriptions.push(
        generateCommitCommand,
        generateCommitStagedCommand,
        explainCommitCommand,
        setApiKeyCommand,
        clearApiKeyCommand,
        completionRegistration,
        configChangeListener,
        openSettingsCommand,
        statusBarItem,
        completionProvider
    );

    // 检查 API 密钥是否配置并更新设置中的状态显示
    DeepSeekConfig.getApiKey().then(async (key) => {
        await updateApiKeyStatusInSettings();
        if (!key) {
            showSetupGuide();
        }
    });
}

/**
 * 更新设置中的 API 密钥状态显示
 */
async function updateApiKeyStatusInSettings(): Promise<void> {
    const key = await DeepSeekConfig.getApiKey();
    const status = key ? '✅ 已配置' : '❌ 未配置';
    await vscode.workspace.getConfiguration('deepseek-completion').update(
        'apiKeyStatus',
        status,
        vscode.ConfigurationTarget.Global
    );
}

/**
 * 扩展停用时的清理函数
 */
export function deactivate() {
    console.log('DeepSeek 助手扩展已停用');
}

/**
 * 提交项接口
 */
interface CommitQuickPickItem extends vscode.QuickPickItem {
    hash: string;
    authorName: string;
    date: string;
}

/**
 * 解释选中的提交
 */
async function explainSelectedCommit(): Promise<void> {
    try {
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

        // 获取选中的提交
        const commits = await repository.log({ maxEntries: 10 });
        if (commits.length === 0) {
            vscode.window.showInformationMessage('没有可用的提交');
            return;
        }

        // 让用户选择要解释的提交
        const items: CommitQuickPickItem[] = commits.map((commit: any) => ({
            label: commit.message.split('\n')[0].substring(0, 60),
            description: commit.hash.substring(0, 8),
            detail: `作者: ${commit.authorName} | 日期: ${new Date(commit.date).toLocaleString()}`,
            hash: commit.hash,
            authorName: commit.authorName,
            date: commit.date
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要解释的提交'
        });

        if (!selected) return;

        // 获取完整的提交详情
        const diff = await repository.diff('HEAD', selected.hash);
        
        // 在编辑器中显示解释
        const panel = vscode.window.createWebviewPanel(
            'deepseek-completion.commitExplain',
            `提交解释: ${selected.label}`,
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { padding: 16px; font-family: var(--vscode-editor-font-family); }
        .commit-title { font-size: 18px; font-weight: bold; margin-bottom: 8px; }
        .commit-meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
        .section-title { font-size: 14px; font-weight: bold; margin-top: 16px; margin-bottom: 8px; }
        .diff { 
            background: var(--vscode-textCodeBlock-background); 
            padding: 12px; 
            border-radius: 4px;
            overflow-x: auto;
            white-space: pre-wrap;
            font-size: 12px;
        }
        .loading { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
        .explanation { line-height: 1.6; }
    </style>
</head>
<body>
    <div class="commit-title">${escapeHtml(selected.label)}</div>
    <div class="commit-meta">
        ${selected.description} | ${selected.authorName} | ${new Date(selected.date).toLocaleString()}
    </div>
    <div class="section-title">变更文件</div>
    <div class="loading">正在加载变更详情...</div>
    <div class="section-title">代码变更</div>
    <div class="diff">${escapeHtml(diff?.substring(0, 3000) || '无差异信息')}</div>
</body>
</html>`;

        // 使用 DeepSeek 解释提交
        const { DeepSeekAPI } = await import('./deepseekApi');
        const api = new DeepSeekAPI();
        
        try {
            const explanation = await api.chat([
                {
                    role: 'system',
                    content: '你是一个 Git 提交解释器。请用中文详细解释这个提交做了什么更改、为什么要做这些更改、以及可能的影响。保持专业且易于理解。'
                },
                {
                    role: 'user',
                    content: `提交信息: ${selected.label}\n\n变更详情:\n\`\`\`diff\n${diff?.substring(0, 4000) || '无'}\n\`\`\``
                }
            ], { temperature: 0.3, maxTokens: 1000 });

            panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { padding: 16px; font-family: var(--vscode-editor-font-family); }
        .commit-title { font-size: 18px; font-weight: bold; margin-bottom: 8px; }
        .commit-meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
        .section-title { font-size: 14px; font-weight: bold; margin-top: 16px; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
        .explanation { 
            line-height: 1.8; 
            background: var(--vscode-textBlockQuote-background);
            padding: 16px;
            border-radius: 6px;
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        .diff { 
            background: var(--vscode-textCodeBlock-background); 
            padding: 12px; 
            border-radius: 4px;
            overflow-x: auto;
            white-space: pre-wrap;
            font-size: 12px;
            max-height: 400px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div class="commit-title">${escapeHtml(selected.label)}</div>
    <div class="commit-meta">
        ${selected.description} | ${selected.authorName} | ${new Date(selected.date).toLocaleString()}
    </div>
    <div class="section-title">📋 提交解释</div>
    <div class="explanation">${escapeHtml(explanation).replace(/\n/g, '<br>')}</div>
    <div class="section-title">📄 代码变更</div>
    <div class="diff">${escapeHtml(diff?.substring(0, 3000) || '无差异信息')}</div>
</body>
</html>`;
        } catch (error: any) {
            panel.webview.html = `<html><body style="padding:16px;"><p style="color:red;">获取解释失败: ${escapeHtml(error.message)}</p></body></html>`;
        }

    } catch (error: any) {
        vscode.window.showErrorMessage(`解释提交失败: ${error.message}`);
    }
}

/**
 * 显示初始设置指南
 */
function showSetupGuide(): void {
    vscode.window.showInformationMessage(
        'DeepSeek 助手需要配置 API 密钥才能使用。密钥将通过系统凭据管理器安全存储。',
        '设置密钥',
        '获取 API 密钥'
    ).then(async (selection) => {
        if (selection === '设置密钥') {
            vscode.commands.executeCommand('deepseek-completion.setApiKey');
        } else if (selection === '获取 API 密钥') {
            vscode.env.openExternal(
                vscode.Uri.parse('https://platform.deepseek.com/api_keys')
            );
        }
    });
}

/**
 * HTML 转义工具函数
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
