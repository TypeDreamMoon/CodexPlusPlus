//! 「更新源」设置的契约：上游 / 本 fork / 自定义仓库的解析与 latest.json 候选地址。
//!
//! 这块的关键不变量是：无论用户怎么填，更新检查都必须有一个可用的地址 ——
//! 所以非法仓库名要回退到上游，而不是拼出一个坏 URL。

use codex_plus_core::settings::BackendSettings;
use codex_plus_core::update::{
    DEFAULT_LATEST_JSON_URL, DEFAULT_REPOSITORY, FORK_REPOSITORY, UPDATE_SOURCE_CUSTOM,
    UPDATE_SOURCE_FORK, UPDATE_SOURCE_UPSTREAM, latest_json_candidates, latest_json_url_for_repository,
    normalize_repository, resolve_update_repository,
};

#[test]
fn default_update_source_is_upstream() {
    let settings = BackendSettings::default();

    assert_eq!(settings.update_source, UPDATE_SOURCE_UPSTREAM);
    assert!(settings.update_source_custom_repo.is_empty());
    assert_eq!(
        resolve_update_repository(&settings.update_source, &settings.update_source_custom_repo),
        DEFAULT_REPOSITORY
    );
}

#[test]
fn settings_without_update_source_field_still_load() {
    // 老版本写的 settings.json 没有 updateSource 字段，升级后必须仍然能加载并落到上游。
    let settings: BackendSettings = serde_json::from_value(serde_json::json!({
        "codexAppPath": "C:/Codex/app",
        "relayTestModel": "gpt-5.4-mini"
    }))
    .expect("deserialize legacy settings");

    assert_eq!(settings.update_source, UPDATE_SOURCE_UPSTREAM);
    assert_eq!(settings.codex_app_path, "C:/Codex/app");
}

#[test]
fn update_source_round_trips_through_json() {
    let mut settings = BackendSettings::default();
    settings.update_source = UPDATE_SOURCE_FORK.to_string();

    let raw = serde_json::to_value(&settings).unwrap();
    assert_eq!(raw["updateSource"], serde_json::json!(UPDATE_SOURCE_FORK));

    let parsed: BackendSettings = serde_json::from_value(raw).unwrap();
    assert_eq!(parsed.update_source, UPDATE_SOURCE_FORK);
}

#[test]
fn fork_source_resolves_to_fork_repository() {
    assert_eq!(
        resolve_update_repository(UPDATE_SOURCE_FORK, ""),
        FORK_REPOSITORY
    );
}

#[test]
fn custom_source_uses_configured_repository() {
    assert_eq!(
        resolve_update_repository(UPDATE_SOURCE_CUSTOM, "someone/their-build"),
        "someone/their-build"
    );
}

#[test]
fn unknown_or_invalid_source_falls_back_to_upstream() {
    for (source, custom) in [
        ("", ""),
        ("nonsense", ""),
        (UPDATE_SOURCE_CUSTOM, ""),
        (UPDATE_SOURCE_CUSTOM, "not a repo"),
        (UPDATE_SOURCE_CUSTOM, "onlyowner"),
        (UPDATE_SOURCE_CUSTOM, "a/b/c"),
    ] {
        assert_eq!(
            resolve_update_repository(source, custom),
            DEFAULT_REPOSITORY,
            "source={source:?} custom={custom:?} 应回退到上游"
        );
    }
}

#[test]
fn pasted_github_urls_are_normalized() {
    for input in [
        "TypeDreamMoon/CodexPlusPlus",
        "https://github.com/TypeDreamMoon/CodexPlusPlus",
        "https://github.com/TypeDreamMoon/CodexPlusPlus.git",
        "http://www.github.com/TypeDreamMoon/CodexPlusPlus/",
        "  TypeDreamMoon/CodexPlusPlus  ",
    ] {
        assert_eq!(
            normalize_repository(input).as_deref(),
            Some("TypeDreamMoon/CodexPlusPlus"),
            "input={input:?}"
        );
    }
}

#[test]
fn normalize_repository_rejects_junk() {
    for input in ["", "   ", "justoneword", "a/b/c", "a//b", "/b", "a/", "a/b?x=1", "a/../b"] {
        assert_eq!(normalize_repository(input), None, "input={input:?}");
    }
}

#[test]
fn latest_json_url_is_built_from_repository() {
    assert_eq!(
        latest_json_url_for_repository("owner/repo"),
        "https://github.com/owner/repo/releases/latest/download/latest.json"
    );
}

#[test]
fn upstream_source_only_tries_upstream() {
    assert_eq!(
        latest_json_candidates(UPDATE_SOURCE_UPSTREAM, ""),
        vec![DEFAULT_LATEST_JSON_URL.to_string()]
    );
}

#[test]
fn fork_and_custom_sources_fall_back_to_upstream() {
    // 选中 fork/自定义仓库时先读它自己，失败再回退上游 —— 这样刚 fork、
    // 还没发过 Release 的情况下更新检查仍然可用。
    for (source, custom) in [
        (UPDATE_SOURCE_FORK, ""),
        (UPDATE_SOURCE_CUSTOM, "someone/their-build"),
    ] {
        let candidates = latest_json_candidates(source, custom);
        assert_eq!(candidates.len(), 2, "source={source:?}");
        assert_eq!(candidates[1], DEFAULT_LATEST_JSON_URL);
        assert_ne!(candidates[0], DEFAULT_LATEST_JSON_URL);

        // 自定义仓库填成上游时不重复追加同一条地址。
        if source == UPDATE_SOURCE_CUSTOM {
            let same_as_upstream = latest_json_candidates(source, DEFAULT_REPOSITORY);
            assert_eq!(same_as_upstream, vec![DEFAULT_LATEST_JSON_URL.to_string()]);
        }
    }
}
