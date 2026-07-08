// axios-like CJS shape: a callable default with named exports attached.
const instance = () => 'real';
class Axios {}
instance.Axios = Axios;
module.exports = instance;
module.exports.Axios = Axios;
module.exports.default = instance;
