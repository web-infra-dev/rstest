import { useI18n, useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme-original';
import { version } from '../../../packages/core/package.json';
import { useI18nUrl } from '../components/utils';
import { AdaptersPatchFigure } from '../ui/AdaptersPatchFigure';
import { BrowserStackFigure } from '../ui/BrowserStackFigure';
import { JestMigrateFigure } from '../ui/JestMigrateFigure';
import { PipelineStackFigure } from '../ui/PipelineStackFigure';
import { PlaywrightBeltFigure } from '../ui/PlaywrightBeltFigure';
import {
  Button,
  Cell,
  FeatureText,
  InstallCommand,
  Grid,
  Section,
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

// Each feature block reads like the rstack-cli homepage: a short title, one
// sentence on what it does, then three short points.
type Feature = { title: string; body: string; points: string[] };

const PIPELINE: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Test it the way you ship it',
    body: 'Compile and run tests with Rspack and Rsbuild, the same toolchain your app builds with',
    points: [
      'Use Rsbuild plugins and Rspack loaders in tests',
      'Tests run against the code you build for production',
      'Tree-shaking and lazy barrel skip unused code in large projects',
    ],
  },
  zh: {
    title: '怎么构建，就怎么测试',
    body: '使用 Rspack 和 Rsbuild 编译并运行测试，与应用构建共用同一套工具链',
    points: [
      '在测试中使用 Rsbuild 插件和 Rspack loader',
      '测试运行的就是生产构建出的代码',
      'tree-shaking 与 lazy barrel 跳过大型项目中的未使用代码',
    ],
  },
};

const BROWSER: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Real browsers, real DOM',
    body: 'Run tests in Chromium, Firefox, and WebKit through Playwright, instead of simulating the DOM with jsdom',
    points: [
      'Test real layout, computed styles, Canvas, and Web Workers',
      'Query the page with a Playwright-style Locator API',
      'Assert with the auto-waiting expect.element',
    ],
  },
  zh: {
    title: '真实浏览器，真实 DOM',
    body: '通过 Playwright 在 Chromium、Firefox 和 WebKit 中运行测试，不再用 jsdom 模拟 DOM',
    points: [
      '覆盖真实的布局、computed style、Canvas 和 Web Worker',
      '使用 Playwright 风格的 Locator API 查询页面',
      '使用自动等待的 expect.element 断言',
    ],
  },
};

const ADAPTER: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Reuse the config you already have',
    body: 'Point Rstest at your Rsbuild, Rslib, or Rspack config and keep one source of truth',
    points: [
      'Reuse path aliases and global variables from your build config',
      'Let frameworks preset setup files and test defaults',
      'No more syncing settings by hand across tools',
    ],
  },
  zh: {
    title: '复用你已有的配置',
    body: '让 Rstest 直接复用 Rsbuild、Rslib 或 Rspack 的配置，只维护一份',
    points: [
      '复用构建配置中的路径别名和全局变量',
      '由框架预设 setup 脚本、超时时间和测试环境',
      '无需在不同工具之间手动同步配置',
    ],
  },
};

const JEST: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Your Jest tests, unchanged',
    body: 'Switch the runner and keep your existing suites, with a Jest-compatible API and CLI',
    points: [
      'Familiar describe, test, expect, and snapshot APIs',
      'Enable globals and run existing suites as-is',
      'Add browser mode and adapters when you need them',
    ],
  },
  zh: {
    title: '沿用 Jest 测试，无需改写',
    body: '切换 runner 即可沿用现有用例，API 与 CLI 均兼容 Jest',
    points: [
      '熟悉的 describe、test、expect 和 snapshot API',
      '开启 globals，现有用例原样运行',
      '需要时再启用 browser mode 和 adapter',
    ],
  },
};

const PLAYWRIGHT: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'End-to-end, in the same runner',
    body: 'Drive a dev server, preview, or deployed URL with Playwright through @rstest/playwright',
    points: [
      'Ready-to-use browser, context, page, and request fixtures',
      'Playwright-style assertions on pages and locators',
      'One config and one report for unit and E2E tests',
    ],
  },
  zh: {
    title: '端到端测试，同一个 runner',
    body: '通过 @rstest/playwright 使用 Playwright 驱动 dev server、preview 或已部署的 URL',
    points: [
      '开箱即用的 browser、context、page 和 request fixture',
      'Playwright 风格的 page 与 locator 断言',
      '单元测试与 E2E 共用一份配置和报告',
    ],
  },
};

const JEST_DESC = {
  en: 'A Jest-compatible API and CLI, so most suites migrate by switching the runner.',
  zh: 'Jest 兼容的 API 与 CLI，大多数用例只需切换 runner 即可迁移。',
};

const PLAYWRIGHT_DESC = {
  en: 'Drive a real app with Playwright from Node workers — one runner, one report.',
  zh: '在 Node worker 里用 Playwright 驱动真实 app —— 同一套 runner、同一份 report。',
};

const RSTACK_DESC = {
  en: 'A unified JavaScript toolchain centered on Rspack, with high performance and consistent architecture',
  zh: '以 Rspack 为核心的 JavaScript 统一工具链，具有优秀的性能和一致的架构',
};

// The `subtitle` i18n entry split over two lines, around the accented "Rspack".
const HERO_TITLE = {
  en: ['', '-based', 'Testing Framework'],
  zh: ['由 ', ' 驱动的', '测试框架'],
};

// A short form of the quick start guide's agent prompt; the linked guide holds the steps.
const AGENT_PROMPT =
  'Set up Rstest in this project: https://rstest.rs/guide/start/agent-install.md';

const LATEST_RELEASE = { en: 'Latest release', zh: '最新版本' };

const LEARN_MORE = { en: 'Learn more', zh: '了解更多' };

const BODY = 'mt-3 text-[15px]/[1.7] text-fg-muted';

function FeatureCopy({ body, points }: Feature) {
  return (
    <>
      <p className={BODY}>{body}</p>
      <ul className="mt-5 space-y-2.5">
        {points.map((point) => (
          <li
            key={point}
            className="flex gap-3 text-[15px]/[1.5] text-fg before:mt-[0.6em] before:size-1 before:shrink-0 before:rounded-full before:bg-fg-subtle"
          >
            {point}
          </li>
        ))}
      </ul>
    </>
  );
}

export function HomeLayout() {
  const t = useI18n<typeof import('i18n')>();
  const tUrl = useI18nUrl();
  const lang = useLang() === 'zh' ? 'zh' : 'en';

  return (
    <main className="pb-6">
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-16 pb-12 text-center lg:pt-24 lg:pb-16">
        <a
          href={`https://github.com/web-infra-dev/rstest/releases/tag/v${version}`}
          className="text-sm text-fg-muted transition-colors hover:text-fg"
        >
          {LATEST_RELEASE[lang]} v{version}
        </a>
        <h1 className="mt-5 text-[40px]/[1.1] font-semibold tracking-[-0.055em] sm:text-[64px]/[1.1]">
          <span className="block text-fg">
            {HERO_TITLE[lang][0]}
            <span className="text-brand">Rspack</span>
            {HERO_TITLE[lang][1]}
          </span>
          <span className="block text-[#999]">{HERO_TITLE[lang][2]}</span>
        </h1>
        <p className="mt-6 max-w-xl text-[19px]/[1.6] text-fg-muted">
          {t('slogan')}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
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
        <div className="mt-6 flex w-full justify-center">
          <InstallCommand prompt={AGENT_PROMPT} args="add @rstest/core -D" />
        </div>
      </section>

      <Section
        index="01"
        eyebrow="Build pipeline"
        description={t('productionAccurateTestingDesc')}
      >
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={PIPELINE[lang].title}
            href={tUrl('/guide/start/')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
          >
            <FeatureCopy {...PIPELINE[lang]} />
          </FeatureText>
          <PipelineStackFigure />
        </Grid>
      </Section>

      <Section
        index="02"
        eyebrow="Browser mode"
        description={t('realBrowserTestingDesc')}
      >
        {/* Zigzag: this showcase runs animation-left / text-right on desktop.
            DOM keeps text first so mobile still reads copy before the visual. */}
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={BROWSER[lang].title}
            href={tUrl('/guide/browser-testing/')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
            className="lg:order-2"
          >
            <FeatureCopy {...BROWSER[lang]} />
          </FeatureText>
          <BrowserStackFigure className="lg:order-1" />
        </Grid>
      </Section>

      <Section index="03" eyebrow="Adapters" description={ADAPTER_DESC[lang]}>
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={ADAPTER[lang].title}
            href={tUrl('/guide/advanced/adapters')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
          >
            <FeatureCopy {...ADAPTER[lang]} />
          </FeatureText>
          <AdaptersPatchFigure />
        </Grid>
      </Section>

      <Section
        index="04"
        eyebrow="Jest compatible"
        description={JEST_DESC[lang]}
      >
        {/* Zigzag: animation-left / text-right on desktop, text-first in DOM. */}
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={JEST[lang].title}
            href={tUrl('/guide/migration/jest')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
            className="lg:order-2"
          >
            <FeatureCopy {...JEST[lang]} />
          </FeatureText>
          <JestMigrateFigure className="lg:order-1" />
        </Grid>
      </Section>

      <Section
        index="05"
        eyebrow="Playwright E2E"
        description={PLAYWRIGHT_DESC[lang]}
      >
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={PLAYWRIGHT[lang].title}
            href={tUrl('/guide/basic/e2e-testing')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
          >
            <FeatureCopy {...PLAYWRIGHT[lang]} />
          </FeatureText>
          <PlaywrightBeltFigure />
        </Grid>
      </Section>

      <Section index="06" eyebrow="Features">
        <Grid columns="sm:grid-cols-3">
          <Cell title={t('blazingFast')} description={t('blazingFastDesc')} />
          <Cell
            title={t('modernByDefault')}
            description={t('modernByDefaultDesc')}
          />
          <Cell title={t('testingReady')} description={t('testingReadyDesc')} />
        </Grid>
      </Section>

      <Section index="07" eyebrow="Rstack" description={RSTACK_DESC[lang]}>
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
