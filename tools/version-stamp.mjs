// 把版本号同步到各个 manifest，供 CI 在打 tag 后调用：
//   node tools/version-stamp.mjs 1.4.0
//
// 版本号的唯一真源是 git tag。仓库里三处声明的版本必须与 tag 一致，
// 否则会出现「安装包叫 1.4.0、关于页显示 1.3.0」这种对不上的情况：
//   - Cargo.toml            → [workspace.package] version（各 crate 用 version.workspace = true）
//   - package.json          → 前端包版本
//   - tauri.conf.json       → Tauri 应用版本
//
// 只改这三处，不做别的；无参数时打印当前版本，方便本地核对。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** 从 `v1.2.3` / `1.2.3` 里取出语义化版本号。 */
export function normalizeVersion(input) {
  const text = String(input ?? "").trim().replace(/^[vV]/, "");
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(text)) {
    throw new Error(`版本号无效：${JSON.stringify(input)}（期望 1.2.3 或 v1.2.3）`);
  }
  return text;
}

function stampCargoToml(version) {
  const file = path.join(repoRoot, "Cargo.toml");
  const before = readFileSync(file, "utf8");
  // 只替换 [workspace.package] 段里的 version，避免碰到依赖表里的 version。
  const sectionStart = before.indexOf("[workspace.package]");
  if (sectionStart === -1) throw new Error("Cargo.toml 缺少 [workspace.package]");
  const nextSection = before.indexOf("\n[", sectionStart + 1);
  const end = nextSection === -1 ? before.length : nextSection;
  const section = before.slice(sectionStart, end);
  const stamped = section.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
  if (stamped === section) throw new Error("Cargo.toml 的 [workspace.package] 里没找到 version");
  writeFileSync(file, before.slice(0, sectionStart) + stamped + before.slice(end), "utf8");
}

function stampPackageJson(version) {
  const file = path.join(repoRoot, "apps", "codex-plus-manager", "package.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.version = version;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function stampTauriConf(version) {
  const file = path.join(repoRoot, "apps", "codex-plus-manager", "src-tauri", "tauri.conf.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.version = version;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** 当前三处 manifest 声明的版本（以 Cargo.toml 为准，并校验三者一致）。 */
export function readStampedVersions() {
  const cargo = readFileSync(path.join(repoRoot, "Cargo.toml"), "utf8");
  const sectionStart = cargo.indexOf("[workspace.package]");
  const section = cargo.slice(sectionStart, cargo.indexOf("\n[", sectionStart + 1));
  const cargoVersion = /^version\s*=\s*"([^"]*)"/m.exec(section)?.[1];
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "apps", "codex-plus-manager", "package.json"), "utf8"),
  ).version;
  const tauri = JSON.parse(
    readFileSync(
      path.join(repoRoot, "apps", "codex-plus-manager", "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  ).version;
  return { cargo: cargoVersion, packageJson: pkg, tauriConf: tauri };
}

export function stampVersion(input) {
  const version = normalizeVersion(input);
  stampCargoToml(version);
  stampPackageJson(version);
  stampTauriConf(version);
  return version;
}

// 作为脚本直接运行时才写盘；被测试 import 时只暴露函数。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) {
    const current = readStampedVersions();
    console.log(`Cargo.toml            ${current.cargo}`);
    console.log(`package.json          ${current.packageJson}`);
    console.log(`src-tauri/tauri.conf  ${current.tauriConf}`);
    const consistent =
      current.cargo === current.packageJson && current.cargo === current.tauriConf;
    console.log(consistent ? "三处一致。" : "三处不一致，请运行：node tools/version-stamp.mjs <版本>");
    process.exit(consistent ? 0 : 1);
  }
  const version = stampVersion(arg);
  console.log(`已把版本号同步为 ${version}`);
}
