import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const coreAudio = resolve(repoRoot, "apps/core/audio");
const androidHandler = resolve(repoRoot, "apps/mobile/android/app/src/main/java/com/libnoname/noname/JsAwareAssetsPathHandler.kt");

function walk(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = resolve(directory, entry.name);
		if (entry.isDirectory()) files.push(...walk(file));
		else if (entry.isFile()) files.push(file);
	}
	return files;
}

async function probe(file) {
	const { stdout } = await execFileAsync("ffprobe", [
		"-v",
		"error",
		"-of",
		"json",
		"-show_format",
		"-show_streams",
		file,
	]);
	const result = JSON.parse(stdout);
	const stream = result.streams?.find(item => item.codec_type === "audio");
	return {
		codec: stream?.codec_name,
		duration: Number(result.format?.duration || 0),
		format: result.format?.format_name || "",
	};
}

function hasFastStart(file) {
	const data = readFileSync(file);
	let offset = 0;
	let moovOffset = -1;
	let mdatOffset = -1;
	while (offset + 8 <= data.length) {
		const size = data.readUInt32BE(offset);
		const type = data.toString("ascii", offset + 4, offset + 8);
		if (type === "moov" && moovOffset < 0) moovOffset = offset;
		if (type === "mdat" && mdatOffset < 0) mdatOffset = offset;
		if (size < 8) break;
		offset += size;
	}
	return moovOffset >= 0 && mdatOffset >= 0 && moovOffset < mdatOffset;
}

function sampleM4aFiles() {
	const files = walk(coreAudio).filter(file => file.endsWith(".m4a"));
	const byDirectory = new Map();
	for (const file of files.sort()) {
		const relative = file.slice(coreAudio.length + 1).split("\\").join("/");
		const category = relative.split("/")[0];
		if (!byDirectory.has(category)) byDirectory.set(category, file);
	}
	return [...byDirectory.values()];
}

const extensionMp3 = [
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
const knownMislabelledExtensionAudio = new Map([
	["玩点论杀/audio/card/wangmeizhike_male.mp3", { codec: "vorbis", format: /ogg/ }],
]);

test("representative core M4A files are AAC, decodable, and fast-start", async () => {
	const samples = sampleM4aFiles();
	assert.equal(samples.length >= 3, true);
	for (const file of samples) {
		const result = await probe(file);
		assert.equal(result.codec, "aac", file);
		assert.equal(result.duration > 0, true, file);
		assert.match(result.format, /mov|mp4|m4a/, file);
		assert.equal(hasFastStart(file), true, file);
	}
});

test("bundled extension MP3 files remain decodable", async () => {
	for (const relativePath of extensionMp3) {
		const file = resolve(repoRoot, "apps/core/extension", relativePath);
		assert.equal(existsSync(file), true, relativePath);
		const result = await probe(file);
		const exception = knownMislabelledExtensionAudio.get(relativePath);
		if (exception) {
			assert.equal(result.codec, exception.codec, relativePath);
			assert.match(result.format, exception.format, relativePath);
		} else {
			assert.equal(result.codec, "mp3", relativePath);
		}
		assert.equal(result.duration > 0, true, relativePath);
	}
	console.warn("已知兼容性异常：玩点论杀/wangmeizhike_male.mp3 实际为 Ogg Vorbis，后续需修复扩展名或转换为真正 MP3。");
});

test("Android asset handler has explicit audio MIME fallbacks", () => {
	const source = readFileSync(androidHandler, "utf8");
	for (const mime of [
		'"m4a" -> "audio/mp4"',
		'"mp3" -> "audio/mpeg"',
		'"ogg" -> "audio/ogg"',
		'"wav" -> "audio/wav"',
	]) {
		assert.match(source, new RegExp(mime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
});
