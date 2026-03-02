import { describe, expect, it } from '@rstest/core';
import type {
  BrowserClientMessage,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
} from '../src/protocol';

describe('browser protocol types', () => {
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
        runnerUrl: 'http://localhost:3000',
        wsPort: 3001,
        mode: 'run',
        debug: true,
      };

      expect(config.testFile).toBe('/root/test.ts');
      expect(config.runnerUrl).toBe('http://localhost:3000');
      expect(config.wsPort).toBe(3001);
      expect(config.mode).toBe('run');
      expect(config.debug).toBe(true);
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

    it('should accept log message', () => {
      const msg: BrowserClientMessage = {
        type: 'log',
        payload: {
          level: 'log',
          content: 'test log',
          testPath: '/test.ts',
          type: 'stdout',
        },
      };
      expect(msg.type).toBe('log');
      if (msg.type === 'log') {
        expect(msg.payload.level).toBe('log');
        expect(msg.payload.content).toBe('test log');
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

    it('should accept collect-result message', () => {
      const msg: BrowserClientMessage = {
        type: 'collect-result',
        payload: { testPath: '/test.ts', project: 'default', tests: [] },
      };
      expect(msg.type).toBe('collect-result');
    });

    it('should accept collect-complete message', () => {
      const msg: BrowserClientMessage = { type: 'collect-complete' };
      expect(msg.type).toBe('collect-complete');
    });
  });

  describe('BrowserDispatch envelope', () => {
    it('should accept dispatch request', () => {
      const request: BrowserDispatchRequest = {
        requestId: 'req-1',
        namespace: 'runner',
        method: 'file-start',
        args: { testPath: '/test.ts', projectName: 'default' },
        runToken: 1,
        target: { testFile: '/test.ts', sessionId: 'session-1' },
      };

      expect(request.namespace).toBe('runner');
      expect(request.method).toBe('file-start');
    });

    it('should accept dispatch response', () => {
      const response: BrowserDispatchResponse = {
        requestId: 'req-1',
        runToken: 1,
        result: { ok: true },
      };

      expect(response.requestId).toBe('req-1');
      expect(response.result).toEqual({ ok: true });
    });
  });
});
