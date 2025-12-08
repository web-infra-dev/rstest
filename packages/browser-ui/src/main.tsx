import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createBirpc } from 'birpc';
import {
  CheckCircle2,
  File,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { ScrollArea } from './components/ui/scroll-area';
import { cn } from './lib/utils';
import type { BrowserClientMessage, BrowserHostConfig } from './types';
import './index.css';

type HostRPC = {
  rerunTest: (testFile: string) => Promise<void>;
  getTestFiles: () => Promise<string[]>;
};

type ContainerRPC = {
  onTestFileUpdate: (testFiles: string[]) => void;
};

type ContainerWindow = Window &
  typeof globalThis & {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_container_dispatch__?: (data: unknown) => void;
    __rstest_container_on__?: (cb: (data: unknown) => void) => void;
    __rstest_dispatch__?: (payload: unknown) => void;
  };

type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

const useRpc = (setTestFiles: (files: string[]) => void) => {
  const rpc = useMemo(() => {
    const methods: ContainerRPC = {
      onTestFileUpdate(files: string[]) {
        setTestFiles(files);
      },
    };

    return createBirpc<HostRPC, ContainerRPC>(methods, {
      post: (data) => {
        (window as ContainerWindow).__rstest_container_dispatch__?.(data);
      },
      on: (fn) => {
        (window as ContainerWindow).__rstest_container_on__ = fn;
      },
    });
  }, [setTestFiles]);

  useEffect(() => {
    rpc.getTestFiles().then((files) => setTestFiles(files));
  }, [rpc, setTestFiles]);

  return rpc;
};

const getDisplayName = (testFile: string) => {
  const parts = testFile.split('/');
  return parts[parts.length - 1] || testFile;
};

const iframeUrlFor = (testFile: string, runnerBase?: string) => {
  const base = runnerBase || window.location.origin;
  const url = new URL('/runner.html', base);
  url.searchParams.set('testFile', testFile);
  return url.toString();
};

const App: React.FC = () => {
  const options = (window as ContainerWindow).__RSTEST_BROWSER_OPTIONS__;
  const [testFiles, setTestFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, TestStatus>>({});
  const rpc = useRpc(setTestFiles);

  useEffect(() => {
    console.log('[Container] __RSTEST_BROWSER_OPTIONS__', options);
  }, [options]);

  useEffect(() => {
    setStatusMap((prev) => {
      const next: Record<string, TestStatus> = {};
      for (const file of testFiles) {
        next[file] = prev[file] ?? 'idle';
      }
      return next;
    });
  }, [testFiles]);

  useEffect(() => {
    if (!active && testFiles.length > 0) {
      setActive(testFiles[0]!);
    }
  }, [active, testFiles]);

  const handleSelect = (file: string) => {
    setActive(file);
  };

  const handleRerun = async () => {
    if (active) {
      await rpc.rerunTest(active);
    }
  };

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type === '__rstest_dispatch__') {
        const message = event.data.payload as BrowserClientMessage | undefined;
        if (message?.type === 'file-start') {
          const payload = message.payload as { testPath?: string };
          const testPath = payload.testPath;
          if (typeof testPath === 'string') {
            setStatusMap((prev) => ({ ...prev, [testPath]: 'running' }));
          }
        } else if (message?.type === 'file-complete') {
          const payload = message.payload as {
            testPath?: string;
            status?: 'pass' | 'fail' | 'skip';
          };
          const testPath = payload.testPath;
          if (typeof testPath === 'string') {
            const passed = payload.status === 'pass';
            setStatusMap((prev) => ({
              ...prev,
              [testPath]: passed ? 'pass' : 'fail',
            }));
          }
        } else if (message?.type === 'fatal') {
          if (active) {
            setStatusMap((prev) => ({ ...prev, [active]: 'fail' }));
          }
        }
        (window as ContainerWindow).__rstest_dispatch__?.(event.data.payload);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [active]);

  if (!options) {
    return (
      <div className="app-shell" style={{ color: 'white' }}>
        Missing browser options
      </div>
    );
  }

  const counts = {
    total: testFiles.length,
    pass: Object.values(statusMap).filter((s) => s === 'pass').length,
    fail: Object.values(statusMap).filter((s) => s === 'fail').length,
  };

  return (
    <div className="app-shell">
      <Card className="h-[calc(100vh-32px)] rounded-2xl border border-border bg-card shadow-xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <Globe size={18} /> Browser Tests
              </span>
            </CardTitle>
            <Button onClick={handleRerun} size="sm" variant="outline" className="border-border text-foreground">
              <RefreshCw size={14} /> Re-run
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-accent px-3 py-1">
              <File size={14} /> {counts.total} files
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-accent px-3 py-1">
              <CheckCircle2 size={14} className="text-success" /> {counts.pass} pass
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-accent px-3 py-1">
              <XCircle size={14} className="text-destructive" /> {counts.fail} fail
            </span>
          </div>
        </CardHeader>
        <CardContent style={{ flex: 1, paddingTop: 0 }}>
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-2">
              {testFiles.map((file) => {
                const status = statusMap[file] ?? 'idle';
                return (
                  <div
                    key={file}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border border-border/60 bg-card/80 px-3 py-2 transition hover:border-primary/60 hover:bg-card',
                      active === file && 'border-primary bg-card',
                    )}
                    onClick={() => handleSelect(file)}
                    title={file}
                  >
                    {status === 'pass' && (
                      <CheckCircle2 size={18} className="text-success" />
                    )}
                    {status === 'fail' && (
                      <XCircle size={18} className="text-destructive" />
                    )}
                    {status === 'running' && (
                      <Loader2 size={18} className="text-primary animate-spin" />
                    )}
                    {(status === 'idle' || status === undefined) && (
                      <Play size={18} className="text-primary" />
                    )}
                    <div className="flex-1 min-w-0 text-sm text-foreground">
                      {getDisplayName(file)}
                    </div>
                    <Badge variant="muted" className="max-w-[220px] truncate">
                      {file}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="h-[calc(100vh-32px)] rounded-2xl border border-border bg-card shadow-xl">
        <CardHeader className="pb-2">
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="h-[calc(100%-72px)] pt-0">
          <div className="iframe-shell">
            {testFiles.map((file) => (
              <iframe
                key={file}
                className="test-runner-iframe"
                data-test-file={file}
                src={iframeUrlFor(file, options.runnerUrl)}
                style={{ display: file === active ? 'block' : 'none' }}
                onLoad={(event) => {
                  const frame = event.currentTarget;
                  if (frame.contentWindow) {
                    frame.contentWindow.postMessage(
                      {
                        type: 'RSTEST_CONFIG',
                        payload: {
                          ...options,
                          testFile: file,
                        },
                      },
                      '*',
                    );
                  }
                }}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const mount = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    return;
  }
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
