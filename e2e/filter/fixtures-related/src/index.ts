import { greet } from './shared';

export const sayHi = () => greet('index');

export const resolveMessage = () => require.resolve('./resolved.json');

export const loadGreeting = (locale: string) =>
  import(`./messages/${locale}.mjs`);
