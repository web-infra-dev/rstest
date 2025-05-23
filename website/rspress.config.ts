import * as path from 'node:path';
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginGoogleAnalytics } from 'rsbuild-plugin-google-analytics';
import { pluginFontOpenSans } from 'rspress-plugin-font-open-sans';
import { defineConfig } from 'rspress/config';

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  title: 'Rstest',
  icon: 'https://assets.rspack.dev/rstest/rstest-logo.svg',
  logo: 'https://assets.rspack.dev/rstest/rstest-logo.svg',
  logoText: 'Rstest',
  markdown: {
    checkDeadLinks: true,
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
    locales: [
      {
        lang: 'en',
        label: 'English',
        description: 'The Rspack-based testing framework',
        editLink: {
          docRepoBaseUrl:
            'https://github.com/web-infra-dev/rstest/tree/main/website/docs',
          text: '📝 Edit this page on GitHub',
        },
      },
      {
        lang: 'zh',
        label: '简体中文',
        outlineTitle: '目录',
        prevPageText: '上一页',
        nextPageText: '下一页',
        description: '由 Rspack 驱动的测试框架',
        editLink: {
          docRepoBaseUrl:
            'https://github.com/web-infra-dev/rstest/tree/main/website/docs',
          text: '📝 在 GitHub 上编辑此页',
        },
      },
    ],
  },
  plugins: [pluginFontOpenSans()],
  builderConfig: {
    plugins: [
      pluginSass(),
      pluginGoogleAnalytics({
        // cspell:disable-next-line
        id: 'G-9WKFF5YJXQ',
      }),
    ],
  },
});
