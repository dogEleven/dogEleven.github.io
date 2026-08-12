const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, dialog, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const tar = require('tar');
const { fileURLToPath } = require('url');
const { execFile, spawn } = require('child_process');

let win;
let tray;
let isQuitting = false;
let manualUpdateCheck = false;
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
let updateDialogOpen = false;
let downloadedUpdateReady = false;
let agentRuntimeInstallPromise = null;

const AGENT_RUNTIME_VERSION = '0.147.0-win32-x64';
const AGENT_RUNTIME_URL = 'https://registry.npmjs.org/@openai/codex/-/codex-0.147.0-win32-x64.tgz';
const AGENT_RUNTIME_INTEGRITY = 'sha512-oT7Ss5fAPf2fiWE9QNURqZcQGAAawSVxmIUdgPzckq4KFZAM+pRz9JbM4Rr498CjtbNgTOjWvDJ+DXvIBSfOPA==';

function getAgentKeyPath() {
    return path.join(app.getPath('userData'), 'openai-api-key.bin');
}

function readAgentKey() {
    try {
        const keyPath = getAgentKeyPath();
        if (!fs.existsSync(keyPath) || !safeStorage.isEncryptionAvailable()) return '';
        return safeStorage.decryptString(fs.readFileSync(keyPath));
    } catch {
        return '';
    }
}

function getAgentRuntimeBase() {
    return path.join(app.getPath('userData'), 'agent-runtime');
}

function getAgentRuntimeRoot() {
    return path.join(getAgentRuntimeBase(), AGENT_RUNTIME_VERSION);
}

function getCodexExecutablePath() {
    return path.join(getAgentRuntimeRoot(), 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
}

function getAgentRuntimeMarkerPath() {
    return path.join(getAgentRuntimeRoot(), 'runtime.json');
}

function isAgentRuntimeInstalled() {
    try {
        const marker = JSON.parse(fs.readFileSync(getAgentRuntimeMarkerPath(), 'utf8'));
        return marker.version === AGENT_RUNTIME_VERSION
            && marker.integrity === AGENT_RUNTIME_INTEGRITY
            && fs.existsSync(getCodexExecutablePath());
    } catch {
        return false;
    }
}

function assertAgentRuntimeChild(targetPath) {
    const base = path.resolve(getAgentRuntimeBase());
    const target = path.resolve(targetPath);
    if (target === base || !target.startsWith(`${base}${path.sep}`)) {
        throw new Error('Agent 运行时路径无效。');
    }
    return target;
}

async function removeAgentRuntimePath(targetPath) {
    await fs.promises.rm(assertAgentRuntimeChild(targetPath), { recursive: true, force: true });
}

function downloadAgentRuntime(archivePath, onProgress, redirectCount = 0) {
    return downloadFileFromUrl(AGENT_RUNTIME_URL, archivePath, onProgress, redirectCount);
}

function downloadFileFromUrl(url, archivePath, onProgress, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers: { 'User-Agent': 'TofuTodo-Widget' } }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                if (redirectCount >= 5) return reject(new Error('Agent 下载重定向次数过多。'));
                downloadFileFromUrl(new URL(response.headers.location, url).toString(), archivePath, onProgress, redirectCount + 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Agent 下载失败（HTTP ${response.statusCode}）。`));
                return;
            }
            const total = Number(response.headers['content-length']) || 0;
            let received = 0;
            const output = fs.createWriteStream(archivePath);
            response.on('data', (chunk) => {
                received += chunk.length;
                onProgress(received, total);
            });
            response.pipe(output);
            output.on('finish', () => output.close(resolve));
            output.on('error', reject);
            response.on('error', reject);
        });
        request.on('error', reject);
    });
}

async function verifyAgentRuntimeArchive(archivePath) {
    const hash = crypto.createHash('sha512');
    await new Promise((resolve, reject) => {
        const input = fs.createReadStream(archivePath);
        input.on('data', (chunk) => hash.update(chunk));
        input.on('end', resolve);
        input.on('error', reject);
    });
    const actual = `sha512-${hash.digest('base64')}`;
    if (actual !== AGENT_RUNTIME_INTEGRITY) throw new Error('Agent 下载校验失败，请重试。');
}

async function installAgentRuntime(sender) {
    const base = getAgentRuntimeBase();
    const finalRoot = getAgentRuntimeRoot();
    const nonce = `${process.pid}-${Date.now()}`;
    const stagingRoot = path.join(base, `.staging-${nonce}`);
    const archivePath = path.join(base, `.download-${nonce}.tgz`);
    await fs.promises.mkdir(base, { recursive: true });
    let lastPercent = -1;

    try {
        sendAgentProgress(sender, { type: 'download', status: '正在下载 Agent 运行环境...', percent: 0 });
        await downloadAgentRuntime(archivePath, (received, total) => {
            const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : null;
            if (percent === lastPercent) return;
            lastPercent = percent;
            const status = percent === null ? '正在下载 Agent 运行环境...' : `正在下载 Agent 运行环境 ${percent}%`;
            sendAgentProgress(sender, { type: 'download', status, percent });
        });
        sendAgentProgress(sender, { type: 'download', status: '正在校验 Agent 运行环境...', percent: 99 });
        await verifyAgentRuntimeArchive(archivePath);
        await fs.promises.mkdir(stagingRoot, { recursive: true });
        await tar.x({ file: archivePath, cwd: stagingRoot, strip: 1 });

        const stagedExecutable = path.join(stagingRoot, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
        if (!fs.existsSync(stagedExecutable)) throw new Error('Agent 运行环境内容不完整。');
        await fs.promises.writeFile(path.join(stagingRoot, 'runtime.json'), JSON.stringify({
            version: AGENT_RUNTIME_VERSION,
            integrity: AGENT_RUNTIME_INTEGRITY,
            installedAt: new Date().toISOString()
        }));
        if (fs.existsSync(finalRoot)) await removeAgentRuntimePath(finalRoot);
        await fs.promises.rename(assertAgentRuntimeChild(stagingRoot), assertAgentRuntimeChild(finalRoot));
        sendAgentProgress(sender, { type: 'download', status: 'Agent 运行环境已就绪', percent: 100 });
        return getCodexExecutablePath();
    } finally {
        if (fs.existsSync(stagingRoot)) await removeAgentRuntimePath(stagingRoot);
        if (fs.existsSync(archivePath)) await removeAgentRuntimePath(archivePath);
    }
}

async function ensureAgentRuntime(sender) {
    if (isAgentRuntimeInstalled()) return getCodexExecutablePath();
    if (!agentRuntimeInstallPromise) {
        agentRuntimeInstallPromise = installAgentRuntime(sender).finally(() => {
            agentRuntimeInstallPromise = null;
        });
    } else {
        sendAgentProgress(sender, { type: 'download', status: 'Agent 运行环境正在下载...' });
    }
    return agentRuntimeInstallPromise;
}

function runCodexCommand(args, timeout = 15000) {
    return new Promise((resolve, reject) => {
        execFile(getCodexExecutablePath(), args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
            if (error) {
                error.details = `${stdout || ''}\n${stderr || ''}`.trim();
                reject(error);
                return;
            }
            resolve(`${stdout || ''}\n${stderr || ''}`.trim());
        });
    });
}

async function getCodexLoginStatus() {
    try {
        const output = await runCodexCommand(['login', 'status']);
        return { loggedIn: /logged in/i.test(output), detail: output };
    } catch (error) {
        return { loggedIn: false, detail: error.details || '' };
    }
}

function startCodexChatGptLogin() {
    return new Promise((resolve, reject) => {
        const child = spawn(getCodexExecutablePath(), ['login'], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('登录等待超时，请重新尝试。'));
        }, 5 * 60 * 1000);

        child.stdout.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { output += chunk.toString(); });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', async (code) => {
            clearTimeout(timer);
            const status = await getCodexLoginStatus();
            if (code === 0 && status.loggedIn) resolve(status);
            else reject(new Error(output.trim() || 'ChatGPT 登录未完成。'));
        });
    });
}

function isTrustedAgentSender(event) {
    const senderUrl = event.senderFrame?.url || '';
    if (/^https:\/\/dogeleven\.github\.io\/test\/test\.html(?:[?#]|$)/.test(senderUrl)) return true;
    if (!senderUrl.startsWith('file:')) return false;

    try {
        const senderPath = path.normalize(fileURLToPath(senderUrl));
        const localPagePath = path.normalize(path.join(__dirname, '..', 'test', 'test.html'));
        return senderPath.toLowerCase() === localPagePath.toLowerCase();
    } catch {
        return false;
    }
}

function assertTrustedAgentSender(event) {
    if (!isTrustedAgentSender(event)) throw new Error('不允许当前页面调用 Agent。');
}

function sendAgentProgress(sender, payload) {
    if (!sender.isDestroyed()) sender.send('agent-progress', payload);
}

function describeAgentItem(item) {
    if (!item) return '';
    if (item.type === 'web_search') return `正在搜索：${item.query}`;
    if (item.type === 'command_execution') return '正在检查本地信息';
    if (item.type === 'mcp_tool_call') return `正在调用工具：${item.tool}`;
    if (item.type === 'todo_list') return '正在整理任务步骤';
    if (item.type === 'file_change') return '正在检查文件变化';
    if (item.type === 'agent_message') return '正在组织回答';
    if (item.type === 'error') return item.message || 'Agent 遇到问题';
    return 'Agent 正在工作';
}

function buildAgentPrompt(request) {
    const userPrompt = String(request?.prompt || '').trim().slice(0, 12000);
    if (!userPrompt) throw new Error('请输入要问 Agent 的内容。');

    return [
        '你是 TofuTodo 的只读研究助手。请使用中文简洁回答。',
        '你可以在确有需要时使用实时网页搜索来核实信息。',
        '不要修改文件，不要执行破坏性操作，也不要声称已经修改 GitHub 数据。',
        `用户的问题：${userPrompt}`
    ].join('\n\n');
}

function registerAgentIpc() {
    ipcMain.handle('agent-config:get', async (event) => {
        assertTrustedAgentSender(event);
        const agentInstalled = isAgentRuntimeInstalled();
        const loginStatus = agentInstalled ? await getCodexLoginStatus() : { loggedIn: false };
        const hasApiKey = Boolean(readAgentKey());
        return {
            desktop: true,
            agentInstalled,
            agentVersion: agentInstalled ? AGENT_RUNTIME_VERSION : null,
            encryptionAvailable: safeStorage.isEncryptionAvailable(),
            hasApiKey,
            hasChatGPTLogin: loginStatus.loggedIn,
            authMode: loginStatus.loggedIn ? 'chatgpt' : (hasApiKey ? 'api-key' : null)
        };
    });

    ipcMain.handle('agent-auth:login-chatgpt', async (event) => {
        assertTrustedAgentSender(event);
        await ensureAgentRuntime(event.sender);
        await startCodexChatGptLogin();
        return { hasChatGPTLogin: true, authMode: 'chatgpt', agentInstalled: true };
    });

    ipcMain.handle('agent-auth:logout-chatgpt', async (event) => {
        assertTrustedAgentSender(event);
        if (!isAgentRuntimeInstalled()) return { hasChatGPTLogin: false };
        try {
            await runCodexCommand(['logout']);
        } catch (error) {
            if (!/not logged in/i.test(error.details || '')) throw error;
        }
        return { hasChatGPTLogin: false };
    });

    ipcMain.handle('agent-config:save-key', (event, rawKey) => {
        assertTrustedAgentSender(event);
        const apiKey = String(rawKey || '').trim();
        if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey)) throw new Error('OpenAI API Key 格式不正确。');
        if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法加密保存 API Key。');
        fs.writeFileSync(getAgentKeyPath(), safeStorage.encryptString(apiKey));
        return { hasApiKey: true };
    });

    ipcMain.handle('agent-config:delete-key', (event) => {
        assertTrustedAgentSender(event);
        const keyPath = getAgentKeyPath();
        if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
        return { hasApiKey: false };
    });

    ipcMain.handle('agent:run', async (event, request) => {
        assertTrustedAgentSender(event);
        const apiKey = readAgentKey();
        await ensureAgentRuntime(event.sender);
        const loginStatus = await getCodexLoginStatus();
        if (!loginStatus.loggedIn && !apiKey) throw new Error('请先在设置中使用 ChatGPT 登录，或保存 OpenAI API Key。');

        const { Codex } = await import('@openai/codex-sdk');
        const codexOptions = { codexPathOverride: getCodexExecutablePath() };
        if (!loginStatus.loggedIn) codexOptions.apiKey = apiKey;
        const codex = new Codex(codexOptions);
        const threadOptions = {
            workingDirectory: app.getPath('userData'),
            skipGitRepoCheck: true,
            sandboxMode: 'read-only',
            approvalPolicy: 'never',
            networkAccessEnabled: true,
            webSearchMode: 'live'
        };
        const requestedThreadId = String(request?.threadId || '').trim();
        const thread = requestedThreadId
            ? codex.resumeThread(requestedThreadId, threadOptions)
            : codex.startThread(threadOptions);
        const { events } = await thread.runStreamed(buildAgentPrompt(request));
        let finalResponse = '';
        let threadId = requestedThreadId;
        let usage = null;

        try {
            for await (const agentEvent of events) {
                if (agentEvent.type === 'thread.started') {
                    threadId = agentEvent.thread_id;
                    sendAgentProgress(event.sender, { type: 'thread', threadId });
                } else if (agentEvent.type === 'item.started' || agentEvent.type === 'item.updated' || agentEvent.type === 'item.completed') {
                    if (agentEvent.item.type === 'agent_message' && agentEvent.item.text) {
                        finalResponse = agentEvent.item.text;
                    }
                    const status = describeAgentItem(agentEvent.item);
                    if (status) sendAgentProgress(event.sender, { type: 'status', status });
                } else if (agentEvent.type === 'turn.completed') {
                    usage = agentEvent.usage;
                } else if (agentEvent.type === 'turn.failed' || agentEvent.type === 'error') {
                    throw new Error(agentEvent.error?.message || agentEvent.message || 'Agent 运行失败。');
                }
            }
        } catch (error) {
            const message = /401|api key|unauthorized/i.test(error.message)
                ? 'OpenAI 登录已失效，或 API Key 无效、过期、没有可用额度。'
                : error.message;
            throw new Error(message);
        }

        if (!finalResponse) throw new Error('Agent 没有返回结果，请稍后重试。');
        return { threadId: threadId || thread.id, content: finalResponse, usage };
    });
}

function createTrayIcon() {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'));
    if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });

    const fallback = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    return nativeImage.createFromDataURL(`data:image/png;base64,${fallback}`).resize({ width: 16, height: 16 });
}

function showWidget() {
    if (!win || win.isDestroyed()) return;
    win.show();
    win.setAlwaysOnTop(true);
}

function hideWidget() {
    if (!win || win.isDestroyed()) return;
    win.hide();
}

function getUpdatePreferencesPath() {
    return path.join(app.getPath('userData'), 'update-preferences.json');
}

function readUpdatePreferences() {
    try {
        return JSON.parse(fs.readFileSync(getUpdatePreferencesPath(), 'utf8'));
    } catch {
        return {};
    }
}

function writeUpdatePreferences(preferences) {
    fs.writeFileSync(getUpdatePreferencesPath(), JSON.stringify(preferences, null, 2), 'utf8');
}

function showUpdateDialog(options) {
    if (win && !win.isDestroyed() && win.isVisible()) {
        return dialog.showMessageBox(win, options);
    }
    return dialog.showMessageBox(options);
}

function installDownloadedUpdate() {
    if (!downloadedUpdateReady) return;
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
}

async function checkForUpdates(manual = false) {
    if (!app.isPackaged) {
        if (manual) {
            await showUpdateDialog({
                type: 'info',
                title: '检查更新',
                message: '开发环境不执行自动更新检查。',
                buttons: ['确定']
            });
        }
        return;
    }

    manualUpdateCheck = manualUpdateCheck || manual;
    if (updateCheckInProgress || updateDownloadInProgress) return;

    updateCheckInProgress = true;
    updateTrayMenu();
    try {
        await autoUpdater.checkForUpdates();
    } catch {
        updateCheckInProgress = false;
        updateTrayMenu();
    }
}

function configureAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('update-available', async (info) => {
        const wasManual = manualUpdateCheck;
        manualUpdateCheck = false;
        updateCheckInProgress = false;
        updateTrayMenu();

        if (!wasManual && readUpdatePreferences().skipVersion === info.version) return;
        if (updateDialogOpen) return;

        const releaseNotes = Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((item) => item.note).filter(Boolean).join('\n')
            : info.releaseNotes;

        updateDialogOpen = true;
        try {
            const { response } = await showUpdateDialog({
                type: 'info',
                title: 'TofuTodo 更新',
                message: `发现新版本 ${info.version}`,
                detail: releaseNotes || '新版本已经可以下载。',
                buttons: ['立即更新', '本版本不再提示', '稍后'],
                defaultId: 0,
                cancelId: 2,
                noLink: true
            });

            if (response === 0) {
                writeUpdatePreferences({ skipVersion: null });
                updateDownloadInProgress = true;
                updateTrayMenu();
                tray?.displayBalloon({
                    title: 'TofuTodo 更新',
                    content: `正在下载 ${info.version}，完成后会提示安装。`
                });
                autoUpdater.downloadUpdate().catch(() => {});
            } else if (response === 1) {
                writeUpdatePreferences({ skipVersion: info.version });
            }
        } finally {
            updateDialogOpen = false;
        }
    });

    autoUpdater.on('update-not-available', async () => {
        const wasManual = manualUpdateCheck;
        manualUpdateCheck = false;
        updateCheckInProgress = false;
        updateTrayMenu();
        if (wasManual) {
            await showUpdateDialog({
                type: 'info',
                title: '检查更新',
                message: `当前已是最新版本 ${app.getVersion()}`,
                buttons: ['确定']
            });
        }
    });

    autoUpdater.on('download-progress', (progress) => {
        updateDownloadInProgress = true;
        tray?.setToolTip(`TofuTodo 更新下载中 ${Math.round(progress.percent)}%`);
        updateTrayMenu();
    });

    autoUpdater.on('update-downloaded', async (info) => {
        updateDownloadInProgress = false;
        downloadedUpdateReady = true;
        tray?.setToolTip('TofuTodo 更新已下载');
        updateTrayMenu();

        const { response } = await showUpdateDialog({
            type: 'info',
            title: '更新已下载',
            message: `TofuTodo ${info.version} 已准备好安装`,
            detail: '安装时挂件会自动退出，完成后重新启动。',
            buttons: ['立即安装', '稍后'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
        });
        if (response === 0) installDownloadedUpdate();
    });

    autoUpdater.on('error', async (error) => {
        const shouldNotify = manualUpdateCheck || updateDownloadInProgress;
        manualUpdateCheck = false;
        updateCheckInProgress = false;
        updateDownloadInProgress = false;
        tray?.setToolTip('TofuTodo 挂件');
        updateTrayMenu();
        if (shouldNotify) {
            await showUpdateDialog({
                type: 'error',
                title: '更新失败',
                message: '暂时无法完成更新，请稍后重试。',
                detail: error.message,
                buttons: ['确定']
            });
        }
    });
}

function updateTrayMenu() {
    if (!tray) return;
    const isVisible = Boolean(win && !win.isDestroyed() && win.isVisible());
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: isVisible ? '隐藏挂件' : '显示挂件',
            click: () => isVisible ? hideWidget() : showWidget()
        },
        { type: 'separator' },
        {
            label: downloadedUpdateReady
                ? '安装已下载更新'
                : updateDownloadInProgress
                    ? '正在下载更新...'
                    : updateCheckInProgress
                        ? '正在检查更新...'
                        : '检查更新',
            enabled: downloadedUpdateReady || (!updateDownloadInProgress && !updateCheckInProgress),
            click: () => downloadedUpdateReady ? installDownloadedUpdate() : checkForUpdates(true)
        },
        { type: 'separator' },
        {
            label: '退出挂件',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]));
}

function createTray() {
    if (tray) return;
    tray = new Tray(createTrayIcon());
    tray.setToolTip('TofuTodo 挂件');
    tray.on('click', () => {
        if (win && win.isVisible()) hideWidget();
        else showWidget();
    });
    updateTrayMenu();
}

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const BUBBLE_W = 24;
    const BUBBLE_H = 72;
    // Reverted expanded width to 1/4 of screen
    const V_WIDTH = Math.round(width * 0.25) + BUBBLE_W;
    const V_HEIGHT = Math.round(height * 0.8) + 60;
    const Y_POS = Math.round(height * 0.1) - 30;

    const X_COLLAPSED = Math.round(width - BUBBLE_W);
    const Y_COLLAPSED = Math.round(Y_POS + V_HEIGHT / 2 - BUBBLE_H / 2);

    const X_EXPANDED = Math.round(width - V_WIDTH);

    win = new BrowserWindow({
        width: BUBBLE_W,
        height: BUBBLE_H,
        x: X_COLLAPSED,
        y: Y_COLLAPSED,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
            partition: 'persist:tofutodo',
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.on('show', updateTrayMenu);
    win.on('hide', updateTrayMenu);
    win.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            hideWidget();
        }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const target = new URL(url);
            if (target.protocol === 'https:' && target.hostname === 'dogeleven.github.io' && target.pathname === '/test/github-setup.html') {
                shell.openExternal(target.toString());
            }
        } catch {
            // Ignore malformed URLs from page content.
        }
        return { action: 'deny' };
    });

    if (app.isPackaged) {
        // Clear only HTTP cache so localStorage and other persistent data stay intact.
        win.webContents.session.clearCache({ storages: ['appcache', 'http'] }).then(() => {
            win.loadURL('https://dogeleven.github.io/test/test.html?timestamp=' + new Date().getTime(), {
                extraHeaders: 'pragma: no-cache\n'
            });
        });
    } else {
        win.loadFile(path.join(__dirname, '..', 'test', 'test.html'), {
            query: { preview: 'agent' }
        });
    }

    // Make sure localStorage modifications are persisted to disk periodically to avoid dataloss
    setInterval(() => {
        if (win && !win.isDestroyed()) {
            win.webContents.session.flushStorageData();
        }
    }, 15000);

    ipcMain.on('expand-window', () => {
        win.setBounds({ x: X_EXPANDED, y: Y_POS, width: V_WIDTH, height: V_HEIGHT });
    });

    ipcMain.on('collapse-window', () => {
        win.setBounds({ x: X_COLLAPSED, y: Y_COLLAPSED, width: BUBBLE_W, height: BUBBLE_H });
    });

    ipcMain.on('exit-app', () => {
        isQuitting = true;
        app.quit();
    });

    createTray();
}

if (!app.isPackaged) {
    app.setPath('userData', path.join(app.getPath('userData'), 'development'));
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (win) {
            if (win.isMinimized()) win.restore();
            showWidget();
            win.focus();
        }
    });

    app.whenReady().then(() => {
        registerAgentIpc();
        configureAutoUpdater();
        createWindow();
        setTimeout(() => checkForUpdates(false), 6000);
    });

    app.on('before-quit', () => {
        isQuitting = true;
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
