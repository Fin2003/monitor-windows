#pragma once
#include <stdbool.h>
#include "esp_lcd_panel_ops.h"
typedef bool (*monitor_send_fn)(const char *line);
void monitor_capture_init(esp_lcd_panel_handle_t panel);
bool monitor_capture_command(const char *json, monitor_send_fn send);
