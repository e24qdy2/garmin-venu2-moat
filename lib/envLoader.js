const fs = require("fs");
const path = require("path");
const BASE_DIR = typeof __dirname !== "undefined" ? __dirname : ".";

/**
 * Lightweight zero-dependency .env loader for Venu2Moat
 */
function loadEnvFile(envPath = path.join(BASE_DIR, "..", ".env")) {
  try {
    if (typeof fs.existsSync !== "function" || !fs.existsSync(envPath)) return false;
    const raw = fs.readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return true;
  } catch (_err) {
    return false;
  }
}

loadEnvFile();

module.exports = { loadEnvFile };
