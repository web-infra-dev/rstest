import {
  Layout as BaseLayout,
  getCustomMDXComponent as basicGetCustomMDXComponent,
} from '@rspress/core/theme';
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

const Layout = () => {
  return <BaseLayout beforeNavTitle={<NavIcon />} />;
};

export { Layout, HomeLayout };

export * from '@rspress/core/theme';
