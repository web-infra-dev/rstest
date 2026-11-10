export default () => {
  if (
    Object.getOwnPropertyNames(globalThis).some((key) =>
      key.startsWith('@rstest/environment/'),
    )
  ) {
    throw new Error(
      'globalSetup without DOM imports must not install the bridge',
    );
  }
  console.log('globalSetup without DOM imports completed');
};
