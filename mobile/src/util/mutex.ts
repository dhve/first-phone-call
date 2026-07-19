/**
 * Minimal async mutex: serializes inference so exactly one completion is in
 * flight at a time. `locked` lets the request gate reject instead of queueing.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private held = false;

  get locked(): boolean {
    return this.held;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    this.held = true;
    try {
      return await fn();
    } finally {
      this.held = false;
      release();
    }
  }
}
