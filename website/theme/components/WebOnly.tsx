/**
 * Renders children only on the website HTML pages, omitted from the `.md`
 * plain-text output (SSG-MD build). Counterpart of `MdOnly`.
 */
export function WebOnly({ children }: { children: React.ReactNode }) {
  if (import.meta.env.SSG_MD) {
    return null;
  }
  return <>{children}</>;
}
