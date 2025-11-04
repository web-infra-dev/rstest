import { createBirpc } from 'birpc';

console.log('[Container] Entry script loaded');

declare global {
  interface Window {
    __RSTEST_TEST_FILES__?: string[];
  }
}

type HostRPC = {
  rerunTest: (testFile: string) => Promise<void>;
  getTestFiles: () => Promise<string[]>;
};

type ContainerRPC = {
  onTestFileUpdate: (testFiles: string[]) => void;
};

const containerMethods: ContainerRPC = {
  onTestFileUpdate(testFiles: string[]) {
    updateTestFileList(testFiles);
  },
};

// Create birpc client to communicate with host
// First generic is local methods, second is remote methods
const rpc = createBirpc<HostRPC, ContainerRPC>(containerMethods, {
  post: (data) => {
    (window as any).__rstest_container_dispatch__?.(data);
  },
  on: (fn) => {
    (window as any).__rstest_container_on__ = fn;
  },
});

let currentTestFile: string | null = null;
let testFiles: string[] = [];

const updateTestFileList = (files: string[]) => {
  testFiles = files;
  renderTestFileList();
  renderIframes();

  // Select first file if nothing is selected
  if (!currentTestFile && files.length > 0) {
    selectTestFile(files[0]!);
  }
};

const selectTestFile = (testFile: string) => {
  console.log('[Container] Selecting test file:', testFile);
  currentTestFile = testFile;

  // Update active tab
  const tabs = document.querySelectorAll('.test-file-tab');
  tabs.forEach((tab) => {
    const tabElement = tab as HTMLElement;
    if (tabElement.dataset.testFile === testFile) {
      tabElement.classList.add('active');
    } else {
      tabElement.classList.remove('active');
    }
  });

  // Show/hide iframes
  const iframes = document.querySelectorAll('.test-runner-iframe');
  iframes.forEach((iframe) => {
    const iframeElement = iframe as HTMLIFrameElement;
    if (iframeElement.dataset.testFile === testFile) {
      iframeElement.style.display = 'block';
    } else {
      iframeElement.style.display = 'none';
    }
  });
};

const renderIframes = () => {
  const container = document.getElementById('iframe-container');
  if (!container) return;

  // Clear existing iframes
  container.innerHTML = '';

  // Create an iframe for each test file
  testFiles.forEach((testFile) => {
    const iframe = document.createElement('iframe');
    iframe.className = 'test-runner-iframe';
    iframe.dataset.testFile = testFile;

    const url = new URL('/runner.html', window.location.origin);
    url.searchParams.set('testFile', testFile);
    iframe.src = url.toString();

    // Hide by default
    iframe.style.display = 'none';

    // When iframe loads, send configuration via postMessage
    iframe.onload = () => {
      const options = (window as any).__RSTEST_BROWSER_OPTIONS__;
      if (options && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: 'RSTEST_CONFIG',
            payload: {
              ...options,
              testFile,
            },
          },
          '*',
        );
      }
    };

    container.appendChild(iframe);
  });

  console.log('[Container] Created', testFiles.length, 'iframes');
};

const renderTestFileList = () => {
  const container = document.getElementById('test-file-list');
  if (!container) return;

  container.innerHTML = '';

  testFiles.forEach((testFile) => {
    const tab = document.createElement('div');
    tab.className = 'test-file-tab';
    tab.dataset.testFile = testFile;
    tab.textContent = getDisplayName(testFile);
    tab.title = testFile;
    tab.onclick = () => selectTestFile(testFile);

    if (testFile === currentTestFile) {
      tab.classList.add('active');
    }

    container.appendChild(tab);
  });
};

const getDisplayName = (testFile: string): string => {
  const parts = testFile.split('/');
  return parts[parts.length - 1] || testFile;
};

const initUI = async () => {
  console.log('[Container] Initializing UI...');

  // Create main container (Rsbuild uses #root by default)
  const app = document.getElementById('root') || document.getElementById('app');
  if (!app) {
    console.error('[Container] #root or #app element not found');
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="sidebar">
        <div class="header">
          <h2>Test Files</h2>
          <button id="rerun-btn" class="rerun-btn">Re-run</button>
        </div>
        <div id="test-file-list" class="test-file-list"></div>
      </div>
      <div class="main">
        <div id="iframe-container" class="iframe-container"></div>
      </div>
    </div>
  `;

  // Setup rerun button
  const rerunBtn = document.getElementById('rerun-btn');
  if (rerunBtn) {
    rerunBtn.onclick = async () => {
      console.log('[Container] Re-run button clicked for:', currentTestFile);
      if (currentTestFile) {
        await rpc.rerunTest(currentTestFile);
      }
    };
  }

  // Load initial test files
  console.log('[Container] Fetching test files...');
  const files = await rpc.getTestFiles();
  console.log('[Container] Got test files:', files);
  updateTestFileList(files);
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initUI();
  });
} else {
  void initUI();
}

// Listen for messages from iframes (test results)
window.addEventListener('message', (event) => {
  if (event.data?.type === '__rstest_dispatch__') {
    // Forward test results to host via binding
    (window as any).__rstest_dispatch__?.(event.data.payload);
  }
});
