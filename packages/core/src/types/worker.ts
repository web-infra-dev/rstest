export type EntryInfo = {
  filePath: string;
  originPath: string;
};

export type RunnerRPC = void;
export type RuntimeRPC = {
  readFile: (filename: string) => string;
};

export type RunWorkerOptions = {
  options: {
    entryInfo: EntryInfo;
  };
  rpcMethods: RuntimeRPC;
};
