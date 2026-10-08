/* Hardware initialization adapted from Waveshare / Espressif's CC0 example. */
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "cJSON.h"
#include "esp_lv_adapter.h"
#include "driver/usb_serial_jtag.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/idf_additions.h"
#include "waveshare_rgb_lcd_port.h"
#include "monitor_ui.h"
#include "monitor_capture.h"
#include "monitor_input.h"
#include "monitor_lights.h"

#define MAX_LINE 16384

static void *json_alloc(size_t size) { return heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT); }

static bool send_line(const char *line)
{
    size_t remaining = strlen(line);
    while (remaining) {
        size_t chunk = remaining > 256 ? 256 : remaining;
        int n = usb_serial_jtag_write_bytes(line, chunk, pdMS_TO_TICKS(1000));
        if (n <= 0) return false;
        line += n;
        remaining -= n;
    }
    return true;
}

static void serial_task(void *arg)
{
    char *line = heap_caps_malloc(MAX_LINE + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    assert(line);
    size_t used = 0;
    bool dropping = false;
    int64_t last_hello = -3000000;
    uint8_t input[512];
    unsigned received = 0, lines = 0;
    for (;;) {
        int64_t now = esp_timer_get_time();
        if (now - last_hello >= 2000000) {
            char diagnostic[300], lights[1000], hello[1800], preferences[700];
            if(esp_lv_adapter_lock(100)==ESP_OK) {
                monitor_ui_diagnostics_json(diagnostic,sizeof(diagnostic));
                monitor_ui_preferences_json(preferences,sizeof(preferences));
                monitor_lights_diagnostics(lights,sizeof(lights));
                esp_lv_adapter_unlock();
                snprintf(hello,sizeof(hello),"{\"v\":1,\"type\":\"hello\",\"board\":\"ESP32-S3-Touch-LCD-5B\",\"width\":1024,\"height\":600,\"firmware\":\"monitor-native-0.16.0-background\",\"background\":true,\"capture\":true,\"input\":true,\"freeHeap\":%u,\"freePsram\":%u,\"usbRx\":%u,\"usbLines\":%u,%s,%s}\n",(unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),(unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),received,lines,diagnostic,lights);
                send_line(hello);send_line(preferences);
            }
            last_hello = now;
        }
        int page;
        while (monitor_ui_pop_navigation(&page)) {
            char reply[96];
            snprintf(reply, sizeof(reply), "{\"v\":1,\"type\":\"navigate\",\"page\":%d}\n", page);
            send_line(reply);
        }
        monitor_ui_service_save();
        char command[1024];
        while(monitor_ui_pop_command(command))send_line(command);
        while(monitor_lights_pop_reply(command,sizeof(command)))send_line(command);
        int count = usb_serial_jtag_read_bytes(input, sizeof(input), pdMS_TO_TICKS(20));
        if (count > 0) received += count;
        for (int i = 0; i < count; i++) {
            if (input[i] == '\n') {
                lines++;
                if (!dropping && used) {
                    line[used] = 0;
                    int sequence;
                    if (!monitor_lights_command(line) && !monitor_capture_command(line,send_line) && !monitor_input_command(line) && monitor_ui_apply(line, &sequence)) {
                        if (sequence == -2) { send_line("{\"v\":1,\"type\":\"background_ack\"}\n"); }
                        else if (sequence >= 0) {
                        char reply[80];
                        snprintf(reply, sizeof(reply), "{\"v\":1,\"type\":\"ack\",\"seq\":%d}\n", sequence);
                        send_line(reply);
                        }
                    }
                }
                used = 0; dropping = false;
            } else if (!dropping) {
                if (used >= MAX_LINE - 1) { dropping = true; used = 0; }
                else line[used++] = input[i];
            }
        }
    }
}

void app_main(void)
{
    /* Leave internal RAM for the radio/DMA; LVGL objects and JSON live in PSRAM. */
    heap_caps_malloc_extmem_enable(64);
    cJSON_Hooks json_hooks = { .malloc_fn = json_alloc, .free_fn = heap_caps_free };
    cJSON_InitHooks(&json_hooks);
    const esp_lv_adapter_rotation_t rotation = ESP_LV_ADAPTER_ROTATE_0;
    const esp_lv_adapter_tear_avoid_mode_t tear_mode = ESP_LV_ADAPTER_TEAR_AVOID_MODE_DEFAULT_RGB;
    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_touch_handle_t touch = NULL;
    ESP_ERROR_CHECK(waveshare_esp32_s3_rgb_lcd_init(tear_mode, rotation, &panel, &touch));
    ESP_ERROR_CHECK(waveshare_rgb_lcd_backlight_on());
    monitor_capture_init(panel);
    esp_lv_adapter_config_t adapter = ESP_LV_ADAPTER_DEFAULT_CONFIG();
    adapter.task_stack_size = 12 * 1024;
    adapter.stack_in_psram = true;
    ESP_ERROR_CHECK(esp_lv_adapter_init(&adapter));
    esp_lv_adapter_display_config_t config = ESP_LV_ADAPTER_DISPLAY_RGB_DEFAULT_CONFIG(panel, NULL, EXAMPLE_LCD_H_RES, EXAMPLE_LCD_V_RES, rotation);
    config.profile.use_psram = true;
    lv_display_t *display = esp_lv_adapter_register_display(&config);
    assert(display);
    if (touch) {
        esp_lv_adapter_touch_config_t tc = ESP_LV_ADAPTER_TOUCH_DEFAULT_CONFIG(display, touch);
        assert(esp_lv_adapter_register_touch(&tc));
    }
    ESP_ERROR_CHECK(esp_lv_adapter_start());
    ESP_ERROR_CHECK(esp_lv_adapter_lock(-1));
    monitor_ui_init();
    monitor_input_init();
    esp_lv_adapter_unlock();
    usb_serial_jtag_driver_config_t usb = { .rx_buffer_size = 8192, .tx_buffer_size = 1024 };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb));
    esp_log_level_set("*", ESP_LOG_NONE);
    monitor_lights_init();
    assert(xTaskCreateWithCaps(serial_task, "monitor_usb", 12 * 1024, NULL, 4, NULL, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) == pdPASS);
}
