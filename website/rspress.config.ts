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
  'Rstest is a JavaScript testing framework powered by Rspack';

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
        description: 'Rstest 是由 Rspack 驱动的 JavaScript 测试框架',
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
