type WorkerState = {
  environment: string;
  filePath: string;
};

let _workerState: WorkerState | undefined;

export function setWorkerState(workerState: WorkerState): void {
  _workerState = workerState;
}

export function getWorkerState(): WorkerState {
  return _workerState as WorkerState;
}
