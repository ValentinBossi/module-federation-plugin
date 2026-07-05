import { BuilderContext } from '@angular-devkit/architect';
import { logger } from '@softarc/native-federation/build';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { FederationInfo } from '@softarc/native-federation-runtime';

export type WorkspaceConfig = {
  i18n?: I18nConfig;
};

export type LocaleTranslation = string | string[];

export type LocaleObject = {
  translation: LocaleTranslation;
  baseHref?: string;
  subPath?: string;
};

export type I18nConfig = {
  sourceLocale: string | SourceLocaleObject;
  locales: Record<string, LocaleTranslation | LocaleObject>;
};

export type SourceLocaleObject = {
  code: string;
  baseHref?: string;
  subPath?: string;
};

export async function getI18nConfig(
  context: BuilderContext,
): Promise<I18nConfig | undefined> {
  const workspaceConfig = (await context.getProjectMetadata(
    context.target?.project || '',
  )) as WorkspaceConfig;

  const i18nConfig = workspaceConfig?.i18n;
  return i18nConfig;
}

export async function translateFederationArtefacts(
  i18n: I18nConfig,
  localize: boolean | string[],
  outputPath: string,
  federationResult: FederationInfo,
) {
  const neededLocales = Array.isArray(localize)
    ? localize
    : Object.keys(i18n.locales);

  const locales = Object.keys(i18n.locales).filter((locale) =>
    neededLocales.includes(locale),
  );

  if (locales.length === 0) {
    return;
  }

  logger.info('Writing Translations');

  const translationFiles = locales
    .map((loc) => i18n.locales[loc])
    .map((config) =>
      typeof config === 'string' || Array.isArray(config)
        ? config
        : config.translation,
    )
    .map((files) => JSON.stringify(files))
    .join(' ');

  const targetLocales = locales.join(' ');

  const sourceLocale =
    typeof i18n.sourceLocale === 'string'
      ? i18n.sourceLocale
      : i18n.sourceLocale.code;

  const translationOutPath = path.join(outputPath, 'browser', '{{LOCALE}}');

  // Use *.js to translate ALL JS files, including lazy-loaded chunks
  // that may contain $localize markers from exposed modules
  const sourcePattern = '*.js';

  const sourceLocalePath = path.join(outputPath, 'browser', sourceLocale);

  const localizeTranslate = path.resolve(
    'node_modules/.bin/localize-translate',
  );

  // Quote paths to handle spaces (Windows compatibility)
  const cmd = `"${localizeTranslate}" -r "${sourceLocalePath}" -s "${sourcePattern}" -t ${translationFiles} -o "${translationOutPath}" --target-locales ${targetLocales} -l ${sourceLocale}`;

  ensureDistFolders(locales, outputPath);
  copyRemoteEntry(locales, outputPath, sourceLocalePath);

  logger.debug('Running: ' + cmd);

  execCommand(cmd, 'Successfully translated');
}

function execCommand(cmd: string, defaultSuccessInfo: string) {
  try {
    const output = execSync(cmd);
    logger.info(output.toString() || defaultSuccessInfo);
  } catch (error) {
    logger.error(error.message);
  }
}

function copyRemoteEntry(
  locales: string[],
  outputPath: string,
  sourceLocalePath: string,
) {
  const remoteEntry = path.join(sourceLocalePath, 'remoteEntry.json');

  for (const locale of locales) {
    const localePath = path.join(
      outputPath,
      'browser',
      locale,
      'remoteEntry.json',
    );
    fs.copyFileSync(remoteEntry, localePath);
  }
}

function ensureDistFolders(locales: string[], outputPath: string) {
  for (const locale of locales) {
    const localePath = path.join(outputPath, 'browser', locale);
    fs.mkdirSync(localePath, { recursive: true });
  }
}

// Angular's framework ships `en`/`en-US` data inline; the locale-data plugin
// short-circuits these and never emits a locale-data import for them.
// See: @angular/build/src/tools/esbuild/i18n-locale-plugin.ts
function isBuiltInEnglishLocale(code: string): boolean {
  return code === 'en' || code === 'en-US';
}

/**
 * Determines whether Angular will inject locale data
 * (`@angular/common/locales/global/<code>`) into the polyfills bundle: it
 * does so for an explicitly defined non-English `i18n.sourceLocale`, or for
 * inline locales (the dev server inlines a single locale via `--localize`).
 */
export function localeDataNeedsBundling(
  i18n: I18nConfig | undefined,
  localeFilter: boolean | string[],
): boolean {
  if (!i18n) {
    return false;
  }

  const codes: string[] = [];

  const sourceCode =
    typeof i18n.sourceLocale === 'string'
      ? i18n.sourceLocale
      : i18n.sourceLocale?.code;
  if (sourceCode) {
    codes.push(sourceCode);
  }

  if (Array.isArray(localeFilter)) {
    codes.push(...localeFilter);
  }

  return codes.some((code) => !isBuiltInEnglishLocale(code));
}

/**
 * Returns the path of the no-op polyfill file that ships with this package
 * (src/polyfills-bundle-switch.mjs), preferably relative to the workspace
 * root.
 *
 * Purpose: In dev-server mode, Angular's polyfills bundle runs with
 * `packages: 'external'`, so the locale data injected for a non-English
 * sourceLocale stays a bare import (`@angular/common/locales/global/<code>`).
 * Vite normally rescues such imports by prebundling them, but under Native
 * Federation they match the `@angular/common/` prefix of the federation
 * externals and are deliberately left bare - which crashes the natively
 * loaded polyfills script.
 *
 * Angular disables external packages for the polyfills bundle as soon as one
 * polyfill entry is a local file - a path starting with '.' or with a
 * JS/TS extension (see getEsBuildCommonPolyfillsOptions in @angular/build).
 * Adding this no-op entry therefore makes the dev server bundle the locale
 * data inline - exactly like a production build.
 */
export function getPolyfillsBundleSwitchPath(workspaceRoot: string): string {
  const absPath = path.join(__dirname, '..', 'polyfills-bundle-switch.mjs');

  const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');

  // Outside the workspace (unusual hoisting): fall back to the absolute
  // path - the .mjs extension still marks it as a local file for Angular.
  return relPath.startsWith('..') ? absPath.replace(/\\/g, '/') : `./${relPath}`;
}
