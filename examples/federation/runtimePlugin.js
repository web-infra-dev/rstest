/* eslint-disable no-var */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */

// Local copy of the Module Federation Node runtime plugin used by our internal
// `node-host` / `node-remote` examples. We vendor it here so the federation
// example can run without depending on `@module-federation/node`.
//
// The plugin patches async-node chunk loading to support loading chunks over
// HTTP in Node (via fetch + vm/eval), and wires `__webpack_require__.l` for
// `remoteType: "script"` remotes.

const nodeRuntimeImportCache = new Map();

function importNodeModule(name) {
  if (!name) throw new Error('import specifier is required');
  if (nodeRuntimeImportCache.has(name)) return nodeRuntimeImportCache.get(name);

  const importModule = new Function('name', 'return import(name)');
  const promise = importModule(name)
    .then((res) => res.default)
    .catch((error) => {
      // Remove from cache on error so it can be retried
      nodeRuntimeImportCache.delete(name);
      throw error;
    });

  nodeRuntimeImportCache.set(name, promise);
  return promise;
}

// webpack/rspack provides `__non_webpack_require__` for Node targets so runtime
// code can access Node's real require even when bundled.
// We intentionally reference it as a free variable (provided by the bundler).

const resolveFile = (rootOutputDir, chunkId) => {
  const path = __non_webpack_require__('path');
  return path.join(__dirname, rootOutputDir + __webpack_require__.u(chunkId));
};

const returnFromCache = (remoteName) => {
  try {
    const globalThisVal = new Function('return globalThis')();
    const federationInstances = globalThisVal.__FEDERATION__?.__INSTANCES__ || [];
    for (const instance of federationInstances) {
      const moduleContainer = instance.moduleCache.get(remoteName);
      if (moduleContainer?.remoteInfo) return moduleContainer.remoteInfo.entry;
    }
  } catch {}
  return null;
};

const returnFromGlobalInstances = (remoteName) => {
  try {
    const globalThisVal = new Function('return globalThis')();
    const federationInstances = globalThisVal.__FEDERATION__?.__INSTANCES__ || [];
    for (const instance of federationInstances) {
      for (const remote of instance.options.remotes || []) {
        if (remote.name === remoteName || remote.alias === remoteName) {
          return remote.entry;
        }
      }
    }
  } catch {}
  return null;
};

const loadFromFs = (filename, callback) => {
  const fs = __non_webpack_require__('fs');
  const path = __non_webpack_require__('path');
  const vm = __non_webpack_require__('vm');

  if (fs.existsSync(filename)) {
    fs.readFile(filename, 'utf-8', (err, content) => {
      if (err) return callback(err, null);
      const chunk = {};
      try {
        const script = new vm.Script(
          `(function(exports, require, __dirname, __filename) {${content}\n})`,
          {
            filename,
            importModuleDynamically:
              // Node 20+ supports a default loader constant; fall back to dynamic import.
              vm.constants?.USE_MAIN_CONTEXT_DEFAULT_LOADER ?? importNodeModule,
          },
        );
        script.runInThisContext()(
          chunk,
          __non_webpack_require__,
          path.dirname(filename),
          filename,
        );
        callback(null, chunk);
      } catch (e) {
        callback(e, null);
      }
    });
  } else {
    callback(new Error(`File ${filename} does not exist`), null);
  }
};

const fetchAndRun = (url, chunkName, callback, args) => {
  (typeof fetch === 'undefined'
    ? importNodeModule('node-fetch').then((mod) => mod.default)
    : Promise.resolve(fetch)
  )
    .then((fetchFunction) => {
      // Allow MF runtime hooks to intercept fetch.
      return args?.origin?.loaderHook?.lifecycle?.fetch
        ?.emit(url.href, {})
        .then((res) => {
          if (!res || !(res instanceof Response)) {
            return fetchFunction(url.href).then((response) => response.text());
          }
          return res.text();
        });
    })
    .then((data) => {
      const chunk = {};
      try {
        // eslint-disable-next-line no-eval
        eval(`(function(exports, require, __dirname, __filename) {${data}\n})`)(
          chunk,
          __non_webpack_require__,
          url.pathname.split('/').slice(0, -1).join('/'),
          chunkName,
        );
        callback(null, chunk);
      } catch (e) {
        callback(e, null);
      }
    })
    .catch((err) => callback(err, null));
};

const resolveUrl = (remoteName, chunkName) => {
  try {
    return new URL(chunkName, __webpack_require__.p);
  } catch {
    const entryUrl = returnFromCache(remoteName) || returnFromGlobalInstances(remoteName);
    if (!entryUrl) return null;

    const url = new URL(entryUrl);
    const path = __non_webpack_require__('path');

    const urlPath = url.pathname;
    const lastSlashIndex = urlPath.lastIndexOf('/');
    const directoryPath =
      lastSlashIndex >= 0 ? urlPath.substring(0, lastSlashIndex + 1) : '/';

    const rootDir = __webpack_require__.federation?.rootOutputDir || '';
    const combinedPath = path.join(directoryPath, rootDir, chunkName).replace(/\\/g, '/');
    return new URL(combinedPath, url.origin);
  }
};

const loadChunk = (strategy, chunkId, rootOutputDir, callback, args) => {
  if (strategy === 'filesystem') {
    return loadFromFs(resolveFile(rootOutputDir, chunkId), callback);
  }

  const url = resolveUrl(rootOutputDir, chunkId);
  if (!url) return callback(null, { modules: {}, ids: [], runtime: null });

  fetchAndRun(url, chunkId, callback, args);
};

const installChunk = (chunk, installedChunks) => {
  for (const moduleId in chunk.modules) {
    __webpack_require__.m[moduleId] = chunk.modules[moduleId];
  }
  if (chunk.runtime) chunk.runtime(__webpack_require__);
  for (const chunkId of chunk.ids) {
    if (installedChunks[chunkId]) installedChunks[chunkId][0]();
    installedChunks[chunkId] = 0;
  }
};

const deleteChunk = (chunkId, installedChunks) => {
  delete installedChunks[chunkId];
  return true;
};

const setupScriptLoader = () => {
  __webpack_require__.l = (url, done, key, chunkId) => {
    if (!key || chunkId) throw new Error(`__webpack_require__.l name is required for ${url}`);
    __webpack_require__.federation.runtime
      .loadScriptNode(url, { attrs: { globalName: key } })
      .then((res) => {
        const enhancedRemote = __webpack_require__.federation.instance.initRawContainer(
          key,
          url,
          res,
        );
        new Function('return globalThis')()[key] = enhancedRemote;
        done(enhancedRemote);
      })
      .catch(done);
  };
};

const setupChunkHandler = (installedChunks, args) => {
  return (chunkId, promises) => {
    let installedChunkData = installedChunks[chunkId];
    if (installedChunkData !== 0) {
      if (installedChunkData) {
        promises.push(installedChunkData[2]);
      } else {
        const matcher = __webpack_require__.federation.chunkMatcher
          ? __webpack_require__.federation.chunkMatcher(chunkId)
          : true;
        if (matcher) {
          const promise = new Promise((resolve, reject) => {
            installedChunkData = installedChunks[chunkId] = [resolve, reject];

            const fs =
              typeof process !== 'undefined' ? __non_webpack_require__('fs') : false;
            const filename =
              typeof process !== 'undefined'
                ? resolveFile(__webpack_require__.federation.rootOutputDir || '', chunkId)
                : false;

            if (fs && fs.existsSync(filename)) {
              loadChunk('filesystem', chunkId, __webpack_require__.federation.rootOutputDir || '', (err, chunk) => {
                if (err) return deleteChunk(chunkId, installedChunks) && reject(err);
                if (chunk) installChunk(chunk, installedChunks);
                resolve(chunk);
              }, args);
            } else {
              const chunkName = __webpack_require__.u(chunkId);
              const loadingStrategy = typeof process === 'undefined' ? 'http-eval' : 'http-vm';
              loadChunk(loadingStrategy, chunkName, __webpack_require__.federation.initOptions.name, (err, chunk) => {
                if (err) return deleteChunk(chunkId, installedChunks) && reject(err);
                if (chunk) installChunk(chunk, installedChunks);
                resolve(chunk);
              }, args);
            }
          });
          promises.push((installedChunkData[2] = promise));
        } else {
          installedChunks[chunkId] = 0;
        }
      }
    }
  };
};

const setupWebpackRequirePatching = (handle) => {
  if (__webpack_require__.f) {
    if (__webpack_require__.f.require) __webpack_require__.f.require = handle;
    if (__webpack_require__.f.readFileVm) __webpack_require__.f.readFileVm = handle;
  }
};

module.exports = function nodeRuntimePlugin() {
  return {
    name: 'node-federation-plugin',
    beforeInit(args) {
      (() => {
        const installedChunks = {};
        setupScriptLoader();
        const handle = setupChunkHandler(installedChunks, args);
        setupWebpackRequirePatching(handle);
      })();
      return args;
    },
  };
};
