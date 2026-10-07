#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef struct {
    uint32_t schema, mask, order[4], dark, big_values, show_minmax, cycle_seconds;
} monitor_settings_t;
void monitor_settings_defaults(monitor_settings_t *settings);
bool monitor_settings_load(monitor_settings_t *settings);
bool monitor_settings_save(const monitor_settings_t *settings);
