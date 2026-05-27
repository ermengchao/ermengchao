#!/usr/bin/env fish

set -l root (realpath (dirname (status --current-filename))/..)
set -l assets_dir "$root/assets"
set -l scale_factor 5

fd . "$assets_dir" -e json -x codesnap -f {} -o {//}/light.svg --mac-window-bar=false --title="{/.}.json" --shadow-color '#00000000' --scale-factor $scale_factor --config $XDG_CONFIG_HOME/codesnap/catppuccin-latte.json
fd . "$assets_dir" -e json -x codesnap -f {} -o {//}/dark.svg --mac-window-bar=false --title="{/.}.json" --shadow-color '#00000000' --scale-factor $scale_factor --config $XDG_CONFIG_HOME/codesnap/catppuccin-mocha.json
