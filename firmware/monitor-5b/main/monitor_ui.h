#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
void monitor_ui_init(void);
bool monitor_ui_apply(const char *json, int *sequence);
bool monitor_ui_pop_navigation(int *page);
bool monitor_ui_pop_command(char *json);
void monitor_ui_preferences_json(char *json, size_t size);
/* Call from a task with an internal-RAM stack: writes pending settings to NVS. */
void monitor_ui_service_save(void);
void monitor_ui_diagnostics_json(char *json, size_t size);
void monitor_ui_request_radar_detail(const char *mode, const char *id);
bool monitor_ui_radar_detail_active(void);
/* Status tap: manual reset marking while waiting, otherwise status history. Recent tap: undo a manual mark, otherwise reset history. */
void monitor_ui_radar_status_tap(void);
void monitor_ui_radar_recent_tap(void);
bool monitor_ui_manual_active(void);
/* Test hook: option count of the open marker's day (0), hour (1) or minute (2) roller. */
int monitor_ui_manual_option_count(int which);
