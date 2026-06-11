import fs from 'node:fs';

export default class CustomCoverageReporter {
  constructor(options = {}) {
    this.options = options;
  }

  execute(context) {
    const summary = context.getTree('flat').getRoot().getCoverageSummary();
    fs.writeFileSync(
      this.options.outputFile,
      JSON.stringify({ lines: summary.lines.pct }),
    );
  }
}
