import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  installVirtualFs,
  setVirtualFiles,
  uninstallVirtualFs,
} from '../../../src/runtime/worker/virtualFs'; // cspell:disable-line

describe('virtualFs', () => {
  it('intercepts fs reads for virtual files and restores originals on uninstall', async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-virtual-fs-'), // cspell:disable-line
    );
    const realFile = path.join(tmpDir, 'real.txt');
    const virtualFile = path.join(tmpDir, 'virtual.txt');

    fs.writeFileSync(realFile, 'real', 'utf-8');

    // Baseline: virtual file does not exist.
    expect(fs.existsSync(virtualFile)).toBe(false);

    installVirtualFs();
    setVirtualFiles({
      [virtualFile]: 'virtual',
    });

    expect(fs.existsSync(virtualFile)).toBe(true);
    expect(fs.readFileSync(virtualFile, 'utf-8')).toBe('virtual');
    expect(await fs.promises.readFile(virtualFile, 'utf-8')).toBe('virtual');

    // Real file still reads from disk.
    expect(fs.readFileSync(realFile, 'utf-8')).toBe('real');

    uninstallVirtualFs();

    // After uninstall, virtual interception is gone.
    expect(fs.existsSync(virtualFile)).toBe(false);
    expect(fs.readFileSync(realFile, 'utf-8')).toBe('real');
  });
});
