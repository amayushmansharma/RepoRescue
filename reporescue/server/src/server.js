import { loadConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { githubAppReady } from "./github/github-app-config.js";

const config = loadConfig();
const app = createApp({ clientOrigin: config.clientOrigin, trustProxy: config.trustProxy });

const server = app.listen(config.port, config.host, () => {
  console.log(`[reporescue] API listening on http://${config.host}:${config.port}`);
  console.log(`[reporescue] GitHub access: ${config.githubToken ? "authenticated (server-side token)" : "anonymous public API"}`);
  console.log(
    `[reporescue] remote GitHub writes: ${
      githubAppReady() ? "enabled via user OAuth fork workflow" : "disabled (OAuth not configured)"
    }`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
