let a: string;

export const getA = () => {
  if (!a) {
    a = Math.ceil(Math.random() * 1000).toString();
  }
  return a;
};
