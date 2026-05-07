export const DEFAULT_LOCALE = 'ru' as const;
export const SUPPORTED_LOCALES = ['ru'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
