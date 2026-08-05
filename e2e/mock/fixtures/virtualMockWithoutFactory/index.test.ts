import { rs } from '@rstest/core';
// @ts-expect-error This import is intentionally unresolved.
import 'virtual-without-factory';

rs.mock('virtual-without-factory');
