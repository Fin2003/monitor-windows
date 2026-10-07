/* Desktop adapter for the same LVGL UI and touch logic used by the ESP32 firmware. */
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lvgl.h"
#include "monitor_ui.h"
#include "cJSON.h"

static uint32_t ticks = 1000;
static lv_color_t frame[1024 * 600], draw_buffer[1024 * 40];
static int pressed, mouse_x, mouse_y, dirty;
static lv_indev_t *mouse_input;
int64_t esp_timer_get_time(void) { return (int64_t)ticks * 1000; }
static void flush(lv_disp_drv_t *driver, const lv_area_t *area, lv_color_t *pixels) {
    for (int y=area->y1; y<=area->y2; y++) {
        memcpy(frame + y*1024 + area->x1, pixels, (area->x2-area->x1+1)*sizeof(*pixels));
        pixels += area->x2-area->x1+1;
    }
    dirty=1;
    lv_disp_flush_ready(driver);
}
static void mouse(lv_indev_drv_t *driver, lv_indev_data_t *data) {
    (void)driver;
    data->point.x=mouse_x; data->point.y=mouse_y;
    data->state=pressed ? LV_INDEV_STATE_PR : LV_INDEV_STATE_REL;
}
static void apply(const char *line) {
    cJSON *root=cJSON_Parse(line);
    if (!root) return;
    const cJSON *type=cJSON_GetObjectItemCaseSensitive(root,"type");
    if (cJSON_IsString(type) && !strcmp(type->valuestring,"pointer")) {
        mouse_x=cJSON_GetObjectItemCaseSensitive(root,"x")->valueint;
        mouse_y=cJSON_GetObjectItemCaseSensitive(root,"y")->valueint;
        pressed=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root,"pressed"));
        /* Preserve each pointer sample even when several arrive in one pipe read. */
        lv_indev_read_timer_cb(mouse_input->driver->read_timer);
    } else {
        int seq=0;
        monitor_ui_apply(line,&seq);
    }
    cJSON_Delete(root);
}
int main(void) {
    _setmode(_fileno(stdin),_O_BINARY); _setmode(_fileno(stdout),_O_BINARY);
    setvbuf(stdout,NULL,_IONBF,0);
    lv_init(); lv_tick_inc(ticks);
    static lv_disp_draw_buf_t buffer;
    lv_disp_draw_buf_init(&buffer,draw_buffer,NULL,1024*40);
    static lv_disp_drv_t driver;
    lv_disp_drv_init(&driver); driver.hor_res=1024; driver.ver_res=600;
    driver.flush_cb=flush; driver.draw_buf=&buffer; lv_disp_drv_register(&driver);
    static lv_indev_drv_t input;
    lv_indev_drv_init(&input); input.type=LV_INDEV_TYPE_POINTER; input.read_cb=mouse;
    mouse_input=lv_indev_drv_register(&input); monitor_ui_init();
    HANDLE pipe=GetStdHandle(STD_INPUT_HANDLE);
    char *pending=calloc(1,262144); size_t length=0;
    ULONGLONG last=GetTickCount64(), last_frame=0, last_state=0;
    for (;;) {
        DWORD available=0, read=0;
        if (!PeekNamedPipe(pipe,NULL,0,NULL,&available,NULL)) break;
        if (available) {
            DWORD amount=(DWORD)(262143-length);
            if (amount>available) amount=available;
            if (!ReadFile(pipe,pending+length,amount,&read,NULL) || !read) break;
            length+=read; pending[length]=0;
            char *start=pending, *end;
            while ((end=strchr(start,'\n'))) { *end=0; apply(start); start=end+1; }
            length-=start-pending; memmove(pending,start,length); pending[length]=0;
        }
        ULONGLONG now=GetTickCount64();
        uint32_t elapsed=(uint32_t)(now-last); last=now; ticks+=elapsed; lv_tick_inc(elapsed);
        lv_timer_handler(); monitor_ui_service_save();
        int page;
        if (monitor_ui_pop_navigation(&page)) printf("EVENT {\"type\":\"navigate\",\"page\":%d}\n",page);
        char command[1024];
        while (monitor_ui_pop_command(command)) printf("EVENT %s\n",command);
        if (now-last_state>=250) {
            char diagnostics[512]; monitor_ui_diagnostics_json(diagnostics,sizeof(diagnostics));
            printf("STATE {%s}\n",diagnostics); last_state=now;
        }
        if (dirty && now-last_frame>=50) {
            printf("FRAME %u\n",(unsigned)sizeof(frame)); fwrite(frame,1,sizeof(frame),stdout);
            dirty=0; last_frame=now;
        }
        Sleep(5);
    }
    free(pending);
    return 0;
}
