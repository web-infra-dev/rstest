it('slow test', async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(1).toBe(1);
});
