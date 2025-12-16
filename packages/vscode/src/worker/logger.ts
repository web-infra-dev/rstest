import { BaseLogger, type LogLevel } from '../shared/logger';
import { masterApi } from '.';

class WorkerLogger extends BaseLogger {
  constructor() {
    super('worker');
  }
  protected log(level: LogLevel, message: string) {
    masterApi.log.asEvent(level, message);
  }
}

export const logger = new WorkerLogger();
