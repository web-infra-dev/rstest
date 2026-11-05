export default function globalSetup() {
  return async () => {
    throw new Error('teardown exploded');
  };
}
