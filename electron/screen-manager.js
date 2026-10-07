const { screen, BrowserWindow } = require('electron');

class ScreenManager {
  #win = null;
  #targetDisplayId = null;
  #repositionTimer = null;
  #moveDebounce = null;
  #customBounds = null;
  #fullscreenLock = false;
  #displayListenersSetup = false;
  #repaintDebounce = null;

  attachWindow(win, displayId, fullscreenLock = false) {
    this.#win = win;
    this.#targetDisplayId = displayId;
    this.#fullscreenLock = fullscreenLock;
    this.#customBounds = null;
    this.#lockWindowPosition();
    this.#setupDisplayListeners();
  }

  detachWindow() {
    this.#win = null;
    this.#targetDisplayId = null;
    this.#customBounds = null;
    this.#fullscreenLock = false;
    if (this.#repositionTimer) {
      clearInterval(this.#repositionTimer);
      this.#repositionTimer = null;
    }
    if (this.#repaintDebounce) {
      clearTimeout(this.#repaintDebounce);
      this.#repaintDebounce = null;
    }
  }

  updateCustomBounds(bounds) {
    this.#customBounds = bounds;
    if (this.#win && !this.#win.isDestroyed()) {
      this.#win.setBounds(bounds);
    }
  }

  findDisplayById(id) {
    if (!id) return null;
    return screen.getAllDisplays().find(d => d.id === id) || null;
  }

  getLandscapeBounds(display) {
    const { width, height } = display.bounds;
    if (width >= height) {
      return {
        x: display.bounds.x,
        y: display.bounds.y,
        width,
        height,
        needsRotation: false,
      };
    }
    return {
      x: display.bounds.x,
      y: display.bounds.y,
      width: height,
      height: width,
      needsRotation: true,
    };
  }

  #getTargetBounds() {
    const target = this.#getTargetDisplay();
    if (!target) return null;

    if (this.#fullscreenLock) {
      return {
        x: target.bounds.x,
        y: target.bounds.y,
        width: target.bounds.width,
        height: target.bounds.height,
      };
    }

    if (this.#customBounds) {
      return this.#customBounds;
    }

    const landscape = this.getLandscapeBounds(target);
    return {
      x: landscape.x,
      y: landscape.y,
      width: landscape.width,
      height: landscape.height,
    };
  }

  #lockWindowPosition() {
    if (this.#repositionTimer) clearInterval(this.#repositionTimer);

    if (!this.#fullscreenLock) return;

    if (this.#win && !this.#win.isDestroyed()) {
      const expected = this.#getTargetBounds();
      if (expected) this.#win.setBounds(expected);
      this.#win.setAlwaysOnTop(true, 'screen-saver');
    }

    this.#repositionTimer = setInterval(() => {
      if (!this.#win || this.#win.isDestroyed()) return;

      const expected = this.#getTargetBounds();
      if (expected) {
        const current = this.#win.getBounds();
        if (
          current.x !== expected.x ||
          current.y !== expected.y ||
          current.width !== expected.width ||
          current.height !== expected.height
        ) {
          this.#win.setBounds(expected);
        }
      }

      if (!this.#win.isAlwaysOnTop()) {
        this.#win.setAlwaysOnTop(true, 'screen-saver');
      }
    }, 2000);
  }

  #setupDisplayListeners() {
    if (this.#displayListenersSetup) return;
    this.#displayListenersSetup = true;

    screen.on('display-metrics-changed', (_event, display, _changedMetrics) => {
      if (!this.#win || this.#win.isDestroyed()) return;
      if (display.id === this.#targetDisplayId && this.#fullscreenLock) {
        this.#reanchorWindow();
      }
      this.#forceRepaint();
    });

    screen.on('display-added', (_event, newDisplay) => {
      if (!this.#getTargetDisplay()) {
        this.#targetDisplayId = newDisplay.id;
        this.#reanchorWindow();
      }
    });

    screen.on('display-removed', (_event, oldDisplay) => {
      if (oldDisplay.id === this.#targetDisplayId) {
        this.#targetDisplayId = null;
        const fallback = screen.getAllDisplays().find(d => d.id !== screen.getPrimaryDisplay().id);
        if (fallback) {
          this.#targetDisplayId = fallback.id;
          this.#reanchorWindow();
        }
      }
    });
  }

  #getTargetDisplay() {
    if (!this.#targetDisplayId) return null;
    return screen.getAllDisplays().find(d => d.id === this.#targetDisplayId) || null;
  }

  #reanchorWindow() {
    if (!this.#win || this.#win.isDestroyed()) return;

    const bounds = this.#getTargetBounds();
    if (!bounds) return;

    this.#win.setBounds(bounds);
    this.#win.setAlwaysOnTop(true, 'screen-saver');

    const target = this.#getTargetDisplay();
    if (target) {
      const landscape = this.getLandscapeBounds(target);
      this.#win.webContents.send('display-config', {
        needsRotation: landscape.needsRotation,
        width: bounds.width,
        height: bounds.height,
      });
    }

    this.#forceRepaint();
  }

  #forceRepaint() {
    if (!this.#win || this.#win.isDestroyed()) return;
    if (this.#repaintDebounce) clearTimeout(this.#repaintDebounce);
    this.#repaintDebounce = setTimeout(() => {
      if (!this.#win || this.#win.isDestroyed()) return;
      this.#win.webContents.reload();
    }, 300);
  }

  destroy() {
    if (this.#repositionTimer) {
      clearInterval(this.#repositionTimer);
      this.#repositionTimer = null;
    }
    this.#win = null;
  }
}

module.exports = ScreenManager;
