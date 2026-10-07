#pragma once
#include "lvgl.h"
#define ESP_OK 0
static inline int esp_lv_adapter_lock(int timeout) { (void)timeout; return ESP_OK; }
static inline void esp_lv_adapter_unlock(void) {}
