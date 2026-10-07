#include "monitor_input.h"
#include <string.h>
#include "cJSON.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "lvgl.h"

/* One gesture at a time: press at (x1,y1), move linearly to (x2,y2) over move_us, hold, release. */
typedef struct { int64_t start_us, move_us; int x1, y1, x2, y2; bool active; } gesture_t;
enum { HOLD_US = 60000 };

static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static gesture_t gesture;
static lv_point_t last;

static int clamp(int value, int low, int high) { return value < low ? low : value > high ? high : value; }

static void read_cb(lv_indev_drv_t *driver, lv_indev_data_t *data) {
    (void)driver;
    gesture_t g;
    portENTER_CRITICAL(&lock); g = gesture; portEXIT_CRITICAL(&lock);
    data->state = LV_INDEV_STATE_RELEASED;
    if (g.active) {
        int64_t t = esp_timer_get_time() - g.start_us;
        if (t < g.move_us + HOLD_US) {
            float k = g.move_us > 0 && t < g.move_us ? (float)t / (float)g.move_us : 1.0f;
            last.x = (lv_coord_t)(g.x1 + (g.x2 - g.x1) * k);
            last.y = (lv_coord_t)(g.y1 + (g.y2 - g.y1) * k);
            data->state = LV_INDEV_STATE_PRESSED;
        } else {
            portENTER_CRITICAL(&lock); if (gesture.start_us == g.start_us) gesture.active = false; portEXIT_CRITICAL(&lock);
        }
    }
    data->point = last;
}

void monitor_input_init(void) {
    static lv_indev_drv_t driver;
    lv_indev_drv_init(&driver);
    driver.type = LV_INDEV_TYPE_POINTER;
    driver.read_cb = read_cb;
    lv_indev_drv_register(&driver);
}

static int field(cJSON *root, const char *key, int fallback) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    return cJSON_IsNumber(item) ? item->valueint : fallback;
}

bool monitor_input_command(const char *json) {
    if (!strstr(json, "\"input\"")) return false;
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;
    cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type"), *action = cJSON_GetObjectItemCaseSensitive(root, "action");
    if (!cJSON_IsString(type) || strcmp(type->valuestring, "input") || !cJSON_IsString(action)) { cJSON_Delete(root); return false; }
    bool swipe = !strcmp(action->valuestring, "swipe");
    if (swipe || !strcmp(action->valuestring, "tap")) {
        gesture_t g = { .start_us = esp_timer_get_time(), .active = true };
        g.x1 = clamp(field(root, "x", 0), 0, 1023); g.y1 = clamp(field(root, "y", 0), 0, 599);
        g.x2 = swipe ? clamp(field(root, "x2", g.x1), 0, 1023) : g.x1;
        g.y2 = swipe ? clamp(field(root, "y2", g.y1), 0, 599) : g.y1;
        g.move_us = (int64_t)clamp(field(root, "ms", swipe ? 250 : 80), 20, 2000) * 1000;
        portENTER_CRITICAL(&lock); gesture = g; portEXIT_CRITICAL(&lock);
    }
    cJSON_Delete(root);
    return true;
}
