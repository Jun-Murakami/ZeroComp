// Version information for the application
// This file is automatically updated by the version update script

// Read version from package.json at build time
export const APP_VERSION = import.meta.env.PACKAGE_VERSION || '0.0.0';

// Read full version with suffix from VERSION file (injected at build time)
export const APP_VERSION_FULL = import.meta.env.VITE_APP_VERSION_FULL || APP_VERSION;

// Build information
export const BUILD_DATE = import.meta.env.VITE_BUILD_DATE || new Date().toISOString().split('T')[0];
export const BUILD_ENV = import.meta.env.MODE || 'development';

// Display version - shows full version in development, base version in production
export const DISPLAY_VERSION = BUILD_ENV === 'development' 
  ? `${APP_VERSION_FULL}-dev`
  : APP_VERSION_FULL;

// Version components (parsed from APP_VERSION)
const versionParts = APP_VERSION.match(/^(\d+)\.(\d+)\.(\d+)/) || ['0.0.0', '0', '0', '0'];
export const VERSION_MAJOR = parseInt(versionParts[1], 10);
export const VERSION_MINOR = parseInt(versionParts[2], 10);
export const VERSION_PATCH = parseInt(versionParts[3], 10);

// Check if this is a pre-release version
export const IS_PRERELEASE = APP_VERSION_FULL.includes('-');
export const PRERELEASE_SUFFIX = APP_VERSION_FULL.split('-')[1] || '';