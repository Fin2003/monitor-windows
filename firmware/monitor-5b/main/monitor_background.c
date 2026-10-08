#include "monitor_background.h"
#include <stdlib.h>
#include <string.h>
#ifdef ESP_PLATFORM
#include "esp_heap_caps.h"
#endif

/* Half-resolution RGB565 keeps the image within the 5B's remaining PSRAM budget.
 * The host retains the source and resends it when the board reconnects. */
static lv_obj_t *image;
static uint8_t *pixels;
static size_t received;
static bool active;
static lv_img_dsc_t descriptor;
bool monitor_background_active(void) { return active; }
void monitor_background_init(void) {
    image=lv_img_create(lv_scr_act());lv_obj_set_pos(image,0,0);
    lv_obj_clear_flag(image,LV_OBJ_FLAG_CLICKABLE);lv_obj_add_flag(image,LV_OBJ_FLAG_HIDDEN);
    lv_obj_move_background(image);
}
static void clear(void) {
    active=false;received=0;lv_obj_add_flag(image,LV_OBJ_FLAG_HIDDEN);
    lv_img_cache_invalidate_src(&descriptor);free(pixels);pixels=NULL;
}
static int digit(char c) { return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1; }
bool monitor_background_apply(cJSON *message) {
    cJSON *type=cJSON_GetObjectItemCaseSensitive(message,"type");
    if(!cJSON_IsString(type))return false;
    if(!strcmp(type->valuestring,"background_clear")){clear();return true;}
    if(!strcmp(type->valuestring,"background_begin")) {
        clear();
#ifdef ESP_PLATFORM
        pixels=heap_caps_malloc(512*300*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
#else
        pixels=malloc(512*300*2);
#endif
        return pixels!=NULL;
    }
    if(!strcmp(type->valuestring,"background_chunk")) {
        cJSON *offset=cJSON_GetObjectItemCaseSensitive(message,"offset"),*data=cJSON_GetObjectItemCaseSensitive(message,"data");
        if(!pixels||!cJSON_IsNumber(offset)||offset->valueint!=(int)received||!cJSON_IsString(data))return false;
        size_t length=strlen(data->valuestring);
        if(length%2||received+length/2>512*300*2)return false;
        for(size_t i=0;i<length;i+=2){int a=digit(data->valuestring[i]),b=digit(data->valuestring[i+1]);if(a<0||b<0)return false;pixels[received++]=(uint8_t)((a<<4)|b);}
        return true;
    }
    if(!strcmp(type->valuestring,"background_end")) {
        if(!pixels||received!=512*300*2)return false;
        descriptor=(lv_img_dsc_t){.header={.cf=LV_IMG_CF_TRUE_COLOR,.w=512,.h=300},.data_size=512*300*2,.data=pixels};
        lv_img_set_src(image,&descriptor);lv_img_set_pivot(image,0,0);lv_img_set_zoom(image,512);
        lv_obj_clear_flag(image,LV_OBJ_FLAG_HIDDEN);lv_obj_move_background(image);active=true;
        return true;
    }
    return false;
}
void monitor_background_style(lv_obj_t *panel) {
    if(!panel)return;
    lv_obj_set_style_bg_opa(panel,active?LV_OPA_TRANSP:LV_OPA_COVER,0);
    for(uint32_t i=0;i<lv_obj_get_child_cnt(panel);i++) {
        lv_obj_t *card=lv_obj_get_child(panel,i);
        if(lv_obj_get_style_bg_opa(card,0)>0)lv_obj_set_style_bg_opa(card,active?220:LV_OPA_COVER,0);
    }
}
