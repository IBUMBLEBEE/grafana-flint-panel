#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
entry_image="$repo_root/src/img/screenshots/ai-chart-studio-entry.png"
source_image="$repo_root/src/img/screenshots/ai-chart-studio.png"
output_gif="$repo_root/src/img/screenshots/ai-chart-studio.gif"
frames_dir="$(mktemp -d)"
trap 'rm -rf "$frames_dir"' EXIT

font="Noto-Sans-Regular"
width=1200
height=647

render_frame() {
  local output="$1"
  shift
  magick "$source_image" -resize "${width}x${height}!" -style Normal "$@" "$output"
}

render_entry_frame() {
  local output="$1"
  shift
  magick "$entry_image" -resize "${width}x${height}!" -style Normal "$@" "$output"
}

chat_clear=(
  -fill '#181b1f' -stroke none -draw 'rectangle 846,84 1199,530'
  -fill '#30343b' -draw 'rectangle 846,84 1199,84'
)

composer_clear=(
  -fill '#111217' -stroke '#34373d' -strokewidth 1 -draw 'roundrectangle 861,544 1188,605 5,5'
  -stroke none
)

set_step_badge() {
  local number="$1"
  local label="$2"
  badge=(
    -fill '#ff780a' -stroke none -draw 'circle 866,105 878,105' \
    -fill '#111217' -font "$font" -pointsize 13 -gravity NorthWest -annotate +862+96 "$number" \
    -fill '#f4f5f5' -font "$font" -pointsize 14 -gravity NorthWest -annotate +887+96 "$label"
  )
}

draw_cursor=(
  -fill '#f4f5f5' -stroke '#111217' -strokewidth 1.4
  -draw 'polygon 1159,617 1159,639 1165,633 1170,643 1175,640 1170,631 1178,631'
)

# Start in the Panel editor, guide the cursor to AI Assist, and click the
# actual Open AI Chart Studio button before continuing with the existing flow.
render_entry_frame "$frames_dir/entry-00.png"

render_entry_frame "$frames_dir/entry-01.png" \
  -fill none -stroke '#ff780a' -strokewidth 3 \
  -draw 'roundrectangle 980,405 1193,437 6,6' \
  -fill '#f4f5f5' -stroke '#111217' -strokewidth 1.4 \
  -draw 'polygon 1018,470 1018,492 1024,486 1029,496 1034,493 1029,484 1037,484'

render_entry_frame "$frames_dir/entry-02.png" \
  -fill none -stroke '#ff780a' -strokewidth 3 \
  -draw 'roundrectangle 980,405 1193,437 6,6' \
  -fill '#ffb35755' -stroke '#ffb357' -strokewidth 3 \
  -draw 'circle 1086,421 1104,421' \
  -fill '#f4f5f5' -stroke '#111217' -strokewidth 1.4 \
  -draw 'polygon 1080,423 1080,445 1086,439 1091,449 1096,446 1091,437 1099,437'

# 0: establish the empty workspace.
render_frame "$frames_dir/00.png"

# 1-4: type the request into the real composer.
typing_prompts=(
  'Turn monthly'
  'Turn monthly new users'
  'Turn monthly new users into a'
  $'Turn monthly new users into a cumulative\nwaterfall chart.'
)

for index in "${!typing_prompts[@]}"; do
  frame_number=$((index + 1))
  set_step_badge '1' 'Describe the chart'
  render_frame "$frames_dir/0${frame_number}.png" \
    "${chat_clear[@]}" \
    "${badge[@]}" \
    "${composer_clear[@]}" \
    -fill '#d8d9da' -font "$font" -pointsize 15 -gravity NorthWest \
    -annotate +872+554 "${typing_prompts[$index]}" \
    -fill '#30343b' -stroke none -draw 'roundrectangle 1148,612 1188,640 5,5' \
    -fill '#d8d9da' -font "$font" -pointsize 13 -gravity NorthWest -annotate +1157+617 'Send' \
    "${draw_cursor[@]}"
done

# 5: the conversation is sent and Generate proposal becomes the next action.
set_step_badge '2' 'Generate a proposal'
render_frame "$frames_dir/05.png" \
  "${chat_clear[@]}" \
  "${badge[@]}" \
  -fill '#22252b' -stroke '#34373d' -strokewidth 1 -draw 'roundrectangle 870,135 1182,206 6,6' \
  -stroke none \
  -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +881+143 'You' \
  -fill '#f4f5f5' -font "$font" -pointsize 14 -gravity NorthWest \
  -annotate +881+164 $'Turn monthly new users into a cumulative\nwaterfall chart.' \
  -fill '#ff780a' -stroke none -draw 'roundrectangle 1038,47 1180,72 5,5' \
  -fill '#111217' -font "$font" -pointsize 13 -gravity NorthWest -annotate +1055+52 'Generate proposal' \
  -fill none -stroke '#ffb357' -strokewidth 3 -draw 'circle 1167,58 1181,58' \
  -fill '#f4f5f5' -stroke '#111217' -strokewidth 1.4 \
  -draw 'polygon 1160,61 1160,83 1166,77 1171,87 1176,84 1171,75 1179,75'

# 6-7: AI uses the current Panel fields while the preview is being compiled.
for index in 0 1; do
  angle=$((index * 180))
  frame_number=$((index + 6))
  set_step_badge '2' 'AI reads the current Panel context'
  render_frame "$frames_dir/0${frame_number}.png" \
    "${chat_clear[@]}" \
    -fill '#08090bcc' -stroke none -draw 'rectangle 8,116 839,646' \
    -fill '#181b1f' -stroke '#34373d' -strokewidth 1 -draw 'roundrectangle 270,318 579,380 8,8' \
    -fill '#ff780a' -stroke none -draw "arc 292,335 316,359 ${angle},$((angle + 110))" \
    -fill '#f4f5f5' -font "$font" -pointsize 15 -gravity NorthWest -annotate +326+331 'Generating proposal…' \
    -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +326+352 'Using period + newUsers' \
    "${badge[@]}" \
    -fill '#22252b' -stroke '#34373d' -strokewidth 1 -draw 'roundrectangle 870,135 1182,206 6,6' \
    -stroke none \
    -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +881+143 'You' \
    -fill '#f4f5f5' -font "$font" -pointsize 14 -gravity NorthWest \
    -annotate +881+164 $'Turn monthly new users into a cumulative\nwaterfall chart.' \
    -fill '#ff780a' -stroke none -draw 'roundrectangle 1042,47 1180,72 5,5' \
    -fill '#111217' -font "$font" -pointsize 13 -gravity NorthWest -annotate +1071+52 'Generating…'
done

# 8: the generated draft is visible but deliberately not applied yet.
set_step_badge '3' 'Review the live preview'
render_frame "$frames_dir/08.png" \
  "${chat_clear[@]}" \
  "${badge[@]}" \
  -fill '#22252b' -stroke '#34373d' -strokewidth 1 -draw 'roundrectangle 870,127 1182,190 6,6' \
  -stroke none \
  -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +881+135 'You' \
  -fill '#f4f5f5' -font "$font" -pointsize 13 -gravity NorthWest \
  -annotate +881+155 $'Turn monthly new users into a cumulative\nwaterfall chart.' \
  -fill '#ff780a22' -stroke '#ff780a' -strokewidth 1 -draw 'circle 879,224 891,224' \
  -stroke none \
  -fill '#ffb357' -font "$font" -pointsize 10 -gravity NorthWest -annotate +873+217 'AI' \
  -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +900+211 'AI Assist' \
  -fill '#d8d9da' -font "$font" -pointsize 13 -gravity NorthWest \
  -annotate +900+231 $'Created a waterfall proposal from period\nand newUsers. Review it before applying.' \
  -fill '#202328' -stroke '#3f434a' -strokewidth 1 -draw 'roundrectangle 870,300 1182,444 7,7' \
  -stroke none \
  -fill '#f4f5f5' -font "$font" -pointsize 15 -gravity NorthWest -annotate +884+315 'Waterfall proposal' \
  -fill '#73bf69' -stroke none -draw 'circle 892,350 897,350' \
  -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +904+342 'Preview ready · not applied' \
  -fill '#ff780a' -stroke none -draw 'roundrectangle 884,388 953,423 5,5' \
  -fill '#111217' -font "$font" -pointsize 13 -gravity NorthWest -annotate +901+398 'Apply' \
  -fill '#181b1f' -stroke '#555a63' -strokewidth 1 -draw 'roundrectangle 962,388 1040,423 5,5' \
  -stroke none \
  -fill '#d8d9da' -font "$font" -pointsize 13 -gravity NorthWest -annotate +976+398 'Discard' \
  -fill none -stroke '#73bf69' -strokewidth 2 -draw 'roundrectangle 8,116 839,646 3,3'

# 9: explicitly apply the reviewed proposal.
set_step_badge '4' 'Apply to the Panel'
render_frame "$frames_dir/09.png" \
  "${chat_clear[@]}" \
  "${badge[@]}" \
  -fill '#22252b' -stroke '#34373d' -strokewidth 1 -draw 'roundrectangle 870,127 1182,190 6,6' \
  -stroke none \
  -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +881+135 'You' \
  -fill '#f4f5f5' -font "$font" -pointsize 13 -gravity NorthWest \
  -annotate +881+155 $'Turn monthly new users into a cumulative\nwaterfall chart.' \
  -fill '#ff780a22' -stroke '#ff780a' -strokewidth 1 -draw 'circle 879,224 891,224' \
  -stroke none \
  -fill '#ffb357' -font "$font" -pointsize 10 -gravity NorthWest -annotate +873+217 'AI' \
  -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +900+211 'AI Assist' \
  -fill '#d8d9da' -font "$font" -pointsize 13 -gravity NorthWest \
  -annotate +900+231 $'Created a waterfall proposal from period\nand newUsers. Review it before applying.' \
  -fill '#202328' -stroke '#3f434a' -strokewidth 1 -draw 'roundrectangle 870,300 1182,444 7,7' \
  -stroke none \
  -fill '#f4f5f5' -font "$font" -pointsize 15 -gravity NorthWest -annotate +884+315 'Waterfall proposal' \
  -fill '#73bf69' -stroke none -draw 'circle 892,350 897,350' \
  -fill '#9b9fa7' -font "$font" -pointsize 12 -gravity NorthWest -annotate +904+342 'Preview ready · not applied' \
  -fill '#ff780a' -stroke none -draw 'roundrectangle 884,388 953,423 5,5' \
  -fill '#111217' -font "$font" -pointsize 13 -gravity NorthWest -annotate +901+398 'Apply' \
  -fill none -stroke '#ffb357' -strokewidth 3 -draw 'circle 920,405 937,405' \
  -fill '#f4f5f5' -stroke '#111217' -strokewidth 1.4 \
  -draw 'polygon 914,407 914,429 920,423 925,433 930,430 925,421 933,421'

# 10: applied confirmation and stable final Panel preview.
set_step_badge '4' 'Saved to Panel options'
render_frame "$frames_dir/10.png" \
  "${chat_clear[@]}" \
  "${badge[@]}" \
  -fill '#1f2d24' -stroke '#3d7049' -strokewidth 1 -draw 'roundrectangle 870,139 1182,211 7,7' \
  -stroke none \
  -fill '#73bf69' -stroke none -draw 'circle 893,174 904,174' \
  -fill '#111217' -font "$font" -pointsize 14 -gravity NorthWest -annotate +888+165 '✓' \
  -fill '#d8d9da' -font "$font" -pointsize 14 -gravity NorthWest \
  -annotate +918+153 $'Applied to Panel\nThe reviewed chart is now saved.' \
  -fill none -stroke '#73bf69' -strokewidth 2 -draw 'roundrectangle 8,116 839,646 3,3'

# GIF delays are in centiseconds. Longer holds make the story readable without
# requiring a high frame rate or a large README asset.
magick \
  -delay 110 "$frames_dir/entry-00.png" \
  -delay 55 "$frames_dir/entry-01.png" \
  -delay 45 "$frames_dir/entry-02.png" \
  -delay 85 "$frames_dir/00.png" \
  -delay 16 "$frames_dir/01.png" \
  -delay 16 "$frames_dir/02.png" \
  -delay 16 "$frames_dir/03.png" \
  -delay 55 "$frames_dir/04.png" \
  -delay 65 "$frames_dir/05.png" \
  -delay 15 "$frames_dir/06.png" \
  -delay 15 "$frames_dir/07.png" \
  -delay 110 "$frames_dir/08.png" \
  -delay 45 "$frames_dir/09.png" \
  -delay 135 "$frames_dir/10.png" \
  -loop 0 +dither -colors 256 "$output_gif"

printf 'Wrote %s\n' "$output_gif"
