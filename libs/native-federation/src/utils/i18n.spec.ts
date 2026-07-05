import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The full `@softarc/native-federation/build` barrel pulls in `chalk` (ESM-only),
// which jest cannot parse in the default config. We only need a minimal logger
// surface in i18n.ts, so stub the barrel here.
jest.mock('@softarc/native-federation/build', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    notice: jest.fn(),
    measure: jest.fn(),
  },
}));

import {
  getPolyfillsBundleSwitchPath,
  I18nConfig,
  localeDataNeedsBundling,
} from './i18n';

describe('localeDataNeedsBundling', () => {
  it('is false without an i18n config', () => {
    expect(localeDataNeedsBundling(undefined, false)).toBe(false);
  });

  it('is false for the default en-US source locale (framework built-in)', () => {
    const i18n: I18nConfig = { sourceLocale: 'en-US', locales: {} };
    expect(localeDataNeedsBundling(i18n, false)).toBe(false);
  });

  it('is false for the short en source locale', () => {
    const i18n: I18nConfig = { sourceLocale: 'en', locales: {} };
    expect(localeDataNeedsBundling(i18n, false)).toBe(false);
  });

  it('is true for a non-English string sourceLocale', () => {
    const i18n: I18nConfig = { sourceLocale: 'de-DE', locales: {} };
    expect(localeDataNeedsBundling(i18n, false)).toBe(true);
  });

  it('is true for a non-English object-form sourceLocale', () => {
    const i18n: I18nConfig = {
      sourceLocale: { code: 'de-CH', baseHref: '/de/' },
      locales: {},
    };
    expect(localeDataNeedsBundling(i18n, false)).toBe(true);
  });

  it('is true when an inline locale filter contains a non-English locale', () => {
    const i18n: I18nConfig = {
      sourceLocale: 'en-US',
      locales: { 'fr-CH': { translation: 'messages.fr-CH.xlf' } },
    };
    expect(localeDataNeedsBundling(i18n, ['fr-CH'])).toBe(true);
  });

  it('is false when source locale and inline locales are all English', () => {
    const i18n: I18nConfig = { sourceLocale: 'en-US', locales: {} };
    expect(localeDataNeedsBundling(i18n, ['en'])).toBe(false);
  });
});

describe('getPolyfillsBundleSwitchPath', () => {
  // Angular treats polyfill entries starting with '.' (or having a JS/TS
  // extension) as local files and then switches the polyfills bundle to
  // packages:'bundle' - the behavior this file exists for.
  const localFileRegex = /\.[mc]?[jt]sx?$/;

  it('returns a workspace-relative path to the shipped no-op module', () => {
    // The package sources live inside the repo, so a workspace root at the
    // repo root yields a './'-relative path.
    const repoRoot = path.resolve(__dirname, '../../../..');

    const rel = getPolyfillsBundleSwitchPath(repoRoot);

    expect(rel.startsWith('./')).toBe(true);
    expect(rel).toMatch(localFileRegex);

    const abs = path.join(repoRoot, rel);
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, 'utf-8')).toContain('export {};');
  });

  it('falls back to an absolute path when the package lives outside the workspace', () => {
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-i18n-spec-'));

    const result = getPolyfillsBundleSwitchPath(foreignRoot);

    expect(path.isAbsolute(result)).toBe(true);
    // The extension alone marks the entry as a local file for Angular.
    expect(result).toMatch(localFileRegex);
    expect(fs.existsSync(result)).toBe(true);
  });
});
