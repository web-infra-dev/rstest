import { describe, expect, it } from '@rstest/core';
import { loadGreeting, resolveMessage, sayHi } from './src/index';

const loadMessage = (name: string) =>
  require(`./src/messages/${name}.json`).message;

const resolveManifest = (method: string) =>
  require.resolve(`./src/manifests/${method}.json`);

describe('index', () => {
  it('should greet index', async () => {
    expect(sayHi()).toBe('Hello, index!');
    expect(loadMessage('required')).toBe('required');
    expect(resolveMessage()).toMatch(/[/\\]resolved\.json$/);
    expect(resolveManifest('standard')).toMatch(/[/\\]standard\.json$/);
    expect((await loadGreeting('en')).greeting).toBe('Welcome');
  });
});
