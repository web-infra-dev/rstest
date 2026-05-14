import type { Readable } from 'node:stream';

const MAX_CAPTURED_STDERR_BYTES = 1024 * 1024; // 1 MB
const STDERR_SETTLE_MAX_WAIT = 200; // ms

/**
 * 1 MB tail buffer for a single worker's stderr. Used by `PoolRunner` to
 * enrich crash errors with the worker's last output before exit. The tail —
 * not the head — is kept because crash output (segfaults, panic messages)
 * lands at the very end of stderr.
 */
export class StderrCapture {
  private buffer = '';
  private bytes = 0;
  private closePromise: Promise<void> | undefined;

  /**
   * Track `close` on the stderr stream so callers can drain pending `data`
   * events after exit but before reading the buffer. Without this wait,
   * the worker's final stderr write — often the most informative one for
   * crash attribution — can race the consumer.
   */
  trackClose(stream: Readable): void {
    this.closePromise = new Promise<void>((resolve) => {
      stream.once('close', resolve);
    });
  }

  append(text: string): void {
    if (!text) return;
    this.buffer += text;
    this.bytes += Buffer.byteLength(text);
    if (this.bytes > MAX_CAPTURED_STDERR_BYTES) {
      const overflow = this.bytes - MAX_CAPTURED_STDERR_BYTES;
      this.buffer = this.buffer.slice(overflow);
      this.bytes = Buffer.byteLength(this.buffer);
    }
  }

  get(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = '';
    this.bytes = 0;
  }

  async waitSettle(): Promise<void> {
    if (!this.closePromise) return;
    await Promise.race([
      this.closePromise,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STDERR_SETTLE_MAX_WAIT);
        timer.unref();
      }),
    ]);
  }
}
