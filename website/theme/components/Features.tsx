import { useI18n } from '@rspress/core/runtime';
import {
  containerStyle,
  innerContainerStyle,
} from '@rstack-dev/doc-ui/section-style';
import { HomeFeature } from '@theme';
import './Features.module.scss';

export function Features() {
  const t = useI18n<typeof import('i18n')>();
  const features = [
    {
      title: t('reuseBuildConfig'),
      details: t('reuseBuildConfigDesc'),
      icon: '♻️',
    },
    {
      title: t('productionAccurateTesting'),
      details: t('productionAccurateTestingDesc'),
      icon: '🎯',
    },
    {
      title: t('blazingFast'),
      details: t('blazingFastDesc'),
      icon: '⚡',
    },
    {
      title: t('modernByDefault'),
      details: t('modernByDefaultDesc'),
      icon: '🧠',
    },
    {
      title: t('testingReady'),
      details: t('testingReadyDesc'),
      icon: '🧰',
    },
    {
      title: t('realBrowserTesting'),
      details: t('realBrowserTestingDesc'),
      icon: '🌐',
    },
  ];

  return (
    <section className={containerStyle}>
      <div className={innerContainerStyle}>
        <HomeFeature features={features} />
      </div>
    </section>
  );
}
