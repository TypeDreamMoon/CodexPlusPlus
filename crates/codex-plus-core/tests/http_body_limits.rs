//! helper 请求体上限的配置契约（上游 issue #2198）。
//!
//! 原先是硬编码的 32 MiB / 64 MiB，长会话叠多图时会直接 413，且用户侧没有
//! 任何办法调大。这里锁定的是：默认值不变、设置的 0 或缺省表示沿用默认、
//! 解压后上限调大时压缩前上限同步跟随、以及拒绝时的报错要指出怎么调。

use codex_plus_core::launcher::{
    DEFAULT_MAX_HTTP_BODY_BYTES, DEFAULT_MAX_HTTP_ENCODED_BODY_BYTES, HttpBodyLimits,
};
use codex_plus_core::settings::BackendSettings;

const MIB: usize = 1024 * 1024;

#[test]
fn defaults_keep_the_original_hardcoded_values() {
    let limits = HttpBodyLimits::default();

    assert_eq!(limits.max_decoded, 32 * MIB);
    assert_eq!(limits.max_encoded, 64 * MIB);
    assert_eq!(limits.max_decoded, DEFAULT_MAX_HTTP_BODY_BYTES);
    assert_eq!(limits.max_encoded, DEFAULT_MAX_HTTP_ENCODED_BODY_BYTES);
}

#[test]
fn missing_settings_fields_keep_defaults() {
    // 老 settings.json 没有这两个字段 —— 必须完全保持原有行为。
    let settings: BackendSettings = serde_json::from_value(serde_json::json!({})).unwrap();

    assert_eq!(settings.codex_plus_max_http_body_mb, 0);
    assert_eq!(settings.codex_plus_max_http_encoded_body_mb, 0);

    let limits = HttpBodyLimits::from_settings(
        settings.codex_plus_max_http_body_mb,
        settings.codex_plus_max_http_encoded_body_mb,
    );
    assert_eq!(limits, HttpBodyLimits::default());
}

#[test]
fn zero_means_use_default() {
    assert_eq!(
        HttpBodyLimits::from_settings(0, 0),
        HttpBodyLimits::default()
    );
}

#[test]
fn configured_body_limit_is_applied() {
    let limits = HttpBodyLimits::from_settings(128, 0);

    assert_eq!(limits.max_decoded, 128 * MIB);
    // 压缩前上限未配置时跟随解压后上限翻倍，避免出现
    // 「解压后 128 MiB、压缩前仍卡在 64 MiB」这种自相矛盾的组合。
    assert_eq!(limits.max_encoded, 256 * MIB);
}

#[test]
fn encoded_limit_can_be_configured_independently() {
    let limits = HttpBodyLimits::from_settings(16, 24);

    assert_eq!(limits.max_decoded, 16 * MIB);
    assert_eq!(limits.max_encoded, 24 * MIB);
}

#[test]
fn encoded_limit_never_falls_below_decoded_limit() {
    // 压缩前上限小于解压后上限在物理上说不通（解压只会变大），收敛到相等。
    let limits = HttpBodyLimits::from_settings(64, 8);

    assert_eq!(limits.max_decoded, 64 * MIB);
    assert_eq!(limits.max_encoded, 64 * MIB);
}

#[test]
fn settings_fields_round_trip_through_json() {
    let mut settings = BackendSettings::default();
    settings.codex_plus_max_http_body_mb = 96;
    settings.codex_plus_max_http_encoded_body_mb = 192;

    let raw = serde_json::to_value(&settings).unwrap();
    assert_eq!(raw["codexPlusMaxHttpBodyMb"], serde_json::json!(96));
    assert_eq!(raw["codexPlusMaxHttpEncodedBodyMb"], serde_json::json!(192));

    let parsed: BackendSettings = serde_json::from_value(raw).unwrap();
    assert_eq!(parsed.codex_plus_max_http_body_mb, 96);
    assert_eq!(parsed.codex_plus_max_http_encoded_body_mb, 192);
}

#[test]
fn huge_megabyte_values_fall_back_to_defaults() {
    // u32::MAX MiB 虽然能塞进 64 位 usize，但把上限设成 4 PiB 没有意义，
    // 也会让「解压后 × 2」溢出到荒唐量级 —— 应当回退到默认值。
    let limits = HttpBodyLimits::from_settings(u32::MAX, u32::MAX);

    assert_eq!(limits.max_decoded, DEFAULT_MAX_HTTP_BODY_BYTES);
    assert_eq!(limits.max_encoded, DEFAULT_MAX_HTTP_ENCODED_BODY_BYTES);
}

#[test]
fn limits_are_capped_at_one_gib() {
    // 1024 MiB 是允许的最大值；解压后 × 2 会被压回天花板而不是到 2 GiB。
    let limits = HttpBodyLimits::from_settings(1024, 0);

    assert_eq!(limits.max_decoded, 1024 * MIB);
    assert_eq!(limits.max_encoded, 1024 * MIB);
}
