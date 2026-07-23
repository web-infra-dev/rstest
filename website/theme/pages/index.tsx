import { useI18n, useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme-original';
import { useI18nUrl } from '../components/utils';
import { IntegrationsPanel } from '../ui/IntegrationsPanel';
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

// Lynx names its logo files by ink color, so the "dark" file is the light-theme one.
const LYNX_ASSETS =
  'https://lf-lynx.tiktok-cdns.com/obj/lynx-artifacts-oss-sg/lynx-website/assets';

const CUSTOM_ADAPTER = {
  en: 'your own adapter',
  zh: '自定义适配器',
};

const RSTACK_DESC = {
  en: 'A unified JavaScript toolchain centered on Rspack, with high performance and consistent architecture',
  zh: '以 Rspack 为核心的 JavaScript 统一工具链，具有优秀的性能和一致的架构',
};

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

      <Section eyebrow="Features">
        <Grid columns="sm:grid-cols-2 lg:grid-cols-3">
          <Cell
            title={t('reuseBuildConfig')}
            description={t('reuseBuildConfigDesc')}
          />
          <Cell
            title={t('productionAccurateTesting')}
            description={t('productionAccurateTestingDesc')}
          />
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
          <Cell
            title={t('realBrowserTesting')}
            description={t('realBrowserTestingDesc')}
          >
            <div className="flex flex-wrap gap-1.5">
              <Chip>Chromium</Chip>
              <Chip>Firefox</Chip>
              <Chip>WebKit</Chip>
            </div>
          </Cell>
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
          {/* min-w-0 stops the long mono strings from widening the grid track. */}
          <div className="min-w-0 bg-surface">
            <IntegrationsPanel
              hostLogo="https://assets.rspack.rs/rstest/rstest-logo.svg"
              integrations={[
                {
                  id: 'rslib',
                  name: 'Rslib',
                  api: 'withRslibConfig()',
                  logo: 'https://assets.rspack.rs/rslib/rslib-logo.svg',
                },
                {
                  id: 'rsbuild',
                  name: 'Rsbuild',
                  api: 'withRsbuildConfig()',
                  logo: 'https://assets.rspack.rs/rsbuild/rsbuild-logo.svg',
                },
                {
                  id: 'rspack',
                  name: 'Rspack',
                  api: 'withRspackConfig()',
                  logo: 'https://assets.rspack.rs/rspack/rspack-logo.svg',
                },
                {
                  id: 'lynx',
                  name: 'Lynx',
                  api: 'withLynxConfig()',
                  logo: `${LYNX_ASSETS}/lynx-dark-logo.svg`,
                  logoDark: `${LYNX_ASSETS}/lynx-light-logo.svg`,
                },
                {
                  id: 'custom',
                  name: CUSTOM_ADAPTER[lang],
                  api: 'ExtendConfigFn',
                  logo: '',
                  dashed: true,
                },
              ]}
            />
          </div>
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
