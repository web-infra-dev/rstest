let b: string;

export const getB = () => {
  if (!b) {
    b = Math.ceil(Math.random() * 1000).toString();
  }
  return b;
};
