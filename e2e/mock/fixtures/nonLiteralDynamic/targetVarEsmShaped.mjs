import * as ns from './esmShapedDep.mjs';

export const probe = () => ns.tag;
export const hasDefault = () => 'default' in ns;
