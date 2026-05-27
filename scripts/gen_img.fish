#!/usr/bin/env fish

fd . ../assets -e json -x codesnap -f {} -o {//}/light.png --mac-window-bar=false --title="{/.}.json" --shadow-color '#00000000' --config $XDG_CONFIG_HOME/codesnap/catppuccin-latte.json
fd . ../assets -e json -x codesnap -f {} -o {//}/dark.png --mac-window-bar=false --title="{/.}.json" --shadow-color '#00000000' --config $XDG_CONFIG_HOME/codesnap/catppuccin-mocha.json
