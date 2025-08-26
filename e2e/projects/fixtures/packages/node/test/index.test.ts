import { sayHi } from '../src/index';

it('should test source code correctly', () => {
  expect(sayHi()).toBe('hi');
});

it('should can not get document', () => {
  expect(global.document).toBeUndefined();
});

it('should generate snapshot correctly', () => {
  expect('hello world').toMatchSnapshot();
});
