import './style.css';

const root = document.getElementById('root') ?? document.body;

root.innerHTML = `
  <main class="content">
    <h1>Rstest Playwright Example</h1>
    <p class="message">Built by Rsbuild and tested with Playwright.</p>
  </main>
`;
