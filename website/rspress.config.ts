import path from 'node:path';
import { pluginSass } from '@rsbuild/plugin-sass';
import { defineConfig } from '@rspress/core';
import { pluginAlgolia } from '@rspress/plugin-algolia';
import { pluginClientRedirects } from '@rspress/plugin-client-redirects';
import { pluginGoogleAnalytics } from 'rsbuild-plugin-google-analytics';
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph';
import { pluginFontOpenSans } from 'rspress-plugin-font-open-sans';
import pluginSitemap from 'rspress-plugin-sitemap';

const siteUrl = 'https://rstest.rs';
const description =
  'Rstest is a fast, modern JavaScript testing framework powered by Rspack';

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  title: 'Rstest',
  icon: 'https://assets.rspack.rs/rstest/rstest-logo.svg',
  logo: 'https://assets.rspack.rs/rstest/rstest-logo.svg',
  logoText: 'Rstest',
  description,
  markdown: {
    link: {
      checkAnchors: true,
      checkDeadLinks: true,
    },
  },
  llms: true,
  search: {
    codeBlocks: true,
  },
  lang: 'en',
  route: {
    cleanUrls: true,
    // exclude document fragments from routes
    exclude: ['**/zh/shared/**', '**/en/shared/**', './theme'],
  },
  themeConfig: {
    llmsUI: {
      placement: 'outline',
    },
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/web-infra-dev/rstest',
      },
      {
        icon: 'x',
        mode: 'link',
        content: 'https://twitter.com/rspack_dev',
      },
      {
        icon: 'discord',
        mode: 'link',
        content: 'https://discord.gg/XsaKEEk4mW',
      },
    ],
    editLink: {
      docRepoBaseUrl:
        'https://github.com/web-infra-dev/rstest/tree/main/website/docs',
    },
    locales: [
      {
        lang: 'en',
        label: 'English',
        description,
      },
      {
        lang: 'zh',
        label: '简体中文',
        description: 'Rstest 是由 Rspack 驱动的快速、现代 JavaScript 测试框架',
      },
    ],
  },
  plugins: [
    pluginAlgolia({
      verificationContent: '71ECBF977243215D',
    }),
    pluginClientRedirects({
      redirects: [
        {
          from: '/guide/advanced/debugging',
          to: '/guide/debug/debugging',
        },
        {
          from: '/guide/advanced/profiling',
          to: '/guide/debug/profiling',
        },
        {
          from: '/guide/advanced/troubleshooting',
          to: '/guide/debug/troubleshooting',
        },
        {
          from: '/guide/basic/metadata',
          to: '/guide/advanced/metadata',
        },
        {
          from: '/guide/basic/scoped-cleanup',
          to: '/guide/advanced/scoped-cleanup',
        },
        {
          from: '/guide/integration/adapters',
          to: '/guide/advanced/adapters',
        },
        {
          from: '^/guide/integration$',
          to: '/integration/module-federation',
        },
        {
          from: '/guide/integration/module-federation',
          to: '/integration/module-federation',
        },
        {
          from: '/guide/integration/playwright',
          to: '/integration/playwright',
        },
        {
          from: '/guide/integration/rslint',
          to: '/integration/rslint',
        },
        {
          from: '/guide/integration/rslib',
          to: '/integration/rslib',
        },
        {
          from: '/guide/integration/rslib/reference',
          to: '/integration/rslib/reference',
        },
        {
          from: '/guide/integration/rsbuild',
          to: '/integration/rsbuild',
        },
        {
          from: '/guide/integration/rsbuild/reference',
          to: '/integration/rsbuild/reference',
        },
        {
          from: '/guide/integration/rspack',
          to: '/integration/rspack',
        },
        {
          from: '/guide/integration/rspack/reference',
          to: '/integration/rspack/reference',
        },
        {
          from: '/guide/advanced/playwright',
          to: '/integration/playwright',
        },
        {
          from: '/zh/guide/advanced/debugging',
          to: '/zh/guide/debug/debugging',
        },
        {
          from: '/zh/guide/advanced/profiling',
          to: '/zh/guide/debug/profiling',
        },
        {
          from: '/zh/guide/advanced/troubleshooting',
          to: '/zh/guide/debug/troubleshooting',
        },
        {
          from: '/zh/guide/basic/metadata',
          to: '/zh/guide/advanced/metadata',
        },
        {
          from: '/zh/guide/basic/scoped-cleanup',
          to: '/zh/guide/advanced/scoped-cleanup',
        },
        {
          from: '/zh/guide/integration/adapters',
          to: '/zh/guide/advanced/adapters',
        },
        {
          from: '^/zh/guide/integration$',
          to: '/zh/integration/module-federation',
        },
        {
          from: '/zh/guide/integration/module-federation',
          to: '/zh/integration/module-federation',
        },
        {
          from: '/zh/guide/integration/playwright',
          to: '/zh/integration/playwright',
        },
        {
          from: '/zh/guide/integration/rslint',
          to: '/zh/integration/rslint',
        },
        {
          from: '/zh/guide/integration/rslib',
          to: '/zh/integration/rslib',
        },
        {
          from: '/zh/guide/integration/rslib/reference',
          to: '/zh/integration/rslib/reference',
        },
        {
          from: '/zh/guide/integration/rsbuild',
          to: '/zh/integration/rsbuild',
        },
        {
          from: '/zh/guide/integration/rsbuild/reference',
          to: '/zh/integration/rsbuild/reference',
        },
        {
          from: '/zh/guide/integration/rspack',
          to: '/zh/integration/rspack',
        },
        {
          from: '/zh/guide/integration/rspack/reference',
          to: '/zh/integration/rspack/reference',
        },
        {
          from: '/zh/guide/advanced/playwright',
          to: '/zh/integration/playwright',
        },
      ],
    }),
    pluginFontOpenSans(),
    pluginSitemap({
      domain: siteUrl,
    }),
  ],
  head: [
    ({ routePath }) => {
      const getOgImage = () => {
        const match = routePath.match(/blog\/announcing-(\d+-\d+)$/);
        if (match) {
          return `rstest-og-image-v${match[1]}.png`;
        }
        return 'rstest-og-image.png';
      };
      return `<meta property="og:image" content="https://assets.rspack.rs/rstest/${getOgImage()}">`;
    },
  ],
  builderConfig: {
    plugins: [
      pluginSass(),
      pluginGoogleAnalytics({
        // cspell:disable-next-line
        id: 'G-9WKFF5YJXQ',
      }),
      pluginOpenGraph({
        title: 'Rstest',
        type: 'website',
        url: siteUrl,
        description,
        twitter: {
          site: '@rspack_dev',
          card: 'summary_large_image',
        },
      }),
    ],
    performance: {
      printFileSize: {
        total: true,
        detail: false,
        compressed: false,
      },
    },
  },
});
