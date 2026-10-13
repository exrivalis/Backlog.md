#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

// Platform-specific packages to uninstall
const platformPackages = [
	"@exrivalis/backlog.md-linux-x64",
	"@exrivalis/backlog.md-linux-arm64",
	"@exrivalis/backlog.md-darwin-x64",
	"@exrivalis/backlog.md-darwin-arm64",
	"@exrivalis/backlog.md-windows-arm64",
	"@exrivalis/backlog.md-windows-x64",
];

// Detect package manager
const packageManager = process.env.npm_config_user_agent?.split("/")[0] || "npm";

console.log("Cleaning up platform-specific packages...");

// Run each uninstall synchronously: fire-and-forget spawns could be cut short when this
// script's process exits, leaving the orphaned platform package behind on disk.
for (const pkg of platformPackages) {
	const args = packageManager === "bun" ? ["remove", "-g", pkg] : ["uninstall", "-g", pkg];

	const result = spawnSync(packageManager, args, {
		stdio: "pipe", // Don't show output to avoid spam
		windowsHide: true,
	});

	if (result.status === 0) {
		console.log(`✓ Cleaned up ${pkg}`);
	}
	// Silently ignore failures - package might not be installed
}

console.log("Platform package cleanup completed.");
