const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

let win;
let tray;
let isQuitting = false;
let manualUpdateCheck = false;
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
let updateDialogOpen = false;
let downloadedUpdateReady = false;

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

    // Clear cache forcefully to ensure the latest Github pages deployment is loaded, 
    // but only clear HTTP cache so we DO NOT clear localStorage or other persistent data
    win.webContents.session.clearCache({ storages: ['appcache', 'http'] }).then(() => {
        win.loadURL('https://dogeleven.github.io/test/test.html?timestamp=' + new Date().getTime(), {
            extraHeaders: 'pragma: no-cache\n'
        });
    });

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
