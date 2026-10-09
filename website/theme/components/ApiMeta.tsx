import { Link } from '@rspress/core/theme';
import styles from './ApiMeta.module.scss';

export interface ApiMetaProps {
  addedVersion?: string;
  deprecatedVersion?: string;
  removedVersion?: string;
  inline?: boolean;
  /** Render a compact superscript marker for use inside a sentence. */
  sup?: boolean;
}

export function ApiMeta(props: ApiMetaProps) {
  const tagStyle = props.inline ? styles.tagInline : styles.tag;
  const wrapperStyle = props.inline ? styles.wrapperInline : styles.wrapper;

  const getGitTagHref = (version: string) =>
    `https://github.com/web-infra-dev/rstest/releases/tag/v${version.replace('v', '')}`;

  if (props.sup) {
    return (
      <>
        {props.addedVersion && (
          <sup className={`${styles.sup} ${styles.supAdded} rp-not-doc`}>
            <Link
              href={getGitTagHref(props.addedVersion)}
              title={`Introduced in v${props.addedVersion}`}
              aria-label={`Introduced in v${props.addedVersion}`}
            >
              v{props.addedVersion}
            </Link>
          </sup>
        )}
        {props.deprecatedVersion && (
          <sup
            className={`${styles.sup} ${styles.supDeprecated} rp-not-doc`}
            title={`Deprecated in v${props.deprecatedVersion}`}
          >
            v{props.deprecatedVersion}
          </sup>
        )}
        {props.removedVersion && (
          <sup
            className={`${styles.sup} ${styles.supRemoved} rp-not-doc`}
            title={`Removed in v${props.removedVersion}`}
          >
            v{props.removedVersion}
          </sup>
        )}
      </>
    );
  }

  return (
    <div className={`${wrapperStyle} rp-not-doc`}>
      {props.addedVersion && (
        <span className={`${tagStyle} ${styles.added}`}>
          <Link href={getGitTagHref(props.addedVersion)}>
            Added in v{props.addedVersion}
          </Link>
        </span>
      )}
      {props.deprecatedVersion && (
        <span className={`${tagStyle} ${styles.deprecated}`}>
          Deprecated in v{props.deprecatedVersion}
        </span>
      )}
      {props.removedVersion && (
        <span className={`${tagStyle} ${styles.removed}`}>
          Removed in v{props.removedVersion}
        </span>
      )}
    </div>
  );
}
