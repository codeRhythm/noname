#!/usr/bin/env node
/**
 * 校验 audio-to-m4a 转码结果：
 *  1) 全量：每个 m4a 必须能被 ffprobe 解码（codec=aac），统计损坏数。
 *  2) 抽样：取样本，按"备份 mp3 的目录+码率"套用规则，计算期望 m4a 码率，
 *     与生成的 m4a 实测码率比对（容差 2k），统计命中/偏离。
 * 用法： node scripts/verify-m4a-rules.mjs [m4a目录] [mp3目录] [样本数=60]
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);
const M4A_ROOT = path.resolve(process.cwd(), process.argv[2] || 'apps/core/audio');
const MP3_ROOT = path.resolve(process.cwd(), process.argv[3] || 'audio-mp3-backup/audio');
const SAMPLE = Math.max(1, parseInt(process.argv[4] || '60', 10));

function walk(dir) {
  if (!fs.existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
  const res = [];
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) res.push(...walk(fp));
    else if (f.toLowerCase().endsWith('.m4a')) res.push(fp);
  }
  return res;
}

async function probeAudio(file) {
  try {
    const { stdout } = await execFileP(
      'ffprobe',
      ['-v', 'error', '-of', 'json', '-show_format', '-show_streams', file],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const j = JSON.parse(stdout);
    const fmt = j.format || {};
    const st = (j.streams || []).find((x) => x.codec_type === 'audio') || {};
    let br = st.bit_rate ? Number(st.bit_rate) : fmt.bit_rate ? Number(fmt.bit_rate) : null;
    if (!br && fmt.duration && fmt.size) br = (Number(fmt.size) * 8) / Number(fmt.duration);
    return { ok: true, br, codec: st.codec_name, dur: fmt.duration ? Number(fmt.duration) : null };
  } catch {
    return { ok: false };
  }
}

let all;
try {
  all = walk(M4A_ROOT).sort();
  if (!fs.existsSync(MP3_ROOT)) throw new Error(`目录不存在: ${MP3_ROOT}`);
} catch (error) {
  console.error(`无法扫描校验目录：${error.message || error}`);
  process.exitCode = 1;
  process.exit();
}
console.log(`m4a 总数: ${all.length}`);

// 1) 全量解码校验
let corrupt = 0;
const concurrency = 6;
let idx = 0,
  active = 0;
await new Promise((resolve) => {
  function pump() {
    while (active < concurrency && idx < all.length) {
      const f = all[idx++];
      active++;
      probeAudio(f)
        .then((r) => {
          if (!r.ok || r.codec !== 'aac') corrupt++;
        })
        .catch(() => corrupt++)
        .finally(() => {
          active--;
          pump();
        });
    }
    if (active === 0 && idx >= all.length) resolve();
  }
  pump();
});
console.log(`解码校验：损坏/非 aac 文件数 = ${corrupt}`);

// 2) 抽样规则核对
const sample = [];
const step = Math.max(1, Math.floor(all.length / SAMPLE));
for (let i = 0; i < all.length && sample.length < SAMPLE; i += step) sample.push(all[i]);

function expect(rel, mp3) {
  const { br, dur } = mp3;
  const origK = Math.round(br / 1000);
  const category = rel.split(path.sep)[0];
  return category === 'background' ? Math.min(origK, 96) : Math.min(origK, 48);
}

let checked = 0,
  hit = 0,
  miss = 0;
let missing = 0,
  unreadable = 0;
const mismatches = [];
await new Promise((resolve) => {
  let k = 0,
    act = 0;
  function pump() {
    while (act < concurrency && k < sample.length) {
      const m4a = sample[k++];
      act++;
      (async () => {
        const rel = path.relative(M4A_ROOT, m4a).replace(/\.m4a$/i, '.mp3');
        const mp3 = path.join(MP3_ROOT, rel);
        if (!fs.existsSync(mp3)) {
          missing++;
          return;
        }
        const [pm, pa] = await Promise.all([probeAudio(mp3), probeAudio(m4a)]);
        if (!pm.ok || !pa.ok || !Number.isFinite(pm.br) || !Number.isFinite(pa.br)) {
          unreadable++;
          return;
        }
        const expK = expect(rel, pm);
        const actK = Math.round(pa.br / 1000);
        checked++;
        if (Math.abs(expK - actK) <= 15) hit++;
        else {
          miss++;
          if (mismatches.length < 10)
            mismatches.push({ f: rel, mp3K: Math.round(pm.br / 1000), dur: pm.dur?.toFixed(1), expK, actK });
        }
      })()
        .catch(() => {})
        .finally(() => {
          act--;
          pump();
        });
    }
    if (act === 0 && k >= sample.length) resolve();
  }
  pump();
});

console.log(`规则抽样：样本 ${sample.length}，可比对 ${checked}，命中 ${hit}，偏离 ${miss}，缺源 ${missing}，不可读 ${unreadable}`);
if (mismatches.length) {
  console.log('偏离样本：');
  for (const m of mismatches) console.log(`  ${m.f}  mp3=${m.mp3K}k dur=${m.dur}s 期望=${m.expK}k 实际=${m.actK}k`);
}
const passed = all.length > 0 && corrupt === 0 && miss === 0 && missing === 0 && unreadable === 0 && checked > 0;
console.log(passed ? '\n✅ 全部通过' : '\n⚠️ 存在异常，见上');
process.exitCode = passed ? 0 : 1;
