export default async function globalSetup() {
  return () => {
    throw new Error('Global teardown failed intentionally');
  };
}
