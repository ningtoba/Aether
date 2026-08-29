/** Detects if running inside Electron */
export function isElectron(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

/** Returns the current OS platform */
export function getPlatform(): 'win32' | 'darwin' | 'linux' | 'unknown' {
  if (typeof process === 'undefined') return 'unknown';
  const p = process.platform;
  if (p === 'win32' || p === 'darwin' || p === 'linux') return p;
  return 'unknown';
}

/** Detects development environment */
export function isDev(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
}
