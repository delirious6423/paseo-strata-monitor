import { join } from "node:path";

// Where Strata keeps things, per OS. Mirrors Strata's own rules (strata_control/discovery.py, paths.py,
// profiles.py, strata_cli/connections.py) so the plugin looks exactly where Strata itself does.

export type Env = Record<string, string | undefined>;
export type Os = { windows: boolean; home: string; env: Env };

export const here = (): Os => ({ windows: process.platform === "win32", home: process.env.HOME ?? process.env.USERPROFILE ?? "", env: process.env });

const roaming = (o: Os) => o.env.APPDATA || join(o.home, "AppData", "Roaming");
const local = (o: Os) => o.env.LOCALAPPDATA || join(o.home, "AppData", "Local");
const xdgConfig = (o: Os) => o.env.XDG_CONFIG_HOME || join(o.home, ".config");
const xdgData = (o: Os) => o.env.XDG_DATA_HOME || join(o.home, ".local", "share");

/** The command-line Strata's settings file (installs, data_dir). The desktop app sets STRATA_SETTINGS_FILE. */
export const settingsFile = (o: Os) =>
  o.env.STRATA_SETTINGS_FILE || (o.windows ? join(roaming(o), "Strata", "settings.json") : join(xdgConfig(o), "strata", "settings.json"));

/** The desktop app's component folder; its install folder and app-settings.json sit beside it. */
export const componentsDir = (o: Os) =>
  o.env.STRATA_COMPONENTS_DIR || (o.windows ? join(local(o), "Strata", "components") : join(xdgData(o), "strata", "components"));

export const appInstallDir = (o: Os) => join(componentsDir(o), "..", "install");
export const appSettingsFile = (o: Os) => join(componentsDir(o), "..", "app-settings.json");

export const profileDir = (o: Os) =>
  o.env.STRATA_PROFILE_DIR || (o.windows ? join(roaming(o), "Strata", "profiles") : join(xdgConfig(o), "strata", "profiles"));

export const connectionDir = (o: Os) =>
  o.env.STRATA_CONNECTION_DIR || (o.windows ? join(roaming(o), "Strata", "connections") : join(xdgConfig(o), "strata", "connections"));

export const systemdUserDir = (o: Os) => join(xdgConfig(o), "systemd", "user");

/** The Strata command-line launcher inside an install. */
export const cliIn = (install: string, o: Os) => join(install, "bin", o.windows ? "strata.cmd" : "strata");

/** The plugin's own files (tool history, benchmark reports), outside Strata's folders. */
export const pluginStateDir = (o: Os) =>
  o.windows ? join(local(o), "paseo-strata")
  : process.platform === "darwin" ? join(o.home, "Library", "Application Support", "paseo-strata")
  : join(o.env.XDG_STATE_HOME || join(o.home, ".local", "state"), "paseo-strata");

/** Strata's server default port, and the port setup writes into run configs. */
export const DEFAULT_PORTS = [8095, 8080];
