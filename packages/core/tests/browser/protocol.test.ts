import { describe, expect, it } from '@rstest/core';
import type {
  BrowserClientMessage,
  BrowserHostConfig,
  BrowserManifestEntry,
  BrowserProjectRuntime,
} from '../../src/browser/protocol';

describe('browser protocol types', () => {
  describe('BrowserManifestEntry', () => {
    it('should accept valid setup entry', () => {
      const entry: BrowserManifestEntry = {
        id: 'project-setup-0',
        type: 'setup',
        projectName: 'default',
        projectRoot: '/root',
        filePath: '/root/setup.ts',
        relativePath: './setup.ts',
      };

      expect(entry.type).toBe('setup');
      expect(entry.testPath).toBeUndefined();
    });

    it('should accept valid test entry', () => {
      const entry: BrowserManifestEntry = {
        id: 'project-test-0',
        type: 'test',
        projectName: 'default',
        projectRoot: '/root',
        filePath: '/root/test.ts',
        relativePath: './test.ts',
        testPath: '/root/test.ts',
      };

      expect(entry.type).toBe('test');
      expect(entry.testPath).toBe('/root/test.ts');
    });
  });

  describe('BrowserProjectRuntime', () => {
    it('should accept valid project runtime with minimal config', () => {
      const runtime: BrowserProjectRuntime = {
        name: 'default',
        environmentName: 'browser',
        projectRoot: '/root',
        runtimeConfig: {} as BrowserProjectRuntime['runtimeConfig'],
      };

      expect(runtime.name).toBe('default');
      expect(runtime.environmentName).toBe('browser');
    });
  });

  describe('BrowserHostConfig', () => {
    it('should accept valid host config', () => {
      const config: BrowserHostConfig = {
        rootPath: '/root',
        projects: [],
        snapshot: {
          updateSnapshot: 'none',
        },
      };

      expect(config.rootPath).toBe('/root');
      expect(config.snapshot.updateSnapshot).toBe('none');
    });

    it('should accept optional fields', () => {
      const config: BrowserHostConfig = {
        rootPath: '/root',
        projects: [],
        snapshot: {
          updateSnapshot: 'all',
        },
        testFile: '/root/test.ts',
        testFiles: ['/root/test1.ts', '/root/test2.ts'],
        runnerUrl: 'http://localhost:3000',
        wsPort: 3001,
      };

      expect(config.testFile).toBe('/root/test.ts');
      expect(config.testFiles).toHaveLength(2);
      expect(config.runnerUrl).toBe('http://localhost:3000');
      expect(config.wsPort).toBe(3001);
    });
  });

  describe('BrowserClientMessage', () => {
    it('should accept ready message', () => {
      const msg: BrowserClientMessage = { type: 'ready' };
      expect(msg.type).toBe('ready');
    });

    it('should accept file-start message', () => {
      const msg: BrowserClientMessage = {
        type: 'file-start',
        payload: { testPath: '/test.ts', projectName: 'default' },
      };
      expect(msg.type).toBe('file-start');
      if (msg.type === 'file-start') {
        expect(msg.payload.testPath).toBe('/test.ts');
      }
    });

    it('should accept case-result message', () => {
      const msg: BrowserClientMessage = {
        type: 'case-result',
        payload: {
          testId: '1',
          name: 'test case',
          status: 'pass',
          duration: 100,
          testPath: '/test.ts',
          project: 'default',
        },
      };
      expect(msg.type).toBe('case-result');
    });

    it('should accept log message', () => {
      const msg: BrowserClientMessage = {
        type: 'log',
        payload: { level: 'log', message: 'test log' },
      };
      expect(msg.type).toBe('log');
      if (msg.type === 'log') {
        expect(msg.payload.level).toBe('log');
      }
    });

    it('should accept fatal message', () => {
      const msg: BrowserClientMessage = {
        type: 'fatal',
        payload: { message: 'error', stack: 'stack trace' },
      };
      expect(msg.type).toBe('fatal');
      if (msg.type === 'fatal') {
        expect(msg.payload.message).toBe('error');
      }
    });

    it('should accept complete message', () => {
      const msg: BrowserClientMessage = { type: 'complete' };
      expect(msg.type).toBe('complete');
    });
  });
});
