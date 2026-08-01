import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const scripts = {
	converter: resolve(repoRoot, "scripts/audio-to-m4a.mjs"),
	rules: resolve(repoRoot, "scripts/verify-m4a-rules.mjs"),
	deployment: resolve(repoRoot, "scripts/verify-audio-m4a.mjs"),
	ab: resolve(repoRoot, "scripts/audio-ab-kit.mjs"),
	compare: resolve(repoRoot, "scripts/audio-codec-compare.mjs"),
};

function run(script, args) {
	return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("converter fails clearly when the source directory is missing", () => {
	const result = run(scripts.converter, ["/definitely/missing/noname-audio", "/tmp/noname-audio-test-output", "1"]);
	assert.equal(result.status, 1);
	assert.match(`${result.stdout}\n${result.stderr}`, /源目录不存在/);
});

test("rule verifier rejects missing input directories instead of passing empty samples", () => {
	const result = run(scripts.rules, ["/definitely/missing/m4a", "/definitely/missing/mp3", "1"]);
	assert.equal(result.status, 1);
	assert.match(`${result.stdout}\n${result.stderr}`, /目录不存在/);
});

test("deployment verifier rejects a missing dist directory", () => {
	const result = run(scripts.deployment, ["http://127.0.0.1:1", "/definitely/missing/dist", "missing-game.js", "missing-audio-source.js"]);
	assert.equal(result.status, 1);
	assert.match(`${result.stdout}\n${result.stderr}`, /dist 音频目录不存在/);
});

test("portable helper scripts do not depend on the original developer path", () => {
	for (const script of [scripts.ab, scripts.compare]) {
		assert.doesNotMatch(readFileSync(script, "utf8"), /\/Users\/hayzax\/workspace\/noname/);
	}
});
