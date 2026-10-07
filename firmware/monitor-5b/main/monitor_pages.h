#pragma once
#include <stdbool.h>
#include "lvgl.h"
#include "cJSON.h"

lv_obj_t *monitor_pages_create(lv_obj_t *parent);
bool monitor_pages_apply(cJSON *data, bool show_minmax);
void monitor_pages_show(bool visible);
void monitor_pages_status(bool online);
void monitor_pages_theme(bool dark);
