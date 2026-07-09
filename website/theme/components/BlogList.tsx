import { useLang } from '@rspress/core/runtime';
import { Link, renderInlineMarkdown } from '@rspress/core/theme';
import { BlogBackground } from '@rstack-dev/doc-ui/blog-background';
import { BlogList as BaseBlogList } from '@rstack-dev/doc-ui/blog-list';
import { useBlogPages } from './useBlogPages';

export function BlogList() {
  const lang = useLang();
  const posts = useBlogPages();

  return (
    <>
      <BaseBlogList
        posts={posts}
        lang={lang}
        LinkComp={Link}
        renderInlineMarkdown={renderInlineMarkdown}
      />
      <BlogBackground />
    </>
  );
}
