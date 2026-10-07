class LoginObserver {
  constructor({ probe, complete, expired, interval = 1500, timeout = 600000 }) {
    Object.assign(this, { probe, complete, expired, interval, timeout });
    this.stopped = true;
  }

  start() {
    this.stop();
    this.stopped = false;
    this.deadline = Date.now() + this.timeout;
    this.timer = setTimeout(() => this.tick(), this.interval);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  async tick() {
    if (this.stopped) return;
    try {
      if (await this.probe()) {
        if (this.stopped) return;
        this.stop();
        await this.complete();
        return;
      }
    } catch (_) {
      // Redirects can destroy execution contexts while a probe is in flight.
    }
    if (this.stopped) return;
    if (Date.now() >= this.deadline) {
      this.stop();
      this.expired?.();
      return;
    }
    this.timer = setTimeout(() => this.tick(), this.interval);
    this.timer.unref?.();
  }
}

module.exports = LoginObserver;
