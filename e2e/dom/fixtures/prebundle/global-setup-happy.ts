import { Window } from 'happy-dom';

export default () => {
  const win = new Window();
  try {
    win.document.body.innerHTML = '<p>global setup</p>';
    if (win.document.querySelector('p')?.textContent !== 'global setup') {
      throw new Error('global setup cannot load happy-dom');
    }
  } finally {
    win.close();
  }
};
