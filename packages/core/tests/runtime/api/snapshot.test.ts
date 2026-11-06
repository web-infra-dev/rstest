import { format } from '@vitest/pretty-format';
import { addSerializer, getSerializers } from '@vitest/snapshot';
import { isolateSnapshotSerializers } from '../../../src/runtime/api/snapshot';

it('restores existing serializers and their precedence after file registrations', () => {
  const restoreInitial = isolateSnapshotSerializers();
  try {
    addSerializer({
      test: (value) => value === 'existing',
      serialize: () => 'baseline',
    });
    const restoreFile = isolateSnapshotSerializers();
    addSerializer({
      test: (value) => value === 'existing' || value === 'file',
      serialize: () => 'file serializer',
    });
    expect(format('existing', { plugins: getSerializers() })).toBe(
      'file serializer',
    );
    restoreFile();
    expect(format('existing', { plugins: getSerializers() })).toBe('baseline');
    expect(format('file', { plugins: getSerializers() })).toBe('"file"');

    const restoreNextFile = isolateSnapshotSerializers();
    restoreNextFile();
    expect(format('existing', { plugins: getSerializers() })).toBe('baseline');
  } finally {
    restoreInitial();
  }
});
