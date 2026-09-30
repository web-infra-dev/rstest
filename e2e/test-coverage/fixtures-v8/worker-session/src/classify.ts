export function classify(value: number): string {
  if (value > 2) {
    return 'big';
  }
  return 'small';
}
