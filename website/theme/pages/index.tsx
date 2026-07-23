import { useI18n, useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme-original';
import { useI18nUrl } from '../components/utils';
import {
  Badge,
  Button,
  Cell,
  Chip,
  Grid,
  Section,
  Window,
} from '../ui/primitives';

const RSTACK_TOOLS = [
  {
    name: 'Rspack',
    en: 'A high performance JavaScript bundler written in Rust, with webpack-compatible API',
    zh: '基于 Rust 编写的高性能 JavaScript 打包工具，具备与 webpack 兼容的 API',
    logo: 'https://assets.rspack.rs/rspack/rspack-logo.svg',
    url: 'https://rspack.rs',
    domain: 'rspack.rs',
  },
  {
    name: 'Rsbuild',
    en: 'An Rspack-based build tool that provides out-of-the-box setup',
    zh: '基于 Rspack 的构建工具，包含开箱即用的预设配置，带来愉悦的开发体验',
    logo: 'https://assets.rspack.rs/rsbuild/rsbuild-logo.svg',
    url: 'https://rsbuild.rs',
    domain: 'rsbuild.rs',
  },
  {
    name: 'Rslib',
    en: 'A Rsbuild-based library development tool for creating libraries and UI components',
    zh: '基于 Rsbuild 的库开发工具，以简单的方式创建 JavaScript 库和 UI 组件库',
    logo: 'https://assets.rspack.rs/rslib/rslib-logo.svg',
    url: 'https://rslib.rs',
    domain: 'rslib.rs',
  },
  {
    name: 'Rspress',
    en: 'An Rsbuild-based static site generator for creating documentation sites',
    zh: '基于 Rsbuild 的静态站点生成器，用于创建优雅的文档站点',
    logo: 'https://assets.rspack.rs/rspress/rspress-logo-480x480.png',
    url: 'https://rspress.rs',
    domain: 'rspress.rs',
  },
  {
    name: 'Rsdoctor',
    en: 'A one-stop build analyzer that makes the build process transparent',
    zh: '一站式的构建分析工具，使构建流程变得透明、可预测和可优化',
    logo: 'https://assets.rspack.rs/rsdoctor/rsdoctor-logo-480x480.png',
    url: 'https://rsdoctor.rs',
    domain: 'rsdoctor.rs',
  },
  {
    name: 'Rslint',
    en: 'A high-performance JavaScript and TypeScript linter based on typescript-go',
    zh: '基于 typescript-go 的高性能 JavaScript 和 TypeScript 代码检查工具',
    logo: 'https://assets.rspack.rs/rslint/rslint-logo.svg',
    url: 'https://rslint.rs',
    domain: 'rslint.rs',
  },
];

const ADAPTER_DESC = {
  en: 'Adapters convert configurations from other tools (such as build tools or CLIs) into a format that Rstest supports',
  zh: '适配器允许你将来自其他工具（如构建工具或 CLI）的配置转换为 Rstest 支持的配置格式',
};

const ADAPTER_POINTS = {
  en: [
    [
      'Reuse configuration',
      'Convert existing build tool configurations (e.g., path aliases, global variables) into test configurations to avoid redundant definitions.',
    ],
    [
      'Framework customization',
      'Let frameworks or templates preset test configurations, such as setup scripts, timeouts, or the default test environment.',
    ],
    [
      'Simplify maintenance',
      'Centralize configuration management and reduce the hassle of manually synchronizing configurations across tools.',
    ],
    [
      'Quick integration',
      'Integrate Rstest into an existing project quickly by reusing what the project already configures.',
    ],
  ],
  zh: [
    [
      '复用配置',
      '将已有的构建工具配置（如路径别名、全局变量等）转换为测试配置，避免重复定义。',
    ],
    [
      '框架定制',
      '允许框架或模板预设测试配置，例如 setup 脚本、超时时间或默认测试环境。',
    ],
    [
      '简化维护',
      '集中管理配置，减少手动同步不同工具配置的麻烦，降低出错可能性。',
    ],
    [
      '快速集成',
      '通过适配器快速将 Rstest 集成到现有项目，复用已有的项目配置。',
    ],
  ],
};

const PIPELINE_BODY = {
  en: 'Rstest is built on Rsbuild, which is built on Rspack — the same toolchain your app ships with. Tests compile and run through that exact pipeline, so what passes in a test is what you build for production.',
  zh: 'Rstest 构建于 Rsbuild，而 Rsbuild 构建于 Rspack —— 和你应用打包用的是同一套工具链。测试会经由这条完全相同的链路编译和运行，所以测试里通过的，就是你为生产构建出的产物。',
};

const PLAYWRIGHT = {
  en: {
    title: 'End-to-end, in the same runner',
    desc: 'Drive a real app with Playwright from Node workers — one runner, one report.',
    body: 'With @rstest/playwright, write E2E specs that drive a dev server, preview, or deployed URL through Playwright. Import test and expect from @rstest/playwright, take the page fixture, and your end-to-end runs share the same Rstest config, workers, and reports as your unit tests.',
  },
  zh: {
    title: '端到端测试，同一个 runner',
    desc: '在 Node worker 里用 Playwright 驱动真实 app —— 同一套 runner、同一份 report。',
    body: '通过 @rstest/playwright，编写驱动 dev server、preview 或部署 URL 的 E2E 用例。从 @rstest/playwright 引入 test 和 expect，拿到 page fixture，端到端测试就与你的单元测试共享同一套 Rstest config、worker 和 report。',
  },
};

const JEST_COMPAT = {
  en: {
    title: 'Bring your Jest tests, unchanged',
    desc: 'A Jest-compatible API and CLI, so most suites migrate by switching the runner.',
    body: "Rstest mirrors Jest's describe / test / expect and snapshot APIs. Point your test script at rstest, keep globals on, and existing suites run as-is — then pick up Rspack-powered speed and Rstest features when you want them.",
  },
  zh: {
    title: '原样沿用你的 Jest 测试',
    desc: 'Jest 兼容的 API 与 CLI，大多数用例只需切换 runner 即可迁移。',
    body: 'Rstest 对齐 Jest 的 describe / test / expect 与 snapshot API。把测试脚本指向 rstest、保持 globals 开启，现有用例即可原样运行 —— 之后再按需享受 Rspack 驱动的速度和 Rstest 的能力。',
  },
};

const BROWSER_MODE_BODY = {
  en: 'Browser mode runs your tests in real Chromium, Firefox, and WebKit through Playwright — real DOM, computed styles, Canvas, and Web Workers. Query the page with a Playwright-style Locator API and assert with auto-waiting expect.element, instead of guessing against jsdom.',
  zh: 'Browser mode 通过 Playwright 在真实的 Chromium、Firefox、WebKit 中运行测试 —— 真实的 DOM、computed style、Canvas 和 Web Worker。用 Playwright 风格的 Locator API 查询页面，配合自动等待的 expect.element 断言，而不必对着 jsdom 猜测。',
};

const RSTACK_DESC = {
  en: 'A unified JavaScript toolchain centered on Rspack, with high performance and consistent architecture',
  zh: '以 Rspack 为核心的 JavaScript 统一工具链，具有优秀的性能和一致的架构',
};

// Placeholder for a feature block's visual; each one gets redrawn.
function FeatureVisual({ className = '' }: { className?: string }) {
  return <div className={`min-h-72 min-w-0 bg-surface ${className}`} />;
}

function TestFileWindow() {
  return (
    <Window title="index.test.ts">
      <code>
        <span className="text-syntax-keyword">import</span> {'{ expect, test }'}{' '}
        <span className="text-syntax-keyword">from</span>{' '}
        <span className="text-syntax-string">'@rstest/core'</span>;{'\n'}
        <span className="text-syntax-keyword">import</span> {'{ sayHi }'}{' '}
        <span className="text-syntax-keyword">from</span>{' '}
        <span className="text-syntax-string">'../src/index'</span>;{'\n\n'}
        <span className="text-syntax-fn">test</span>(
        <span className="text-syntax-string">'should sayHi correctly'</span>,
        {' () => {'}
        {'\n  '}
        <span className="text-syntax-fn">expect</span>(
        <span className="text-syntax-fn">sayHi</span>()).
        <span className="text-syntax-fn">toBe</span>(
        <span className="text-syntax-string">'hi'</span>);{'\n'}
        {'});'}
      </code>
    </Window>
  );
}

function TerminalWindow() {
  return (
    <Window title="npx rstest">
      <code>
        <span className="text-syntax-pass">{' ✓ '}</span>
        {'test/index.test.ts (2 tests) 1ms\n\n'}
        <span className="text-fg-muted">{' Test Files '}</span>
        <span className="text-syntax-pass">{'1 passed'}</span>
        {' (1)\n'}
        <span className="text-fg-muted">{'      Tests '}</span>
        <span className="text-syntax-pass">{'2 passed'}</span>
        {' (2)\n'}
        <span className="text-fg-muted">{'   Duration '}</span>
        {'189 ms (build 22 ms, tests 167 ms)'}
      </code>
    </Window>
  );
}

export function HomeLayout() {
  const t = useI18n<typeof import('i18n')>();
  const tUrl = useI18nUrl();
  const lang = useLang() === 'zh' ? 'zh' : 'en';

  // Both locales phrase the subtitle around "Rspack", so accent that token.
  const [beforeRspack, afterRspack] = t('subtitle').split('Rspack');

  return (
    <main>
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 pt-12 pb-8 lg:grid-cols-2 lg:items-center lg:gap-12">
        <div>
          <Badge>
            <img
              src="https://assets.rspack.rs/rstest/rstest-logo.svg"
              alt=""
              className="size-3.5"
            />
            @rstest/core
          </Badge>
          <h1 className="mt-5 text-5xl leading-[0.95] font-bold tracking-tighter text-fg sm:text-7xl">
            {beforeRspack}
            <span className="text-brand">Rspack</span>
            {afterRspack}
          </h1>
          <p className="mt-5 max-w-lg text-base text-fg-muted">{t('slogan')}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button href={tUrl('/guide/start/quick-start')} LinkComp={Link}>
              {t('quickStart')}
            </Button>
            <Button
              href="https://github.com/web-infra-dev/rstest"
              variant="secondary"
            >
              GitHub
            </Button>
          </div>
        </div>

        <div className="grid gap-px border border-line bg-line">
          <TestFileWindow />
          <TerminalWindow />
        </div>
      </section>

      <Section
        eyebrow="Build pipeline"
        description={t('productionAccurateTestingDesc')}
      >
        <Grid columns="lg:grid-cols-2">
          <div className="flex flex-col justify-center bg-surface p-6">
            <h3 className="text-[19px] font-semibold text-fg">
              {t('productionAccurateTesting')}
            </h3>
            <p className="mt-3 text-[14px]/[1.7] text-fg-muted">
              {PIPELINE_BODY[lang]}
            </p>
          </div>
          <FeatureVisual />
        </Grid>
      </Section>

      <Section eyebrow="Browser mode" description={t('realBrowserTestingDesc')}>
        {/* Zigzag: this showcase runs animation-left / text-right on desktop.
            DOM keeps text first so mobile still reads copy before the visual. */}
        <Grid columns="lg:grid-cols-2">
          <div className="flex flex-col justify-center bg-surface p-6 lg:order-2">
            <h3 className="text-[19px] font-semibold text-fg">
              {t('realBrowserTesting')}
            </h3>
            <p className="mt-3 text-[14px]/[1.7] text-fg-muted">
              {BROWSER_MODE_BODY[lang]}
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              <Chip>Chromium</Chip>
              <Chip>Firefox</Chip>
              <Chip>WebKit</Chip>
              <Chip>page.getByRole()</Chip>
              <Chip>expect.element()</Chip>
            </div>
          </div>
          <FeatureVisual className="lg:order-1" />
        </Grid>
      </Section>

      <Section eyebrow="Adapters" description={ADAPTER_DESC[lang]}>
        <Grid columns="lg:grid-cols-2">
          <dl className="bg-surface p-5">
            {ADAPTER_POINTS[lang].map(([term, desc]) => (
              <div key={term} className="mt-4 first:mt-0">
                <dt className="text-[15px] font-semibold text-fg">{term}</dt>
                <dd className="mt-1 text-[13px]/[1.6] text-fg-muted">{desc}</dd>
              </div>
            ))}
          </dl>
          <FeatureVisual />
        </Grid>
      </Section>

      <Section eyebrow="Jest compatible" description={JEST_COMPAT[lang].desc}>
        {/* Zigzag: animation-left / text-right on desktop, text-first in DOM. */}
        <Grid columns="lg:grid-cols-2">
          <div className="flex flex-col justify-center bg-surface p-6 lg:order-2">
            <h3 className="text-[19px] font-semibold text-fg">
              {JEST_COMPAT[lang].title}
            </h3>
            <p className="mt-3 text-[14px]/[1.7] text-fg-muted">
              {JEST_COMPAT[lang].body}
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              <Chip>describe</Chip>
              <Chip>test</Chip>
              <Chip>expect</Chip>
              <Chip>toMatchSnapshot()</Chip>
              <Chip>globals</Chip>
            </div>
          </div>
          <FeatureVisual className="lg:order-1" />
        </Grid>
      </Section>

      <Section eyebrow="Playwright E2E" description={PLAYWRIGHT[lang].desc}>
        <Grid columns="lg:grid-cols-2">
          <div className="flex flex-col justify-center bg-surface p-6">
            <h3 className="text-[19px] font-semibold text-fg">
              {PLAYWRIGHT[lang].title}
            </h3>
            <p className="mt-3 text-[14px]/[1.7] text-fg-muted">
              {PLAYWRIGHT[lang].body}
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              <Chip>page.goto()</Chip>
              <Chip>getByRole().click()</Chip>
              <Chip>expect(page)</Chip>
              <Chip>Node workers</Chip>
            </div>
          </div>
          <FeatureVisual />
        </Grid>
      </Section>

      <Section eyebrow="Features">
        <Grid columns="sm:grid-cols-3">
          <Cell title={t('blazingFast')} description={t('blazingFastDesc')} />
          <Cell
            title={t('modernByDefault')}
            description={t('modernByDefaultDesc')}
          >
            <div className="flex flex-wrap gap-1.5">
              <Chip>TypeScript</Chip>
              <Chip>ESM</Chip>
              <Chip>CJS</Chip>
              <Chip>CSS Modules</Chip>
            </div>
          </Cell>
          <Cell title={t('testingReady')} description={t('testingReadyDesc')}>
            <div className="flex flex-wrap gap-1.5">
              <Chip>expect</Chip>
              <Chip>snapshots</Chip>
              <Chip>mocks</Chip>
              <Chip>coverage</Chip>
            </div>
          </Cell>
        </Grid>
      </Section>

      <Section eyebrow="Rstack" description={RSTACK_DESC[lang]}>
        <Grid columns="sm:grid-cols-2 lg:grid-cols-3">
          {RSTACK_TOOLS.map((tool) => (
            <a
              key={tool.name}
              href={tool.url}
              className="group bg-surface p-5 transition-colors hover:bg-surface-soft"
            >
              <div className="flex items-center gap-2.5">
                <img src={tool.logo} alt="" className="size-5" />
                <h3 className="text-[15px] font-semibold text-fg">
                  {tool.name}
                </h3>
                <span className="ml-auto font-mono text-[11px] text-fg-subtle group-hover:text-brand">
                  {tool.domain}
                </span>
              </div>
              <p className="mt-2 text-[13px]/[1.6] text-fg-muted">
                {tool[lang]}
              </p>
            </a>
          ))}
        </Grid>
      </Section>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-6 py-6 text-[13px] text-fg-subtle">
          <p>
            Rstest is free and open source software released under the MIT
            license.
          </p>
          <p>© 2024-present ByteDance Inc.</p>
        </div>
      </footer>
    </main>
  );
}
