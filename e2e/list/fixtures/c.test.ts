import { describe, it } from '@rstest/core';

describe.each([0])('test c describe each %#', () => {});

describe.for([0])('test c describe for %#', () => {});

describe.runIf(true)('test c describe runIf', () => {});

describe.skipIf(false)('test c describe skipIf', () => {});

it.each([0])('test c it each %#', () => {});

it.for([0])('test c it for %#', () => {});

it.runIf(true)('test c it runIf', () => {});

it.skipIf(false)('test c it skipIf', () => {});
