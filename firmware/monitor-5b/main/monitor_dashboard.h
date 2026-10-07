#pragma once
#include "lvgl.h"
#include "cJSON.h"
lv_obj_t *monitor_dashboard_create(lv_obj_t *parent);
void monitor_dashboard_apply(cJSON *data, bool show_minmax);
void monitor_dashboard_status(bool online);
void monitor_dashboard_theme(bool dark);
/* Simulator only: shows the Coding Plan card in its wide, single and tall shapes. */
void monitor_dashboard_preview_coding_shapes(void);
