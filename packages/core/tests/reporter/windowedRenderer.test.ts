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
  it('restores overlapping stream hooks when stopped out of order', () => {
    const output: string[] = [];
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const errorStream = createWritable();
    const stdoutWrite = process.stdout.write;
    const stderrWrite = process.stderr.write;
    const options = {
      getWindow: () => [],
      logger: {
        outputStream,
        errorStream,
        getColumns: () => 80,
      },
    };
    const first = new WindowRenderer(options);
    const second = new WindowRenderer(options);

    onTestFinished(() => {
      first.stop();
      second.stop();
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    });

    first.start();
    second.start();
    first.stop();
    process.stdout.write('visible between stops');
    second.finish();
    second.stop();

    expect(output).toEqual(['visible between stops']);
    expect(process.stdout.write).toBe(stdoutWrite);
    expect(process.stderr.write).toBe(stderrWrite);
  });

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
