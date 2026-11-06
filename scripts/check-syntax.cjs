const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
function scan(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(item.name)) continue;
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) scan(filename);
    else if (/\.(js|cjs)$/.test(filename)) {
      const result = spawnSync(process.execPath, ["--check", filename], { stdio: "inherit" });
      if (result.status !== 0) process.exit(1);
    }
  }
}
scan(".");
