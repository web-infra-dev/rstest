export default () => {
  if (
    Object.getOwnPropertyNames(globalThis).some((key) =>
      key.startsWith('@rstest/jsdom/'),
    )
  ) {
    throw new Error('globalSetup without jsdom must not install the bridge');
  }
  console.log('globalSetup without jsdom completed');
};
