export type StatsModule = {
  nameForCondition?: string;
  children?: StatsModule[];
};

export type StatsChunk = {
  id?: string | number;
  names?: string[];
  hash?: string;
  files?: string[];
  modules?: StatsModule[];
};
