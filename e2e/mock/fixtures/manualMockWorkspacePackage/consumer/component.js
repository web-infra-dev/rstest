const {
  makeStyles,
} = require('@rstest/test-mock-manual-mock-workspace-package-styles-lib');

const useCardStyles = makeStyles(() => ({ real: true }));

function getCardStyles() {
  // If `makeStyles` is replaced by an automatic mock (a bare rs.fn() with no
  // implementation), it returns `undefined` instead of a function, so calling
  // `useCardStyles()` below throws "useCardStyles is not a function".
  return useCardStyles();
}

module.exports = { getCardStyles };
