"use strict";
const http = require("node:http");
const next = require("next");

process.chdir(__dirname);
const hostname = process.env.HOSTNAME || "127.0.0.1";
const port = Number(process.env.PORT || 3200);

const app = next({ dev: false, dir: __dirname, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      handle(req, res);
    });
    server.listen(port, hostname, () => {
      console.log(`TradeLoom portable server ready at http://${hostname}:${port}`);
    });
    const shutdown = () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((err) => {
    console.error("Failed to start TradeLoom server:", err);
    process.exit(1);
  });