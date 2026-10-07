#pragma once
#include <stdbool.h>

/* Virtual pointer driven from the PC editor: taps and swipes go through LVGL exactly like the GT911. */
void monitor_input_init(void);
/* Handles {"v":1,"type":"input","action":"tap"|"swipe","x":..,"y":..,"x2":..,"y2":..,"ms":..}. */
bool monitor_input_command(const char *json);
