#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Build only on the hosted runner, after the unchanged control build.
set -euo pipefail
task_work="$(realpath "${1:?Usage: build-trace.sh WORK}")"
task_trace="$task_work/trace"
[[ $# == 1 && -f "$task_work/evidence/trace-preparation.json" ]]
mkdir -p "$task_trace/evidence"
exec > >(tee "$task_trace/evidence/build.log") 2>&1
export CC=clang CXX=clang++ AR=llvm-ar
export CARGO_BUILD_JOBS=2 RUSTFLAGS='-C relocation-model=pic'
export SKIA_INCLUDE_ROOT="$task_work/skia"
export ATF_SCALER_TRACE_SOURCE="$task_trace/copied-skia/src/ports/SkTypeface_fontations.cpp"
export CARGO_TARGET_DIR="$task_trace/target"
for task_tool in clang clang++ llvm-ar llvm-nm ninja cmake meson rustc cargo; do
  command -v "$task_tool"
  "$task_tool" --version
  sha256sum "$(realpath "$(command -v "$task_tool")")"
done
if command -v rustup >/dev/null; then
  sha256sum "$(rustup which rustc)" "$(rustup which cargo)"
fi
rustc -vV > "$task_trace/evidence/rustc-vV.txt"
(
  cd "$task_trace/assembly"
  CXXFLAGS="-I$task_trace/assembly" CC_ENABLE_DEBUG_OUTPUT=1 cargo build --release --locked -vv \
    2>&1 | tee "$task_trace/evidence/cargo-build.log"
  cargo metadata --locked --format-version 1 > "$task_trace/evidence/cargo-metadata-built.json"
  cargo tree --locked -e features > "$task_trace/evidence/cargo-features.txt"
)
# Keep the current N32 compile receipt/guard. Reuse all three native archives;
# the copied engine/header bytes are checked against the unchanged control.
python3 "$(dirname "${BASH_SOURCE[0]}")/../text-engine-probe/surface-build.py" compile \
  --receipt "$task_trace/evidence/cabi-command.json" -- \
  clang++ -std=c++20 -O2 -fPIC -fno-rtti -shared -DSK_RELEASE -DSK_R32_SHIFT=16 -I"$task_trace/assembly" \
  -I"$task_work/skia" -I"$task_work/skia/out/text-probe/gen" \
  -I"$task_work/harfbuzz/src" -I"$task_work/harfbuzz/out/src" -I"$task_work/ots/include" \
  "$task_trace/assembly/text_engine.cc" -Wl,--start-group \
  "$task_trace/target/release/libastro_fyne_fontations_experiment.a" \
  "$task_work/skia/out/text-probe/libskia.a" "$task_work/harfbuzz/out/libharfbuzz.a" \
  "$task_work/ots/out/libots.a" -Wl,--end-group \
  $(pkg-config --libs zlib libwoff2dec) -lpthread -ldl -lm \
  -Wl,-Map,"$task_trace/evidence/native-link.map" -Wl,--no-undefined \
  -o "$task_trace/evidence/libastro_fyne_text_experiment.so"
cp "$task_work/evidence/skia-commands.txt" "$task_trace/evidence/skia-commands.txt"
python3 "$(dirname "${BASH_SOURCE[0]}")/../text-engine-probe/surface-build.py" verify --work "$task_trace"
ldd -v "$task_trace/evidence/libastro_fyne_text_experiment.so" > "$task_trace/evidence/linked-libraries.txt"
sha256sum "$task_trace/assembly/Cargo.lock" "$task_trace/evidence/libastro_fyne_text_experiment.so" \
  "$task_trace/target/release/libastro_fyne_fontations_experiment.a" \
  "$ATF_SCALER_TRACE_SOURCE" > "$task_trace/evidence/compiled.sha256"
sha256sum --check "$task_work/evidence/compiled.sha256"
