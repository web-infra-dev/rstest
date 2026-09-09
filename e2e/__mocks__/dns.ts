// Manual mock for the `node:dns` builtin, used to verify that a manual mock of
// a dynamically imported external survives `rs.resetModules()`.
export default { __tag: 'MOCKED_DNS' };
