import { useI18n, useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme-original';
import { useI18nUrl } from '../components/utils';
import { AdaptersPatchFigure } from '../ui/AdaptersPatchFigure';
import { BrowserStackFigure } from '../ui/BrowserStackFigure';
import { JestMigrateFigure } from '../ui/JestMigrateFigure';
import { PipelineStackFigure } from '../ui/PipelineStackFigure';
import { PlaywrightBeltFigure } from '../ui/PlaywrightBeltFigure';
import {
  Button,
  FeatureText,
  InstallCommand,
  Grid,
  Panel,
  PanelHeader,
} from '../ui/primitives';

type RstackTool = {
  name: string;
  // Stable selector for the hover accent in `theme/index.scss`.
  slug: string;
  en: string;
  zh: string;
  logo: string;
  url: string;
  domain: string;
};

const RSTACK_TOOLS: RstackTool[] = [
  {
    name: 'Rspack',
    slug: 'rspack',
    en: 'A fast Rust-based bundler for the web, with a modernized webpack API',
    zh: '基于 Rust 编写的高性能 Web 打包工具，提供现代化的 webpack API',
    logo: 'https://assets.rspack.rs/rspack/rspack-logo.svg',
    url: 'https://rspack.rs',
    domain: 'rspack.rs',
  },
  {
    name: 'Rsbuild',
    slug: 'rsbuild',
    en: 'A fast, extensible build tool for modern web development, powered by Rspack',
    zh: '基于 Rspack 的现代 Web 构建工具，快速且易于扩展',
    logo: 'https://assets.rspack.rs/rsbuild/rsbuild-logo.svg',
    url: 'https://rsbuild.rs',
    domain: 'rsbuild.rs',
  },
  {
    name: 'Rslib',
    slug: 'rslib',
    en: 'An Rsbuild-based library development tool for creating libraries and UI components',
    zh: '基于 Rsbuild 的库开发工具，以简单的方式创建 JavaScript 库和 UI 组件库',
    logo: 'https://assets.rspack.rs/rslib/rslib-logo.svg',
    url: 'https://rslib.rs',
    domain: 'rslib.rs',
  },
  {
    name: 'Rspress',
    slug: 'rspress',
    en: 'An Rsbuild-based static site generator for creating documentation sites',
    zh: '基于 Rsbuild 的静态站点生成器，用于创建优雅的文档站点',
    logo: 'https://assets.rspack.rs/rspress/rspress-logo-480x480.png',
    url: 'https://rspress.rs',
    domain: 'rspress.rs',
  },
  {
    name: 'Rsdoctor',
    slug: 'rsdoctor',
    en: 'An AI-friendly build analyzer that makes the build process transparent',
    zh: 'AI 友好的构建分析工具，使构建流程变得透明、可预测和可优化',
    logo: 'https://assets.rspack.rs/rsdoctor/rsdoctor-logo-480x480.png',
    url: 'https://rsdoctor.rs',
    domain: 'rsdoctor.rs',
  },
  {
    name: 'Rstest',
    slug: 'rstest',
    en: 'A JavaScript testing framework powered by Rspack, with a Jest-compatible API',
    zh: '基于 Rspack 的 JavaScript 测试框架，兼容 Jest API',
    logo: 'https://assets.rspack.rs/rstest/rstest-logo.svg',
    url: 'https://rstest.rs',
    domain: 'rstest.rs',
  },
  {
    name: 'Rslint',
    slug: 'rslint',
    en: 'A high-performance, ESLint-compatible linter for JavaScript and TypeScript',
    zh: '高性能 JavaScript 和 TypeScript 代码检查工具，兼容 ESLint 生态',
    logo: 'https://assets.rspack.rs/rslint/rslint-logo.svg',
    url: 'https://rslint.rs',
    domain: 'rslint.rs',
  },
  {
    name: 'Rstack CLI',
    slug: 'rstack-cli',
    en: 'One CLI that covers development, builds, testing, linting, and formatting',
    zh: '统一的命令行工具，覆盖开发、构建、测试、Lint 和格式化',
    logo: 'https://assets.rspack.rs/rspack/rspack-claw-logo.svg',
    url: 'https://rstack.rs',
    domain: 'rstack.rs',
  },
];

const ADAPTER_DESC = {
  en: 'Reuse build config from Rsbuild, Rslib, Rspack, Lynx, and Modern.js projects through adapters',
  zh: '通过适配器复用 Rsbuild、Rslib、Rspack、Lynx 和 Modern.js 项目的构建配置，无缝接入现有项目',
};

// Each feature block reads like the rstack-cli homepage: a short title, one
// sentence on what it does, then three short points.
type Feature = { title: string; body: string; points: string[] };

const PIPELINE: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Rspack speed, Rsbuild ecosystem',
    body: 'Tests are compiled by Rspack and share the config and plugin system of Rsbuild, ready out of the box and easy to extend',
    points: [
      'Utilizes Rust-based Rspack and SWC for fast test compilation',
      'Compatible with Rsbuild plugins, including official ones such as React and Sass',
      'Supports Rsbuild and Rspack config options, configured the same way',
    ],
  },
  zh: {
    title: 'Rspack 的速度，Rsbuild 的生态',
    body: '测试由 Rspack 编译，并沿用 Rsbuild 的配置与插件体系，开箱即用，易于扩展',
    points: [
      '利用基于 Rust 的 Rspack 和 SWC，测试编译更快',
      '兼容 Rsbuild 插件，可直接使用 React、Sass 等官方插件',
      '支持 Rsbuild 与 Rspack 配置项，配置方式一致',
    ],
  },
};

const BROWSER: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Real browsers, real DOM',
    body: 'Tests run in real browsers launched by Playwright, with the same rendering, interactions, and browser APIs as production',
    points: [
      'Covers real layout, computed styles, Canvas, and Web Workers',
      'Query elements with the Playwright-style Locator API',
      'Assert with the auto-waiting expect.element',
    ],
  },
  zh: {
    title: '真实浏览器，真实 DOM',
    body: '测试运行在 Playwright 启动的真实浏览器中，渲染、交互与浏览器 API 均与生产环境一致',
    points: [
      '覆盖真实布局、computed style、Canvas 与 Web Worker',
      '通过 Playwright 风格的 Locator API 查询元素',
      '使用自动等待的 expect.element 进行断言',
    ],
  },
};

const ADAPTER: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Reuse your build config',
    body: 'Adapters extract and convert the config tests need, while Rstest keeps control of test entries and runtime',
    points: [
      'Reuse plugins, aliases, and SWC options from your build config',
      'Keep tests consistent with your project config',
      'No duplicate config to maintain',
    ],
  },
  zh: {
    title: '复用现有构建配置',
    body: '适配器按需提取并转换测试所需的配置，测试入口与运行时仍由 Rstest 管理',
    points: [
      '复用构建配置中的插件、alias 与 SWC 选项',
      '测试与项目配置始终保持一致',
      '无需重复维护测试配置',
    ],
  },
};

const JEST: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Jest-compatible APIs',
    body: 'Assertions, mocks, snapshots, lifecycle hooks, projects, and coverage follow Jest and Vitest conventions',
    points: [
      'Familiar describe, test, expect, and snapshot APIs',
      'Enable globals to use test APIs without imports',
      'Adopt Browser Mode and adapters as needed',
    ],
  },
  zh: {
    title: '兼容 Jest API',
    body: '断言、Mock、快照、生命周期钩子、多项目与覆盖率，沿用 Jest 与 Vitest 的使用习惯',
    points: [
      '熟悉的 describe、test、expect 与 snapshot API',
      '开启 globals，无需 import 即可使用测试 API',
      '按需启用 Browser Mode 与适配器',
    ],
  },
};

const PLAYWRIGHT: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'End-to-end in the same runner',
    body: 'Use Playwright browser automation in Rstest to verify complete page and app flows',
    points: [
      'Ready-to-use browser, context, page, and request fixtures',
      'Playwright-style assertions for pages and locators',
      'Unit and E2E tests share one runner, config, and reporting workflow',
    ],
  },
  zh: {
    title: '端到端测试，同一 runner',
    body: '在 Rstest 中直接使用 Playwright 的浏览器自动化能力，验证完整的页面与应用流程',
    points: [
      '开箱即用的 browser、context、page 与 request fixture',
      '支持 Playwright 风格的 page 与 locator 断言',
      '单元测试与 E2E 测试共享 runner、配置与报告流程',
    ],
  },
};

const JEST_DESC = {
  en: 'Compatible with Jest and Vitest APIs and CLI, with guides for a smooth migration',
  zh: '兼容 Jest 与 Vitest 的 API 和 CLI，并提供迁移指南，平滑迁移现有项目',
};

const PLAYWRIGHT_DESC = {
  en: 'Drive a local dev server, preview server, or deployed app with Playwright for end-to-end verification',
  zh: '基于 Playwright 驱动本地开发服务、预览服务或线上应用，完成端到端验证',
};

const FOOTER_COLUMNS: Record<
  'en' | 'zh',
  { title: string; links: { label: string; href: string }[] }[]
> = {
  en: [
    {
      title: 'Guide',
      links: [
        { label: 'Quick start', href: '/guide/start/quick-start' },
        { label: 'Configuration', href: '/config/' },
        { label: 'API reference', href: '/api/runtime-api/' },
        { label: 'Browser mode', href: '/guide/browser-testing/' },
        { label: 'Migration', href: '/guide/migration/jest' },
      ],
    },
    {
      title: 'Ecosystem',
      links: [
        { label: 'Rstack CLI', href: 'https://rstack.rs/' },
        { label: 'Rspack', href: 'https://rspack.rs/' },
        { label: 'Rsbuild', href: 'https://rsbuild.rs/' },
        { label: 'Rslib', href: 'https://rslib.rs/' },
        { label: 'Rspress', href: 'https://rspress.rs/' },
        { label: 'Rslint', href: 'https://rslint.rs/' },
      ],
    },
    {
      title: 'Community',
      links: [
        { label: 'GitHub', href: 'https://github.com/web-infra-dev/rstest' },
        { label: 'Discord', href: 'https://discord.gg/XsaKEEk4mW' },
        { label: 'X', href: 'https://twitter.com/rspack_dev' },
        { label: 'Blog', href: '/blog/index' },
      ],
    },
  ],
  zh: [
    {
      title: '指南',
      links: [
        { label: '快速开始', href: '/guide/start/quick-start' },
        { label: '配置', href: '/config/' },
        { label: 'API 参考', href: '/api/runtime-api/' },
        { label: '浏览器模式', href: '/guide/browser-testing/' },
        { label: '迁移', href: '/guide/migration/jest' },
      ],
    },
    {
      title: '生态',
      links: [
        { label: 'Rstack CLI', href: 'https://rstack.rs/' },
        { label: 'Rspack', href: 'https://rspack.rs/' },
        { label: 'Rsbuild', href: 'https://rsbuild.rs/' },
        { label: 'Rslib', href: 'https://rslib.rs/' },
        { label: 'Rspress', href: 'https://rspress.rs/' },
        { label: 'Rslint', href: 'https://rslint.rs/' },
      ],
    },
    {
      title: '社区',
      links: [
        { label: 'GitHub', href: 'https://github.com/web-infra-dev/rstest' },
        { label: 'Discord', href: 'https://discord.gg/XsaKEEk4mW' },
        { label: 'X', href: 'https://twitter.com/rspack_dev' },
        { label: '博客', href: '/blog/index' },
      ],
    },
  ],
};

const FOOTER_LICENSE = {
  en: {
    prefix: 'Rstest is free and open source software released under the ',
    link: 'MIT license',
    suffix: '.',
  },
  zh: {
    prefix: 'Rstest 是自由开源软件，基于 ',
    link: 'MIT 许可证',
    suffix: ' 发布。',
  },
};

const FOOTER_LOGO = 'https://assets.rspack.rs/rstest/rstest-logo.svg';
const FOOTER_LICENSE_URL =
  'https://github.com/web-infra-dev/rstest/blob/main/LICENSE';

const RSTACK_DESC = {
  en: 'The fast, unified JavaScript toolchain for developers and agents',
  zh: '高性能、一体化的 JavaScript 工具链，为开发者与 Agent 打造',
};

// The `subtitle` i18n entry split over two lines, around the accented "Rspack".
const HERO_TITLE = {
  en: ['', '-based', 'Testing Framework'],
  zh: ['基于 ', ' 的', '测试框架'],
};

// A short form of the quick start guide's agent prompt; the linked guide holds the steps.
const AGENT_PROMPT =
  'Set up Rstest in this project: https://rstest.rs/guide/start/agent-install.md';

const LEARN_MORE = { en: 'Learn more', zh: '了解更多' };

const HIGHLIGHT_ICONS = {
  blazingFast: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-4"
    >
      <path d="M14 2 5 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  ),
  modernByDefault: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-4"
    >
      <path d="m8 6-6 6 6 6" />
      <path d="m16 6 6 6-6 6" />
      <path d="m14 4-4 16" />
    </svg>
  ),
  testingReady: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-4"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  ),
};

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
  const highlights = [
    {
      key: 'blazingFast',
      title: t('blazingFast'),
      description: t('blazingFastDesc'),
    },
    {
      key: 'modernByDefault',
      title: t('modernByDefault'),
      description: t('modernByDefaultDesc'),
    },
    {
      key: 'testingReady',
      title: t('testingReady'),
      description: t('testingReadyDesc'),
    },
  ] as const;

  return (
    <main className="pb-6">
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-10 pb-12 text-center lg:pt-16 lg:pb-16">
        <h1 className="text-[40px]/[1.1] font-semibold tracking-[-0.055em] sm:text-[64px]/[1.1]">
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
        <div className="mt-12 w-full border border-line bg-line text-left lg:mt-16">
          <div className="grid gap-px sm:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="home-highlight bg-surface px-6 py-5 sm:px-8 sm:py-6 lg:px-10 lg:py-8"
              >
                <div className="flex items-center gap-3">
                  <div className="home-highlight__icon flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-brand">
                    {HIGHLIGHT_ICONS[item.key]}
                  </div>
                  <h2 className="text-[16px] font-semibold text-fg">
                    {item.title}
                  </h2>
                </div>
                <p className="mt-3 text-[14px]/[1.6] text-fg-muted">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Panel>
        <PanelHeader
          index="01"
          description={t('productionAccurateTestingDesc')}
        />
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

        <PanelHeader index="02" description={t('realBrowserTestingDesc')} />
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

        <PanelHeader index="03" description={ADAPTER_DESC[lang]} />
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

        <PanelHeader index="04" description={JEST_DESC[lang]} />
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

        <PanelHeader index="05" description={PLAYWRIGHT_DESC[lang]} />
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
      </Panel>

      <Panel className="mt-16 lg:mt-24">
        <PanelHeader index="06" description={RSTACK_DESC[lang]} />
        <Grid columns="grid-cols-2">
          {RSTACK_TOOLS.map((tool) => (
            <a
              key={tool.name}
              href={tool.url}
              target="_blank"
              rel="noreferrer"
              data-tool={tool.slug}
              className="rstack-tool group relative flex flex-col gap-2 bg-surface p-4 sm:grid sm:min-h-[132px] sm:grid-cols-[80px_minmax(0,1fr)] sm:items-center sm:gap-x-5 sm:p-5 lg:grid-cols-[96px_minmax(0,1fr)]"
            >
              <div className="relative col-start-1 size-10 shrink-0 self-start sm:size-auto sm:self-stretch">
                <img
                  src={tool.logo}
                  alt=""
                  className="block size-10 object-contain object-center sm:absolute sm:inset-0 sm:size-full"
                />
              </div>
              <div className="col-start-2 flex min-w-0 flex-col gap-y-0.5 sm:self-center">
                <h3 className="text-[16px]/6 font-semibold text-fg sm:text-[24px]/8">
                  {tool.name}
                </h3>
                <span className="rstack-tool__domain font-mono text-[12px]/[1.5] sm:text-[15px]/[1.5]">
                  {tool.domain}
                </span>
                <p className="min-w-0 text-[13px]/[1.45] text-fg-muted sm:text-[15px]/[1.5]">
                  {tool[lang]}
                </p>
              </div>
            </a>
          ))}
        </Grid>
      </Panel>

      <footer className="mt-16 border-t border-line lg:mt-24">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:py-16">
          <div className="grid grid-cols-3 gap-x-6 gap-y-10 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <div className="col-span-3 lg:col-span-1">
              <a
                href={tUrl('/')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2.5"
                aria-label="Rstest"
              >
                <img src={FOOTER_LOGO} alt="" className="size-7" />
                <span className="text-[15px] font-semibold text-fg">
                  Rstest
                </span>
              </a>
              <p className="mt-4 max-w-[17rem] text-[13px]/[1.7] text-fg-muted">
                {t('slogan')}
              </p>
            </div>
            {FOOTER_COLUMNS[lang].map((column) => (
              <div key={column.title}>
                <h3 className="text-[13px] font-semibold text-fg">
                  {column.title}
                </h3>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={
                          link.href.startsWith('http')
                            ? link.href
                            : tUrl(link.href)
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13px] text-fg-muted transition-colors hover:text-fg"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-[12px] text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
            <p>© 2024-present ByteDance Inc.</p>
            <p>
              {FOOTER_LICENSE[lang].prefix}
              <a
                href={FOOTER_LICENSE_URL}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-line underline-offset-4 transition-colors hover:text-fg"
              >
                {FOOTER_LICENSE[lang].link}
              </a>
              {FOOTER_LICENSE[lang].suffix}
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
