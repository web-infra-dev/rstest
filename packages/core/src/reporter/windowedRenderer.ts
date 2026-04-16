/**
 * MIT License
 *
 * Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */
import type { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';

const DEFAULT_RENDER_INTERVAL_MS = 1_000;

const ESC = '\x1B[';
const CLEAR_LINE = `${ESC}2K`;
const CARRIAGE_RETURN = '\r';
const MOVE_CURSOR_ONE_ROW_UP = `${ESC}1A`;

export interface Options {
  logger: {
    outputStream: Writable;
    errorStream: Writable;
    getColumns: () => number;
  };
  interval?: number;
  getWindow: () => string[];
}

type StreamType = 'output' | 'error';

/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/accd2edaeff7aca01392452ff9d2753d4e448ac5/packages/vitest/src/node/reporters/renderers/windowedRenderer.ts
 *
 * Renders content of `getWindow` at the bottom of the terminal and
 * forwards all other intercepted `stdout` and `stderr` logs above it.
 */
export class WindowRenderer {
  private readonly options: Required<Options>;
  private readonly streams!: Record<StreamType, Writable['write']>;
  private readonly buffer: { type: StreamType; message: string }[] = [];
  private renderInterval: NodeJS.Timeout | undefined = undefined;
  private renderScheduled = false;

  private windowHeight = 0;
  private finished = false;
  private hiddenForOutputCount = 0;
  private readonly cleanups: (() => void)[] = [];
  private readonly exitHandler = () => {
    this.finish();
  };

  constructor(options: Options) {
    this.options = {
      interval: DEFAULT_RENDER_INTERVAL_MS,
      ...options,
    };

    this.streams = {
      output: options.logger.outputStream.write.bind(
        options.logger.outputStream,
      ),
      error: options.logger.errorStream.write.bind(options.logger.errorStream),
    };

    this.cleanups.push(
      this.interceptStream(process.stdout, 'output'),
      this.interceptStream(process.stderr, 'error'),
    );

    this.start();

    process.once('exit', this.exitHandler);
  }

  start(): void {
    this.finished = false;
    this.renderInterval = setInterval(
      () => this.schedule(),
      this.options.interval,
    ).unref();
  }

  stop(): void {
    this.cleanups.splice(0).map((fn) => fn());
    clearInterval(this.renderInterval);
  }

  /**
   * Write all buffered output and stop buffering.
   * All intercepted writes are forwarded to actual write after this.
   */
  finish(): void {
    if (this.finished) {
      return;
    }

    this.flushBuffer();
    this.finished = true;
    this.clearWindow();
    this.stop();
    process.removeListener('exit', this.exitHandler);
  }

  /**
   * Queue new render update
   */
  schedule(): void {
    if (this.hiddenForOutputCount > 0) {
      return;
    }

    if (!this.renderScheduled) {
      this.renderScheduled = true;
      this.flushBuffer();

      setTimeout(() => {
        this.renderScheduled = false;
      }, 100).unref();
    }
  }

  private flushBuffer() {
    const messages = this.drainBuffer();

    if (messages.length === 0) {
      return this.render();
    }

    for (const message of messages) {
      this.render(message.message, message.type);
    }
  }

  private render(message?: string, type: StreamType = 'output') {
    if (this.hiddenForOutputCount > 0) {
      if (message) {
        this.write(message, type);
      }
      return;
    }

    if (this.finished) {
      this.clearWindow();
      return this.write(message || '', type);
    }

    const windowContent = this.options.getWindow();
    const rowCount = getRenderedRowCount(
      windowContent,
      this.options.logger.getColumns(),
    );
    let padding = this.windowHeight - rowCount;

    if (padding > 0 && message) {
      padding -= getRenderedRowCount(
        [message],
        this.options.logger.getColumns(),
      );
    }

    this.clearWindow();

    if (message) {
      this.write(message, type);
    }

    if (padding > 0) {
      this.write('\n'.repeat(padding));
    }

    this.write(windowContent.join('\n'));

    this.windowHeight = rowCount + Math.max(0, padding);
  }

  private clearWindow() {
    if (this.windowHeight === 0) {
      return;
    }

    this.write(`${CARRIAGE_RETURN}${CLEAR_LINE}`);

    for (let i = 1; i < this.windowHeight; i++) {
      this.write(`${MOVE_CURSOR_ONE_ROW_UP}${CARRIAGE_RETURN}${CLEAR_LINE}`);
    }

    this.windowHeight = 0;
  }

  private interceptStream(stream: NodeJS.WriteStream, type: StreamType) {
    const original = stream.write.bind(stream);

    // @ts-expect-error -- not sure how 2 overloads should be typed
    stream.write = (chunk, _, callback) => {
      if (chunk) {
        if (this.finished || this.hiddenForOutputCount > 0) {
          this.write(chunk.toString(), type);
        } else {
          this.buffer.push({ type, message: chunk.toString() });
        }
      }
      callback?.();
    };

    return function restore() {
      stream.write = original;
    };
  }

  private write(message: string, type: 'output' | 'error' = 'output') {
    this.streams[type](message);
  }

  private drainBuffer(): { type: StreamType; message: string }[] {
    const messages: { type: StreamType; message: string }[] = [];
    let current: { type: StreamType; message: string } | undefined;

    for (const next of this.buffer.splice(0)) {
      if (!current) {
        current = { ...next };
        continue;
      }

      if (current.type !== next.type) {
        messages.push(current);
        current = { ...next };
        continue;
      }

      current.message += next.message;
    }

    if (current) {
      messages.push(current);
    }

    return messages;
  }

  withWindowHidden<T>(action: () => T): T {
    this.flushBuffer();
    this.clearWindow();
    this.hiddenForOutputCount += 1;

    try {
      return action();
    } finally {
      this.hiddenForOutputCount -= 1;

      if (!this.finished && this.hiddenForOutputCount === 0) {
        this.render();
      }
    }
  }
}

/** Calculate the actual row count needed to render `rows` into `stream` */
function getRenderedRowCount(rows: string[], columns: number) {
  let count = 0;

  for (const row of rows) {
    const text = stripVTControlCharacters(row);
    count += Math.max(1, Math.ceil(text.length / columns));
  }

  return count;
}
