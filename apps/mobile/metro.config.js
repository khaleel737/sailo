// Metro, configured for the pnpm-workspaces monorepo.
//
// The whole reason this file is hand-written: Metro resolves modules by
// walking real node_modules trees, and in a workspace the mobile app's deps
// are hoisted to the repo root while the shared @sailo/* packages live two
// directories up. Without telling Metro about both, an EAS build fails with
// "unable to resolve @sailo/core" — the classic monorepo-Expo wall. So:
//   - watch the whole workspace, so edits to a shared package are seen;
//   - resolve from both the app's and the root's node_modules.
//
// The hoisting is pnpm's, and deliberate: `.npmrc` sets `node-linker=hoisted`,
// which lays out a flat root `node_modules` the way npm would. That is what
// lets the app bundle a package it does not declare — `better-auth` and
// `@better-auth/expo` are declared by `@sailo/auth`, which is where the app
// reaches them from, and they resolve at the root. Flipping the linker to
// pnpm's default isolated layout breaks that contract along with the @sailo/*
// resolution below, so the two move together or not at all.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// npm hoists; don't let Metro invent a second copy of a hoisted dep.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
