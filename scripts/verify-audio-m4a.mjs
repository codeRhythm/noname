// 自动化验证：默认 m4a 音频方案是否可发声
// 用法：先确保静态服务在跑，再执行：
//       node scripts/verify-audio-m4a.mjs [服务地址] [dist/audio目录] [game/index.js] [audioSource.js]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const BASE = process.argv[2] || process.env.NONAME_AUDIO_VERIFY_BASE || "http://localhost:8089";
const DIST = path.resolve(process.cwd(), process.argv[3] || process.env.NONAME_AUDIO_VERIFY_DIST || "dist/audio");
const GAME = path.resolve(process.cwd(), process.argv[4] || "apps/core/noname/game/index.js");
const AUDIO_SOURCE = path.resolve(process.cwd(), process.argv[5] || "apps/core/noname/game/audioSource.js");
const results = [];
const ok = (n, d) => { results.push({ n, p: true, d }); console.log(`✅ ${n} — ${d}`); };
const bad = (n, d) => { results.push({ n, p: false, d }); console.log(`❌ ${n} — ${d}`); };

function httpHead(p) {
  return new Promise((resolve) => {
    const req = http.request(new URL(p, BASE), { method: "HEAD" }, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on("error", () => resolve(0));
    req.setTimeout(8000, () => { req.destroy(); resolve(0); });
    req.end();
  });
}
function probeExt(file) {
  try {
    const codec = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nk=1:nw=1", file], { encoding: "utf8" }).trim();
    const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file], { encoding: "utf8" }).trim();
    return { codec, dur: parseFloat(dur) || 0 };
  } catch { return null; }
}
function sample(dir, n) {
  const out = [];
  function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f);
      const st = fs.statSync(fp);
      if (st.isDirectory()) walk(fp);
      else if (f.endsWith(".m4a") && out.length < n) out.push(fp);
    }
  }
  try { walk(path.join(DIST, dir)); } catch {}
  return out;
}

async function main() {
  if (!fs.existsSync(DIST)) {
    bad("验证输入", `dist 音频目录不存在：${DIST}`);
    process.exit(1);
  }
  if (!fs.existsSync(GAME) || !fs.existsSync(AUDIO_SOURCE)) {
    bad("验证输入", `运行时代码不存在：${GAME} 或 ${AUDIO_SOURCE}`);
    process.exit(1);
  }

  console.log("========== 阶段1：资产层（m4a 合法可解码 / mp3 已不打包）==========");
  let p1 = 0, p1f = 0;
  for (const sub of ["background", "card", "die", "effect", "skill", "voice"]) {
    const files = sample(sub, 5);
    if (files.length === 0) {
      p1f++;
      bad(`资产 ${sub}`, "没有找到可验证的 m4a 样本");
      continue;
    }
    for (const f of files) {
      const rel = "/" + path.relative("dist", f).split(path.sep).join("/");
      const mp3 = rel.replace(/\.m4a$/, ".mp3");
      const code = await httpHead(rel);
      const mp3code = await httpHead(mp3);
      const ext = probeExt(f);
      const decodable = ext && /aac/i.test(ext.codec) && ext.dur > 0;
      if (code === 200 && mp3code === 404 && decodable) p1++;
      else { p1f++; bad(`资产 ${sub}`, `${rel} http=${code} mp3=${mp3code} ffprobe=${ext ? `${ext.codec}/${ext.dur}s` : "err"}`); }
    }
  }
  if (p1f === 0) ok("资产层抽样全通过", `各子目录 m4a 均可访问且为合法 aac，对应 mp3 均 404（共 ${p1} 项）`);

  console.log("\n========== 阶段2：打包层（dist 仅含 m4a）==========");
  const bgM4a = await httpHead("/audio/background/" + (fs.readdirSync(path.join(DIST, "background")).find(f => f.endsWith(".m4a")) || "x.m4a"));
  const bgMp3 = await httpHead("/audio/background/" + (fs.readdirSync(path.join(DIST, "background")).find(f => f.endsWith(".mp3")) || "x.mp3"));
  if (bgM4a === 200 && bgMp3 === 404) ok("打包层", "背景音乐 m4a=200 / mp3=404，确认打包只含 m4a");
  else bad("打包层", `m4a=${bgM4a} mp3=${bgMp3}`);

  console.log("\n========== 阶段3：代码层（默认 m4a，缺失时回退 mp3）==========");
  const src = fs.readFileSync(GAME, "utf8");
  const audioSource = fs.readFileSync(AUDIO_SOURCE, "utf8");
  const cnt = (src.match(/audio_format/g) || []).length;
  const hasFallback = /getAudioSourceCandidates/.test(src) && /setAudioSourceWithFallback/.test(src);
  const hasDefaultM4a = /\.m4a/.test(audioSource);
  if (cnt === 0 && hasFallback && hasDefaultM4a) ok("代码层回退", "已移除 audio_format 界面依赖，默认优先 m4a，资源失败时回退同名 mp3");
  else bad("代码层回退", `audio_format 引用=${cnt}（期望=0）, fallback=${hasFallback}, 默认 m4a=${hasDefaultM4a}`);

  console.log("\n========== 阶段4：功能模拟（之前无声的两类，按默认 m4a 拼接 URL 可访问）==========");
  let p4 = 0, p4f = 0;
  // 技能音（之前硬拼 .mp3，最频繁）
  const skillFiles = sample("skill", 6);
  if (skillFiles.length === 0) bad("技能音模拟", "没有找到可验证的 m4a 样本");
  for (const f of skillFiles) {
    const name = path.basename(f, ".m4a");
    const url = `/audio/skill/${name}.m4a`;
    const c = await httpHead(url);
    if (c === 200) p4++; else { p4f++; bad("技能音模拟", `${url} http=${c}`); }
  }
  // 背景音乐（之前硬拼 .mp3）
  const bgFiles = sample("background", 4);
  if (bgFiles.length === 0) bad("背景音乐模拟", "没有找到可验证的 m4a 样本");
  for (const f of bgFiles) {
    const name = path.basename(f, ".m4a");
    const url = `/audio/background/${name}.m4a`;
    const c = await httpHead(url);
    if (c === 200) p4++; else { p4f++; bad("背景音乐模拟", `${url} http=${c}`); }
  }
  if (p4f === 0) ok("功能模拟", `技能音 ${skillFiles.length} 项 + 背景音乐 ${bgFiles.length} 项按默认 m4a 路径均可访问（共 ${p4} 项）`);

  const allPass = results.every(r => r.p);
  console.log("\n========================================");
  console.log(allPass ? "🟢 总体：新方案（默认 m4a）可正常发声" : "🔴 总体：仍存在未通过项");
  console.log("========================================");
  process.exit(allPass ? 0 : 1);
}
main();
