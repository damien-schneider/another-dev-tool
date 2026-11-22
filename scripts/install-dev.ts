import { $, sleep } from "bun";

const TARGET = "aarch64-apple-darwin";
const APP = "Another Dev Tool Dev.app";
const BUILT = `src-tauri/target/${TARGET}/release/bundle/macos/${APP}`;
const INSTALLED = `/Applications/${APP}`;
const EXECUTABLE = `${INSTALLED}/Contents/MacOS/another-dev-tool`;

await $`./node_modules/.bin/tauri build --target ${TARGET} --config src-tauri/tauri.dev.conf.json --bundles app`;

const isRunning = async () =>
  (await $`pgrep -f ${EXECUTABLE}`.nothrow().quiet()).exitCode === 0;

const wasRunning = await isRunning();
if (wasRunning) {
  await $`osascript -e ${`quit app "${INSTALLED}"`}`.nothrow();
  while (await isRunning()) {
    await sleep(200);
  }
}

await $`rm -rf ${INSTALLED}`;
await $`ditto ${BUILT} ${INSTALLED}`;
if (wasRunning) {
  await $`open ${INSTALLED}`;
}
