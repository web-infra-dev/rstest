import vscode from 'vscode';
import { getConfigValue } from './config';

export function shouldIgnorePath(path: string) {
  return (
    path.includes('/node_modules/') ||
    path.includes('/.git/') ||
    path.endsWith('.git')
  );
}

export function isTestFile(filename: string): boolean {
  const regex = /.*\.(test|spec)\.(c|m)?[jt]sx?$/;
  return regex.test(filename);
}

export type WorkspaceTestPattern = {
  workspaceFolder: vscode.WorkspaceFolder;
  pattern: vscode.GlobPattern;
};

export function getWorkspaceTestPatterns(): WorkspaceTestPattern[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return [];
  }

  return folders.flatMap((workspaceFolder) => {
    const globs = getConfigValue('testFileGlobPattern', workspaceFolder);
    return globs.map((glob) => ({
      workspaceFolder,
      pattern: new vscode.RelativePattern(workspaceFolder, glob),
    }));
  });
}
