#include "monitor_settings.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <string.h>
void monitor_settings_defaults(monitor_settings_t *s) {
    *s=(monitor_settings_t){.schema=1,.mask=15,.order={0,1,2,3},.dark=1,.big_values=0,.show_minmax=1,.cycle_seconds=0};
}
bool monitor_settings_load(monitor_settings_t *s) {
    monitor_settings_defaults(s);
    if(nvs_flash_init()!=ESP_OK)return false;
    nvs_handle_t handle;
    if(nvs_open("monitor",NVS_READONLY,&handle)!=ESP_OK)return true;
    monitor_settings_t saved;size_t size=sizeof(saved);
    esp_err_t result=nvs_get_blob(handle,"display",&saved,&size);nvs_close(handle);
    if(result==ESP_ERR_NVS_NOT_FOUND)return true;
    if(result!=ESP_OK||size!=sizeof(saved)||saved.schema!=1||!saved.mask||saved.mask>15)return false;
    unsigned seen=0;for(int i=0;i<4;i++){if(saved.order[i]>3||(seen&(1<<saved.order[i])))return false;seen|=1<<saved.order[i];}
    if(saved.dark>1||saved.big_values>1||saved.show_minmax>1)return false;
    if(saved.cycle_seconds!=0&&saved.cycle_seconds!=5&&saved.cycle_seconds!=10&&saved.cycle_seconds!=15&&saved.cycle_seconds!=30&&saved.cycle_seconds!=60)return false;
    *s=saved;return true;
}
bool monitor_settings_save(const monitor_settings_t *s) {
    nvs_handle_t handle;if(nvs_open("monitor",NVS_READWRITE,&handle)!=ESP_OK)return false;
    esp_err_t result=nvs_set_blob(handle,"display",s,sizeof(*s));
    if(result==ESP_OK) result=nvs_commit(handle);
    nvs_close(handle);
    return result==ESP_OK;
}
