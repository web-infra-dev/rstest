import { Writable } from 'node:stream';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { WindowRenderer } from '../../src/reporter/windowedRenderer';
import { flushOutputStreams } from '../../src/utils/logger';

const createWritable = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

describe('WindowRenderer', () => {
  it('does not block stream flushing when write callback is the second argument', async () => {
    const renderer = new WindowRenderer({
      getWindow: () => [],
      logger: {
        outputStream: createWritable(),
        errorStream: createWritable(),
        getColumns: () => 80,
      },
    });

    onTestFinished(() => {
      renderer.stop();
    });

    renderer.start();

    const flushed = await Promise.race([
      flushOutputStreams().then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 100);
      }),
    ]);

    expect(flushed).toBe(true);
  });
});
