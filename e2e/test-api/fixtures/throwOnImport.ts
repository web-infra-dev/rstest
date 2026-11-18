const readConfig = (): { port: number } => {
  throw new Error('Missing config file');
};

export const config = readConfig();
