import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const coreRoot = resolve(repoRoot, "apps/core");
const manifestPath = resolve(coreRoot, "game/asset.json");
const excludedDirectories = ["audio/effect", "image/flappybird", "image/pointer"];

function walk(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const fullPath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...walk(fullPath));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

function relativeResourceFiles() {
	const resources = [];
	for (const directory of ["audio", "font", "image", "theme"]) {
		const root = resolve(coreRoot, directory);
		for (const fullPath of walk(root)) {
			const relativePath = fullPath.slice(coreRoot.length + 1).split("\\").join("/");
			if (relativePath.endsWith(".css")) continue;
			if (excludedDirectories.some(directoryName => relativePath.startsWith(`${directoryName}/`))) continue;
			resources.push(relativePath);
		}
	}
	return resources.sort();
}

test("asset.json exactly covers generated core resources", () => {
	assert.equal(existsSync(manifestPath), true);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	assert.equal(Array.isArray(manifest), true);
	assert.equal(new Set(manifest).size, manifest.length, "asset.json contains duplicate entries");

	const actual = relativeResourceFiles();
	assert.deepEqual([...manifest].sort(), actual);
});

test("core audio manifest uses M4A for converted MP3 resources", () => {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const audio = manifest.filter(resource => resource.startsWith("audio/"));
	const coreMp3 = audio.filter(resource => resource.endsWith(".mp3"));
	const coreM4a = audio.filter(resource => resource.endsWith(".m4a"));

	assert.equal(coreMp3.length, 0);
	assert.equal(coreM4a.length > 0, true);
});
