/**
 * Renders children only in the `.md` plain-text output (SSG-MD build),
 * invisible on the website HTML pages.
 */
export function MdOnly({ children }: { children: React.ReactNode }) {
  if (import.meta.env.SSG_MD) {
    return <>{children}</>;
  }
  return null;
}
