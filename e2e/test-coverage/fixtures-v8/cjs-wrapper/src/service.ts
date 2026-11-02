export let calls = 0;

export class Service {
  async getInfo() {
    calls++;
    return 'original';
  }
}
