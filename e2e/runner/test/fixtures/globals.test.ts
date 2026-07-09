import 'rstest-globals';

it('should run setup correctly', async () => {
  expect(process.env.A).toBe('A');
});
