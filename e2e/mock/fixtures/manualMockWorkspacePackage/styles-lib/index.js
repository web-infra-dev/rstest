// Real implementation. Represents a shared design-system package (like the real-world
// @msteams/components-teams-fluent-ui) that exports a `makeStyles`-style factory: it takes a
// style-definitions function and returns a "useStyles" hook.
exports.makeStyles = function makeStyles(definitionsFn) {
  return function useStyles() {
    return definitionsFn();
  };
};
