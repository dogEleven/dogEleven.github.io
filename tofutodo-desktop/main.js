const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let win;

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
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Load the online page directly
    win.loadURL('https://dogeleven.github.io/test/test.html');

    ipcMain.on('expand-window', () => {
        win.setBounds({ x: X_EXPANDED, y: Y_POS, width: V_WIDTH, height: V_HEIGHT });
    });

    ipcMain.on('collapse-window', () => {
        win.setBounds({ x: X_COLLAPSED, y: Y_COLLAPSED, width: BUBBLE_W, height: BUBBLE_H });
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
