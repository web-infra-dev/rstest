import { execSync } from 'node:child_process';
import readline from 'node:readline';
import { type PackageGroup, packageGroups } from '../bump.config.mts';

const groupEntries = Object.entries(packageGroups);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const printMenu = () => {
  console.log('\nSelect package group to bump:\n');
  groupEntries.forEach(([key, value], index) => {
    console.log(`  ${index + 1}. ${value.name} (${key})`);
  });
  console.log('');
};

const prompt = (question: string) =>
  new Promise<string>((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });

const parseSelection = (input: string): [string, PackageGroup] | undefined => {
  const trimmed = input.trim();
  const index = Number.parseInt(trimmed, 10);

  if (!Number.isNaN(index)) return groupEntries[index - 1];

  return groupEntries.find(([key]) => key === trimmed);
};

const run = async () => {
  printMenu();
  const answer = await prompt('Enter number or key: ');
  rl.close();

  const selected = parseSelection(answer);
  if (!selected) {
    console.error('Invalid selection');
    process.exit(1);
  }

  const [, group] = selected;
  const files = group.files.map((file) => `'${file}'`).join(' ');

  execSync(
    `pnpm bumpp ${files} --no-tag --no-push -c "${group.commitMessage}"`,
    { stdio: 'inherit' },
  );
};

run().catch((error) => {
  rl.close();
  console.error(error);
  process.exit(1);
});
