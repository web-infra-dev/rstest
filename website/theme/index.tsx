import { useLang } from '@rspress/core/runtime';
import {
  Layout as BaseLayout,
  getCustomMDXComponent as basicGetCustomMDXComponent,
} from '@rspress/core/theme';
import {
  Search as PluginAlgoliaSearch,
  ZH_LOCALES,
} from '@rspress/plugin-algolia/runtime';
import {
  LlmsContainer,
  LlmsCopyButton,
  LlmsViewOptions,
} from '@rspress/plugin-llms/runtime';
import { NavIcon } from '@rstack-dev/doc-ui/nav-icon';

import { HomeLayout } from './pages';
import './index.scss';

export function getCustomMDXComponent() {
  const { h1: H1, ...mdxComponents } = basicGetCustomMDXComponent();

  const MyH1 = ({ ...props }) => {
    return (
      <>
        <H1 {...props} />
        <LlmsContainer>
          <LlmsCopyButton />
          <LlmsViewOptions />
        </LlmsContainer>
      </>
    );
  };
  return {
    ...mdxComponents,
    h1: MyH1,
  };
}

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

export * from '@rspress/core/theme';
