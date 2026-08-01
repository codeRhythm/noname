import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
	getAudioSourceCandidates,
	isExternalAudioSource,
	setAudioSourceWithFallback,
} from "../apps/core/noname/game/audioSource.js";

const repoRoot = resolve(import.meta.dirname, "..");

test("extensionless core audio prefers M4A and falls back to MP3", () => {
	assert.deepEqual(getAudioSourceCandidates("audio/skill/tao"), ["audio/skill/tao.m4a", "audio/skill/tao.mp3"]);
	assert.deepEqual(getAudioSourceCandidates("audio/skill/tao.mp3"), ["audio/skill/tao.m4a", "audio/skill/tao.mp3"]);
});

test("OGG remains the first candidate and keeps M4A/MP3 fallback", () => {
	assert.deepEqual(getAudioSourceCandidates("audio/skill/tao.ogg"), [
		"audio/skill/tao.ogg",
		"audio/skill/tao.m4a",
		"audio/skill/tao.mp3",
	]);
});

test("external audio URLs are not rewritten", () => {
	for (const source of ["blob:test", "data:audio/mp3;base64,test", "file:///tmp/test.mp3", "https://example.test/test.mp3"]) {
		assert.equal(isExternalAudioSource(source), true);
		assert.deepEqual(getAudioSourceCandidates(source), [source]);
	}
});

test("audio fallback advances candidates and reports only the final error", () => {
	const audio = { src: "", onerror: null };
	const errors = [];
	setAudioSourceWithFallback(audio, ["a.m4a", "a.mp3"], event => errors.push(event));
	assert.equal(audio.src, "a.m4a");

	audio.onerror("m4a failed");
	assert.equal(audio.src, "a.mp3");
	assert.deepEqual(errors, []);

	audio.onerror("mp3 failed");
	assert.deepEqual(errors, ["mp3 failed"]);
});

test("the 19 bundled extension MP3 files remain available", () => {
	const extensionAudio = [
		"杀海拾遗/audio/card/fudichouxin_female.mp3",
		"杀海拾遗/audio/card/fudichouxin_male.mp3",
		"杀海拾遗/audio/card/toulianghuanzhu_female.mp3",
		"杀海拾遗/audio/card/toulianghuanzhu_male.mp3",
		"欢乐卡牌/audio/card/jiuwei_female.mp3",
		"欢乐卡牌/audio/card/jiuwei_male.mp3",
		"欢乐卡牌/audio/card/kuwu_female.mp3",
		"欢乐卡牌/audio/card/kuwu_male.mp3",
		"欢乐卡牌/audio/card/monkey_female.mp3",
		"欢乐卡牌/audio/card/monkey_male.mp3",
		"欢乐卡牌/audio/card/shoulijian_female.mp3",
		"欢乐卡牌/audio/card/shoulijian_male.mp3",
		"欢乐卡牌/audio/card/xuelunyang_female.mp3",
		"欢乐卡牌/audio/card/xuelunyang_male.mp3",
		"欢乐卡牌/audio/skill/jiuwei.mp3",
		"欢乐卡牌/audio/skill/kuwu.mp3",
		"欢乐卡牌/audio/skill/monkey.mp3",
		"欢乐卡牌/audio/skill/xuelunyang.mp3",
		"玩点论杀/audio/card/wangmeizhike_male.mp3",
	];

	for (const relativePath of extensionAudio) {
		assert.equal(existsSync(resolve(repoRoot, "apps/core/extension", relativePath)), true, relativePath);
	}
});
