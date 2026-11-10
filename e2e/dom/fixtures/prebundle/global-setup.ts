// @ts-expect-error jsdom types are not installed in this fixture.
import { JSDOM } from 'jsdom';

export default () => {
  const dom = new JSDOM('<p>global setup</p>');
  if (dom.window.document.querySelector('p')?.textContent !== 'global setup') {
    throw new Error('global setup cannot load jsdom');
  }
  dom.window.close();
};
