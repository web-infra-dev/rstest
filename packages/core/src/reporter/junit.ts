import { writeFile } from 'node:fs/promises';
import { relative } from 'pathe';
import stripAnsi from 'strip-ansi';
import type {
  Duration,
  GetSourcemap,
  Reporter,
  TestFileResult,
  TestResult,
} from '../types';
import { getTaskNameWithPrefix } from '../utils';
import { formatStack, parseErrorStacktrace } from '../utils/error';

interface JUnitTestCase {
  name: string;
  classname: string;
  time: number;
  status: string;
  errors?: {
    message: string;
    type: string;
    details?: string;
  }[];
}

interface JUnitTestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  timestamp: string;
  testcases: JUnitTestCase[];
}

interface JUnitReport {
  testsuites: {
    name: string;
    tests: number;
    failures: number;
    errors: number;
    skipped: number;
    time: number;
    timestamp: string;
    testsuite: JUnitTestSuite[];
  };
}

export class JUnitReporter implements Reporter {
  private rootPath: string;
  private outputPath?: string;

  constructor({
    rootPath,
    options: { outputPath } = {},
  }: {
    rootPath: string;
    options?: { outputPath?: string };
  }) {
    this.rootPath = rootPath;
    this.outputPath = outputPath;
  }

  private sanitizeXml(text: string): string {
    let result = '';

    // XML 1.0 valid chars: \x09 | \x0A | \x0D | [\x20-\uD7FF] | [\uE000-\uFFFD] | [\u{10000}-\u{10FFFF}]
    // Iterate code points to keep valid ones and drop invalid (e.g., 0x1B, other control chars)
    for (const ch of stripAnsi(text)) {
      const cp = ch.codePointAt(0)!;
      const valid =
        cp === 0x09 ||
        cp === 0x0a ||
        cp === 0x0d ||
        (cp >= 0x20 && cp <= 0xd7ff) ||
        (cp >= 0xe000 && cp <= 0xfffd) ||
        (cp >= 0x10000 && cp <= 0x10ffff);
      if (valid) {
        result += ch;
      }
    }
    return result;
  }

  private escapeXml(text: string): string {
    const sanitized = this.sanitizeXml(text);
    return sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async createJUnitTestCase(
    test: TestResult,
    getSourcemap: GetSourcemap,
  ): Promise<JUnitTestCase> {
    const testCase: JUnitTestCase = {
      name: getTaskNameWithPrefix(test),
      classname: relative(this.rootPath, test.testPath),
      time: (test.duration || 0) / 1000, // Convert to seconds
      status: test.status,
    };

    if (test.errors && test.errors.length > 0) {
      testCase.errors = await Promise.all(
        test.errors.map(async (error) => {
          let details = `${error.message}${error.diff ? `\n${error.diff}` : ''}`;
          const stackFrames = error.stack
            ? await parseErrorStacktrace({
                stack: error.stack,
                fullStack: error.fullStack,
                getSourcemap,
              })
            : [];

          if (stackFrames[0]) {
            details += `\n${formatStack(stackFrames[0], this.rootPath)}`;
          }

          return {
            message: this.escapeXml(error.message),
            type: error.name || 'Error',
            details: this.escapeXml(details),
          };
        }),
      );
    }

    return testCase;
  }

  private async createJUnitTestSuite(
    fileResult: TestFileResult,
    getSourcemap: GetSourcemap,
  ): Promise<JUnitTestSuite> {
    const testCases = await Promise.all(
      fileResult.results.map(async (test) =>
        this.createJUnitTestCase(test, getSourcemap),
      ),
    );

    const failures = testCases.filter((test) => test.status === 'fail').length;
    const errors = 0; // No separate error tracking; set to 0 for clarity
    const skipped = testCases.filter(
      (test) => test.status === 'skip' || test.status === 'todo',
    ).length;
    const totalTime = testCases.reduce((sum, test) => sum + test.time, 0);

    return {
      name: relative(this.rootPath, fileResult.testPath),
      tests: testCases.length,
      failures,
      errors,
      skipped,
      time: totalTime,
      timestamp: new Date().toISOString(),
      testcases: testCases,
    };
  }

  private generateJUnitXml(report: JUnitReport): string {
    const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';

    const testsuitesXml = `
<testsuites name="${this.escapeXml(report.testsuites.name)}" tests="${report.testsuites.tests}" failures="${report.testsuites.failures}" errors="${report.testsuites.errors}" skipped="${report.testsuites.skipped}" time="${report.testsuites.time}" timestamp="${this.escapeXml(report.testsuites.timestamp)}">`;

    const testsuiteXmls = report.testsuites.testsuite
      .map((suite) => {
        const testsuiteStart = `
  <testsuite name="${this.escapeXml(suite.name)}" tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" skipped="${suite.skipped}" time="${suite.time}" timestamp="${this.escapeXml(suite.timestamp)}">`;

        const testcaseXmls = suite.testcases
          .map((testcase) => {
            let testcaseXml = `
    <testcase name="${this.escapeXml(testcase.name)}" classname="${this.escapeXml(testcase.classname)}" time="${testcase.time}">`;

            if (testcase.status === 'skip' || testcase.status === 'todo') {
              testcaseXml += `
      <skipped/>`;
            } else if (testcase.status === 'fail' && testcase.errors) {
              testcase.errors.forEach((error) => {
                testcaseXml += `
      <failure message="${error.message}" type="${error.type}">${error.details || ''}</failure>`;
              });
            }

            testcaseXml += `
    </testcase>`;
            return testcaseXml;
          })
          .join('');

        const testsuiteEnd = `
  </testsuite>`;

        return testsuiteStart + testcaseXmls + testsuiteEnd;
      })
      .join('');

    const testsuitesEnd = `
</testsuites>`;

    return xmlDeclaration + testsuitesXml + testsuiteXmls + testsuitesEnd;
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    getSourcemap,
  }: {
    getSourcemap: GetSourcemap;
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
  }): Promise<void> {
    const testSuites = await Promise.all(
      results.map(async (fileResult) =>
        this.createJUnitTestSuite(fileResult, getSourcemap),
      ),
    );

    const totalTests = testResults.length;
    const totalFailures = testResults.filter(
      (test) => test.status === 'fail',
    ).length;
    const totalErrors = totalFailures; // In JUnit, failures are treated as errors
      (test) => test.status === 'skip' || test.status === 'todo',
    ).length;
    const totalTime = duration.testTime / 1000; // Convert to seconds

    const report: JUnitReport = {
      testsuites: {
        name: 'rstest tests',
        tests: totalTests,
        failures: totalFailures,
        errors: totalErrors,
        skipped: totalSkipped,
        time: totalTime,
        timestamp: new Date().toISOString(),
        testsuite: testSuites,
      },
    };

    const xmlContent = this.generateJUnitXml(report);

    if (this.outputPath) {
      try {
        await writeFile(this.outputPath, xmlContent, 'utf-8');
        console.log(`JUnit XML report written to: ${this.outputPath}`);
      } catch (error) {
        console.error(
          `Failed to write JUnit XML report to ${this.outputPath}:`,
          error,
        );
        // Fallback to console output
        console.log('JUnit XML Report:');
        console.log(xmlContent);
      }
    } else {
      // Output to console by default
      console.log(xmlContent);
    }
  }
}
