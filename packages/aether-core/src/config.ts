// AppSettings type — defined locally to avoid import cycle
export interface AppSettings extends Record<string, unknown> {
  theme: string;
  language: string;
  logLevel: string;
  autoUpdate: boolean;
  telemetry: boolean;
  dataDir: string;
  port: number;
  host: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  language: "en",
  logLevel: "info",
  autoUpdate: true,
  telemetry: false,
  dataDir: "./data",
  port: 8456,
  host: "127.0.0.1",
};

/** Type-safe configuration manager with defaults */
export class ConfigManager<T extends Record<string, unknown> = AppSettings> {
  private settings: T;

  constructor(defaults?: Record<string, unknown>) {
    this.settings = { ...DEFAULT_SETTINGS, ...defaults } as unknown as T;
  }

  /** Get a configuration value */
  get<K extends keyof T>(key: K): T[K] {
    return this.settings[key];
  }

  /** Set a configuration value */
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.settings[key] = value;
  }

  /** Get all settings */
  getAll(): Readonly<T> {
    return Object.freeze({ ...this.settings });
  }

  /** Update multiple settings at once */
  update(values: Partial<T>): void {
    Object.assign(this.settings, values);
  }

  /** Reset all settings to defaults */
  reset(defaults?: Partial<T>): void {
    this.settings = { ...DEFAULT_SETTINGS, ...defaults } as unknown as T;
  }

  /** Load settings from a JSON config object */
  load(config: Record<string, unknown>): void {
    for (const key of Object.keys(config)) {
      if (key in this.settings) {
        (this.settings as Record<string, unknown>)[key] = config[key];
      }
    }
  }

  /** Serialize settings to JSON */
  toJSON(): string {
    return JSON.stringify(this.settings, null, 2);
  }
}
