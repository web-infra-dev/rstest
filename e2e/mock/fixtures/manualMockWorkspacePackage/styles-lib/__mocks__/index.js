// Manual mock, colocated inside styles-lib's OWN package directory. This is Jest's documented
// convention for mocking a node_modules / workspace package: place the mock at
// `<package>/__mocks__/<entry-file>` and it is picked up automatically for a bare
// `jest.mock("styles-lib")` call in any consumer, without a factory.
exports.makeStyles = function makeStyles() {
  return function useStyles() {
    return { mocked: true };
  };
};
