const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let win;
let tray;
let isQuitting = false;

function createTrayIcon() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="15" fill="#4a90e2"/>
            <ellipse cx="16" cy="12" rx="10" ry="4" fill="#ffffff"/>
            <path d="M6 12c0 8 3.5 13 10 13s10-5 10-13c-1.8 2.5-5.6 4-10 4S7.8 14.5 6 12Z" fill="#ffffff"/>
            <rect x="10" y="9" width="4" height="4" rx="1" fill="#4a90e2"/>
            <rect x="18" y="8" width="4" height="4" rx="1" fill="#4a90e2"/>
        </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
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

    app.whenReady().then(createWindow);

    app.on('before-quit', () => {
        isQuitting = true;
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
