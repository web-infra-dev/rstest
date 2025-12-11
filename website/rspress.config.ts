import * as path from 'node:path';
import { pluginSass } from '@rsbuild/plugin-sass';
import { defineConfig } from '@rspress/core';
import { pluginAlgolia } from '@rspress/plugin-algolia';
import { pluginLlms } from '@rspress/plugin-llms';
import { pluginGoogleAnalytics } from 'rsbuild-plugin-google-analytics';
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph';
import { pluginFontOpenSans } from 'rspress-plugin-font-open-sans';
import pluginSitemap from 'rspress-plugin-sitemap';

const siteUrl = 'https://rstest.rs';
const description = 'The Rspack-based testing framework';

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  title: 'Rstest',
  icon: 'https://assets.rspack.rs/rstest/rstest-logo.svg',
  logo: 'https://assets.rspack.rs/rstest/rstest-logo.svg',
  logoText: 'Rstest',
  description:
    'Rstest is a testing framework powered by Rspack. It delivers comprehensive, first-class support for the Rspack ecosystem, enabling seamless integration into existing Rspack-based projects.',
  markdown: {
    link: {
      checkDeadLinks: true,
    },
  },
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
        description: '由 Rspack 驱动的测试框架',
      },
    ],
  },
  plugins: [
    pluginAlgolia({
      verificationContent: '71ECBF977243215D',
    }),
    pluginFontOpenSans(),
    pluginSitemap({
      domain: siteUrl,
    }),
    pluginLlms(),
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
        image: 'https://assets.rspack.rs/rstest/rstest-og-image.png',
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
