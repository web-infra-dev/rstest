import type { BlogAvatarAuthor } from '@rstack-dev/doc-ui/blog-avatar';
import type { BlogListItem } from '@rstack-dev/doc-ui/blog-list';
import { useLang, usePages } from '@rspress/core/runtime';

const DEFAULT_AUTHOR: BlogAvatarAuthor = {
  name: 'Rstest Team',
  avatar: 'https://assets.rspack.rs/rstest/rstest-logo.svg',
  github: 'https://github.com/web-infra-dev/rstest',
  x: 'https://x.com/rspack_dev',
  title: 'Rstest contributors',
};

type BlogFrontmatter = {
  description?: string;
  date?: string;
  authors?: BlogAvatarAuthor[];
};

const getDateValue = (date?: BlogListItem['date']): number => {
  if (!date) {
    return 0;
  }

  const timestamp = new Date(date).getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const withDefaultAuthor = (page: BlogListItem): BlogListItem => ({
  ...page,
  authors: page.authors?.length ? page.authors : [DEFAULT_AUTHOR],
});

export const useBlogPages = (): BlogListItem[] => {
  const { pages } = usePages();
  const lang = useLang();

  return pages
    .filter((page) => page.lang === lang)
    .filter(
      (page) =>
        page.routePath.includes('/blog/') && !page.routePath.endsWith('/blog/'),
    )
    .map((page) => {
      const frontmatter = (page.frontmatter ?? {}) as BlogFrontmatter;

      return withDefaultAuthor({
        title: page.title,
        description: frontmatter.description,
        date: frontmatter.date,
        href: page.routePath,
        authors: frontmatter.authors,
      });
    })
    .sort((a, b) => getDateValue(b.date) - getDateValue(a.date));
};
