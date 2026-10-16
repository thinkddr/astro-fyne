#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Run on a hosted Linux builder.
set -euo pipefail
task_proposal="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_phase="${1:?Usage: build-remote.sh --resolve|--build --work DIR}"
[[ "${2:-}" == --work && -n "${3:-}" && $# == 3 ]]
task_work="$(realpath -m "$3")"
if [[ "$task_phase" == --resolve ]]; then
  python3 "$task_proposal/resolve.py" --work "$task_work"
  exit
fi
[[ "$task_phase" == --build ]]
[[ -f "$task_work/sources.json" && -f "$task_work/assembly/Cargo.lock" ]]
mkdir -p "$task_work/evidence"
exec > >(tee "$task_work/evidence/build.log") 2>&1
for task_tool in clang clang++ llvm-ar ninja cmake meson rustc cargo; do
  command -v "$task_tool"
  "$task_tool" --version
  sha256sum "$(realpath "$(command -v "$task_tool")")"
done
if command -v rustup >/dev/null; then
  sha256sum "$(rustup which rustc)" "$(rustup which cargo)"
fi
uname -a
ldd --version
pkg-config --modversion zlib libwoff2dec
export CC=clang CXX=clang++ AR=llvm-ar
export CARGO_BUILD_JOBS=2
export RUSTFLAGS='-C relocation-model=pic'
export SKIA_INCLUDE_ROOT="$task_work/skia"
(
  cd "$task_work/skia"
  python3 bin/fetch-gn
  sha256sum bin/gn
  bin/gn --version
  task_dependencies_ready=false
  for task_attempt in 1 2 3; do
    echo "Pinned Skia dependency sync attempt $task_attempt"
    if python3 tools/git-sync-deps; then
      task_dependencies_ready=true
      break
    fi
    if [[ "$task_attempt" -lt 3 ]]; then sleep "$((task_attempt * 5))"; fi
  done
  [[ "$task_dependencies_ready" == true ]]
  bin/gn gen out/text-probe --fail-on-unused-args --args="$(cat "$task_proposal/gn.args")"
  ninja -j2 -C out/text-probe skia
  ninja -C out/text-probe -t commands skia > "$task_work/evidence/skia-commands.txt"
)
cmake -S "$task_work/harfbuzz" -B "$task_work/harfbuzz/out" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_SHARED_LIBS=OFF \
  -DHB_HAVE_FREETYPE=OFF -DHB_HAVE_ICU=OFF -DHB_HAVE_GLIB=OFF -DHB_HAVE_GRAPHITE2=OFF \
  -DHB_BUILD_UTILS=OFF -DHB_BUILD_SUBSET=OFF -DHB_BUILD_RASTER=OFF -DHB_BUILD_VECTOR=OFF -DHB_BUILD_GPU=OFF
cmake --build "$task_work/harfbuzz/out" --target harfbuzz --parallel 2
meson setup "$task_work/ots/out" "$task_work/ots" --buildtype=release \
  --wrap-mode=nofallback -Dgraphite=false -Ddefault_library=static -Db_staticpic=true
meson compile -C "$task_work/ots/out" -j2 ots
(
  cd "$task_work/assembly"
  CXXFLAGS="-I$task_work/assembly" CC_ENABLE_DEBUG_OUTPUT=1 cargo build --release --locked -vv
  cargo metadata --locked --format-version 1 > "$task_work/evidence/cargo-metadata-built.json"
  cargo tree --locked -e features > "$task_work/evidence/cargo-features.txt"
)
clang++ -std=c++20 -O2 -fPIC -fno-rtti -shared -DSK_RELEASE -I"$task_work/assembly" \
  -I"$task_work/skia" -I"$task_work/skia/out/text-probe/gen" \
  -I"$task_work/harfbuzz/src" -I"$task_work/harfbuzz/out/src" -I"$task_work/ots/include" \
  "$task_work/assembly/text_engine.cc" -Wl,--start-group \
  "$task_work/assembly/target/release/libastro_fyne_fontations_experiment.a" \
  "$task_work/skia/out/text-probe/libskia.a" "$task_work/harfbuzz/out/libharfbuzz.a" \
  "$task_work/ots/out/libots.a" -Wl,--end-group \
  $(pkg-config --libs zlib libwoff2dec) -lpthread -ldl -lm \
  -Wl,-Map,"$task_work/evidence/native-link.map" -Wl,--no-undefined \
  -o "$task_work/evidence/libastro_fyne_text_experiment.so"
ldd -v "$task_work/evidence/libastro_fyne_text_experiment.so" > "$task_work/evidence/linked-libraries.txt"
sha256sum "$task_work/assembly/Cargo.lock" "$task_work/evidence/libastro_fyne_text_experiment.so" \
  "$task_work/skia/out/text-probe/libskia.a" "$task_work/harfbuzz/out/libharfbuzz.a" \
  "$task_work/ots/out/libots.a" > "$task_work/evidence/compiled.sha256"
cp "$task_proposal/gn.args" "$task_work/evidence/gn.args"
cp "$task_work/assembly/Cargo.lock" "$task_work/evidence/Cargo.lock"
cp "$task_work/harfbuzz/out/compile_commands.json" "$task_work/evidence/harfbuzz-commands.json"
cp "$task_work/ots/out/compile_commands.json" "$task_work/evidence/ots-commands.json"
python3 "$task_proposal/collect-notices.py" --work "$task_work"
for task_source in skia harfbuzz ots; do
  git -C "$task_work/$task_source" diff --exit-code
  git -C "$task_work/$task_source" status --short > "$task_work/evidence/$task_source-status.txt"
done
echo 'Native experimental library built; no pixel or widget claim follows from compilation'
