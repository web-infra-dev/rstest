import { useI18n, useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme-original';
import { version } from '../../../packages/core/package.json';
import { useI18nUrl } from '../components/utils';
import { AdaptersPatchFigure } from '../ui/AdaptersPatchFigure';
import { BrowserStackFigure } from '../ui/BrowserStackFigure';
import { JestMigrateFigure } from '../ui/JestMigrateFigure';
import { PipelineStackFigure } from '../ui/PipelineStackFigure';
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

const ADAPTER_BODY = {
  en: 'Point Rstest at your Rsbuild, Rslib, or Rspack config and keep one source of truth.',
  zh: '让 Rstest 直接复用 Rsbuild、Rslib 或 Rspack 的配置，只维护一份。',
};

const ADAPTER_POINTS = {
  en: [
    'Reuse path aliases and global variables from your build config',
    'Let frameworks preset setup files and test defaults',
    'No more syncing settings by hand across tools',
  ],
  zh: [
    '复用构建配置中的路径别名和全局变量',
    '由框架预设 setup 脚本、超时时间和测试环境',
    '无需在不同工具之间手动同步配置',
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

const ADAPTER_TITLE = {
  en: 'Reuse the config you already have',
  zh: '复用你已有的配置',
};

const BODY = 'mt-3 text-[15px]/[1.7] text-fg-muted';

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
            title={t('productionAccurateTesting')}
            href={tUrl('/guide/start/')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
          >
            <p className={BODY}>{PIPELINE_BODY[lang]}</p>
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
            title={t('realBrowserTesting')}
            href={tUrl('/guide/browser-testing/')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
            className="lg:order-2"
          >
            <p className={BODY}>{BROWSER_MODE_BODY[lang]}</p>
          </FeatureText>
          <BrowserStackFigure className="lg:order-1" />
        </Grid>
      </Section>

      <Section index="03" eyebrow="Adapters" description={ADAPTER_DESC[lang]}>
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={ADAPTER_TITLE[lang]}
            href={tUrl('/guide/advanced/adapters')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
          >
            <p className={BODY}>{ADAPTER_BODY[lang]}</p>
            <ul className="mt-5 space-y-2.5">
              {ADAPTER_POINTS[lang].map((point) => (
                <li
                  key={point}
                  className="flex gap-3 text-[15px]/[1.5] text-fg before:mt-[0.6em] before:size-1 before:shrink-0 before:rounded-full before:bg-fg-subtle"
                >
                  {point}
                </li>
              ))}
            </ul>
          </FeatureText>
          <AdaptersPatchFigure />
        </Grid>
      </Section>

      <Section
        index="04"
        eyebrow="Jest compatible"
        description={JEST_COMPAT[lang].desc}
      >
        {/* Zigzag: animation-left / text-right on desktop, text-first in DOM. */}
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={JEST_COMPAT[lang].title}
            href={tUrl('/guide/migration/jest')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
            className="lg:order-2"
          >
            <p className={BODY}>{JEST_COMPAT[lang].body}</p>
          </FeatureText>
          <JestMigrateFigure className="lg:order-1" />
        </Grid>
      </Section>

      <Section
        index="05"
        eyebrow="Playwright E2E"
        description={PLAYWRIGHT[lang].desc}
      >
        <Grid columns="lg:grid-cols-2">
          <FeatureText
            title={PLAYWRIGHT[lang].title}
            href={tUrl('/guide/basic/e2e-testing')}
            linkLabel={LEARN_MORE[lang]}
            LinkComp={Link}
          >
            <p className={BODY}>{PLAYWRIGHT[lang].body}</p>
          </FeatureText>
          <FeatureVisual />
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
