#pragma once
#include "lvgl.h"
#include "cJSON.h"
void monitor_background_init(void);
bool monitor_background_apply(cJSON *message);
bool monitor_background_active(void);
void monitor_background_style(lv_obj_t *panel);
