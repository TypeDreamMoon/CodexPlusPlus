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
//
// 注意：本脚本会在 Windows runner 上以 CRLF 检出运行（这几个文件没有
// .gitattributes 的 eol 规则），所以所有匹配都不能假设行尾是 LF，并且
// 改写时只替换匹配到的那一小段，其它字节原样保留。

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

/**
 * 在 `[workspace.package]` 段内把 version 换成新值。
 *
 * 先定位段头，再从段头往后找第一条 `version = "…"`，用捕获组回填以保留
 * 原有的空格与引号风格；行尾统一按 `\r?\n` 处理，CRLF/LF 都能命中。
 */
export function stampCargoTomlText(text, version) {
  const header = /^\[workspace\.package\][^\S\r\n]*\r?$/m.exec(text);
  if (!header) throw new Error("Cargo.toml 缺少 [workspace.package] 段");

  const afterHeader = header.index + header[0].length;
  const rest = text.slice(afterHeader);
  // 段的结束：下一个以 `[` 开头的行；没有就到文件末尾。
  const nextSection = /^\[/m.exec(rest);
  const sectionEnd = nextSection ? afterHeader + nextSection.index : text.length;

  const section = text.slice(afterHeader, sectionEnd);
  const versionLine = /^([^\S\r\n]*)version([^\S\r\n]*=[^\S\r\n]*")([^"]*)(")/m.exec(section);
  if (!versionLine) {
    throw new Error(
      "Cargo.toml 的 [workspace.package] 段里没找到 version 行：" +
        JSON.stringify(section),
    );
  }

  const lineStart = afterHeader + versionLine.index;
  const replaced = versionLine[1] + "version" + versionLine[2] + version + versionLine[4];
  const lineEnd = lineStart + versionLine[0].length;
  return text.slice(0, lineStart) + replaced + text.slice(lineEnd);
}

function readWorkspacePackageSection(text) {
  const header = /^\[workspace\.package\][^\S\r\n]*\r?$/m.exec(text);
  if (!header) throw new Error("Cargo.toml 缺少 [workspace.package] 段");
  const afterHeader = header.index + header[0].length;
  const rest = text.slice(afterHeader);
  const nextSection = /^\[/m.exec(rest);
  return text.slice(afterHeader, nextSection ? afterHeader + nextSection.index : text.length);
}

function stampCargoToml(version) {
  const file = path.join(repoRoot, "Cargo.toml");
  const text = readFileSync(file, "utf8");
  writeFileSync(file, stampCargoTomlText(text, version), "utf8");
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
  const section = readWorkspacePackageSection(cargo);
  const cargoVersion = /^[^\S\r\n]*version[^\S\r\n]*=[^\S\r\n]*"([^"]*)"/m.exec(section)?.[1];
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
