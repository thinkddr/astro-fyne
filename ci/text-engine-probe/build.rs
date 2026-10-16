// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
fn main() {
    let root = std::path::PathBuf::from(
        std::env::var_os("SKIA_INCLUDE_ROOT").expect("SKIA_INCLUDE_ROOT is required"),
    );
    assert!(root.join("include/core/SkFont.h").is_file());
    println!("cargo:rerun-if-env-changed=SKIA_INCLUDE_ROOT");
    // SkTypeface_fontations_priv.h includes this exact path without a crate prefix.
    unsafe { cxx_build::CFG.include_prefix = ""; }
    let mut build = cxx_build::bridge("src/ports/fontations/src/ffi.rs");
    build.include(".").include(&root).include(root.join("out/text-probe/gen"));
    // Pinned GN Skia disables RTTI; derived classes must use the same ABI.
    build.std("c++20").pic(true).flag("-fno-rtti").define("SK_RELEASE", None);
    for source in [
        "src/ports/SkTypeface_fontations.cpp",
        "src/ports/SkFontScanner_fontations.cpp",
        "src/ports/SkTypeface_proxy.cpp",
    ] {
        let source = root.join(source);
        println!("cargo:rerun-if-changed={}", source.display());
        build.file(source);
    }
    build.compile("astro_fyne_fontations_cpp");
    println!("cargo:rerun-if-changed=src/ports/fontations/src");
}
