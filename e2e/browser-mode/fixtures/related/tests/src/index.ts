import { greet } from './shared';

export const sayHi = () => greet('index');

export const loadGreeting = (locale: string) =>
  import(`./messages/${locale}.js`);
