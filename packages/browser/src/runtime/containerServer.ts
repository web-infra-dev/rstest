import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { logger } from '@rstest/core/browser';
import openEditor from 'open-editor';
import sirv from 'sirv';
import type { BrowserHostConfig } from '../protocol';

const optionsPlaceholder = '__RSTEST_OPTIONS_PLACEHOLDER__';

type ContainerServerOptions = {
  containerHtmlTemplate: string | null;
  containerDistPath?: string;
  containerDevServer?: string;
};

type ContainerServerState = {
  injectedContainerHtml: string | null;
  serializedOptions: string;
  containerDevBase: URL | null;
  serveContainer: ReturnType<typeof sirv> | null;
};

export type ContainerServer = {
  setOptions: (options: BrowserHostConfig) => void;
  middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => void;
};

export const createContainerServer = ({
  containerHtmlTemplate,
  containerDistPath,
  containerDevServer,
}: ContainerServerOptions): ContainerServer => {
  const state: ContainerServerState = {
    injectedContainerHtml: null,
    serializedOptions: 'null',
    containerDevBase: containerDevServer ? new URL(containerDevServer) : null,
    serveContainer: containerDistPath
      ? sirv(containerDistPath, {
          dev: false,
          single: 'container.html',
        })
      : null,
  };

  const setOptions = (options: BrowserHostConfig): void => {
    state.serializedOptions = JSON.stringify(options).replace(/</g, '\u003c');
    if (containerHtmlTemplate) {
      state.injectedContainerHtml = containerHtmlTemplate.replace(
        optionsPlaceholder,
        state.serializedOptions,
      );
    }
  };

  const respondWithDevServerHtml = async (
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> => {
    if (!state.containerDevBase) {
      return false;
    }

    try {
      const target = new URL(url.pathname + url.search, state.containerDevBase);
      const response = await fetch(target);
      if (!response.ok) {
        return false;
      }

      let html = await response.text();
      html = html.replace(optionsPlaceholder, state.serializedOptions);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-length') {
          return;
        }
        res.setHeader(key, value);
      });
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
      return true;
    } catch (error) {
      logger.debug(
        `[Browser UI] Failed to fetch container HTML from dev server: ${String(error)}`,
      );
      return false;
    }
  };

  const proxyDevServerAsset = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    if (!state.containerDevBase || !req.url) {
      return false;
    }

    try {
      const target = new URL(req.url, state.containerDevBase);
      const response = await fetch(target);
      if (!response.ok) {
        return false;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-length') {
          return;
        }
        res.setHeader(key, value);
      });
      res.end(buffer);
      return true;
    } catch (error) {
      logger.debug(
        `[Browser UI] Failed to proxy asset from dev server: ${String(error)}`,
      );
      return false;
    }
  };

  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (!req.url) {
      next();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__open-in-editor') {
      const file = url.searchParams.get('file');
      if (!file) {
        res.statusCode = 400;
        res.end('Missing file');
        return;
      }
      try {
        await openEditor([{ file }]);
        res.statusCode = 204;
        res.end();
      } catch (error) {
        logger.debug(`[Browser UI] Failed to open editor: ${String(error)}`);
        res.statusCode = 500;
        res.end('Failed to open editor');
      }
      return;
    }

    if (url.pathname === '/') {
      if (await respondWithDevServerHtml(url, res)) {
        return;
      }

      const html =
        state.injectedContainerHtml ||
        containerHtmlTemplate?.replace(optionsPlaceholder, 'null');

      if (html) {
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }

      res.statusCode = 502;
      res.end('Container UI is not available.');
      return;
    }

    if (url.pathname.startsWith('/container-static/')) {
      if (await proxyDevServerAsset(req, res)) {
        return;
      }

      if (state.serveContainer) {
        state.serveContainer(req, res, next);
        return;
      }

      res.statusCode = 502;
      res.end('Container assets are not available.');
      return;
    }

    if (url.pathname === '/runner.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end(htmlTemplate);
      return;
    }

    next();
  };

  return {
    setOptions,
    middleware,
  };
};

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Rstest Browser Runner</title>
  </head>
  <body>
    <script type="module" src="/static/js/runner.js"></script>
  </body>
</html>
`;
