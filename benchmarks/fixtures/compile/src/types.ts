export type ScenarioSeed = {
  name: string;
  imports: string[];
};

export type ScenarioRecord = {
  name: string;
  dependencyCount: number;
  reachableModuleCount: number;
  bucket: 'leaf' | 'branch' | 'entry';
};

export type ScenarioGroup = {
  bucket: ScenarioRecord['bucket'];
  names: string[];
  totalDependencies: number;
  totalReachableModules: number;
};
