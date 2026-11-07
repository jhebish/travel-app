// Monorepo setup: let Metro see the shared @travel/core package.
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// The website (Next 14) keeps React 18 at the top of the shared install, and the app runs
// React 19 from apps/mobile/node_modules. Other packages carry their own nested copies, so
// resolve React from here for every importer: the bundle then holds exactly one React.
const SINGLETONS = new Set(["react", "react-dom"]);
const fromApp = path.join(projectRoot, "package.json");
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const ctx = SINGLETONS.has(moduleName.split("/")[0]) ? { ...context, originModulePath: fromApp } : context;
  return upstream ? upstream(ctx, moduleName, platform) : ctx.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
