import { sayHi } from '@/src';

it('should test source code correctly', () => {
  expect(sayHi()).toBe('hi');
});

it('should can not get document', () => {
  // @ts-expect-error
  expect(global.document).toBeUndefined();
});

it('should generate snapshot correctly', () => {
  expect('hello world').toMatchSnapshot();
});
