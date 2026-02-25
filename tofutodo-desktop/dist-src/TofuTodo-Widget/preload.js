const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  expand: () => ipcRenderer.send('expand-window'),
  collapse: () => ipcRenderer.send('collapse-window')
});

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    html, body {
      background-color: transparent !important;
      overflow: hidden !important;
      margin: 0;
      padding: 0;
      pointer-events: none; /* Let clicks pass through transparent parts of the screen */
    }
    #widget-bubble, #app {
      pointer-events: auto; /* Re-enable clicks on visible parts */
    }
    #app {
      position: absolute;
      left: 24px; 
      top: 30px; /* Margins to prevent shadow clipping at top */
      bottom: 30px; /* Margins to prevent shadow clipping at bottom */
      width: calc(100% - 24px); /* Screen width minus bubble */
      background-color: var(--bg, #f5f5f7);
      border-radius: 26px 0 0 26px;
      box-shadow: -6px 0 20px rgba(0, 0, 0, 0.2);
      overflow-y: auto;
      padding: 20px;
      box-sizing: border-box;
      opacity: 0; /* Hide when collapsed so shadow doesn't bleed */
      transition: opacity 0.2s ease;
    }
    
    #widget-bubble {
      position: fixed;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 24px;
      height: 72px;
      background-color: var(--primary, #4a90e2);
      color: white;
      border-radius: 8px 0 0 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      writing-mode: vertical-rl;
      letter-spacing: 2px;
      font-weight: bold;
      font-size: 11px;
      z-index: 999999;
      box-shadow: -2px 0 5px rgba(0,0,0,0.2);
      transition: background-color 0.2s;
    }
    #widget-bubble:hover {
      background-color: #357abd;
    }
  `;
  document.head.appendChild(style);

  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.style.margin = '0';
    appEl.style.maxWidth = 'none';
  }

  const bubble = document.createElement('div');
  bubble.id = 'widget-bubble';
  bubble.innerText = 'TofuSoup';
  document.documentElement.appendChild(bubble);

  let isExpanded = false;

  bubble.addEventListener('click', () => {
    isExpanded = !isExpanded;
    const appEl = document.getElementById('app');
    if (isExpanded) {
      ipcRenderer.send('expand-window');
      // Wait a tiny bit for the OS window bounds to actually enlarge before showing shadow
      setTimeout(() => {
        if (appEl) appEl.style.opacity = '1';
      }, 50);
    } else {
      if (appEl) appEl.style.opacity = '0';

      // Delay collapsing window by 0.15s to allow shadow to fade out
      // so it doesn't suddenly cut off when the window boundary instantly snaps shut.
      setTimeout(() => {
        ipcRenderer.send('collapse-window');
      }, 150);
    }
  });
});
