import { useLang } from '@rspress/core/runtime';
import { Layout as BaseLayout } from '@rspress/core/theme-original';
import {
  Search as PluginAlgoliaSearch,
  ZH_LOCALES,
} from '@rspress/plugin-algolia/runtime';
import { NavIcon } from '@rstack-dev/doc-ui/nav-icon';

import { HomeLayout } from './pages';
import './index.scss';

const Search = () => {
  const lang = useLang();
  return (
    <PluginAlgoliaSearch
      docSearchProps={{
        appId: 'TRUZL3HFAU', // cspell:disable-line
        apiKey: '3cf720e0589287b96f68a8c7bad7f682', // cspell:disable-line
        indexName: 'rstest',
        searchParameters: {
          facetFilters: [`lang:${lang}`],
        },
      }}
      locales={ZH_LOCALES}
    />
  );
};

const Layout = () => {
  return <BaseLayout beforeNavTitle={<NavIcon />} />;
};

export { Search, Layout, HomeLayout };

export * from '@rspress/core/theme-original';
