import path from 'node:path';
import * as p from '@clack/prompts';
import { determineAgent } from '@vercel/detect-agent';
import color from 'picocolors';
import { detectProject } from './detect';
import type { BrowserProvider, Framework } from './templates';
import {
  getConfigFileName,
  getConfigTemplate,
  getDependenciesWithVersions,
  getInstallCommand,
  getPlaywrightInstallCommand,
  getReactComponentTemplate,
  getReactTestTemplate,
  getRunCommand,
  getVanillaComponentTemplate,
  getVanillaTestTemplate,
} from './templates';
import {
  ensureDir,
  getUniqueBaseName,
  updatePackageJsonDevDeps,
  updatePackageJsonScripts,
  writeFile,
} from './utils';

export interface CreateOptions {
  /** Non-interactive mode, use default options */
  yes?: boolean;
}

type ProjectInfo = Awaited<ReturnType<typeof detectProject>>;

/** Preview info for files to be created */
interface FilePreview {
  configFile: string;
  componentFile: string;
  testFile: string;
  framework: Framework;
}

/**
 * Main init function for browser mode.
 */
export async function create(options: CreateOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const { yes: nonInteractive } = options;

  // Detect project info
  const projectInfo = await detectProject(cwd);

  // Check if running in AI agent environment
  const { isAgent } = await determineAgent();

  if (nonInteractive) {
    // Non-interactive mode
    await createNonInteractive(cwd, projectInfo);
  } else {
    // Interactive mode
    await createInteractive(cwd, projectInfo, isAgent);
  }
}

/**
 * Compute which files will be created (for preview).
 */
function computeFilePreview(
  cwd: string,
  projectInfo: ProjectInfo,
): FilePreview {
  const { language, testDir, framework } = projectInfo;
  const effectiveFramework: Framework =
    framework === 'react' ? 'react' : 'vanilla';

  const configFile = getConfigFileName();

  // Determine file extensions based on framework and language
  let componentExt: string;
  let testExt: string;

  if (effectiveFramework === 'react') {
    componentExt = language === 'ts' ? '.tsx' : '.jsx';
    testExt = language === 'ts' ? '.test.tsx' : '.test.jsx';
  } else {
    componentExt = language === 'ts' ? '.ts' : '.js';
    testExt = language === 'ts' ? '.test.ts' : '.test.js';
  }

  const testDirPath = path.join(cwd, testDir);
  const baseName = getUniqueBaseName(testDirPath, 'Counter', componentExt);

  return {
    configFile,
    componentFile: `${testDir}/${baseName}${componentExt}`,
    testFile: `${testDir}/${baseName}${testExt}`,
    framework: effectiveFramework,
  };
}

/**
 * Non-interactive creation (--yes mode).
 */
async function createNonInteractive(
  cwd: string,
  projectInfo: ProjectInfo,
): Promise<void> {
  const { agent, testDir, framework, reactVersion } = projectInfo;
  const provider: BrowserProvider = 'playwright';

  console.log();
  console.log(color.cyan('◆'), color.bold('rstest init browser --yes'));
  console.log();

  // Show detection results
  console.log('  Detecting project...');
  if (framework === 'react' && reactVersion) {
    console.log(color.green('  ✓'), `Found React ${reactVersion}`);
  } else if (framework === 'react') {
    console.log(color.green('  ✓'), 'Found React');
  } else {
    console.log(
      color.yellow('  ⚠'),
      'Framework not detected, generating vanilla DOM example',
    );
  }
  console.log(color.green('  ✓'), 'Using playwright as browser provider');
  console.log(color.green('  ✓'), `Test directory: ${testDir}/`);
  console.log();

  // Generate files
  const createdFiles = await generateFiles(cwd, projectInfo, provider);

  // Show created files
  console.log('  Created files:');
  for (const file of createdFiles) {
    console.log(`    - ${file}`);
  }
  console.log('    - Updated package.json');
  console.log();

  // Show next steps
  console.log('  Next steps:');
  console.log(`    ${getInstallCommand(agent)}`);
  console.log(`    ${getPlaywrightInstallCommand(agent, provider)}`);
  console.log(`    ${getRunCommand(agent)}`);
  console.log();

  console.log(color.green('└'), 'Done!');
}

/**
 * Interactive creation with prompts.
 */
async function createInteractive(
  cwd: string,
  projectInfo: ProjectInfo,
  isAgent: boolean,
): Promise<void> {
  const { agent, language, testDir, framework, reactVersion } = projectInfo;
  const effectiveFramework: Framework =
    framework === 'react' ? 'react' : 'vanilla';

  p.intro(color.bgCyan(color.black(' rstest init browser ')));

  // Step 1: Show detection results
  const detectionLines: string[] = [];
  if (framework === 'react' && reactVersion) {
    detectionLines.push(`${color.green('✓')} Found React ${reactVersion}`);
  } else if (framework === 'react') {
    detectionLines.push(`${color.green('✓')} Found React`);
  } else {
    detectionLines.push(
      `${color.yellow('⚠')} Framework not detected, will generate vanilla DOM example`,
    );
  }
  detectionLines.push(
    `${color.green('✓')} Found ${language === 'ts' ? 'TypeScript' : 'JavaScript'}`,
  );
  detectionLines.push(`${color.green('✓')} Test directory: ${testDir}/`);

  p.note(detectionLines.join('\n'), 'Detecting project...');

  // Show agent hint if running in AI agent environment
  if (isAgent) {
    p.log.info(
      `AI Agent detected. For non-interactive mode, run:\n  ${color.cyan('npx rstest init browser --yes')}`,
    );
  }

  // Step 2: Choose browser provider (only playwright supported for now)
  const providerSelection = await p.select({
    message: 'Choose a browser provider (so far, only Playwright)',
    options: [
      {
        value: 'playwright',
        label: 'Playwright',
        hint: 'recommended',
      },
    ],
  });

  if (p.isCancel(providerSelection)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  const provider = providerSelection;

  // Step 3: Preview changes
  const preview = computeFilePreview(cwd, projectInfo);
  const deps = getDependenciesWithVersions(
    effectiveFramework,
    provider,
    RSTEST_VERSION,
  );
  const depsList = Object.entries(deps)
    .map(([name, version]) => `${name}@${version}`)
    .join(', ');

  const previewLines = [
    `${color.cyan('+')} Create ${preview.configFile}`,
    `${color.cyan('+')} Create ${preview.componentFile}`,
    `${color.cyan('+')} Create ${preview.testFile}`,
    `${color.yellow('~')} Modify package.json`,
    `   - Add "test:browser" script`,
    `   - Add devDependencies: ${color.dim(depsList)}`,
  ];
  p.note(previewLines.join('\n'), 'Changes to be made');

  // Step 4: Confirm
  const confirmed = await p.confirm({
    message: 'Proceed with these changes?',
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  // Step 5: Generate files
  const s = p.spinner();
  s.start('Creating files...');

  const createdFiles = await generateFiles(cwd, projectInfo, provider);

  s.stop('Created files');

  // Show created files
  const fileLines = createdFiles.map((f) => `${color.green('✓')} Created ${f}`);
  fileLines.push(`${color.green('✓')} Updated package.json`);
  p.note(fileLines.join('\n'), 'Files');

  // Step 6: Show next steps
  const nextStepsLines = [
    `${color.bold('1.')} Install dependencies:`,
    `   ${color.cyan(getInstallCommand(agent))}`,
    '',
    `${color.bold('2.')} Install Playwright browsers:`,
    `   ${color.cyan(getPlaywrightInstallCommand(agent, provider))}`,
    '',
    `${color.bold('3.')} Run your tests:`,
    `   ${color.cyan(getRunCommand(agent))}`,
  ];

  p.note(nextStepsLines.join('\n'), 'Next steps');

  p.outro(color.green('Done! Happy testing with Rstest!'));
}

/**
 * Generate all required files.
 * @returns List of created file paths (relative to cwd)
 */
async function generateFiles(
  cwd: string,
  projectInfo: ProjectInfo,
  provider: BrowserProvider,
): Promise<string[]> {
  const { language, testDir, framework } = projectInfo;
  const effectiveFramework: Framework =
    framework === 'react' ? 'react' : 'vanilla';
  const createdFiles: string[] = [];

  // 1. Create config file
  const configFileName = getConfigFileName();
  const configPath = path.join(cwd, configFileName);
  writeFile(configPath, getConfigTemplate());
  createdFiles.push(configFileName);

  // 2. Ensure test directory exists
  const testDirPath = path.join(cwd, testDir);
  ensureDir(testDirPath);

  // 3. Create example files based on framework
  let componentExt: string;
  let testExt: string;

  if (effectiveFramework === 'react') {
    componentExt = language === 'ts' ? '.tsx' : '.jsx';
    testExt = language === 'ts' ? '.test.tsx' : '.test.jsx';
  } else {
    componentExt = language === 'ts' ? '.ts' : '.js';
    testExt = language === 'ts' ? '.test.ts' : '.test.js';
  }

  // Get unique base name to avoid conflicts
  const baseName = getUniqueBaseName(testDirPath, 'Counter', componentExt);

  // Create component file
  const componentFileName = `${baseName}${componentExt}`;
  const componentPath = path.join(testDirPath, componentFileName);

  if (effectiveFramework === 'react') {
    writeFile(componentPath, getReactComponentTemplate(language));
  } else {
    writeFile(componentPath, getVanillaComponentTemplate(language));
  }
  createdFiles.push(`${testDir}/${componentFileName}`);

  // Create test file
  const testFileName = `${baseName}${testExt}`;
  const testPath = path.join(testDirPath, testFileName);

  let testContent: string;
  if (effectiveFramework === 'react') {
    testContent = getReactTestTemplate(language);
    // Update import path if using non-default name
    if (baseName !== 'Counter') {
      testContent = testContent.replace(
        /from '\.\/Counter\.(tsx|jsx)'/,
        `from './${baseName}.$1'`,
      );
    }
  } else {
    testContent = getVanillaTestTemplate(language);
    // Update import path if using non-default name
    if (baseName !== 'Counter') {
      testContent = testContent.replace(
        /from '\.\/Counter\.(ts|js)'/,
        `from './${baseName}.$1'`,
      );
    }
  }
  writeFile(testPath, testContent);
  createdFiles.push(`${testDir}/${testFileName}`);

  // 4. Update package.json scripts
  updatePackageJsonScripts(cwd, {
    'test:browser': 'rstest --config=rstest.browser.config.ts',
  });

  // 5. Add devDependencies to package.json
  const deps = getDependenciesWithVersions(
    effectiveFramework,
    provider,
    RSTEST_VERSION,
  );
  updatePackageJsonDevDeps(cwd, deps);

  return createdFiles;
}
