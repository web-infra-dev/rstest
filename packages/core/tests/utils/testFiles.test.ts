import path from 'node:path';
import { filterFiles, formatTestEntryName } from '../../src/utils/testFiles';

describe('test filterFiles', () => {
  it('should filter files correctly', () => {
    const testFiles = ['index.test.ts', 'index1.test.ts', 'index2.test.ts'].map(
      (filename) => path.join(__dirname, filename),
    );

    expect(filterFiles(testFiles, ['index.test.ts'], __dirname)).toEqual([
      testFiles[0],
    ]);

    expect(
      filterFiles(
        testFiles,
        [path.join(__dirname, 'index.test.ts')],
        __dirname,
      ),
    ).toEqual([testFiles[0]]);

    expect(filterFiles(testFiles, ['index'], __dirname)).toEqual(testFiles);
  });
});

test('formatTestEntryName', () => {
  expect(formatTestEntryName('../setup.ts')).toBe('_setup~ts');
  expect(formatTestEntryName('setup.ts')).toBe('setup~ts');
  expect(formatTestEntryName('some.setup.ts')).toBe('some~setup~ts');
  expect(formatTestEntryName('some/setup.ts')).toBe('some_setup~ts');
});
