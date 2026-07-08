const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const port = Number(process.argv[2] || 5173);
const fileEnv = loadEnvFiles();
applyFileEnv(fileEnv);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const cleanPath = decodeURIComponent(request.url.split("?")[0]);

  if (cleanPath === "/api/config") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        supabaseUrl: getEnvValue("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
        supabaseAnonKey: getEnvValue(
          "SUPABASE_ANON_KEY",
          "VITE_SUPABASE_ANON_KEY",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        ),
      }),
    );
    return;
  }

  if (cleanPath === "/api/send-queued") {
    runApiHandler("./api/send-queued.js", request, response);
    return;
  }

  const target = path.normalize(path.join(root, cleanPath === "/" ? "/index.html" : cleanPath));

  if (!target.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": contentTypes[path.extname(target)] || "application/octet-stream",
    });
    response.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}/index.html`);
});

function loadEnvFiles() {
  const values = {};

  for (const filename of [".env", ".env.local"]) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }

  return values;
}

function applyFileEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getEnvValue(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
    if (fileEnv[name]) return fileEnv[name];
  }

  return "";
}

function runApiHandler(modulePath, request, response) {
  try {
    delete require.cache[require.resolve(modulePath)];
    const handler = require(modulePath);
    Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
    });
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}
