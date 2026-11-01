import { appVersion } from './app-version';

describe('appVersion', () => {
  const saved = process.env.APP_VERSION;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = saved;
  });

  it('берёт версию релиза из APP_VERSION', () => {
    process.env.APP_VERSION = '2.3.4';
    expect(appVersion()).toBe('2.3.4');
  });

  it('без номера версии в APP_VERSION берёт версию из package.json', () => {
    const pkg = require('../../../package.json') as { version: string };
    process.env.APP_VERSION = 'local';
    expect(appVersion()).toBe(pkg.version);
    delete process.env.APP_VERSION;
    expect(appVersion()).toBe(pkg.version);
  });
});
