import { useI18n, useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme-original';
import { type MouseEvent, type ReactNode, useState } from 'react';
import { useI18nUrl } from '../components/utils';
import { AdaptersPatchFigure } from '../ui/AdaptersPatchFigure';
import { BrowserStackFigure } from '../ui/BrowserStackFigure';
import { HeroDitherMatrix } from '../ui/HeroDitherMatrix';
import { JestMigrateFigure } from '../ui/JestMigrateFigure';
import { PipelineStackFigure } from '../ui/PipelineStackFigure';
import { PlaywrightBeltFigure } from '../ui/PlaywrightBeltFigure';
import { PopperFigure } from '../ui/PopperFigure';
import {
  Button,
  FeatureLink,
  HatchBand,
  InstallCommand,
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

const HERO_ANCHORS: Record<
  'en' | 'zh',
  { href: string; title: string; desc: string }[]
> = {
  en: [
    {
      href: '#pipeline',
      title: 'Rspack Pipeline',
      desc: 'Rust-fast compilation sharing Rsbuild plugins and config',
    },
    {
      href: '#browser',
      title: 'Real Browsers',
      desc: 'Chromium, Firefox, and WebKit with Locator assertions',
    },
    {
      href: '#adapters',
      title: 'Build Adapters',
      desc: 'Reuse Rsbuild, Rslib, Rspack, Lynx, and Modern.js configs',
    },
    {
      href: '#playwright',
      title: 'Playwright E2E',
      desc: 'Unit, component, and end-to-end tests in one runner',
    },
  ],
  zh: [
    {
      href: '#pipeline',
      title: 'Rspack 构建链路',
      desc: '复用 Rsbuild 插件与配置，测试编译极速完成',
    },
    {
      href: '#browser',
      title: '真实浏览器 DOM',
      desc: '在 Chromium、Firefox 与 WebKit 中运行组件测试',
    },
    {
      href: '#adapters',
      title: '复用构建配置',
      desc: '通过适配器无缝复用 Rsbuild、Rslib、Rspack 等配置',
    },
    {
      href: '#playwright',
      title: '端到端同一 Runner',
      desc: '单元测试与 Playwright E2E 共享配置与报告流程',
    },
  ],
};

type Feature = { title: string; body: string; points: string[] };

const PIPELINE: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'Rspack speed, Rsbuild ecosystem',
    body: 'Tests are compiled by Rspack and share the config and plugin system of Rsbuild, ready out of the box and easy to extend',
    points: [
      'Fast compilation powered by Rust-based Rspack and SWC',
      'Compatible with Rsbuild plugins like React and Sass',
      'Shares Rsbuild and Rspack config options directly',
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

const ECOSYSTEM: Record<'en' | 'zh', Feature> = {
  en: {
    title: 'A modern testing framework',
    body: 'One framework for Node.js, jsdom, and real browsers',
    points: [
      'TypeScript, CSS, and more work out of the box',
      'Component testing for mainstream frameworks',
      'Loads real Module Federation remotes instead of mocks',
    ],
  },
  zh: {
    title: '现代测试框架',
    body: '从 Node.js 到 jsdom 与真实浏览器，一个框架全部覆盖',
    points: [
      'TypeScript、CSS 等开箱即用',
      '支持主流框架的组件测试',
      '加载真实的 Module Federation 远程模块，无需 mock',
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
      'Reuse plugins, aliases, and SWC options from build config',
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
      'Unit and E2E tests share one runner, config, and reporter',
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

const HERO_TITLE = {
  en: ['', '-based', 'Testing Framework'],
  zh: ['基于 ', ' 的', '测试框架'],
};

// A short form of the quick start guide's agent prompt; the linked guide holds the steps.
const AGENT_PROMPT =
  'Set up Rstest in this project: https://rstest.rs/guide/start/agent-install.md';

const HERO_GRID_ROW_TRACKS = 'grid-rows-[repeat(7,92px)]';
const HERO_GRID_ROWS = Array.from({ length: 7 }, (_, i) => i);
const HERO_GRID_COL_CLASSES = Array.from({ length: 12 }, (_, i) => {
  if (i >= 8) return 'hidden lg:block';
  if (i >= 6) return 'hidden sm:block';
  return '';
});

function HeroGridColCells() {
  return (
    <>
      {HERO_GRID_COL_CLASSES.map((className, i) => (
        <div key={i} className={className} />
      ))}
    </>
  );
}

/**
 * True 1px CSS grid overlays behind the Hero: the prompt row merges its spanned
 * cells horizontally so no vertical lines cut through InstallCommand.
 */
function HeroGridOverlay() {
  return (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 grid ${HERO_GRID_ROW_TRACKS}`}
      >
        <div className="row-start-1 row-span-4 grid grid-cols-6 divide-x divide-[var(--home-grid-line)] sm:row-span-5 sm:grid-cols-8 lg:grid-cols-12">
          <HeroGridColCells />
        </div>
        <div className="row-start-5 row-span-2 hidden divide-x divide-[var(--home-grid-line)] sm:row-start-6 sm:row-span-1 sm:grid sm:grid-cols-8 lg:hidden">
          <div />
          <div className="col-span-6" />
          <div />
        </div>
        <div className="row-start-6 row-span-1 hidden grid-cols-12 divide-x divide-[var(--home-grid-line)] lg:grid">
          <div />
          <div />
          <div className="col-span-8" />
          <div />
          <div />
        </div>
        <div className="row-start-7 row-span-1 grid grid-cols-6 divide-x divide-[var(--home-grid-line)] sm:grid-cols-8 lg:grid-cols-12">
          <HeroGridColCells />
        </div>
      </div>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 grid divide-y divide-[var(--home-grid-line)] ${HERO_GRID_ROW_TRACKS}`}
      >
        {HERO_GRID_ROWS.map((i) => (
          <div key={i} />
        ))}
      </div>
    </>
  );
}

const LEARN_MORE = { en: 'Learn more', zh: '了解更多' };

function FeaturePoints({ points }: { points: string[] }) {
  return (
    <ul className="mt-5 space-y-2.5">
      {points.map((point) => (
        <li
          key={point}
          className="flex items-start gap-2.5 text-[15px]/[1.55] text-fg"
        >
          <span
            aria-hidden
            className="mt-[0.68em] h-[2px] w-2 shrink-0 bg-brand"
          />
          <span>{point}</span>
        </li>
      ))}
    </ul>
  );
}

function scrollToAnchor(event: MouseEvent<HTMLAnchorElement>, href: string) {
  const target = document.getElementById(href.slice(1));
  if (!target) return;
  event.preventDefault();
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  target.scrollIntoView({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  });
  history.replaceState(null, '', href);
}

function GridFeatureCell({
  id,
  feature,
  href,
  linkLabel,
  figure,
}: {
  id: string;
  feature: Feature;
  href: string;
  linkLabel: string;
  figure: ReactNode;
}) {
  return (
    <article id={id} className="flex scroll-mt-20 flex-col bg-[var(--home-bg)]">
      <div className="home-stage relative flex h-[268px] items-center justify-center overflow-hidden border-b border-[var(--home-border)] sm:h-[308px]">
        {figure}
      </div>
      <div className="flex flex-1 flex-col px-6 py-6 sm:px-8 sm:py-7">
        <h2 className="text-[24px]/[1.2] font-semibold tracking-[-0.025em] text-fg sm:text-[26px]">
          {feature.title}
        </h2>
        <p className="mt-3 text-[16px]/[1.6] text-fg-muted">{feature.body}</p>
        <FeaturePoints points={feature.points} />
        <div className="mt-auto pt-6">
          <FeatureLink href={href} label={linkLabel} LinkComp={Link} />
        </div>
      </div>
    </article>
  );
}

export function HomeLayout() {
  const t = useI18n<typeof import('i18n')>();
  const tUrl = useI18nUrl();
  const lang = useLang() === 'zh' ? 'zh' : 'en';
  const [heroPulse, setHeroPulse] = useState(0);

  return (
    <main className="rstest-home relative isolate">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="border-x border-[var(--home-border)]">
          <div className="relative overflow-hidden bg-[var(--home-bg)]">
            <HeroGridOverlay />
            <HeroDitherMatrix pulse={heroPulse} />
            <div
              className={`relative z-10 grid grid-cols-6 text-center sm:grid-cols-8 lg:grid-cols-12 ${HERO_GRID_ROW_TRACKS}`}
            >
              <div className="col-span-6 row-start-2 row-span-3 flex flex-col items-center justify-center px-6 sm:contents">
                <div className="sm:col-span-8 sm:row-start-2 sm:row-span-2 sm:flex sm:items-center sm:justify-center sm:px-10 lg:col-span-12">
                  <h1 className="text-[36px]/[1.05] font-semibold tracking-[-0.055em] sm:text-[66px]/[1.0] lg:text-[76px]/[0.98]">
                    <span className="block text-fg">
                      {HERO_TITLE[lang][0]}
                      <span className="text-brand">Rspack</span>
                      {HERO_TITLE[lang][1]}
                    </span>
                    <span className="home-hero-sub mt-1.5 block">
                      {HERO_TITLE[lang][2]}
                    </span>
                  </h1>
                </div>
                <div className="mt-4 sm:col-span-8 sm:row-start-4 sm:row-span-1 sm:mt-0 sm:flex sm:items-center sm:justify-center sm:px-10 lg:col-span-12">
                  <p className="max-w-2xl text-[15px]/[1.55] text-fg-muted sm:text-[19px]/[1.55]">
                    {t('slogan')}
                  </p>
                </div>
                <div className="mt-5 flex flex-wrap justify-center gap-3 sm:col-span-8 sm:row-start-5 sm:row-span-1 sm:mt-0 sm:items-center sm:px-10 lg:col-span-12">
                  <Button
                    href={tUrl('/guide/start/quick-start')}
                    LinkComp={Link}
                  >
                    <span>{t('quickStart')}</span>
                    <span
                      aria-hidden
                      className="transition-transform duration-150 group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </Button>
                  <Button
                    href="https://github.com/web-infra-dev/rstest"
                    variant="secondary"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="size-4 fill-current"
                      aria-hidden
                    >
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
                    </svg>
                    <span>GitHub</span>
                  </Button>
                </div>
              </div>
              <div className="col-span-6 row-start-5 row-span-2 sm:col-start-2 sm:col-span-6 sm:row-start-6 sm:row-span-1 lg:col-start-3 lg:col-span-8">
                <InstallCommand
                  prompt={AGENT_PROMPT}
                  args="add @rstest/core -D"
                  onCopy={() => setHeroPulse((n) => n + 1)}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px border-t border-[var(--home-border)] bg-[var(--home-border)] sm:grid-cols-2 lg:grid-cols-4">
            {HERO_ANCHORS[lang].map((anchor) => (
              <a
                key={anchor.href}
                href={anchor.href}
                onClick={(event) => scrollToAnchor(event, anchor.href)}
                className="home-anchor group flex flex-col gap-1.5 px-6 py-5 sm:px-8 sm:py-6"
              >
                <span
                  aria-hidden
                  className="absolute top-4 right-4 font-mono text-[13px]/none text-brand transition-transform duration-150 group-hover:translate-x-0.5 group-hover:translate-y-0.5"
                >
                  ↘
                </span>
                <h2 className="pr-5 text-[15px]/[1.35] font-semibold tracking-[-0.015em] text-fg">
                  {anchor.title}
                </h2>
                <p className="text-[14px]/[1.55] text-fg-muted">
                  {anchor.desc}
                </p>
              </a>
            ))}
          </div>
        </section>
      </div>

      <HatchBand />

      <section className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-px border-x border-[var(--home-border)] bg-[var(--home-border)] lg:grid-cols-2">
          <GridFeatureCell
            id="ecosystem"
            feature={ECOSYSTEM[lang]}
            href={tUrl('/guide/start/features')}
            linkLabel={LEARN_MORE[lang]}
            figure={<PopperFigure className="w-full" />}
          />
          <GridFeatureCell
            id="pipeline"
            feature={PIPELINE[lang]}
            href={tUrl('/guide/start/')}
            linkLabel={LEARN_MORE[lang]}
            figure={<PipelineStackFigure className="w-full" />}
          />
          <GridFeatureCell
            id="browser"
            feature={BROWSER[lang]}
            href={tUrl('/guide/browser-testing/')}
            linkLabel={LEARN_MORE[lang]}
            figure={<BrowserStackFigure className="w-full" />}
          />
          <GridFeatureCell
            id="adapters"
            feature={ADAPTER[lang]}
            href={tUrl('/guide/advanced/adapters')}
            linkLabel={LEARN_MORE[lang]}
            figure={<AdaptersPatchFigure className="w-full" />}
          />
          <GridFeatureCell
            id="jest"
            feature={JEST[lang]}
            href={tUrl('/guide/migration/jest')}
            linkLabel={LEARN_MORE[lang]}
            figure={<JestMigrateFigure className="w-full" />}
          />
          <GridFeatureCell
            id="playwright"
            feature={PLAYWRIGHT[lang]}
            href={tUrl('/guide/basic/e2e-testing')}
            linkLabel={LEARN_MORE[lang]}
            figure={<PlaywrightBeltFigure className="w-full" />}
          />
        </div>
      </section>

      <HatchBand />

      <section className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="border-x border-[var(--home-border)]">
          <div className="border-b border-[var(--home-border)] px-6 py-6 sm:px-8 sm:py-7">
            <p className="font-mono text-[14px] font-medium tracking-[0.04em] text-brand">
              Rstack
            </p>
            <h2 className="mt-2.5 text-[24px]/[1.2] font-semibold tracking-[-0.03em] text-fg sm:text-[28px]">
              {RSTACK_DESC[lang]}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-px bg-[var(--home-border)] sm:grid-cols-2 lg:grid-cols-4">
            {RSTACK_TOOLS.map((tool) => {
              const isCurrent = tool.slug === 'rstest';
              return (
                <a
                  key={tool.name}
                  href={tool.url}
                  target="_blank"
                  rel="noreferrer"
                  data-tool={tool.slug}
                  data-current={isCurrent ? 'true' : undefined}
                  className="rstack-tool group flex flex-col px-6 py-6 sm:px-8 sm:py-7"
                >
                  {isCurrent ? (
                    <span
                      aria-hidden
                      className="absolute top-5 right-5 size-1.5 rounded-full bg-brand"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="absolute top-4 right-4 font-mono text-[13px]/none text-fg-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-fg"
                    >
                      ↗
                    </span>
                  )}
                  <img
                    src={tool.logo}
                    alt=""
                    className="size-9 shrink-0 object-contain"
                  />
                  <div className="mt-5 flex flex-col gap-0.5">
                    <h3 className="text-[16px]/[1.3] font-semibold tracking-[-0.015em] text-fg">
                      {tool.name}
                    </h3>
                    <span className="rstack-tool__domain font-mono text-[13px]/[1.5]">
                      {tool.domain}
                    </span>
                  </div>
                  <p className="mt-2.5 text-[14px]/[1.55] text-fg-muted">
                    {tool[lang]}
                  </p>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <HatchBand />

      <footer>
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="border-x border-[var(--home-border)]">
            <div className="grid grid-cols-1 gap-px bg-[var(--home-border)] sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-[var(--home-bg)] px-6 py-8 sm:px-8 sm:py-10">
                <a
                  href={tUrl('/')}
                  className="inline-flex items-center gap-2.5"
                  aria-label="Rstest"
                >
                  <img src={FOOTER_LOGO} alt="" className="size-7" />
                  <span className="text-[16px] font-semibold text-fg">
                    Rstest
                  </span>
                </a>
                <p className="mt-4 text-[14px]/[1.65] text-fg-muted">
                  {t('slogan')}
                </p>
              </div>
              {FOOTER_COLUMNS[lang].map((column) => (
                <div
                  key={column.title}
                  className="bg-[var(--home-bg)] px-6 py-8 sm:px-8 sm:py-10"
                >
                  <h3 className="text-[14px] font-semibold text-fg">
                    {column.title}
                  </h3>
                  <ul className="mt-3.5 space-y-2.5">
                    {column.links.map((link) => {
                      const isExternal = link.href.startsWith('http');
                      return (
                        <li key={link.label}>
                          <a
                            href={isExternal ? link.href : tUrl(link.href)}
                            {...(isExternal
                              ? { target: '_blank', rel: 'noreferrer' }
                              : {})}
                            className="text-[14px] text-fg-muted transition-colors hover:text-fg"
                          >
                            {link.label}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-[var(--home-border)] px-6 py-5 text-[13px] text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-8">
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
        </div>
      </footer>
    </main>
  );
}
