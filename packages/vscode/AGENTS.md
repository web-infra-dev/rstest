# Rstest VS Code Extension Agents

This document describes the agent architecture used in the Rstest VS Code extension.

## Overview

The Rstest VS Code extension implements a test runner integration for the VS Code Testing API. It connects VS Code's test explorer with the Rstest testing framework, allowing users to discover, run, and debug tests directly from the editor.

## How to test the extension

To test the extension during development:

1. Open the project in VS Code
2. Press `F5` or go to **Run and Debug** view
3. Select the "Run Extension" launch configuration from `.vscode/launch.json`
4. Click the play button to start a new Extension Development Host window
5. In the new window, open a workspace that contains Rstest configuration files
6. The extension should automatically activate and discover tests in the workspace

## Architecture

The extension is built around a multi-process architecture with two main components:

1. **Main Process (VS Code Extension)**: Handles the VS Code integration and UI
2. **Worker Process (Test Runner)**: Executes the actual tests using the Rstest framework

### Communication Flow

```
┌─────────────────────┐                  ┌─────────────────────┐
│                     │                  │                     │
│   VS Code Process   │◄─── WebSocket ───►   Worker Process    │
│   (extension.ts)    │                  │   (worker/index.ts) │
│                     │                  │                     │
└─────────────────────┘                  └─────────────────────┘
```

## Main Process Components

### `Rstest` Class (extension.ts)

The main controller class that:

- Creates and manages the VS Code Test Controller API
- Sets up event handlers for file changes
- Manages test discovery and execution requests
- Coordinates with the Worker process

### `RstestApi` Class (master.ts)

Responsible for:

- Creating and managing the worker process
- Establishing WebSocket communication with the worker
- Resolving paths to the Rstest framework
- Sending test execution requests to the worker
- Handling responses from worker process

## Worker Process Components

### `Worker` Class (worker/index.ts)

Handles:

- Initializing the connection back to the main process
- Creating instances of the Rstest testing framework
- Configuring and running tests as requested
- Reporting test results back to the main process

### `VscodeReporter` Class (worker/reporter.ts)

A custom reporter implementation that:

- Formats test results for VS Code consumption
- Communicates results back to the main process

## Message Types

### Main → Worker

- `WorkerInitData`: Initializes the worker with necessary paths and configuration
- `WorkerRunTestData`: Requests the execution of specific tests

### Worker → Main

- `WorkerEventFinish`: Reports test execution results back to the main process

## Test Discovery and Execution Flow

1. VS Code discovers test files via file patterns (_.md, _.ts)
2. The extension parses these files to identify test cases
3. When a test run is requested:
   - The main process sends test details to the worker
   - The worker executes the tests using the Rstest framework
   - Results are sent back to the main process
   - The main process updates the VS Code Test Explorer UI

## Configuration

The extension automatically activates when it detects Rstest configuration files in the workspace:

- `*rstest*.config*.{ts,js,mjs,cjs,cts,mts}`
- `*rstest.{workspace,projects}*.{ts,js,mjs,cjs,cts,mts,json}`

## Feature Set

- Test discovery for Markdown and TypeScript files
- Run individual tests or test suites
- Continuous test execution on file changes
- Test output in VS Code's test explorer
- Coverage visualization (in development)
