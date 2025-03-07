import path from 'node:path';
import { glob } from 'tinyglobby';

export const getTestEntries = async ({
  include,
  exclude,
  root,
}: {
  include: string[];
  exclude: string[];
  root: string;
}): Promise<{
  [name: string]: string;
}> => {
  const entries = await glob(include, {
    cwd: root,
    absolute: true,
    ignore: exclude,
    dot: true,
    expandDirectories: false,
  });

  return Object.fromEntries(
    entries.map((entry) => {
      const name = path.relative(root, entry);
      return [name, entry];
    }),
  );
};
