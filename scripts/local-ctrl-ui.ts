import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { type Plugin, searchForWorkspaceRoot } from "vite";

const SIBLING_REPO = resolve(import.meta.dirname, "../../control-ui");
const PACKAGE_PREFIX = "@ctrl-ui/react/";
const SOURCE_PREFIX = /^@\/components\/control-ui\//;
const PACKAGE_STYLESHEET = /@import "@ctrl-ui\/react\/(styles\/[^"]+)";/g;
const SCRIPT_FILE = /\.(tsx?|m?js)$/;
const SCRIPT_EXTENSIONS = ["", ".tsx", ".ts", ".mjs", ".js"];
const MANIFEST_SETTLE_MS = 150;

interface Closure {
  files: Record<string, string>;
  styles: string[];
}

function readClosure(packageDir: string): Closure {
  const script =
    'import { closure, skinFiles } from "./registry-closure.ts"; const c = closure(); console.log(JSON.stringify({ files: Object.fromEntries([...c.files, ...skinFiles()]), styles: c.styles }))';
  return JSON.parse(
    execFileSync("bun", ["-e", script], { cwd: packageDir, encoding: "utf8" })
  );
}

export function localCtrlUiRepo() {
  if (process.env.CTRL_UI_PATH) {
    return resolve(process.env.CTRL_UI_PATH);
  }
  return existsSync(SIBLING_REPO) ? SIBLING_REPO : undefined;
}

export function localCtrlUi(repoDir: string, appStylesheet: string): Plugin {
  const packageDir = resolve(repoDir, "packages/components");
  const manifestDir = resolve(repoDir, "apps/docs/registry");
  const manifest: { peerDependencies: Record<string, string> } = JSON.parse(
    readFileSync(resolve(packageDir, "package.json"), "utf8")
  );
  let files: Closure["files"] = {};
  let packageStyles = "";

  function load() {
    const closure = readClosure(packageDir);
    const styles = [
      ...closure.styles.map(
        (sheet) => `@import "${closure.files[`styles/${sheet}`]}";`
      ),
      ...Object.values(closure.files)
        .filter((path) => SCRIPT_FILE.test(path))
        .map((path) => `@source "${path}";`),
    ].join("\n");
    files = closure.files;
    const changed = packageStyles !== "" && styles !== packageStyles;
    packageStyles = styles;
    if (changed) {
      // Tailwind rebuilds on file mtimes, not on transformed input.
      const now = new Date();
      utimesSync(appStylesheet, now, now);
    }
  }

  function lookup(name: string) {
    const extension = SCRIPT_EXTENSIONS.find(
      (candidate) => files[name + candidate]
    );
    return extension === undefined ? undefined : files[name + extension];
  }

  load();

  return {
    name: "local-ctrl-ui",
    enforce: "pre",
    config: () => ({
      resolve: {
        alias: [{ find: SOURCE_PREFIX, replacement: PACKAGE_PREFIX }],
        dedupe: Object.keys(manifest.peerDependencies),
      },
      server: {
        fs: { allow: [searchForWorkspaceRoot(process.cwd()), repoDir] },
      },
    }),
    configureServer(devServer) {
      let pending: ReturnType<typeof setTimeout> | undefined;
      devServer.watcher.add(manifestDir);
      devServer.watcher.on("all", (_event, path) => {
        if (!(path.startsWith(manifestDir) && path.endsWith(".json"))) {
          return;
        }
        clearTimeout(pending);
        pending = setTimeout(load, MANIFEST_SETTLE_MS);
      });
    },
    configResolved(config) {
      config.logger.info(`  ➜  control-ui: ${repoDir} (local source)`);
    },
    resolveId(source) {
      if (!source.startsWith(PACKAGE_PREFIX)) {
        return null;
      }
      const name = source.slice(PACKAGE_PREFIX.length);
      const known = lookup(name);
      if (known) {
        return known;
      }
      load();
      return lookup(name) ?? null;
    },
    transform(code, id) {
      return id.split("?")[0] === appStylesheet
        ? code.replace(PACKAGE_STYLESHEET, (statement, sheet: string) => {
            if (sheet === "styles/index.css") {
              return packageStyles;
            }
            return files[sheet] ? `@import "${files[sheet]}";` : statement;
          })
        : null;
    },
  };
}
