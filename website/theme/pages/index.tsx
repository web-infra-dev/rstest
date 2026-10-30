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
  Cell,
  FeatureText,
  InstallCommand,
  Grid,
  Section,
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
    en: 'A high performance JavaScript bundler written in Rust, with webpack-compatible API',
    zh: '基于 Rust 编写的高性能 JavaScript 打包工具，具备与 webpack 兼容的 API',
    logo: 'https://assets.rspack.rs/rspack/rspack-logo.svg',
    url: 'https://rspack.rs',
    domain: 'rspack.rs',
  },
  {
    name: 'Rsbuild',
    slug: 'rsbuild',
    en: 'An Rspack-based build tool that provides out-of-the-box setup',
    zh: '基于 Rspack 的构建工具，包含开箱即用的预设配置，带来愉悦的开发体验',
    logo: 'https://assets.rspack.rs/rsbuild/rsbuild-logo.svg',
    url: 'https://rsbuild.rs',
    domain: 'rsbuild.rs',
  },
  {
    name: 'Rslib',
    slug: 'rslib',
    en: 'A Rsbuild-based library development tool for creating libraries and UI components',
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
    en: 'A one-stop build analyzer that makes the build process transparent',
    zh: '一站式的构建分析工具，使构建流程变得透明、可预测和可优化',
    logo: 'https://assets.rspack.rs/rsdoctor/rsdoctor-logo-480x480.png',
    url: 'https://rsdoctor.rs',
    domain: 'rsdoctor.rs',
  },
  {
    name: 'Rstest',
    slug: 'rstest',
    en: 'A JavaScript testing framework powered by Rspack, with a Jest-compatible API',
    zh: '由 Rspack 驱动的 JavaScript 测试框架，兼容 Jest API',
    logo: 'https://assets.rspack.rs/rstest/rstest-logo.svg',
    url: 'https://rstest.rs',
    domain: 'rstest.rs',
  },
  {
    name: 'Rslint',
    slug: 'rslint',
    en: 'A high-performance JavaScript and TypeScript linter based on typescript-go',
    zh: '基于 typescript-go 的高性能 JavaScript 和 TypeScript 代码检查工具',
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
  en: 'Config adapters reuse the existing build config from Rsbuild, Rslib, Rspack, or Rstack CLI projects.',
  zh: '配置适配器可以直接复用 Rsbuild、Rslib、Rspack 和 Rstack CLI 项目中已有的构建配置。',
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
      'Skip unused dependency branches when modules are side-effect free, then tree-shake their code',
    ],
  },
  zh: {
    title: '怎么构建，就怎么测试',
    body: '使用 Rspack 和 Rsbuild 编译并运行测试，与应用构建共用同一套工具链',
    points: [
      '在测试中使用 Rsbuild 插件和 Rspack loader',
      '测试运行的就是生产构建出的代码',
      '无副作用时跳过未使用的依赖分支，tree-shaking 移除产物中的无用代码',
    ],
  },
};

const BROWSER: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Real browsers, real DOM',
    body: 'Test code runs in real browsers launched by Playwright, so rendering, interaction, and page results are checked for real',
    points: [
      'Test real layout, computed styles, Canvas, and Web Workers',
      'Query the page with a Playwright-style Locator API',
      'Assert with the auto-waiting expect.element',
    ],
  },
  zh: {
    title: '真实浏览器，真实 DOM',
    body: '测试代码在 Playwright 启动的真实浏览器中执行，渲染、交互和页面结果都来自真实环境',
    points: [
      '覆盖真实的布局、computed style、Canvas 和 Web Worker',
      '使用 Playwright 风格的 Locator API 查询页面',
      '使用自动等待的 expect.element 断言',
    ],
  },
};

const ADAPTER: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Reuse your existing build config',
    body: 'The adapter extracts and converts the config the test build needs, while Rstest still owns the test entry and runtime',
    points: [
      'Reuse plugins, path aliases, and SWC options from your build config',
      'Let frameworks preset setup files and test defaults',
      'No duplicate config to sync or maintain',
    ],
  },
  zh: {
    title: '复用已有的构建配置',
    body: '适配器按需提取并转换测试编译所需的配置项，测试入口和运行时仍由 Rstest 管理',
    points: [
      '复用构建配置中的插件、路径别名和 SWC 等编译选项',
      '由框架预设 setup 脚本、超时时间和测试环境',
      '无需为测试重复配置，减少后续维护负担',
    ],
  },
};

const JEST: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Your Jest tests, unchanged',
    body: 'Assertions, mocks, snapshots, lifecycle hooks, test projects, and coverage follow the Jest and Vitest conventions you already know',
    points: [
      'Familiar describe, test, expect, and snapshot APIs',
      'Enable globals and run existing suites as-is',
      'Add Browser Mode and adapters when you need them',
    ],
  },
  zh: {
    title: '沿用 Jest 测试，无需改写',
    body: '断言、Mock、快照、生命周期钩子、多项目测试和代码覆盖率沿用 Jest、Vitest 的既有习惯',
    points: [
      '熟悉的 describe、test、expect 和 snapshot API',
      '开启 globals，现有用例原样运行',
      '需要时再启用 Browser Mode 和适配器',
    ],
  },
};

const PLAYWRIGHT: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'End-to-end, in the same runner',
    body: "Use Playwright's browser automation inside Rstest to verify complete page and app flows",
    points: [
      'Ready-to-use browser, context, page, and request fixtures',
      'Playwright-style assertions on pages and locators',
      'Share the runner, config, and reporting flow between unit and end-to-end tests',
    ],
  },
  zh: {
    title: '端到端测试，同一个 runner',
    body: '在 Rstest 中直接使用 Playwright 的浏览器自动化能力，验证完整的页面和应用流程',
    points: [
      '开箱即用的 browser、context、page 和 request fixture',
      'Playwright 风格的 page 与 locator 断言',
      '单元测试与端到端测试共享 runner、配置体系和报告流程',
    ],
  },
};

const JEST_DESC = {
  en: 'A Jest- and Vitest-compatible API and CLI, so most suites migrate by switching the runner.',
  zh: '兼容 Jest、Vitest 的常用测试 API 与 CLI，大多数用例只需切换 runner 即可迁移。',
};

const PLAYWRIGHT_DESC = {
  en: 'Drive a local dev server, a build preview, or a deployed app with Playwright.',
  zh: '用 Playwright 验证本地开发服务、构建预览服务或已部署的应用。',
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
  en: 'A unified JavaScript toolchain centered on Rspack, with high performance and consistent architecture.',
  zh: '以 Rspack 为核心的 JavaScript 统一工具链，具有优秀的性能和一致的架构。',
};

// The `subtitle` i18n entry split over two lines, around the accented "Rspack".
const HERO_TITLE = {
  en: ['', '-based', 'Testing Framework'],
  zh: ['由 ', ' 驱动的', '测试框架'],
};

// A short form of the quick start guide's agent prompt; the linked guide holds the steps.
const AGENT_PROMPT =
  'Set up Rstest in this project: https://rstest.rs/guide/start/agent-install.md';

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
      </section>

      <Section index="01" description={t('productionAccurateTestingDesc')}>
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

      <Section index="02" description={t('realBrowserTestingDesc')}>
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

      <Section index="03" description={ADAPTER_DESC[lang]}>
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

      <Section index="04" description={JEST_DESC[lang]}>
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

      <Section index="05" description={PLAYWRIGHT_DESC[lang]}>
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

      <Section index="06">
        <Grid columns="sm:grid-cols-3">
          <Cell title={t('blazingFast')} description={t('blazingFastDesc')} />
          <Cell
            title={t('modernByDefault')}
            description={t('modernByDefaultDesc')}
          />
          <Cell title={t('testingReady')} description={t('testingReadyDesc')} />
        </Grid>
      </Section>

      <Section index="07" description={RSTACK_DESC[lang]}>
        <Grid columns="sm:grid-cols-2">
          {RSTACK_TOOLS.map((tool) => (
            <a
              key={tool.name}
              href={tool.url}
              target="_blank"
              rel="noreferrer"
              data-tool={tool.slug}
              className="rstack-tool group relative grid min-h-[132px] grid-cols-[80px_minmax(0,1fr)] gap-x-5 bg-surface p-5 lg:grid-cols-[96px_minmax(0,1fr)]"
            >
              <div className="relative col-start-1 self-stretch">
                <img
                  src={tool.logo}
                  alt=""
                  className="absolute inset-0 block size-full object-contain object-center"
                />
              </div>
              <div className="col-start-2 flex min-w-0 flex-col gap-y-0.5 self-center">
                <h3 className="text-[24px]/8 font-semibold text-fg">
                  {tool.name}
                </h3>
                <span className="rstack-tool__domain font-mono text-[15px]/[1.5]">
                  {tool.domain}
                </span>
                <p className="min-w-0 text-[15px]/[1.5] text-fg-muted">
                  {tool[lang]}
                </p>
              </div>
            </a>
          ))}
        </Grid>
      </Section>

      <footer className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:py-16">
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <div className="col-span-2 sm:col-span-3 lg:col-span-1">
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
