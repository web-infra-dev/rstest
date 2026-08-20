export default async function globalSetup() {
  console.log('[mixed-shortcuts-browser-setup] executed');

  return () => {
    console.log('[mixed-shortcuts-browser-teardown] executed');
  };
}
