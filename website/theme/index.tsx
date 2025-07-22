import { Layout as BaseLayout } from '@rspress/core/theme';
import { NavIcon } from '@rstack-dev/doc-ui/nav-icon';
import { HomeLayout } from './pages';
import './index.scss';

const Layout = () => {
  return <BaseLayout beforeNavTitle={<NavIcon />} />;
};

export { Layout, HomeLayout };

export * from '@rspress/core/theme';
