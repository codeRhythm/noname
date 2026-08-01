import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), process.argv[2] || process.env.NONAME_ROOT || ".");
const BACKUP = path.resolve(process.cwd(), process.argv[3] || process.env.NONAME_AUDIO_SOURCE || path.join(ROOT, "audio-mp3-backup/audio"));
const OUT = path.resolve(process.cwd(), process.argv[4] || process.env.NONAME_AUDIO_OUTPUT || "/tmp/ab-listen");
if (!fs.existsSync(BACKUP)) throw new Error(`音频源目录不存在: ${BACKUP}`);
fs.mkdirSync(OUT, { recursive: true });

// 3 类典型音频: 音乐 / 短音效 / 语音
const samples = [
  { key: "bgm", name: "BGM_疾风(音乐/立体声)", file: "background/music_jifeng.mp3" },
  { key: "sha", name: "卡牌_杀(短音效)", file: "card/male/sha.mp3" },
  { key: "skill", name: "技能语音(人声/中长)", file: "skill/benyu_sxrm_caocao1.mp3" },
];

function probe(p) {
  const j = JSON.parse(
    execSync(`ffprobe -v error -of json -show_format -show_streams ${JSON.stringify(p)}`).toString()
  );
  const a = j.streams.find((s) => s.codec_type === "audio");
  return {
    size: fs.statSync(p).size,
    duration: parseFloat(j.format.duration || "0"),
    bitrate: parseInt(a.bit_rate || "0", 10),
    channels: a.channels,
    sample_rate: parseInt(a.sample_rate || "0", 10),
  };
}

function enc(input, output, opts) {
  execSync(
    `ffmpeg -y -hide_banner -loglevel error -i ${JSON.stringify(input)} ${opts} ${JSON.stringify(output)}`
  );
}

// 各样本生成的文件清单(供 HTML 引用)
const manifest = [];

for (const s of samples) {
  const src = path.join(BACKUP, s.file);
  const o = probe(src);
  const lowRate = o.bitrate <= 48000;
  const projBr = lowRate ? 16000 : Math.round(o.bitrate * 0.7);
  const projAr = o.sample_rate === 22048 ? 22050 : o.sample_rate;
  const projAc = lowRate ? 1 : o.channels;

  const files = [];
  const fmtSize = (b) =>
    b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB";
  const add = (label, filePath) => {
    const sz = fs.statSync(filePath).size;
    files.push({ label: `${label} · ${fmtSize(sz)}`, file: path.basename(filePath) });
  };

  // 参考: 原始 mp3
  const refOut = path.join(OUT, `${s.key}__ref.mp3`);
  fs.copyFileSync(src, refOut);
  add(`原始 MP3 (${Math.round(o.bitrate / 1000)}k 参考)`, refOut);

  // AAC 码率阶梯
  const aacTiers = [
    { br: 64000, label: "AAC 64k" },
    { br: 96000, label: "AAC 96k" },
    { br: 128000, label: "AAC 128k" },
    { br: 192000, label: "AAC 192k" },
  ];
  for (const t of aacTiers) {
    const out = path.join(OUT, `${s.key}__aac_${t.br / 1000}k.m4a`);
    enc(src, out, `-c:a aac -b:a ${t.br}`);
    add(t.label, out);
  }
  // AAC 项目现方案档
  const projOut = path.join(OUT, `${s.key}__aac_proj.m4a`);
  enc(src, projOut, `-c:a aac -b:a ${projBr} -ar ${projAr} -ac ${projAc}`);
  add(`AAC 项目现方案 (~${Math.round(projBr / 1000)}k${lowRate ? " 单声道" : ""})`, projOut);

  // Opus 对照点(等音质更低码率)
  const opusOut = path.join(OUT, `${s.key}__opus_96k.webm`);
  enc(src, opusOut, `-c:a libopus -application audio -b:a 96000`);
  add("Opus 96k (对照)", opusOut);

  manifest.push({ name: s.name, orig: `${Math.round(o.bitrate / 1000)}k / ${o.duration.toFixed(1)}s`, files });
}

// 生成 HTML 试听页
const rows = manifest
  .map((m) => {
    const items = m.files
      .map(
        (f) =>
          `      <tr><td class="l">${f.label}</td><td><audio controls preload="none" src="./${f.file}"></audio></td></tr>`
      )
      .join("\n");
    return `    <section>
      <h2>${m.name} <span class="meta">原 ${m.orig}</span></h2>
      <table>${items}
      </table>
    </section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>音频码率/编码试听对照</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#222}
  h1{font-size:20px} h2{font-size:16px;margin-top:28px;border-bottom:1px solid #eee;padding-bottom:6px}
  .meta{font-weight:400;color:#888;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  td{padding:6px 4px;border-bottom:1px solid #f3f3f3;vertical-align:middle}
  td.l{width:230px;font-size:13px;color:#444}
  audio{width:100%}
  .tip{background:#f7f7f9;border:1px solid #eee;border-radius:8px;padding:10px 14px;font-size:13px;color:#555;margin:12px 0}
</style></head>
<body>
  <h1>音频码率 / 编码试听对照</h1>
  <div class="tip">每类音频给出：原始 MP3(参考) + AAC 码率阶梯(64/96/128/192k) + 项目现方案档 + 一个 Opus 对照点。
  点播放对比听感差异。低码率对音乐损伤最明显，对短音效影响较小。</div>
${rows}
</body></html>`;

fs.writeFileSync(path.join(OUT, "ab.html"), html);
console.log("试听包已生成: " + OUT);
console.log("文件数: " + fs.readdirSync(OUT).length);
console.log("HTML: " + path.join(OUT, "ab.html"));
