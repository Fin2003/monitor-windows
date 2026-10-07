#include "monitor_ui.h"
#include "monitor_settings.h"
#include "monitor_dashboard.h"
#include "monitor_pages.h"
#include "monitor_theme.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "cJSON.h"
#include "lvgl.h"
#include "esp_lv_adapter.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

enum { SETTINGS_HOME=-1, SETTINGS_OVERVIEW, SETTINGS_CODING, SETTINGS_SYSTEM, SETTINGS_RADAR, SETTINGS_CATALOG };
static lv_obj_t *title, *status, *pager, *previous, *next, *overlay, *settings_heading, *settings_body, *settings_back, *save_status;
static lv_obj_t *settings_topbar;
static lv_obj_t *dashboard_panel, *native_page_panel;
static lv_obj_t *radar_detail_overlay, *radar_detail_card, *radar_detail_title, *radar_detail_meta, *radar_detail_scroll, *radar_detail_body;
static bool radar_detail_pending;
static char radar_detail_mode[16], radar_detail_id[40];
static int64_t radar_detail_last_request;
static int plugin_pages[4]={-1,-1,-1,-1};
static int current_group=-1;
static bool dashboard_visible;
static lv_obj_t *labels[6], *values[6], *details[6], *bars[6], *rows[6], *group_rows[4], *group_checks[4];
static lv_obj_t *catalog_checks[8], *catalog_labels[8], *catalog_position, *catalog_selected;
static lv_obj_t *catalog_previous, *catalog_next, *catalog_parent;
static char catalog_ids[8][256];
static int catalog_offset, catalog_total;
static bool catalog_channels, catalog_filter, filling_catalog;
static int settings_page=SETTINGS_HOME, catalog_return_page=SETTINGS_HOME;
static int current_page, page_count = 1;
static int64_t last_frame, last_navigation, last_change;
static uint32_t frame_count, touches, revision;
static bool mirror_mode, passive = true, settings_dirty, save_failed;
static monitor_settings_t save_copy;
static volatile bool save_requested;
static monitor_settings_t prefs;
static QueueHandle_t navigation, commands;
static lv_font_t large_font;
#define FRAME_STALE_US 15000000LL
static const uint32_t accents[] = {0x58c7ae,0x64b5f6,0xf5b841,0xef817c,0x58c7ae,0x64b5f6};
static const char *group_names[] = {"缩略总览","Coding Plan","系统监控","Tibo 雷达"};
static const char *group_descriptions[] = {
    "内置 · v1.0.0 · Coding Plan · 系统监控 · Tibo 雷达",
    "内置 · v1.0.0 · 追踪 Coding Plan 进度",
    "内置 · v1.0.0 · 硬件传感器与卡片布局",
    "内置 · v1.0.0 · 重置预告、完成通知与延迟观察"
};
static struct {
    int overview_channels,overview_sensors,coding_accounts,coding_channels;
    int system_selected,system_total,system_refresh,radar_interval;
    int overview_layout_count,coding_item_count,system_name_count,system_preview_group_count,system_preview_total;
    bool radar_replies,radar_paused,radar_running;
    char system_backend[160],system_language[32],system_color[40],system_preview_hardware[80],radar_provider[24],radar_timezone[64];
    struct {int index;char kind[48],cells[32];} overview_layout[6];
    struct {int selected,available;char label[72],kind[32],subtitle[48],description[96],status[32];} coding_items[4];
    char system_names[6][80];
    struct {
        int selected,total,sensor_count;
        char label[48],primary[64],primary_value[32];
        struct {bool selected,favorite;char name[72],type[32],value[32];} sensors[6];
    } system_preview_groups[3];
} manager_info={.system_refresh=5,.radar_interval=120};
static void open_settings(lv_event_t *event);
static void close_settings(lv_event_t *event);
static void render_settings_home(void);
static void render_plugin_settings(int id);
static void settings_back_action(lv_event_t *event);
static void close_radar_detail(lv_event_t *event);
static void bubble_tree(lv_obj_t *obj){
    lv_obj_add_flag(obj,LV_OBJ_FLAG_GESTURE_BUBBLE);
    for(uint32_t i=0;i<lv_obj_get_child_cnt(obj);i++)bubble_tree(lv_obj_get_child(obj,i));
}

static bool connected(void) { return last_frame && esp_timer_get_time()-last_frame<FRAME_STALE_US; }
static uint32_t foreground(void) { return ui_pal()->text; }
static uint32_t secondary(void) { return ui_pal()->text2; }
static uint32_t manager_bg(void) { return ui_pal()->bg; }
static uint32_t manager_card_bg(void) { return ui_pal()->surface; }
static uint32_t manager_hover(void) { return ui_pal()->surface2; }
static uint32_t manager_border(void) { return ui_pal()->border; }
static uint32_t manager_accent(void) { return ui_pal()->blue; }
static const char *string(cJSON *object,const char *key) {
    cJSON *item=cJSON_GetObjectItemCaseSensitive(object,key);
    return cJSON_IsString(item)?item->valuestring:"";
}
static lv_obj_t *label(lv_obj_t *parent,int x,int y,int width,uint32_t color) {
    lv_obj_t *obj=lv_label_create(parent);
    lv_obj_set_pos(obj,x,y);lv_obj_set_width(obj,width);
    lv_label_set_long_mode(obj,LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(obj,&ui_font_20r,0);
    lv_obj_set_style_text_color(obj,lv_color_hex(color),0);
    lv_label_set_text(obj,"");return obj;
}
static lv_obj_t *sized_label(lv_obj_t *parent,int x,int y,int width,int height,uint32_t color) {
    lv_obj_t *obj=label(parent,x,y,width,color);lv_obj_set_height(obj,height);return obj;
}
static lv_obj_t *button(lv_obj_t *parent,int x,int y,int w,const char *text,bool icon,lv_event_cb_t callback,void *data) {
    lv_obj_t *obj=lv_btn_create(parent);lv_obj_set_pos(obj,x,y);lv_obj_set_size(obj,w,44);
    lv_obj_set_style_radius(obj,5,0);
    lv_obj_t *caption=lv_label_create(obj);lv_label_set_text(caption,text);
    lv_obj_clear_flag(caption,LV_OBJ_FLAG_CLICKABLE);lv_obj_add_flag(caption,LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_set_style_text_font(caption,icon?&lv_font_montserrat_14:&ui_font_20r,0);lv_obj_center(caption);
    if(callback)lv_obj_add_event_cb(obj,callback,LV_EVENT_CLICKED,data);
    return obj;
}
static lv_obj_t *compact_button(lv_obj_t *parent,int x,int y,int w,int h,const char *text,bool icon,lv_event_cb_t callback,void *data) {
    lv_obj_t *obj=button(parent,x,y,w,text,icon,callback,data);lv_obj_set_height(obj,h);return obj;
}
static lv_obj_t *manager_card(lv_obj_t *parent,int x,int y,int w,int h) {
    lv_obj_t *obj=lv_obj_create(parent);lv_obj_set_pos(obj,x,y);lv_obj_set_size(obj,w,h);
    lv_obj_set_style_radius(obj,UI_RADIUS,0);lv_obj_set_style_pad_all(obj,0,0);lv_obj_clear_flag(obj,LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(obj,lv_color_hex(manager_card_bg()),0);lv_obj_set_style_bg_opa(obj,LV_OPA_COVER,0);
    lv_obj_set_style_border_width(obj,0,0);
    return obj;
}
static void enqueue(cJSON *message) {
    char command[1024]={0};
    if(cJSON_PrintPreallocated(message,command,sizeof(command)-2,false)) {
        strcat(command,"\n");
        if(xQueueSend(commands,command,0)!=pdPASS && save_status)lv_label_set_text(save_status,"操作队列已满，请重试");
    }
    cJSON_Delete(message);
}
static cJSON *message(const char *type) {
    cJSON *root=cJSON_CreateObject();cJSON_AddNumberToObject(root,"v",1);cJSON_AddStringToObject(root,"type",type);return root;
}
static void style_radar_detail(void) {
    if(!radar_detail_overlay)return;
    const ui_palette_t *p=ui_pal();
    lv_obj_set_style_bg_color(radar_detail_card,lv_color_hex(p->surface),0);
    lv_obj_set_style_border_color(radar_detail_card,lv_color_hex(p->border),0);
    lv_obj_set_style_text_color(radar_detail_title,lv_color_hex(p->text),0);
    lv_obj_set_style_text_color(radar_detail_meta,lv_color_hex(p->text2),0);
}
static lv_obj_t *create_radar_detail_body(void) {
    radar_detail_body=lv_label_create(radar_detail_scroll);lv_obj_set_width(radar_detail_body,800);lv_obj_set_height(radar_detail_body,LV_SIZE_CONTENT);
    lv_label_set_long_mode(radar_detail_body,LV_LABEL_LONG_WRAP);lv_obj_set_style_text_font(radar_detail_body,&ui_font_20r,0);
    lv_obj_set_style_text_color(radar_detail_body,lv_color_hex(foreground()),0);
    lv_obj_set_style_text_line_space(radar_detail_body,8,0);return radar_detail_body;
}
/* Heading plus wrapped body, stacked inside the scroll area; returns the next y. */
static int detail_section(int y,const char *heading,const char *body,uint32_t body_color) {
    lv_obj_t *title=lv_label_create(radar_detail_scroll);lv_obj_set_pos(title,4,y);
    lv_obj_set_style_text_font(title,&ui_font_16m,0);lv_obj_set_style_text_color(title,lv_color_hex(secondary()),0);lv_label_set_text(title,heading);
    lv_obj_t *text=lv_label_create(radar_detail_scroll);lv_obj_set_pos(text,4,y+30);lv_obj_set_width(text,796);
    lv_label_set_long_mode(text,LV_LABEL_LONG_WRAP);lv_obj_set_style_text_font(text,&ui_font_20r,0);
    lv_obj_set_style_text_line_space(text,8,0);lv_obj_set_style_text_color(text,lv_color_hex(body_color),0);lv_label_set_text(text,body);
    bubble_tree(title);bubble_tree(text);lv_obj_update_layout(text);
    return y+30+lv_obj_get_height(text)+28;
}
static uint32_t radar_history_tone(const char *tone) {
    const ui_palette_t *p=ui_pal();
    if(!strcmp(tone,"done"))return p->green;
    if(!strcmp(tone,"banked"))return p->violet;
    if(!strcmp(tone,"late"))return p->red;
    if(!strcmp(tone,"waiting"))return p->amber;
    return p->blue;
}
static void render_radar_history_cards(cJSON *items,bool status_mode) {
    const ui_palette_t *p=ui_pal();
    int count=cJSON_IsArray(items)?cJSON_GetArraySize(items):0;
    for(int i=0;i<count&&i<10;i++) {
        cJSON *item=cJSON_GetArrayItem(items,i);uint32_t tone=radar_history_tone(string(item,"tone"));int y=i*118;bool current=status_mode&&i==0;
        lv_obj_t *card=lv_obj_create(radar_detail_scroll);lv_obj_set_pos(card,0,y);lv_obj_set_size(card,806,106);
        lv_obj_set_style_radius(card,UI_RADIUS_S+2,0);lv_obj_set_style_pad_all(card,0,0);lv_obj_clear_flag(card,LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_add_flag(card,LV_OBJ_FLAG_EVENT_BUBBLE|LV_OBJ_FLAG_GESTURE_BUBBLE);
        lv_obj_set_style_bg_color(card,lv_color_hex(current?ui_tint(tone,30):p->surface2),0);lv_obj_set_style_bg_opa(card,LV_OPA_COVER,0);
        lv_obj_set_style_border_color(card,lv_color_hex(tone),0);lv_obj_set_style_border_width(card,current?2:0,0);lv_obj_set_style_shadow_width(card,0,0);
        lv_obj_t *accent=lv_obj_create(card);lv_obj_remove_style_all(accent);lv_obj_set_pos(accent,current?14:16,18);lv_obj_set_size(accent,10,10);
        lv_obj_set_style_radius(accent,LV_RADIUS_CIRCLE,0);lv_obj_set_style_bg_color(accent,lv_color_hex(tone),0);lv_obj_set_style_bg_opa(accent,LV_OPA_COVER,0);
        lv_obj_t *heading=lv_label_create(card);lv_obj_set_pos(heading,36,12);lv_obj_set_size(heading,current?480:560,22);
        lv_obj_set_style_text_font(heading,&ui_font_16m,0);lv_obj_set_style_text_color(heading,lv_color_hex(tone),0);
        lv_label_set_long_mode(heading,LV_LABEL_LONG_DOT);lv_label_set_text(heading,string(item,"label"));
        if(current) {
            lv_obj_t *badge=ui_chip(card,0,8,26,tone);ui_chip_set(badge,"当前",tone);lv_obj_align(badge,LV_ALIGN_TOP_RIGHT,-150,8);
        }
        lv_obj_t *time=lv_label_create(card);lv_obj_set_size(time,140,22);lv_obj_align(time,LV_ALIGN_TOP_RIGHT,-18,12);
        lv_obj_set_style_text_font(time,&ui_font_16r,0);lv_obj_set_style_text_color(time,lv_color_hex(p->text3),0);lv_obj_set_style_text_align(time,LV_TEXT_ALIGN_RIGHT,0);lv_label_set_text(time,string(item,"at"));
        lv_obj_t *detail=lv_label_create(card);lv_obj_set_pos(detail,36,44);lv_obj_set_size(detail,748,46);
        lv_obj_set_style_text_font(detail,&ui_font_16r,0);lv_obj_set_style_text_color(detail,lv_color_hex(p->text),0);
        lv_obj_set_style_text_line_space(detail,6,0);lv_label_set_long_mode(detail,LV_LABEL_LONG_DOT);lv_label_set_text(detail,string(item,"detail"));
        bubble_tree(card);
    }
}
static void close_radar_detail(lv_event_t *event) {
    (void)event;lv_obj_t *old=radar_detail_overlay;
    radar_detail_overlay=NULL;radar_detail_card=NULL;radar_detail_title=NULL;radar_detail_meta=NULL;radar_detail_scroll=NULL;radar_detail_body=NULL;
    radar_detail_pending=false;radar_detail_mode[0]=0;radar_detail_id[0]=0;
    last_navigation=esp_timer_get_time();if(old)lv_obj_del_async(old);
}
static void open_radar_detail(const char *caption) {
    if(radar_detail_overlay)return;
    const ui_palette_t *p=ui_pal();
    radar_detail_overlay=lv_obj_create(lv_scr_act());lv_obj_remove_style_all(radar_detail_overlay);lv_obj_set_pos(radar_detail_overlay,0,0);lv_obj_set_size(radar_detail_overlay,1024,600);
    lv_obj_set_style_bg_color(radar_detail_overlay,lv_color_hex(0x000000),0);lv_obj_set_style_bg_opa(radar_detail_overlay,prefs.dark?170:110,0);lv_obj_clear_flag(radar_detail_overlay,LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(radar_detail_overlay,LV_OBJ_FLAG_CLICKABLE);lv_obj_add_event_cb(radar_detail_overlay,close_radar_detail,LV_EVENT_CLICKED,NULL);
    radar_detail_card=lv_obj_create(radar_detail_overlay);lv_obj_set_pos(radar_detail_card,72,42);lv_obj_set_size(radar_detail_card,880,516);lv_obj_set_style_radius(radar_detail_card,20,0);
    lv_obj_set_style_border_width(radar_detail_card,1,0);lv_obj_set_style_pad_all(radar_detail_card,0,0);lv_obj_set_style_shadow_width(radar_detail_card,0,0);lv_obj_clear_flag(radar_detail_card,LV_OBJ_FLAG_SCROLLABLE|LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_add_flag(radar_detail_card,LV_OBJ_FLAG_CLICKABLE);
    radar_detail_title=lv_label_create(radar_detail_card);lv_obj_set_pos(radar_detail_title,28,20);lv_obj_set_size(radar_detail_title,740,32);lv_obj_set_style_text_font(radar_detail_title,&ui_font_26b,0);lv_label_set_long_mode(radar_detail_title,LV_LABEL_LONG_DOT);lv_label_set_text(radar_detail_title,caption);
    radar_detail_meta=lv_label_create(radar_detail_card);lv_obj_set_pos(radar_detail_meta,28,56);lv_obj_set_size(radar_detail_meta,740,22);lv_obj_set_style_text_font(radar_detail_meta,&ui_font_16r,0);lv_label_set_long_mode(radar_detail_meta,LV_LABEL_LONG_DOT);lv_label_set_text(radar_detail_meta,"正在从 Windows 读取详情");
    lv_obj_t *close=lv_btn_create(radar_detail_card);lv_obj_set_pos(close,816,14);lv_obj_set_size(close,46,46);lv_obj_set_style_radius(close,23,0);lv_obj_add_event_cb(close,close_radar_detail,LV_EVENT_CLICKED,NULL);
    lv_obj_set_style_bg_color(close,lv_color_hex(p->surface2),0);lv_obj_set_style_bg_color(close,lv_color_hex(p->border),LV_STATE_PRESSED);lv_obj_set_style_shadow_width(close,0,0);
    lv_obj_t *close_icon=lv_label_create(close);lv_obj_set_style_text_font(close_icon,&lv_font_montserrat_20,0);lv_obj_set_style_text_color(close_icon,lv_color_hex(p->text),0);lv_label_set_text(close_icon,LV_SYMBOL_CLOSE);lv_obj_center(close_icon);
    lv_obj_t *divider=lv_obj_create(radar_detail_card);lv_obj_remove_style_all(divider);lv_obj_set_pos(divider,0,92);lv_obj_set_size(divider,880,1);lv_obj_set_style_bg_color(divider,lv_color_hex(p->border),0);lv_obj_set_style_bg_opa(divider,LV_OPA_COVER,0);
    radar_detail_scroll=lv_obj_create(radar_detail_card);lv_obj_set_pos(radar_detail_scroll,18,100);lv_obj_set_size(radar_detail_scroll,852,406);lv_obj_set_style_radius(radar_detail_scroll,0,0);lv_obj_set_style_border_width(radar_detail_scroll,0,0);
    lv_obj_set_style_bg_opa(radar_detail_scroll,LV_OPA_TRANSP,0);lv_obj_set_style_pad_all(radar_detail_scroll,10,0);lv_obj_set_style_pad_right(radar_detail_scroll,16,0);
    lv_obj_set_scroll_dir(radar_detail_scroll,LV_DIR_VER);lv_obj_set_scrollbar_mode(radar_detail_scroll,LV_SCROLLBAR_MODE_AUTO);
    lv_obj_set_style_bg_color(radar_detail_scroll,lv_color_hex(p->border),LV_PART_SCROLLBAR);lv_obj_set_style_width(radar_detail_scroll,4,LV_PART_SCROLLBAR);
    create_radar_detail_body();lv_label_set_text(radar_detail_body,"正在读取...");lv_obj_set_style_text_color(radar_detail_body,lv_color_hex(p->text2),0);
    style_radar_detail();lv_obj_move_foreground(radar_detail_overlay);
}
bool monitor_ui_radar_detail_active(void) {return radar_detail_overlay!=NULL;}
static void send_radar_detail_request(void) {
    if(!radar_detail_pending||!radar_detail_overlay||!connected())return;
    cJSON *root=message("radar_detail_request");cJSON_AddStringToObject(root,"mode",radar_detail_mode);
    if(radar_detail_id[0])cJSON_AddStringToObject(root,"id",radar_detail_id);
    radar_detail_last_request=esp_timer_get_time();enqueue(root);
}
void monitor_ui_request_radar_detail(const char *mode,const char *id) {
    if(!connected()||!mode||!*mode)return;
    open_radar_detail(!strcmp(mode,"post")?"帖子详情":!strcmp(mode,"status")?"状态变动":"历史重置");
    snprintf(radar_detail_mode,sizeof(radar_detail_mode),"%s",mode);
    snprintf(radar_detail_id,sizeof(radar_detail_id),"%s",id?id:"");
    radar_detail_pending=true;radar_detail_last_request=0;send_radar_detail_request();
}
static void apply_radar_detail(cJSON *root) {
    const char *mode=string(root,"mode"),*title_text=string(root,"title"),*meta_text=string(root,"subtitle"),*error=string(root,"error");
    open_radar_detail(*title_text?title_text:!strcmp(mode,"post")?"帖子详情":!strcmp(mode,"status")?"状态变动":"历史重置");
    radar_detail_pending=false;
    lv_label_set_text(radar_detail_title,*title_text?title_text:"Tibo 雷达");lv_label_set_text(radar_detail_meta,meta_text);
    lv_obj_clean(radar_detail_scroll);radar_detail_body=NULL;char *output=NULL;bool rendered=false;
    if(*error) {
        size_t size=strlen(error)+32;output=lv_mem_alloc(size);if(output)snprintf(output,size,"无法显示\n\n%s",error);
    } else if(!strcmp(mode,"post")) {
        const char *original=string(root,"original"),*translation=string(root,"translation"),*state=string(root,"translationState");
        const char *fallback=!strcmp(state,"unavailable")?"自动翻译暂不可用，请检查 Windows 模型连接。":"正在自动翻译，关闭后稍候再点即可查看。";
        int y=detail_section(0,"原文",*original?original:"--",foreground());
        y=detail_section(y,"中文翻译",*translation?translation:fallback,*translation?foreground():secondary());
        if(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root,"truncated")))detail_section(y,"提示","内容过长，已按设备传输上限截断。",secondary());
        rendered=true;
    } else {
        cJSON *items=cJSON_GetObjectItemCaseSensitive(root,"items");int count=cJSON_IsArray(items)?cJSON_GetArraySize(items):0;
        if(count){render_radar_history_cards(items,!strcmp(mode,"status"));rendered=true;}
        else {size_t size=64;output=lv_mem_alloc(size);if(output)snprintf(output,size,"暂无历史记录");}
    }
    if(output){create_radar_detail_body();lv_label_set_text(radar_detail_body,output);lv_mem_free(output);}
    else if(!rendered){create_radar_detail_body();lv_label_set_text(radar_detail_body,"内存不足，无法显示详情");}
    lv_obj_scroll_to_y(radar_detail_scroll,0,LV_ANIM_OFF);style_radar_detail();lv_obj_move_foreground(radar_detail_overlay);
}
/* ---- Manual reset marking: used when Tibo never posts a "reset finished" tweet. ---- */
static struct {
    bool can_mark,has_last;int day_count,hour,minute;
    char day_values[7][12],day_labels[7][20],last_id[24],last_label[48];
} manual_info;
static lv_obj_t *manual_overlay,*manual_kind_buttons[2],*manual_day,*manual_hour,*manual_minute,*manual_status,*manual_confirm;
static int manual_kind;
static bool manual_waiting;
static void apply_manual_info(cJSON *manual) {
    if(!cJSON_IsObject(manual))return;
    manual_info.can_mark=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(manual,"canMark"));
    cJSON *hour=cJSON_GetObjectItemCaseSensitive(manual,"hour"),*minute=cJSON_GetObjectItemCaseSensitive(manual,"minute");
    manual_info.hour=cJSON_IsNumber(hour)?hour->valueint:0;manual_info.minute=cJSON_IsNumber(minute)?minute->valueint:0;
    manual_info.day_count=0;cJSON *day;
    cJSON_ArrayForEach(day,cJSON_GetObjectItemCaseSensitive(manual,"days")){
        if(manual_info.day_count>=7)break;
        int i=manual_info.day_count++;
        snprintf(manual_info.day_values[i],sizeof(manual_info.day_values[i]),"%s",string(day,"value"));
        snprintf(manual_info.day_labels[i],sizeof(manual_info.day_labels[i]),"%s",string(day,"label"));
    }
    cJSON *last=cJSON_GetObjectItemCaseSensitive(manual,"last");manual_info.has_last=cJSON_IsObject(last);
    snprintf(manual_info.last_id,sizeof(manual_info.last_id),"%s",string(last,"id"));
    snprintf(manual_info.last_label,sizeof(manual_info.last_label),"%s",string(last,"label"));
}
static void close_manual_dialog(lv_event_t *event) {
    (void)event;lv_obj_t *old=manual_overlay;manual_overlay=NULL;manual_waiting=false;
    last_navigation=esp_timer_get_time();if(old)lv_obj_del_async(old);
}
static void style_manual_kinds(void) {
    const ui_palette_t *p=ui_pal();const uint32_t colors[]={p->green,p->violet};
    for(int i=0;i<2;i++){
        bool on=manual_kind==i;lv_obj_t *b=manual_kind_buttons[i];
        lv_obj_set_style_bg_color(b,lv_color_hex(on?ui_tint(colors[i],46):p->surface2),0);
        lv_obj_set_style_border_color(b,lv_color_hex(on?colors[i]:p->surface2),0);
        lv_obj_set_style_text_color(lv_obj_get_child(b,0),lv_color_hex(on?colors[i]:p->text2),0);
    }
}
static void manual_pick_kind(lv_event_t *event) {manual_kind=(int)(intptr_t)lv_event_get_user_data(event);style_manual_kinds();}
static void manual_message(const char *text,uint32_t color) {
    if(!manual_status)return;
    lv_label_set_text(manual_status,text);lv_obj_set_style_text_color(manual_status,lv_color_hex(color),0);
}
static void manual_send(lv_event_t *event) {
    bool undo=(bool)(intptr_t)lv_event_get_user_data(event);
    if(manual_waiting)return;
    if(!connected()){manual_message("USB 未连接，无法保存",ui_pal()->red);return;}
    cJSON *root=message("radar_manual_reset");
    if(undo){cJSON_AddStringToObject(root,"action","undo");cJSON_AddStringToObject(root,"id",manual_info.last_id);}
    else {
        int day=lv_roller_get_selected(manual_day);if(day>=manual_info.day_count)day=0;
        cJSON_AddStringToObject(root,"action","mark");cJSON_AddStringToObject(root,"kind",manual_kind?"banked":"hard");
        cJSON_AddStringToObject(root,"date",manual_info.day_values[day]);
        cJSON_AddNumberToObject(root,"hour",lv_roller_get_selected(manual_hour));cJSON_AddNumberToObject(root,"minute",lv_roller_get_selected(manual_minute));
    }
    enqueue(root);manual_waiting=true;manual_message("正在保存…",ui_pal()->text2);
}
static void manual_history(lv_event_t *event) {
    bool resets=(bool)(intptr_t)lv_event_get_user_data(event);close_manual_dialog(NULL);
    monitor_ui_request_radar_detail(resets?"resets":"status",NULL);
}
static void apply_manual_ack(cJSON *root) {
    if(!manual_overlay)return;
    if(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root,"ok")))close_manual_dialog(NULL);
    else {manual_waiting=false;manual_message(*string(root,"message")?string(root,"message"):"保存失败",ui_pal()->red);}
}
static lv_obj_t *manual_button(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t bg,uint32_t color,lv_event_cb_t callback,void *data) {
    lv_obj_t *b=lv_btn_create(parent);lv_obj_set_pos(b,x,y);lv_obj_set_size(b,w,52);lv_obj_set_style_radius(b,UI_RADIUS_S+2,0);
    lv_obj_set_style_shadow_width(b,0,0);lv_obj_set_style_bg_color(b,lv_color_hex(bg),0);lv_obj_set_style_border_width(b,0,0);
    lv_obj_t *caption=lv_label_create(b);lv_obj_set_style_text_font(caption,&ui_font_20r,0);lv_obj_set_style_text_color(caption,lv_color_hex(color),0);
    lv_label_set_text(caption,text);lv_obj_center(caption);
    if(callback)lv_obj_add_event_cb(b,callback,LV_EVENT_CLICKED,data);
    return b;
}
static lv_obj_t *manual_roller(lv_obj_t *parent,int x,int w,const char *options,int selected) {
    const ui_palette_t *p=ui_pal();
    lv_obj_t *r=lv_roller_create(parent);lv_roller_set_options(r,options,LV_ROLLER_MODE_NORMAL);lv_roller_set_visible_row_count(r,3);
    lv_obj_set_pos(r,x,236);lv_obj_set_width(r,w);
    lv_obj_set_style_text_font(r,&ui_font_20r,0);lv_obj_set_style_text_line_space(r,14,0);
    lv_obj_set_style_bg_color(r,lv_color_hex(p->surface2),0);lv_obj_set_style_border_width(r,0,0);lv_obj_set_style_radius(r,UI_RADIUS_S+2,0);
    lv_obj_set_style_text_color(r,lv_color_hex(p->text3),0);
    lv_obj_set_style_bg_color(r,lv_color_hex(ui_tint(p->blue,50)),LV_PART_SELECTED);lv_obj_set_style_text_color(r,lv_color_hex(p->text),LV_PART_SELECTED);
    lv_roller_set_selected(r,selected,LV_ANIM_OFF);return r;
}
static void open_manual_dialog(bool undo) {
    if(manual_overlay||!connected())return;
    if(radar_detail_overlay)close_radar_detail(NULL);
    const ui_palette_t *p=ui_pal();manual_waiting=false;manual_kind=0;
    manual_overlay=lv_obj_create(lv_scr_act());lv_obj_remove_style_all(manual_overlay);lv_obj_set_size(manual_overlay,1024,600);
    lv_obj_set_style_bg_color(manual_overlay,lv_color_hex(0x000000),0);lv_obj_set_style_bg_opa(manual_overlay,prefs.dark?170:110,0);
    lv_obj_clear_flag(manual_overlay,LV_OBJ_FLAG_SCROLLABLE);lv_obj_add_flag(manual_overlay,LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(manual_overlay,close_manual_dialog,LV_EVENT_CLICKED,NULL);
    int h=undo?300:464;
    lv_obj_t *card=lv_obj_create(manual_overlay);lv_obj_set_size(card,640,h);lv_obj_set_pos(card,192,(600-h)/2);
    lv_obj_set_style_radius(card,20,0);lv_obj_set_style_pad_all(card,0,0);lv_obj_set_style_shadow_width(card,0,0);
    lv_obj_set_style_bg_color(card,lv_color_hex(p->surface),0);lv_obj_set_style_border_color(card,lv_color_hex(p->border),0);lv_obj_set_style_border_width(card,1,0);
    lv_obj_clear_flag(card,LV_OBJ_FLAG_SCROLLABLE|LV_OBJ_FLAG_EVENT_BUBBLE);lv_obj_add_flag(card,LV_OBJ_FLAG_CLICKABLE);
    lv_obj_t *title=lv_label_create(card);lv_obj_set_pos(title,28,22);lv_obj_set_style_text_font(title,&ui_font_26b,0);lv_obj_set_style_text_color(title,lv_color_hex(p->text),0);
    lv_obj_t *meta=lv_label_create(card);lv_obj_set_pos(meta,28,58);lv_obj_set_width(meta,520);lv_label_set_long_mode(meta,LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(meta,&ui_font_16r,0);lv_obj_set_style_text_color(meta,lv_color_hex(p->text2),0);
    lv_obj_t *close=lv_btn_create(card);lv_obj_set_pos(close,576,16);lv_obj_set_size(close,46,46);lv_obj_set_style_radius(close,23,0);lv_obj_set_style_shadow_width(close,0,0);
    lv_obj_set_style_bg_color(close,lv_color_hex(p->surface2),0);lv_obj_add_event_cb(close,close_manual_dialog,LV_EVENT_CLICKED,NULL);
    lv_obj_t *icon=lv_label_create(close);lv_obj_set_style_text_font(icon,&lv_font_montserrat_20,0);lv_obj_set_style_text_color(icon,lv_color_hex(p->text),0);lv_label_set_text(icon,LV_SYMBOL_CLOSE);lv_obj_center(icon);
    manual_status=lv_label_create(card);lv_obj_set_width(manual_status,584);lv_obj_set_style_text_font(manual_status,&ui_font_16r,0);lv_label_set_text(manual_status,"");
    if(undo) {
        lv_label_set_text(title,"手动标记的重置");lv_label_set_text(meta,manual_info.last_label);
        lv_obj_t *body=lv_label_create(card);lv_obj_set_pos(body,28,108);lv_obj_set_width(body,584);lv_label_set_long_mode(body,LV_LABEL_LONG_WRAP);
        lv_obj_set_style_text_font(body,&ui_font_20r,0);lv_obj_set_style_text_color(body,lv_color_hex(p->text),0);lv_obj_set_style_text_line_space(body,8,0);
        lv_label_set_text(body,"最近重置来自手动标记。如果标记有误，撤销后雷达会恢复为等待重置。");
        lv_obj_set_pos(manual_status,28,h-104);
        manual_button(card,28,h-76,160,"重置历史",p->surface2,p->text,manual_history,(void *)(intptr_t)1);
        manual_button(card,338,h-76,130,"关闭",p->surface2,p->text,close_manual_dialog,NULL);
        manual_confirm=manual_button(card,482,h-76,130,"撤销标记",ui_tint(p->red,60),p->red,manual_send,(void *)(intptr_t)1);
    } else {
        lv_label_set_text(title,"标记重置已完成");lv_label_set_text(meta,"Tibo 没有发完成推文时使用 · 记录在 Windows 镜像中");
        lv_obj_t *kind=lv_label_create(card);lv_obj_set_pos(kind,28,100);lv_obj_set_style_text_font(kind,&ui_font_16r,0);lv_obj_set_style_text_color(kind,lv_color_hex(p->text2),0);lv_label_set_text(kind,"重置类型");
        const char *names[]={"Hard 重置","Banked 重置"};
        for(int i=0;i<2;i++){
            lv_obj_t *b=manual_kind_buttons[i]=manual_button(card,28+i*296,126,288,names[i],p->surface2,p->text2,manual_pick_kind,(void *)(intptr_t)i);
            lv_obj_set_height(b,60);lv_obj_set_style_border_width(b,2,0);lv_obj_set_style_text_font(lv_obj_get_child(b,0),&ui_font_26b,0);
        }
        style_manual_kinds();
        lv_obj_t *when=lv_label_create(card);lv_obj_set_pos(when,28,210);lv_obj_set_style_text_font(when,&ui_font_16r,0);lv_obj_set_style_text_color(when,lv_color_hex(p->text2),0);lv_label_set_text(when,"完成时间（Windows 显示时区）");
        char days[200]="";for(int i=0;i<manual_info.day_count;i++){if(i)strcat(days,"\n");strcat(days,manual_info.day_labels[i]);}
        /* "00\n01\n...": 3 bytes per entry, the last newline becomes the terminator (the roller copies it). */
        char hours[24*3],minutes[60*3];
        for(int i=0;i<60;i++){char *slot=minutes+i*3;slot[0]=(char)('0'+i/10);slot[1]=(char)('0'+i%10);slot[2]=i==59?0:'\n';}
        for(int i=0;i<24;i++){char *slot=hours+i*3;slot[0]=(char)('0'+i/10);slot[1]=(char)('0'+i%10);slot[2]=i==23?0:'\n';}
        manual_day=manual_roller(card,28,236,*days?days:"--",0);
        manual_hour=manual_roller(card,284,150,hours,manual_info.hour);
        lv_obj_t *colon=lv_label_create(card);lv_obj_set_style_text_font(colon,&ui_font_26b,0);lv_obj_set_style_text_color(colon,lv_color_hex(p->text2),0);lv_label_set_text(colon,":");
        manual_minute=manual_roller(card,462,150,minutes,manual_info.minute);
        lv_obj_update_layout(card);lv_obj_align_to(colon,manual_hour,LV_ALIGN_OUT_RIGHT_MID,9,-2);
        lv_obj_set_pos(manual_status,28,h-106);
        manual_button(card,28,h-76,160,"状态历史",p->surface2,p->text,manual_history,(void *)(intptr_t)0);
        manual_button(card,338,h-76,130,"取消",p->surface2,p->text,close_manual_dialog,NULL);
        manual_confirm=manual_button(card,482,h-76,130,"确认标记",p->blue,0xffffff,manual_send,(void *)(intptr_t)0);
    }
    lv_obj_move_foreground(manual_overlay);
}
bool monitor_ui_manual_active(void) {return manual_overlay!=NULL;}
int monitor_ui_manual_option_count(int which) {
    lv_obj_t *roller=which==0?manual_day:which==1?manual_hour:manual_minute;
    return manual_overlay&&roller?(int)lv_roller_get_option_cnt(roller):0;
}
void monitor_ui_radar_status_tap(void) {if(manual_info.can_mark&&manual_info.day_count)open_manual_dialog(false);else monitor_ui_request_radar_detail("status",NULL);}
void monitor_ui_radar_recent_tap(void) {if(manual_info.has_last)open_manual_dialog(true);else monitor_ui_request_radar_detail("resets",NULL);}
void monitor_ui_service_save(void) {
    if(!save_requested||esp_lv_adapter_lock(100)!=ESP_OK)return;
    monitor_settings_t copy=save_copy;save_requested=false;esp_lv_adapter_unlock();
    bool ok=monitor_settings_save(&copy);
    if(esp_lv_adapter_lock(1000)!=ESP_OK){save_failed=!ok;return;}
    save_failed=!ok;if(save_status)lv_label_set_text(save_status,ok?"已保存到设备":"保存失败");
    esp_lv_adapter_unlock();
}
void monitor_ui_preferences_json(char *json,size_t size) {
    snprintf(json,size,"{\"v\":1,\"type\":\"prefs\",\"revision\":%lu,\"prefs\":{\"mask\":%lu,\"order\":[%lu,%lu,%lu,%lu],\"dark\":%s,\"bigValues\":%s,\"showMinMax\":%s,\"cycleSeconds\":%lu}}\n",
        (unsigned long)revision,(unsigned long)prefs.mask,(unsigned long)prefs.order[0],(unsigned long)prefs.order[1],(unsigned long)prefs.order[2],(unsigned long)prefs.order[3],prefs.dark?"true":"false",prefs.big_values?"true":"false",prefs.show_minmax?"true":"false",(unsigned long)prefs.cycle_seconds);
}
void monitor_ui_diagnostics_json(char *json,size_t size) {
    snprintf(json,size,"\"frames\":%lu,\"touches\":%lu,\"settingsOpen\":%s,\"settingsPage\":%d,\"detailOpen\":%s,\"detailPending\":%s,\"manualOpen\":%s,\"mask\":%lu,\"dark\":%s,\"settingsSaved\":%s",
        (unsigned long)frame_count,(unsigned long)touches,overlay?"true":"false",settings_page,radar_detail_overlay?"true":"false",radar_detail_pending?"true":"false",manual_overlay?"true":"false",(unsigned long)prefs.mask,prefs.dark?"true":"false",(!settings_dirty&&!save_requested&&!save_failed)?"true":"false");
}
static void request_catalog(void) {
    if(!connected()) {if(catalog_position)lv_label_set_text(catalog_position,"USB 未连接");return;}
    cJSON *root=message("catalog_request");
    cJSON_AddStringToObject(root,"kind",catalog_channels?"channels":"sensors");
    cJSON_AddNumberToObject(root,"offset",catalog_offset);
    cJSON_AddBoolToObject(root,"onlySelected",catalog_filter);enqueue(root);
}
static void apply_palette(void) {
    ui_theme_set_dark(prefs.dark);
    monitor_dashboard_theme(prefs.dark);
    monitor_pages_theme(prefs.dark);
    lv_theme_t *theme=lv_theme_default_init(lv_disp_get_default(),lv_color_hex(manager_accent()),lv_color_hex(ui_pal()->green),prefs.dark,&ui_font_20r);
    lv_disp_set_theme(lv_disp_get_default(),theme);
    lv_obj_set_style_bg_color(lv_scr_act(),lv_color_hex(manager_bg()),0);
    lv_obj_set_style_text_color(title,lv_color_hex(foreground()),0);
    lv_obj_set_style_text_color(pager,lv_color_hex(secondary()),0);
    for(int i=0;i<6;i++) {
        lv_obj_set_style_bg_color(rows[i],lv_color_hex(manager_card_bg()),0);
        lv_obj_set_style_text_color(labels[i],lv_color_hex(foreground()),0);
        lv_obj_set_style_text_color(details[i],lv_color_hex(secondary()),0);
        lv_obj_set_style_text_color(values[i],lv_color_hex(prefs.dark?accents[i]:(i%3==0?0x087f68:i%3==1?0x116ead:0x946209)),0);
    }
    if(overlay) {
        lv_obj_set_style_bg_color(overlay,lv_color_hex(manager_bg()),0);
    }
    style_radar_detail();
}
static void apply_density(void) {
    for(int i=0;i<6;i++) {
        int step=prefs.big_values?116:77;
        lv_obj_set_pos(rows[i],16,58+i*step);lv_obj_set_height(rows[i],step-5);
        lv_obj_set_style_text_font(values[i],prefs.big_values?&large_font:&ui_font_20r,0);
        lv_obj_set_y(details[i],prefs.big_values?52:33);
        lv_obj_set_y(bars[i],step-14);
        if(prefs.big_values&&i>=4)lv_obj_add_flag(rows[i],LV_OBJ_FLAG_HIDDEN);
    }
}
static void changed(void) {
    settings_dirty=true;last_change=esp_timer_get_time();revision++;
    char command[1024]={0};monitor_ui_preferences_json(command,sizeof(command));xQueueSend(commands,command,0);
    if(save_status)lv_label_set_text(save_status,"保存中");
    apply_density();apply_palette();
}
static void go_page(int target) {
    if(!connected()||target<0||target>=page_count)return;
    xQueueOverwrite(navigation,&target);last_navigation=esp_timer_get_time();
}
static void group_bounds(int *first,int *last){
    *first=current_group>=0&&plugin_pages[current_group]>=0?plugin_pages[current_group]:0;*last=page_count-1;
    for(int i=0;i<4;i++)if(plugin_pages[i]>*first&&plugin_pages[i]-1<*last)*last=plugin_pages[i]-1;
}
static void navigate(lv_event_t *event) {
    int first,last,target=current_page+(int)(intptr_t)lv_event_get_user_data(event);group_bounds(&first,&last);
    if(target>=first&&target<=last)go_page(target);
}
static void next_plugin(int delta){
    int enabled[4],count=0,at=-1;
    for(int i=0;i<4;i++){int id=(int)prefs.order[i];if((prefs.mask&(1U<<id))&&plugin_pages[id]>=0){if(id==current_group)at=count;enabled[count++]=id;}}
    if(!count){go_page(current_page+delta);return;}
    if(count==1&&at==0)return;
    int target=at<0?(delta>0?0:count-1):(at+delta+count)%count;
    go_page(plugin_pages[enabled[target]]);
}
static void root_event(lv_event_t *event) {
    if(lv_event_get_code(event)==LV_EVENT_PRESSED)touches++;
    if(radar_detail_overlay||manual_overlay)return;
    if(lv_event_get_code(event)!=LV_EVENT_GESTURE)return;
    lv_indev_t *input=lv_indev_get_act();if(!input)return;
    lv_dir_t dir=lv_indev_get_gesture_dir(input);
    if(dir==LV_DIR_LEFT||dir==LV_DIR_RIGHT){
        if(!overlay)open_settings(NULL);
        else if(dir==LV_DIR_RIGHT&&settings_page!=SETTINGS_HOME)settings_back_action(NULL);
        else close_settings(NULL);
    }
    else if(!overlay&&dir==LV_DIR_TOP)next_plugin(1);
    else if(!overlay&&dir==LV_DIR_BOTTOM)next_plugin(-1);
    lv_indev_wait_release(input);
}
static void bubble(lv_obj_t *obj) {
    lv_obj_add_flag(obj,LV_OBJ_FLAG_EVENT_BUBBLE);lv_obj_add_flag(obj,LV_OBJ_FLAG_GESTURE_BUBBLE);
}
static void status_tick(lv_timer_t *timer) {
    (void)timer;bool online=connected();int64_t now=esp_timer_get_time();
    const char *caption=online?(mirror_mode?"只读跟随":passive?"历史缓存":"USB 已连接"):"USB 未连接";
    if(strcmp(lv_label_get_text(status),caption))lv_label_set_text(status,caption);
    lv_obj_set_style_text_color(status,lv_color_hex(online?(passive?0xd2982e:0x159c86):0xde5b55),0);
    if(dashboard_panel)monitor_dashboard_status(online);
    if(native_page_panel)monitor_pages_status(online);
    for(int i=0;i<6;i++)lv_obj_set_style_opa(rows[i],online?LV_OPA_COVER:LV_OPA_50,0);
    int first,last;group_bounds(&first,&last);
    if(online&&current_page>first)lv_obj_clear_state(previous,LV_STATE_DISABLED);else lv_obj_add_state(previous,LV_STATE_DISABLED);
    if(online&&current_page<last)lv_obj_clear_state(next,LV_STATE_DISABLED);else lv_obj_add_state(next,LV_STATE_DISABLED);
    if(settings_dirty&&esp_timer_get_time()-last_change>800000) {
        /* Saved by the USB task (monitor_ui_service_save): this task's stack is in PSRAM, and NVS writes need internal RAM. */
        save_copy=prefs;save_requested=true;settings_dirty=false;
    }
    if(online&&radar_detail_pending&&radar_detail_overlay&&now-radar_detail_last_request>=1000000)send_radar_detail_request();
    if(online&&!overlay&&!radar_detail_overlay&&!manual_overlay&&prefs.cycle_seconds&&page_count>1&&now-last_navigation>(int64_t)prefs.cycle_seconds*1000000)next_plugin(1);
}
static void close_settings(lv_event_t *event) {
    (void)event;lv_obj_t *old=overlay;overlay=NULL;settings_heading=NULL;settings_body=NULL;settings_back=NULL;settings_topbar=NULL;save_status=NULL;
    catalog_parent=NULL;catalog_position=NULL;settings_page=SETTINGS_HOME;catalog_return_page=SETTINGS_HOME;
    last_navigation=esp_timer_get_time();if(old)lv_obj_del_async(old);
}
static void group_toggle(lv_event_t *event) {
    unsigned id=(unsigned)(uintptr_t)lv_event_get_user_data(event);
    bool enabled=lv_obj_has_state(lv_event_get_target(event),LV_STATE_CHECKED);
    unsigned mask=enabled?prefs.mask|(1U<<id):prefs.mask&~(1U<<id);
    if(!mask){lv_obj_add_state(lv_event_get_target(event),LV_STATE_CHECKED);return;}
    prefs.mask=mask;changed();
}
static void reorder(lv_event_t *event) {
    int code=(int)(intptr_t)lv_event_get_user_data(event),id=code/2,delta=code%2?1:-1;
    for(int i=0;i<4;i++)if(prefs.order[i]==(unsigned)id) {
        int j=i+delta;if(j<0||j>=4)return;
        unsigned swap=prefs.order[i];prefs.order[i]=prefs.order[j];prefs.order[j]=swap;
        for(int k=0;k<4;k++)lv_obj_set_y(group_rows[prefs.order[k]],k*170);
        changed();return;
    }
}
static lv_obj_t *plain(lv_obj_t *parent,int x,int y,int w,int h) {
    lv_obj_t *obj=lv_obj_create(parent);lv_obj_set_pos(obj,x,y);lv_obj_set_size(obj,w,h);
    lv_obj_set_style_border_width(obj,0,0);lv_obj_set_style_radius(obj,0,0);lv_obj_set_style_pad_all(obj,0,0);
    lv_obj_set_style_bg_opa(obj,LV_OPA_TRANSP,0);lv_obj_clear_flag(obj,LV_OBJ_FLAG_SCROLLABLE);return obj;
}
static lv_obj_t *manager_panel(lv_obj_t *parent,int x,int y,int w,int h,uint32_t bg,int radius,bool border) {
    lv_obj_t *obj=lv_obj_create(parent);lv_obj_set_pos(obj,x,y);lv_obj_set_size(obj,w,h);
    lv_obj_set_style_pad_all(obj,0,0);lv_obj_set_style_radius(obj,radius,0);
    lv_obj_set_style_bg_color(obj,lv_color_hex(bg),0);lv_obj_set_style_bg_opa(obj,LV_OPA_COVER,0);
    lv_obj_set_style_border_color(obj,lv_color_hex(manager_border()),0);lv_obj_set_style_border_width(obj,border?1:0,0);
    lv_obj_clear_flag(obj,LV_OBJ_FLAG_SCROLLABLE);return obj;
}
static lv_obj_t *manager_scroll(lv_obj_t *parent,int x,int y,int w,int h) {
    lv_obj_t *obj=manager_panel(parent,x,y,w,h,manager_bg(),0,false);
    lv_obj_add_flag(obj,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_scroll_dir(obj,LV_DIR_VER);
    lv_obj_set_scrollbar_mode(obj,LV_SCROLLBAR_MODE_AUTO);lv_obj_set_style_pad_right(obj,8,0);
    lv_obj_set_style_bg_opa(obj,LV_OPA_TRANSP,0);
    lv_obj_set_style_bg_color(obj,lv_color_hex(manager_border()),LV_PART_SCROLLBAR);
    lv_obj_set_style_width(obj,5,LV_PART_SCROLLBAR);return obj;
}
static lv_obj_t *manager_divider(lv_obj_t *parent,int x,int y,int w) {
    lv_obj_t *line=manager_panel(parent,x,y,w,1,manager_border(),0,false);return line;
}
static lv_obj_t *manager_button(lv_obj_t *parent,int x,int y,int w,int h,const char *text,bool accent,bool icon,lv_event_cb_t callback,void *data) {
    lv_obj_t *obj=compact_button(parent,x,y,w,h,text,icon,callback,data);
    lv_obj_set_style_radius(obj,8,0);lv_obj_set_style_shadow_width(obj,0,0);
    lv_obj_set_style_bg_color(obj,lv_color_hex(accent?manager_accent():manager_hover()),0);
    lv_obj_set_style_bg_color(obj,lv_color_hex(accent?(prefs.dark?0x409cff:0x0044a8):manager_border()),LV_STATE_PRESSED);
    lv_obj_set_style_text_color(obj,lv_color_hex(accent?0xffffff:foreground()),0);
    lv_obj_set_style_border_color(obj,lv_color_hex(accent?manager_accent():manager_border()),0);
    lv_obj_set_style_border_width(obj,accent?0:1,0);
    if(!icon&&lv_obj_get_child_cnt(obj))lv_obj_set_style_text_font(lv_obj_get_child(obj,0),&ui_font_16r,0);
    return obj;
}
static lv_obj_t *manager_text(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t color) {
    lv_obj_t *obj=sized_label(parent,x,y,w,22,color);lv_obj_set_style_text_font(obj,&ui_font_16r,0);lv_label_set_text(obj,text);return obj;
}
static lv_obj_t *manager_meta(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t color) {
    lv_obj_t *obj=sized_label(parent,x,y,w,20,color);lv_obj_set_style_text_font(obj,&ui_font_14r,0);lv_label_set_text(obj,text);return obj;
}
static lv_obj_t *manager_heading(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t color) {
    lv_obj_t *obj=sized_label(parent,x,y,w,38,color);lv_obj_set_style_text_font(obj,&ui_font_26b,0);lv_label_set_text(obj,text);return obj;
}
static lv_obj_t *manager_ascii(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t color) {
    lv_obj_t *obj=sized_label(parent,x,y,w,20,color);lv_obj_set_style_text_font(obj,&lv_font_montserrat_14,0);lv_label_set_text(obj,text);return obj;
}
static lv_obj_t *manager_icon(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t color) {
    lv_obj_t *obj=sized_label(parent,x,y,w,32,color);lv_obj_set_style_text_font(obj,&lv_font_montserrat_20,0);lv_obj_set_style_text_align(obj,LV_TEXT_ALIGN_CENTER,0);lv_label_set_text(obj,text);return obj;
}
static lv_obj_t *manager_checkbox(lv_obj_t *parent,int x,int y,bool checked) {
    lv_obj_t *box=manager_panel(parent,x,y,30,30,checked?manager_accent():manager_card_bg(),7,true);
    lv_obj_set_style_border_color(box,lv_color_hex(checked?manager_accent():manager_border()),0);
    if(checked){lv_obj_t *mark=label(box,5,-4,20,0xffffff);lv_obj_set_style_text_font(mark,&lv_font_montserrat_20,0);lv_obj_set_style_text_align(mark,LV_TEXT_ALIGN_CENTER,0);lv_label_set_text(mark,LV_SYMBOL_OK);}
    return box;
}
static lv_obj_t *manager_pill(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t color,uint32_t bg) {
    lv_obj_t *pill=manager_panel(parent,x,y,w,30,bg,5,false);lv_obj_t *caption=manager_meta(pill,8,5,w-16,text,color);lv_obj_set_style_text_align(caption,LV_TEXT_ALIGN_CENTER,0);return pill;
}
static lv_obj_t *manager_ascii_pill(lv_obj_t *parent,int x,int y,int w,const char *text,uint32_t color,uint32_t bg) {
    lv_obj_t *pill=manager_panel(parent,x,y,w,30,bg,5,false);lv_obj_t *caption=manager_ascii(pill,8,4,w-16,text,color);lv_obj_set_style_text_align(caption,LV_TEXT_ALIGN_CENTER,0);return pill;
}
static lv_obj_t *manager_arc(lv_obj_t *parent,int x,int y,int size,int value,uint32_t color) {
    lv_obj_t *arc=lv_arc_create(parent);lv_obj_set_pos(arc,x,y);lv_obj_set_size(arc,size,size);
    lv_arc_set_rotation(arc,135);lv_arc_set_bg_angles(arc,0,270);lv_arc_set_value(arc,value);
    lv_obj_remove_style(arc,NULL,LV_PART_KNOB);lv_obj_clear_flag(arc,LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(arc,8,LV_PART_MAIN);lv_obj_set_style_arc_color(arc,lv_color_hex(0x2c343d),LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc,8,LV_PART_INDICATOR);lv_obj_set_style_arc_color(arc,lv_color_hex(color),LV_PART_INDICATOR);
    return arc;
}
static void catalog_toggle(lv_event_t *event) {
    if(filling_catalog)return;
    int index=(int)(intptr_t)lv_event_get_user_data(event);
    if(!connected()){request_catalog();return;}
    cJSON *root=message("select");cJSON_AddStringToObject(root,"kind",catalog_channels?"channels":"sensors");
    cJSON_AddStringToObject(root,"id",catalog_ids[index]);cJSON_AddBoolToObject(root,"enabled",lv_obj_has_state(catalog_checks[index],LV_STATE_CHECKED));
    cJSON_AddNumberToObject(root,"offset",catalog_offset);cJSON_AddBoolToObject(root,"onlySelected",catalog_filter);enqueue(root);
}
static void catalog_move(lv_event_t *event) {
    int target=catalog_offset+(int)(intptr_t)lv_event_get_user_data(event)*8;
    if(target<0||target>=catalog_total) return;
    catalog_offset=target;
    request_catalog();
}
static void catalog_filter_changed(lv_event_t *event) {
    catalog_filter=lv_obj_has_state(lv_event_get_target(event),LV_STATE_CHECKED);catalog_offset=0;request_catalog();
}
static void make_catalog(lv_obj_t *parent,int y) {
    if(catalog_parent)lv_obj_del(catalog_parent);
    catalog_parent=manager_card(parent,8,y,984,420);
    catalog_selected=lv_checkbox_create(catalog_parent);lv_obj_set_pos(catalog_selected,8,4);lv_checkbox_set_text(catalog_selected,"");
    lv_obj_set_style_text_font(catalog_selected,&lv_font_montserrat_14,LV_PART_MAIN);
    lv_obj_set_style_width(catalog_selected,20,LV_PART_INDICATOR);lv_obj_set_style_height(catalog_selected,20,LV_PART_INDICATOR);
    lv_obj_set_style_pad_all(catalog_selected,2,LV_PART_INDICATOR);
    lv_obj_set_style_text_font(catalog_selected,&lv_font_montserrat_14,LV_PART_INDICATOR|LV_STATE_CHECKED);
    lv_obj_t *filter_label=label(catalog_selected,36,1,300,foreground());lv_label_set_text(filter_label,"仅显示已选");
    if(catalog_filter)lv_obj_add_state(catalog_selected,LV_STATE_CHECKED);
    lv_obj_add_event_cb(catalog_selected,catalog_filter_changed,LV_EVENT_VALUE_CHANGED,NULL);
    for(int i=0;i<8;i++) {
        catalog_checks[i]=lv_checkbox_create(catalog_parent);lv_obj_set_pos(catalog_checks[i],8,42+i*38);
        lv_obj_set_style_text_font(catalog_checks[i],&lv_font_montserrat_14,LV_PART_MAIN);
        lv_obj_set_style_width(catalog_checks[i],20,LV_PART_INDICATOR);lv_obj_set_style_height(catalog_checks[i],20,LV_PART_INDICATOR);
        lv_obj_set_style_pad_all(catalog_checks[i],2,LV_PART_INDICATOR);
        lv_obj_set_style_text_font(catalog_checks[i],&lv_font_montserrat_14,LV_PART_INDICATOR|LV_STATE_CHECKED);
        lv_checkbox_set_text(catalog_checks[i],"");lv_obj_set_size(catalog_checks[i],966,34);
        lv_obj_add_event_cb(catalog_checks[i],catalog_toggle,LV_EVENT_VALUE_CHANGED,(void *)(intptr_t)i);
        catalog_labels[i]=label(catalog_checks[i],36,1,914,foreground());
        lv_obj_add_state(catalog_checks[i],LV_STATE_DISABLED);catalog_ids[i][0]=0;
    }
    catalog_previous=compact_button(catalog_parent,8,374,76,36,LV_SYMBOL_LEFT,true,catalog_move,(void *)(intptr_t)-1);
    catalog_next=compact_button(catalog_parent,900,374,76,36,LV_SYMBOL_RIGHT,true,catalog_move,(void *)(intptr_t)1);
    catalog_position=label(catalog_parent,130,382,724,secondary());lv_obj_set_style_text_align(catalog_position,LV_TEXT_ALIGN_CENTER,0);
    lv_label_set_text(catalog_position,"读取中");bubble_tree(catalog_parent);request_catalog();
}
static void rerender_settings_async(void *data) {
    (void)data;if(!overlay)return;
    if(settings_page==SETTINGS_HOME)render_settings_home();
    else if(settings_page>=SETTINGS_OVERVIEW&&settings_page<=SETTINGS_RADAR)render_plugin_settings(settings_page);
}
static void display_toggle(lv_event_t *event) {
    int id=(int)(intptr_t)lv_event_get_user_data(event);bool value=lv_obj_has_state(lv_event_get_target(event),LV_STATE_CHECKED);
    if(id==0)prefs.dark=value;else if(id==1)prefs.big_values=value;else prefs.show_minmax=value;
    changed();if(id==0)lv_async_call(rerender_settings_async,NULL);
}
static void cycle_changed(lv_event_t *event) {
    static const unsigned seconds[]={0,5,10,15,30,60};
    unsigned selected=lv_dropdown_get_selected(lv_event_get_target(event));prefs.cycle_seconds=seconds[selected<6?selected:0];last_navigation=esp_timer_get_time();changed();lv_async_call(rerender_settings_async,NULL);
}
static lv_obj_t *settings_switch(lv_obj_t *parent,int x,int y,bool checked,lv_event_cb_t callback,void *data) {
    lv_obj_t *control=lv_switch_create(parent);lv_obj_set_pos(control,x,y);lv_obj_set_size(control,40,22);
    lv_obj_set_style_bg_color(control,lv_color_hex(manager_border()),LV_PART_MAIN);
    lv_obj_set_style_bg_color(control,lv_color_hex(manager_accent()),LV_PART_INDICATOR|LV_STATE_CHECKED);
    lv_obj_set_style_bg_color(control,lv_color_hex(0xffffff),LV_PART_KNOB);
    lv_obj_set_style_pad_all(control,2,LV_PART_MAIN);
    if(checked)lv_obj_add_state(control,LV_STATE_CHECKED);
    lv_obj_add_event_cb(control,callback,LV_EVENT_VALUE_CHANGED,data);
    return control;
}
static void preview_plugin(lv_event_t *event) {
    int id=(int)(intptr_t)lv_event_get_user_data(event);
    if((prefs.mask&(1U<<id))&&plugin_pages[id]>=0){go_page(plugin_pages[id]);close_settings(NULL);}
}
static void manage_plugin(lv_event_t *event) {render_plugin_settings((int)(intptr_t)lv_event_get_user_data(event));}
static void manual_switch(lv_event_t *event) {(void)event;next_plugin(1);close_settings(NULL);}
static void auto_switch_toggle(lv_event_t *event) {
    prefs.cycle_seconds=lv_obj_has_state(lv_event_get_target(event),LV_STATE_CHECKED)?10:0;
    last_navigation=esp_timer_get_time();changed();lv_async_call(rerender_settings_async,NULL);
}
static void show_catalog_settings(int code) {
    catalog_return_page=code/2;catalog_channels=code%2!=0;
    settings_page=SETTINGS_CATALOG;catalog_offset=0;catalog_total=0;catalog_filter=false;
    lv_obj_clean(settings_body);lv_obj_clear_flag(settings_back,LV_OBJ_FLAG_HIDDEN);lv_obj_set_x(settings_heading,58);
    lv_obj_set_style_bg_color(settings_topbar,lv_color_hex(manager_card_bg()),0);
    lv_label_set_text(settings_heading,catalog_channels?"选择 Coding 渠道":"选择系统指标");make_catalog(settings_body,0);
}
static void open_catalog_settings(lv_event_t *event) {show_catalog_settings((int)(intptr_t)lv_event_get_user_data(event));}
static void settings_back_action(lv_event_t *event) {
    (void)event;if(settings_page==SETTINGS_CATALOG)render_plugin_settings(catalog_return_page);else if(settings_page!=SETTINGS_HOME)render_settings_home();else close_settings(NULL);
}
static void plugin_toolbar(int id,const char *meta) {
    lv_obj_t *bar=manager_card(settings_body,8,0,984,50);
    lv_obj_t *caption=label(bar,16,12,520,foreground());lv_label_set_text(caption,meta);
    compact_button(bar,714,7,108,36,LV_SYMBOL_EYE_OPEN,true,preview_plugin,(void *)(intptr_t)id);
    group_checks[id]=settings_switch(bar,902,9,(prefs.mask&(1U<<id))!=0,group_toggle,(void *)(intptr_t)id);
    lv_obj_t *enabled=label(bar,832,13,62,secondary());lv_label_set_text(enabled,"启用");
}
static void info_row(lv_obj_t *parent,int y,const char *title_text,const char *detail_text,const char *action,lv_event_cb_t callback,void *data) {
    lv_obj_t *card=manager_card(parent,8,y,984,88);
    lv_obj_t *heading=label(card,18,16,420,foreground());lv_label_set_text(heading,title_text);
    lv_obj_t *detail=label(card,18,47,730,secondary());lv_label_set_text(detail,detail_text);
    if(action)compact_button(card,812,23,150,42,action,false,callback,data);
}
static void render_settings_home(void) {
    if(!settings_body)return;
    settings_page=SETTINGS_HOME;catalog_parent=NULL;catalog_position=NULL;lv_obj_clean(settings_body);
    lv_obj_set_size(settings_topbar,1024,48);lv_obj_set_pos(settings_body,0,48);lv_obj_set_size(settings_body,1024,552);
    lv_obj_set_y(settings_back,8);lv_obj_add_flag(settings_back,LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_pos(settings_heading,22,9);lv_obj_set_height(settings_heading,30);lv_obj_set_style_text_font(settings_heading,&ui_font_16r,0);lv_label_set_text(settings_heading,"Monitor");
    lv_obj_set_y(lv_obj_get_child(settings_topbar,2),8);
    lv_obj_set_style_bg_color(settings_topbar,lv_color_hex(manager_card_bg()),0);
    lv_obj_t *sidebar=manager_panel(settings_body,0,0,229,552,manager_card_bg(),0,false);
    lv_obj_set_style_border_side(sidebar,LV_BORDER_SIDE_RIGHT,0);lv_obj_set_style_border_width(sidebar,1,0);
    manager_icon(sidebar,94,20,40,LV_SYMBOL_LIST,secondary());
    lv_obj_t *display_nav=manager_panel(sidebar,14,68,204,50,manager_card_bg(),8,false);
    manager_text(display_nav,14,15,112,"深色模式",foreground());
    settings_switch(display_nav,154,14,prefs.dark,display_toggle,(void *)(intptr_t)0);
    lv_obj_t *plugin_nav=manager_panel(sidebar,14,125,204,50,manager_accent(),8,false);
    manager_icon(plugin_nav,18,11,32,LV_SYMBOL_LIST,0xffffff);manager_text(plugin_nav,55,15,128,"插件管理",0xffffff);
    manager_heading(settings_body,259,30,230,"插件管理",foreground());
    manager_button(settings_body,720,32,104,36,"手动切换",false,false,manual_switch,NULL);
    manager_text(settings_body,840,40,76,"自动切换",secondary());
    settings_switch(settings_body,914,39,prefs.cycle_seconds>0,auto_switch_toggle,NULL);
    lv_obj_t *list=manager_scroll(settings_body,249,91,743,461);
    for(int id=0;id<4;id++) {
        char meta[180];
        if(id==0)snprintf(meta,sizeof(meta),"%s · %d 渠道 · %d 指标",group_descriptions[id],manager_info.overview_channels,manager_info.overview_sensors);
        else if(id==1)snprintf(meta,sizeof(meta),"%s · %d 账号 · %d 渠道",group_descriptions[id],manager_info.coding_accounts,manager_info.coding_channels);
        else if(id==2)snprintf(meta,sizeof(meta),"%s · 已选 %d / %d",group_descriptions[id],manager_info.system_selected,manager_info.system_total);
        else snprintf(meta,sizeof(meta),"%s · %s · %d 秒",group_descriptions[id],manager_info.radar_provider[0]?manager_info.radar_provider:"LLM",manager_info.radar_interval);
        group_rows[id]=manager_card(list,10,id*170,700,160);
        const char *icons[]={LV_SYMBOL_LIST,"</>",LV_SYMBOL_CHARGE,LV_SYMBOL_REFRESH};
        lv_obj_t *icon=label(group_rows[id],20,22,36,secondary());lv_obj_set_style_text_font(icon,&lv_font_montserrat_20,0);lv_label_set_text(icon,icons[id]);
        manager_text(group_rows[id],64,22,420,group_names[id],foreground());
        manager_meta(group_rows[id],64,50,550,meta,secondary());
        manager_divider(group_rows[id],20,87,660);
        manager_button(group_rows[id],20,102,80,36,"管理",false,false,manage_plugin,(void *)(intptr_t)id);
        lv_obj_t *preview=manager_button(group_rows[id],108,102,80,36,"预览",false,false,preview_plugin,(void *)(intptr_t)id);
        if(!(prefs.mask&(1U<<id)))lv_obj_add_state(preview,LV_STATE_DISABLED);
        manager_button(group_rows[id],196,102,44,36,LV_SYMBOL_UP,false,true,reorder,(void *)(intptr_t)(id*2));
        manager_button(group_rows[id],248,102,44,36,LV_SYMBOL_DOWN,false,true,reorder,(void *)(intptr_t)(id*2+1));
        group_checks[id]=settings_switch(group_rows[id],630,28,(prefs.mask&(1U<<id))!=0,group_toggle,(void *)(intptr_t)id);
        if(!(prefs.mask&(1U<<id)))lv_obj_set_style_opa(group_rows[id],LV_OPA_50,0);
    }
    for(int i=0;i<4;i++)lv_obj_set_y(group_rows[prefs.order[i]],i*170);
    lv_obj_t *footer=manager_panel(list,10,680,700,54,manager_card_bg(),12,true);
    save_status=manager_meta(footer,18,18,450,save_failed?"保存失败":"设置保存在设备",secondary());
    bubble_tree(settings_body);
}
static void render_plugin_settings(int id) {
    if(!settings_body||id<0||id>3)return;
    settings_page=id;catalog_parent=NULL;catalog_position=NULL;lv_obj_clean(settings_body);
    lv_obj_set_size(settings_topbar,1024,38);lv_obj_set_pos(settings_body,0,38);lv_obj_set_size(settings_body,1024,562);
    lv_obj_set_y(settings_back,3);lv_obj_set_y(lv_obj_get_child(settings_topbar,2),3);
    lv_obj_clear_flag(settings_back,LV_OBJ_FLAG_HIDDEN);lv_obj_set_pos(settings_heading,58,6);lv_obj_set_height(settings_heading,26);lv_obj_set_style_text_font(settings_heading,&ui_font_16r,0);char heading[80];
    if(id==SETTINGS_CODING)snprintf(heading,sizeof(heading),"Coding Plan 管理");else snprintf(heading,sizeof(heading),"%s管理",group_names[id]);lv_label_set_text(settings_heading,heading);
    lv_obj_set_style_bg_color(settings_topbar,lv_color_hex(manager_card_bg()),0);
    if(id==0) {
        manager_heading(settings_body,18,4,260,"缩略总览管理",foreground());manager_meta(settings_body,950,17,56,"54%",secondary());
        manager_divider(settings_body,18,56,988);
        lv_obj_t *editor=manager_scroll(settings_body,12,64,500,490);
        manager_icon(editor,14,7,24,LV_SYMBOL_LIST,foreground());manager_text(editor,48,8,200,"缩略显示",foreground());
        char cells[40];snprintf(cells,sizeof(cells),"%d 格",manager_info.overview_layout_count?manager_info.overview_layout_count:6);manager_meta(editor,250,10,80,cells,secondary());
        settings_switch(editor,438,8,(prefs.mask&1U)!=0,group_toggle,(void *)(intptr_t)0);
        manager_divider(editor,14,43,462);
        manager_text(editor,14,54,310,"> Coding Plan 渠道多选",foreground());
        manager_button(editor,404,48,72,34,"选择",false,false,open_catalog_settings,(void *)(intptr_t)1);
        manager_divider(editor,14,89,462);
        manager_text(editor,14,100,180,"系统监控",foreground());manager_button(editor,438,94,38,34,"+",false,false,open_catalog_settings,(void *)(intptr_t)0);
        manager_divider(editor,14,135,462);
        for(int i=0;i<6;i++){
            const char *fallback[]={"Coding Plan","系统监控","Tibo 雷达","空","空","空"};const char *kind=fallback[i],*cells=i<3?"双格":"未使用";
            if(i<manager_info.overview_layout_count){kind=manager_info.overview_layout[i].kind;cells=manager_info.overview_layout[i].cells;}
            int y=143+i*88;char number[12];snprintf(number,sizeof(number),"%d",i+1);manager_meta(editor,14,y+11,20,number,secondary());
            lv_obj_t *kind_box=manager_panel(editor,46,y+1,128,38,manager_bg(),6,true);manager_text(kind_box,10,8,108,kind,foreground());
            const char *detail=!strcmp(kind,"Coding Plan")?"1 个渠道":!strcmp(kind,"系统监控")?"卡片 1 · GPU 显存":"当前状态 · 最近重置";
            manager_meta(editor,184,y+11,190,detail,secondary());
            lv_obj_t *mode=manager_panel(editor,384,y+1,92,38,manager_bg(),6,true);manager_text(mode,8,8,76,cells&&*cells?cells:"横双格",foreground());
            manager_icon(editor,44,y+46,24,LV_SYMBOL_TRASH,secondary());manager_icon(editor,84,y+46,24,LV_SYMBOL_UP,secondary());manager_icon(editor,122,y+46,24,LV_SYMBOL_DOWN,secondary());
            manager_meta(editor,184,y+49,42,"文字",foreground());lv_obj_t *a=lv_slider_create(editor);lv_obj_set_pos(a,230,y+51);lv_obj_set_size(a,92,4);lv_slider_set_value(a,i<3?72:50,LV_ANIM_OFF);
            lv_obj_set_style_bg_color(a,lv_color_hex(manager_accent()),LV_PART_INDICATOR);lv_obj_set_style_bg_color(a,lv_color_hex(manager_accent()),LV_PART_KNOB);manager_ascii(editor,330,y+46,48,i<3?"200%":"100%",secondary());
            manager_meta(editor,380,y+49,42,"数值",foreground());lv_obj_t *b=lv_slider_create(editor);lv_obj_set_pos(b,426,y+51);lv_obj_set_size(b,50,4);lv_slider_set_value(b,i<3?72:50,LV_ANIM_OFF);lv_obj_set_style_bg_color(b,lv_color_hex(manager_accent()),LV_PART_INDICATOR);lv_obj_set_style_bg_color(b,lv_color_hex(manager_accent()),LV_PART_KNOB);
            manager_divider(editor,14,y+82,462);
        }
        lv_obj_t *right=plain(settings_body,526,64,486,490);manager_panel(settings_body,520,64,1,490,manager_border(),0,false);
        manager_checkbox(right,10,0,true);manager_text(right,48,5,145,"跟随实际分辨率",foreground());
        manager_text(right,202,5,28,"宽",foreground());lv_obj_t *wide=manager_panel(right,234,0,92,38,manager_card_bg(),5,true);manager_ascii(wide,10,9,70,"1024",foreground());
        manager_text(right,338,5,28,"高",foreground());lv_obj_t *high=manager_panel(right,370,0,82,38,manager_card_bg(),5,true);manager_ascii(high,10,9,62,"600",foreground());
        manager_button(right,458,0,28,38,LV_SYMBOL_REFRESH,false,true,NULL,NULL);manager_meta(right,10,43,450,"画布 1024 x 600 · 输出 1024 x 600 px",secondary());
        /* Scaled sketch of the overview dashboard (same grid and palette, sample values). */
        const ui_palette_t *pal=ui_pal();
        lv_obj_t *preview=ui_box(right,14,102,460,270,pal->bg,10);
        lv_obj_t *coding=ui_box(preview,7,7,297,122,pal->surface,8);manager_text(coding,10,8,170,"Coding Plan",foreground());
        lv_obj_t *outer=ui_ring(coding,10,34,80,7,360,pal->amber),*inner=ui_ring(coding,20,44,60,7,360,pal->blue);ui_ring_value(outer,0);ui_ring_value(inner,0);
        manager_meta(coding,110,38,90,"周用量",secondary());manager_text(coding,110,58,110,"--",foreground());
        manager_meta(coding,212,38,80,"月用量",secondary());manager_text(coding,212,58,80,"--",pal->amber);
        manager_meta(coding,110,88,180,"等待配置渠道",secondary());
        const char *kinds[]={"GPU 显存","内存"},*values[]={"--","--"};const uint32_t colors[]={pal->blue,pal->violet};
        for(int i=0;i<2;i++){
            lv_obj_t *sensor=ui_box(preview,7+i*151,135,146,128,pal->surface,8);manager_text(sensor,10,8,126,kinds[i],foreground());
            manager_text(sensor,10,62,126,values[i],colors[i]);lv_obj_t *bar=ui_bar(sensor,10,94,126,4,colors[i]);lv_bar_set_value(bar,i?55:37,LV_ANIM_OFF);
        }
        lv_obj_t *radar=ui_box(preview,310,7,143,256,pal->surface,8);manager_text(radar,10,8,126,"Tibo 雷达",foreground());
        manager_meta(radar,10,38,126,"最近重置",secondary());manager_text(radar,10,58,126,"1天前",foreground());
        manager_meta(radar,10,92,126,"当前状态",secondary());manager_text(radar,10,112,126,"等待重置",pal->amber);
        for(int i=0;i<2;i++){lv_obj_t *post=ui_box(radar,6,148+i*52,131,46,pal->surface2,6);manager_meta(post,8,6,115,i?"Taken by none...":"More resets coming",foreground());manager_meta(post,8,25,115,i?"09/28 15:04":"重置预告",i?pal->text3:pal->amber);}
    } else if(id==1) {
        manager_heading(settings_body,42,10,330,"Coding Plan 管理",foreground());manager_meta(settings_body,42,49,620,"登录账号后自动获取用量数据，每个账号独立隔离",secondary());
        manager_button(settings_body,736,16,118,38,"+  新建渠道",true,false,NULL,NULL);manager_ascii_pill(settings_body,866,16,110,"DEBUG",secondary(),manager_card_bg());
        lv_obj_t *cards=manager_scroll(settings_body,36,94,952,460);
        int shown=manager_info.coding_item_count<4?manager_info.coding_item_count:4;
        if(!shown){lv_obj_t *empty=manager_card(cards,8,0,920,150);manager_text(empty,20,16,400,"暂无账号",foreground());manager_text(empty,20,52,620,"请先在 Windows 后端添加并登录账号",secondary());}
        for(int i=0;i<shown;i++){
            int y=i*174;bool selected=manager_info.coding_items[i].selected>0;lv_obj_t *card=manager_card(cards,8,y,920,160);
            if(selected){lv_obj_set_style_border_color(card,lv_color_hex(manager_accent()),0);lv_obj_set_style_border_width(card,2,0);lv_obj_set_style_bg_color(card,lv_color_hex(0x0b2133),0);}
            manager_checkbox(card,22,22,selected);
            lv_obj_t *icon=manager_panel(card,68,18,48,48,manager_hover(),10,false);manager_text(icon,8,3,32,"<>",foreground());
            manager_text(card,132,13,190,manager_info.coding_items[i].kind,foreground());
            lv_obj_t *account=manager_panel(card,294,14,180,34,manager_hover(),6,true);manager_text(account,10,6,158,manager_info.coding_items[i].label,foreground());
            manager_meta(card,132,46,230,manager_info.coding_items[i].subtitle,secondary());
            uint32_t status_color=!strcmp(manager_info.coding_items[i].status,"已连接")?0x30d158:(!strcmp(manager_info.coding_items[i].status,"需重连")?0xff9f0a:secondary());
            manager_pill(card,790,20,104,manager_info.coding_items[i].status,status_color,selected?0x0b3153:manager_hover());
            manager_divider(card,22,78,872);
            manager_meta(card,22,88,600,manager_info.coding_items[i].description,secondary());
            char count[72];snprintf(count,sizeof(count),"%d / %d",manager_info.coding_items[i].selected,manager_info.coding_items[i].available);manager_ascii_pill(card,650,88,92,count,selected?manager_accent():secondary(),manager_hover());
            manager_ascii_pill(card,750,88,144,"Windows backend",secondary(),manager_hover());
            manager_meta(card,22,124,300,"自动登录  由 Windows 管理",secondary());
        }
    } else if(id==2) {
        manager_ascii(settings_body,30,10,280,"LIBRE HARDWARE MONITOR",manager_accent());manager_heading(settings_body,30,31,300,"系统监控管理",foreground());
        manager_meta(settings_body,30,73,780,"内置 LibreHardwareMonitor 采集引擎，自动启动并扫描全部硬件传感器。",secondary());
        manager_meta(settings_body,30,101,900,"Windows 传感器 · LibreHardwareMonitor/LibreHardwareMonitor · MPL-2.0 · 源码",secondary());
        manager_button(settings_body,864,16,132,38,"管理传感器",false,false,open_catalog_settings,(void *)(intptr_t)4);
        lv_obj_t *browser=manager_card(settings_body,30,132,966,416);
        manager_text(browser,20,10,700,"传感器",foreground());char selected_text[64];snprintf(selected_text,sizeof(selected_text),"已选 %d / %d",manager_info.system_selected,manager_info.system_total);manager_meta(browser,760,12,170,selected_text,secondary());
        manager_divider(browser,20,42,926);
        lv_obj_t *hardware=manager_panel(browser,20,50,926,44,manager_hover(),0,false);manager_icon(hardware,10,9,24,LV_SYMBOL_DOWN,foreground());char hardware_title[130];snprintf(hardware_title,sizeof(hardware_title),"硬件 · %s",manager_info.system_preview_hardware[0]?manager_info.system_preview_hardware:"系统传感器");manager_text(hardware,42,11,700,hardware_title,foreground());char total[32];snprintf(total,sizeof(total),"%d",manager_info.system_preview_total);manager_ascii(hardware,858,13,50,total,secondary());
        lv_obj_t *sensor_scroll=manager_scroll(browser,20,96,926,306);lv_obj_set_style_bg_color(sensor_scroll,lv_color_hex(0x181d23),0);lv_obj_set_style_bg_opa(sensor_scroll,LV_OPA_COVER,0);
        if(!manager_info.system_preview_group_count){manager_text(sensor_scroll,20,12,700,"尚未读取到传感器预览",secondary());}
        for(int g=0;g<manager_info.system_preview_group_count;g++){
            int gy=g*132;lv_obj_t *block=manager_panel(sensor_scroll,0,gy,902,124,0x1b2026,0,true);
            char group_title[96];snprintf(group_title,sizeof(group_title),"%s   %d / %d 已选",manager_info.system_preview_groups[g].label,manager_info.system_preview_groups[g].selected,manager_info.system_preview_groups[g].total);manager_text(block,14,10,470,group_title,foreground());
            char primary[120];snprintf(primary,sizeof(primary),"%s · %s",manager_info.system_preview_groups[g].primary,manager_info.system_preview_groups[g].primary_value);lv_obj_t *primary_label=manager_meta(block,560,12,320,primary,manager_accent());lv_obj_set_style_text_align(primary_label,LV_TEXT_ALIGN_RIGHT,0);manager_divider(block,0,40,902);
            for(int s=0;s<manager_info.system_preview_groups[g].sensor_count;s++){
                int col=s%3,row=s/3,x=14+col*294,y=48+row*36;manager_ascii(block,x,y+6,22,manager_info.system_preview_groups[g].sensors[s].favorite?"*":"+",manager_info.system_preview_groups[g].sensors[s].favorite?0xff9f0a:secondary());
                lv_obj_t *tile=manager_panel(block,x+28,y,174,32,manager_info.system_preview_groups[g].sensors[s].selected?0x16334d:manager_hover(),6,true);
                if(manager_info.system_preview_groups[g].sensors[s].selected)lv_obj_set_style_border_color(tile,lv_color_hex(manager_accent()),0);
                manager_meta(tile,8,7,158,manager_info.system_preview_groups[g].sensors[s].name,foreground());
                lv_obj_t *alias=manager_panel(block,x+208,y,72,32,manager_card_bg(),6,true);manager_meta(alias,8,7,56,"重命名",secondary());
            }
        }
    } else {
        manager_heading(settings_body,34,9,260,"Tibo 雷达管理",foreground());manager_meta(settings_body,34,50,700,"重置预告、完成通知与延迟观察",secondary());
        manager_pill(settings_body,848,18,142,manager_info.radar_running?"● 后端运行中":"只读跟随",manager_info.radar_running?0x30d158:secondary(),manager_hover());
        lv_obj_t *radar_scroll=manager_scroll(settings_body,28,92,968,462);
        lv_obj_t *provider=manager_card(radar_scroll,8,0,936,102);
        manager_text(provider,20,14,260,"判断渠道",foreground());manager_meta(provider,20,48,300,"选择帖子判断引擎",secondary());
        lv_obj_t *llm=manager_panel(provider,506,22,190,58,manager_card_bg(),10,true),*jev=manager_panel(provider,714,22,196,58,manager_card_bg(),10,true);
        bool use_jev=!strcmp(manager_info.radar_provider,"JEV");
        lv_obj_set_style_border_color(use_jev?jev:llm,lv_color_hex(manager_accent()),0);lv_obj_set_style_border_width(use_jev?jev:llm,2,0);
        manager_text(llm,14,18,160,use_jev?"LLM":"LLM  ·  使用中",use_jev?secondary():foreground());manager_text(jev,14,18,170,use_jev?"JEV  ·  使用中":"JEV",use_jev?foreground():secondary());
        lv_obj_t *source=manager_card(radar_scroll,8,114,936,82);manager_text(source,20,13,250,"X 帖子来源",foreground());manager_meta(source,20,46,700,manager_info.radar_replies?"读取主帖与回复 · X 连接由 Windows 后端维护":"仅主帖",secondary());
        lv_obj_t *connection=manager_card(radar_scroll,8,208,936,116);manager_text(connection,20,13,250,"连接参数",foreground());manager_meta(connection,656,15,252,use_jev?"LLM 参数    JEV 参数 · 当前":"LLM 参数 · 当前    JEV 参数",secondary());manager_meta(connection,20,54,884,"Base URL、API Key、模型名、连接测试与 X 登录继续由 Windows 后端管理",secondary());
        lv_obj_t *schedule=manager_card(radar_scroll,8,336,936,150);manager_text(schedule,20,12,180,"检查间隔",foreground());
        char interval[96];snprintf(interval,sizeof(interval),"%d 秒 · %s",manager_info.radar_interval,manager_info.radar_paused?"后台已暂停":"后台检查中");
        manager_meta(schedule,220,14,680,interval,secondary());manager_text(schedule,20,50,180,"显示时区",foreground());manager_meta(schedule,220,52,680,manager_info.radar_timezone[0]?manager_info.radar_timezone:"Asia/Shanghai",secondary());manager_divider(schedule,20,88,896);manager_meta(schedule,20,102,884,"待补全、待判断与同步状态由 Windows 后端持续更新",secondary());
    }
    bubble_tree(settings_body);
}
static void open_settings(lv_event_t *event) {
    (void)event;if(overlay)return;if(radar_detail_overlay)close_radar_detail(NULL);if(manual_overlay)close_manual_dialog(NULL);
    overlay=plain(lv_scr_act(),0,0,1024,600);lv_obj_set_style_bg_opa(overlay,LV_OPA_COVER,0);
    settings_topbar=manager_panel(overlay,0,0,1024,38,manager_card_bg(),0,false);
    lv_obj_set_style_border_side(settings_topbar,LV_BORDER_SIDE_BOTTOM,0);lv_obj_set_style_border_width(settings_topbar,1,0);
    settings_back=manager_button(settings_topbar,4,3,42,32,LV_SYMBOL_LEFT,false,true,settings_back_action,NULL);lv_obj_add_flag(settings_back,LV_OBJ_FLAG_HIDDEN);
    settings_heading=label(settings_topbar,22,0,620,foreground());lv_obj_set_height(settings_heading,38);lv_label_set_text(settings_heading,"Monitor");
    manager_button(settings_topbar,978,3,42,32,LV_SYMBOL_CLOSE,false,true,close_settings,NULL);
    settings_body=manager_panel(overlay,0,38,1024,562,manager_bg(),0,false);render_settings_home();bubble_tree(overlay);apply_palette();
}
static void show_content(bool dashboard,bool native){
    dashboard_visible=dashboard;bool visible=dashboard||native;
    if(dashboard)lv_obj_clear_flag(dashboard_panel,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(dashboard_panel,LV_OBJ_FLAG_HIDDEN);
    monitor_pages_show(native);
    lv_obj_t *header[]={title,status,pager};
    for(unsigned i=0;i<3;i++){if(visible)lv_obj_add_flag(header[i],LV_OBJ_FLAG_HIDDEN);else lv_obj_clear_flag(header[i],LV_OBJ_FLAG_HIDDEN);}
    if(visible)for(int i=0;i<6;i++)lv_obj_add_flag(rows[i],LV_OBJ_FLAG_HIDDEN);
    int first,last;group_bounds(&first,&last);
    if(visible||first==last){lv_obj_add_flag(previous,LV_OBJ_FLAG_HIDDEN);lv_obj_add_flag(next,LV_OBJ_FLAG_HIDDEN);lv_obj_add_flag(pager,LV_OBJ_FLAG_HIDDEN);}
    else {lv_obj_clear_flag(previous,LV_OBJ_FLAG_HIDDEN);lv_obj_clear_flag(next,LV_OBJ_FLAG_HIDDEN);}
}
void monitor_ui_init(void) {
    save_failed=!monitor_settings_load(&prefs);
    navigation=xQueueCreate(1,sizeof(int));commands=xQueueCreate(8,1024);configASSERT(navigation&&commands);
    large_font=ui_font_26b;
    lv_obj_t *screen=lv_scr_act();lv_obj_clear_flag(screen,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_text_font(screen,&ui_font_20r,0);
    lv_obj_add_event_cb(screen,root_event,LV_EVENT_ALL,NULL);
    title=label(screen,22,16,620,foreground());lv_label_set_text(title,"Monitor / ESP32-S3 5B");
    status=label(screen,742,16,260,secondary());
    for(int i=0;i<6;i++) {
        rows[i]=lv_obj_create(screen);lv_obj_set_pos(rows[i],16,58+i*77);lv_obj_set_size(rows[i],992,72);
        lv_obj_clear_flag(rows[i],LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_style_pad_all(rows[i],0,0);lv_obj_set_style_radius(rows[i],4,0);lv_obj_set_style_border_width(rows[i],0,0);bubble(rows[i]);
        labels[i]=label(rows[i],12,7,724,foreground());values[i]=label(rows[i],746,7,230,accents[i]);lv_obj_set_style_text_align(values[i],LV_TEXT_ALIGN_RIGHT,0);
        details[i]=label(rows[i],12,33,966,secondary());
        bars[i]=lv_bar_create(rows[i]);lv_obj_set_pos(bars[i],12,63);lv_obj_set_size(bars[i],966,3);lv_obj_set_style_bg_color(bars[i],lv_color_hex(accents[i]),LV_PART_INDICATOR);lv_obj_add_flag(bars[i],LV_OBJ_FLAG_HIDDEN);
    }
    previous=button(screen,366,538,56,LV_SYMBOL_LEFT,true,navigate,(void *)(intptr_t)-1);
    next=button(screen,602,538,56,LV_SYMBOL_RIGHT,true,navigate,(void *)(intptr_t)1);bubble(previous);bubble(next);
    pager=label(screen,430,550,164,secondary());lv_obj_set_style_text_align(pager,LV_TEXT_ALIGN_CENTER,0);lv_label_set_text(pager,"");
    dashboard_panel=monitor_dashboard_create(screen);lv_obj_add_flag(dashboard_panel,LV_OBJ_FLAG_HIDDEN);
    native_page_panel=monitor_pages_create(screen);lv_obj_add_flag(native_page_panel,LV_OBJ_FLAG_HIDDEN);
    lv_obj_move_foreground(previous);lv_obj_move_foreground(next);
    lv_obj_add_flag(previous,LV_OBJ_FLAG_HIDDEN);lv_obj_add_flag(next,LV_OBJ_FLAG_HIDDEN);
    apply_density();apply_palette();last_navigation=esp_timer_get_time();lv_timer_create(status_tick,200,NULL);status_tick(NULL);
}
static int json_int(cJSON *object,const char *key,int fallback) {
    cJSON *value=cJSON_GetObjectItemCaseSensitive(object,key);return cJSON_IsNumber(value)?value->valueint:fallback;
}
static bool json_bool(cJSON *object,const char *key,bool fallback) {
    cJSON *value=cJSON_GetObjectItemCaseSensitive(object,key);return cJSON_IsBool(value)?cJSON_IsTrue(value):fallback;
}
static void copy_json_text(char *target,size_t size,cJSON *object,const char *key) {
    const char *value=string(object,key);if(*value)snprintf(target,size,"%s",value);
}
static void apply_manager_summary(cJSON *root) {
    cJSON *manager=cJSON_GetObjectItemCaseSensitive(root,"manager");if(!cJSON_IsObject(manager))return;
    cJSON *overview=cJSON_GetObjectItemCaseSensitive(manager,"overview"),*coding=cJSON_GetObjectItemCaseSensitive(manager,"coding");
    cJSON *system=cJSON_GetObjectItemCaseSensitive(manager,"system"),*radar=cJSON_GetObjectItemCaseSensitive(manager,"radar");
    if(cJSON_IsObject(overview)){
        manager_info.overview_channels=json_int(overview,"channels",manager_info.overview_channels);manager_info.overview_sensors=json_int(overview,"sensors",manager_info.overview_sensors);
        manager_info.overview_layout_count=0;cJSON *layout=cJSON_GetObjectItemCaseSensitive(overview,"layout"),*entry;
        cJSON_ArrayForEach(entry,layout){if(manager_info.overview_layout_count>=6)break;int i=manager_info.overview_layout_count++;
            manager_info.overview_layout[i].index=json_int(entry,"index",i+1);copy_json_text(manager_info.overview_layout[i].kind,sizeof(manager_info.overview_layout[i].kind),entry,"kind");copy_json_text(manager_info.overview_layout[i].cells,sizeof(manager_info.overview_layout[i].cells),entry,"cells");}
    }
    if(cJSON_IsObject(coding)){
        manager_info.coding_accounts=json_int(coding,"accounts",manager_info.coding_accounts);manager_info.coding_channels=json_int(coding,"channels",manager_info.coding_channels);
        manager_info.coding_item_count=0;cJSON *items=cJSON_GetObjectItemCaseSensitive(coding,"items"),*entry;
        cJSON_ArrayForEach(entry,items){if(manager_info.coding_item_count>=4)break;int i=manager_info.coding_item_count++;
            manager_info.coding_items[i].selected=json_int(entry,"selected",0);manager_info.coding_items[i].available=json_int(entry,"available",0);
            copy_json_text(manager_info.coding_items[i].label,sizeof(manager_info.coding_items[i].label),entry,"label");copy_json_text(manager_info.coding_items[i].kind,sizeof(manager_info.coding_items[i].kind),entry,"kind");
            copy_json_text(manager_info.coding_items[i].subtitle,sizeof(manager_info.coding_items[i].subtitle),entry,"subtitle");copy_json_text(manager_info.coding_items[i].description,sizeof(manager_info.coding_items[i].description),entry,"description");
            copy_json_text(manager_info.coding_items[i].status,sizeof(manager_info.coding_items[i].status),entry,"status");}
    }
    if(cJSON_IsObject(system)){
        manager_info.system_selected=json_int(system,"selected",manager_info.system_selected);manager_info.system_total=json_int(system,"total",manager_info.system_total);
        manager_info.system_refresh=json_int(system,"refreshInterval",manager_info.system_refresh);copy_json_text(manager_info.system_backend,sizeof(manager_info.system_backend),system,"backend");
        copy_json_text(manager_info.system_language,sizeof(manager_info.system_language),system,"language");copy_json_text(manager_info.system_color,sizeof(manager_info.system_color),system,"colorMode");
        manager_info.system_name_count=0;cJSON *names=cJSON_GetObjectItemCaseSensitive(system,"names"),*name;
        cJSON_ArrayForEach(name,names){if(manager_info.system_name_count>=6)break;if(cJSON_IsString(name))snprintf(manager_info.system_names[manager_info.system_name_count++],sizeof(manager_info.system_names[0]),"%s",name->valuestring);}
        manager_info.system_preview_group_count=0;manager_info.system_preview_hardware[0]=0;manager_info.system_preview_total=0;
        cJSON *preview=cJSON_GetObjectItemCaseSensitive(system,"preview");
        if(cJSON_IsObject(preview)){
            copy_json_text(manager_info.system_preview_hardware,sizeof(manager_info.system_preview_hardware),preview,"hardware");
            manager_info.system_preview_total=json_int(preview,"count",0);
            cJSON *groups=cJSON_GetObjectItemCaseSensitive(preview,"groups"),*group;
            cJSON_ArrayForEach(group,groups){
                if(manager_info.system_preview_group_count>=3||!cJSON_IsObject(group))break;
                int g=manager_info.system_preview_group_count++;manager_info.system_preview_groups[g].sensor_count=0;
                manager_info.system_preview_groups[g].selected=json_int(group,"selected",0);manager_info.system_preview_groups[g].total=json_int(group,"total",0);
                copy_json_text(manager_info.system_preview_groups[g].label,sizeof(manager_info.system_preview_groups[g].label),group,"label");
                copy_json_text(manager_info.system_preview_groups[g].primary,sizeof(manager_info.system_preview_groups[g].primary),group,"primary");
                copy_json_text(manager_info.system_preview_groups[g].primary_value,sizeof(manager_info.system_preview_groups[g].primary_value),group,"primaryValue");
                cJSON *sensors=cJSON_GetObjectItemCaseSensitive(group,"sensors"),*sensor;
                cJSON_ArrayForEach(sensor,sensors){
                    if(manager_info.system_preview_groups[g].sensor_count>=6||!cJSON_IsObject(sensor))break;
                    int s=manager_info.system_preview_groups[g].sensor_count++;
                    manager_info.system_preview_groups[g].sensors[s].selected=json_bool(sensor,"selected",false);
                    manager_info.system_preview_groups[g].sensors[s].favorite=json_bool(sensor,"favorite",false);
                    copy_json_text(manager_info.system_preview_groups[g].sensors[s].name,sizeof(manager_info.system_preview_groups[g].sensors[s].name),sensor,"name");
                    copy_json_text(manager_info.system_preview_groups[g].sensors[s].type,sizeof(manager_info.system_preview_groups[g].sensors[s].type),sensor,"type");
                    copy_json_text(manager_info.system_preview_groups[g].sensors[s].value,sizeof(manager_info.system_preview_groups[g].sensors[s].value),sensor,"value");
                }
            }
        }
    }
    if(cJSON_IsObject(radar)){
        manager_info.radar_interval=json_int(radar,"intervalSeconds",manager_info.radar_interval);manager_info.radar_replies=json_bool(radar,"repliesEnabled",manager_info.radar_replies);
        manager_info.radar_paused=json_bool(radar,"paused",manager_info.radar_paused);manager_info.radar_running=json_bool(radar,"running",manager_info.radar_running);
        copy_json_text(manager_info.radar_provider,sizeof(manager_info.radar_provider),radar,"provider");copy_json_text(manager_info.radar_timezone,sizeof(manager_info.radar_timezone),radar,"timezone");
    }
}
static void apply_catalog(cJSON *root) {
    if(!catalog_parent)return;
    if(strcmp(string(root,"kind"),catalog_channels?"channels":"sensors"))return;
    cJSON *items=cJSON_GetObjectItemCaseSensitive(root,"items"),*offset=cJSON_GetObjectItemCaseSensitive(root,"offset"),*total=cJSON_GetObjectItemCaseSensitive(root,"total");
    if(!cJSON_IsArray(items)||cJSON_GetArraySize(items)>8||!cJSON_IsNumber(offset)||!cJSON_IsNumber(total))return;
    catalog_offset=offset->valueint;catalog_total=total->valueint;filling_catalog=true;
    for(int i=0;i<8;i++) {
        cJSON *item=cJSON_GetArrayItem(items,i);
        if(!item){lv_obj_add_flag(catalog_checks[i],LV_OBJ_FLAG_HIDDEN);continue;}
        lv_obj_clear_flag(catalog_checks[i],LV_OBJ_FLAG_HIDDEN);lv_obj_clear_state(catalog_checks[i],LV_STATE_DISABLED);
        snprintf(catalog_ids[i],sizeof(catalog_ids[i]),"%s",string(item,"id"));
        lv_label_set_text(catalog_labels[i],string(item,"label"));
        if(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(item,"enabled")))lv_obj_add_state(catalog_checks[i],LV_STATE_CHECKED);else lv_obj_clear_state(catalog_checks[i],LV_STATE_CHECKED);
    }
    filling_catalog=false;char caption[96];snprintf(caption,sizeof(caption),"%d / %d",catalog_total?catalog_offset/8+1:0,(catalog_total+7)/8);lv_label_set_text(catalog_position,caption);
    if(catalog_offset>0)lv_obj_clear_state(catalog_previous,LV_STATE_DISABLED);else lv_obj_add_state(catalog_previous,LV_STATE_DISABLED);
    if(catalog_offset+8<catalog_total)lv_obj_clear_state(catalog_next,LV_STATE_DISABLED);else lv_obj_add_state(catalog_next,LV_STATE_DISABLED);
}
/* Preferences pushed by the PC editor: validated like on-device edits, then saved to NVS and echoed back. */
static bool apply_pushed_prefs(cJSON *value) {
    if(!cJSON_IsObject(value))return false;
    monitor_settings_t next=prefs;
    cJSON *mask=cJSON_GetObjectItemCaseSensitive(value,"mask"),*order=cJSON_GetObjectItemCaseSensitive(value,"order"),*cycle=cJSON_GetObjectItemCaseSensitive(value,"cycleSeconds");
    if(cJSON_IsNumber(mask)&&mask->valueint>=1&&mask->valueint<=15)next.mask=(uint32_t)mask->valueint;
    if(cJSON_IsArray(order)&&cJSON_GetArraySize(order)==4) {
        uint32_t seen=0,ids[4];bool ok=true;
        for(int i=0;i<4;i++){cJSON *item=cJSON_GetArrayItem(order,i);int id=cJSON_IsNumber(item)?item->valueint:-1;if(id<0||id>3||(seen&(1U<<id))){ok=false;break;}seen|=1U<<id;ids[i]=(uint32_t)id;}
        if(ok)memcpy(next.order,ids,sizeof(ids));
    }
    const char *flags[]={"dark","bigValues","showMinMax"};uint32_t *targets[]={&next.dark,&next.big_values,&next.show_minmax};
    for(int i=0;i<3;i++){cJSON *flag=cJSON_GetObjectItemCaseSensitive(value,flags[i]);if(cJSON_IsBool(flag))*targets[i]=cJSON_IsTrue(flag);}
    if(cJSON_IsNumber(cycle)){int s=cycle->valueint;if(s==0||s==5||s==10||s==15||s==30||s==60)next.cycle_seconds=(uint32_t)s;}
    if(!memcmp(&next,&prefs,sizeof(prefs)))return true;
    prefs=next;changed();return true;
}
bool monitor_ui_apply(const char *json,int *sequence) {
    *sequence=-1;cJSON *root=cJSON_Parse(json);if(!root)return false;
    cJSON *version=cJSON_GetObjectItemCaseSensitive(root,"v");
    if(!cJSON_IsNumber(version)||version->valuedouble!=1){cJSON_Delete(root);return false;}
    const char *type=string(root,"type");
    if(!strcmp(type,"prefs_set")) {
        if(esp_lv_adapter_lock(100)!=ESP_OK){cJSON_Delete(root);return false;}
        bool ok=apply_pushed_prefs(cJSON_GetObjectItemCaseSensitive(root,"prefs"));
        esp_lv_adapter_unlock();cJSON_Delete(root);return ok;
    }
    if(!strcmp(type,"ui")){
        const char *action=string(root,"action");
        if(!strcmp(action,"manual")||!strcmp(action,"manual-undo")) {
            /* Diagnostic capture of the reset marker; opens only when a real tap would. */
            bool undo=action[6]!=0;
            if(esp_lv_adapter_lock(100)!=ESP_OK){cJSON_Delete(root);return false;}
            if(overlay)close_settings(NULL);
            if(undo?manual_info.has_last:(manual_info.can_mark&&manual_info.day_count))open_manual_dialog(undo);
            esp_lv_adapter_unlock();cJSON_Delete(root);return true;
        }
        int target=SETTINGS_HOME;
        int catalog_code=-1;
        if(!strcmp(action,"overview"))target=SETTINGS_OVERVIEW;
        else if(!strcmp(action,"coding"))target=SETTINGS_CODING;
        else if(!strcmp(action,"system"))target=SETTINGS_SYSTEM;
        else if(!strcmp(action,"radar"))target=SETTINGS_RADAR;
        else if(!strcmp(action,"channel-catalog"))catalog_code=1;
        else if(!strcmp(action,"system-catalog"))catalog_code=4;
        else if(strcmp(action,"plugins")&&strcmp(action,"settings")&&strcmp(action,"close")){cJSON_Delete(root);return false;}
        if(esp_lv_adapter_lock(100)!=ESP_OK){cJSON_Delete(root);return false;}
        if(!strcmp(action,"close")){if(overlay)close_settings(NULL);}
        else {
            if(!overlay)open_settings(NULL);
            if(catalog_code>=0)show_catalog_settings(catalog_code);
            else if(target==SETTINGS_HOME)render_settings_home();else render_plugin_settings(target);
        }
        esp_lv_adapter_unlock();cJSON_Delete(root);return true;
    }
    if(!strcmp(type,"radar_detail")) {
        if(esp_lv_adapter_lock(100)!=ESP_OK){cJSON_Delete(root);return false;}
        apply_radar_detail(root);esp_lv_adapter_unlock();cJSON_Delete(root);return true;
    }
    if(!strcmp(type,"radar_manual_ack")) {
        if(esp_lv_adapter_lock(100)!=ESP_OK){cJSON_Delete(root);return false;}
        apply_manual_ack(root);esp_lv_adapter_unlock();cJSON_Delete(root);return true;
    }
    if(!strcmp(type,"catalog")||!strcmp(type,"prefs_ack")||!strcmp(type,"error")) {
        if(esp_lv_adapter_lock(100)!=ESP_OK){cJSON_Delete(root);return false;}
        if(!strcmp(type,"catalog"))apply_catalog(root);
        else if(!strcmp(type,"error")&&catalog_position)lv_label_set_text(catalog_position,string(root,"message"));
        esp_lv_adapter_unlock();cJSON_Delete(root);return true;
    }
    cJSON *seq=cJSON_GetObjectItemCaseSensitive(root,"seq"),*page=cJSON_GetObjectItemCaseSensitive(root,"page"),*pages=cJSON_GetObjectItemCaseSensitive(root,"pages"),*items=cJSON_GetObjectItemCaseSensitive(root,"rows");
    bool valid=!strcmp(type,"view")&&cJSON_IsNumber(seq)&&seq->valuedouble>=0&&seq->valuedouble<=2147483647
        &&cJSON_IsNumber(page)&&cJSON_IsNumber(pages)&&pages->valueint>0&&pages->valueint<=64&&page->valueint>=0&&page->valueint<pages->valueint&&cJSON_IsArray(items)&&cJSON_GetArraySize(items)<=6;
    if(!valid||esp_lv_adapter_lock(100)!=ESP_OK){cJSON_Delete(root);return false;}
    apply_manager_summary(root);
    if(current_page!=page->valueint)last_navigation=esp_timer_get_time();
    current_page=page->valueint;page_count=pages->valueint;passive=strcmp(string(root,"mode"),"live")!=0;mirror_mode=!strcmp(string(root,"mode"),"mirror");
    const char *groups[]={"overview","coding","system","radar"};
    current_group=-1;for(int i=0;i<4;i++)if(!strcmp(string(root,"group"),groups[i]))current_group=i;
    cJSON *menu=cJSON_GetObjectItemCaseSensitive(root,"menu");
    if(cJSON_IsArray(menu))for(int i=0;i<4;i++){
        plugin_pages[i]=-1;
        cJSON *entry; cJSON_ArrayForEach(entry,menu){cJSON *index=cJSON_GetObjectItemCaseSensitive(entry,"page");if(!strcmp(string(entry,"group"),groups[i])&&cJSON_IsNumber(index)&&index->valueint>=0&&index->valueint<page_count)plugin_pages[i]=index->valueint;}
    }
    lv_label_set_text(title,string(root,"title"));
    for(int i=0;i<6;i++) {
        cJSON *item=cJSON_GetArrayItem(items,i);
        if(!item||(prefs.big_values&&i>=4)){lv_obj_add_flag(rows[i],LV_OBJ_FLAG_HIDDEN);continue;}
        lv_obj_clear_flag(rows[i],LV_OBJ_FLAG_HIDDEN);lv_label_set_text(labels[i],string(item,"label"));lv_label_set_text(values[i],string(item,"value"));lv_label_set_text(details[i],string(item,"detail"));
        cJSON *pct=cJSON_GetObjectItemCaseSensitive(item,"pct");
        if(cJSON_IsNumber(pct)&&isfinite(pct->valuedouble)){lv_obj_clear_flag(bars[i],LV_OBJ_FLAG_HIDDEN);lv_bar_set_value(bars[i],(int)fmax(0,fmin(100,pct->valuedouble)),LV_ANIM_OFF);}else lv_obj_add_flag(bars[i],LV_OBJ_FLAG_HIDDEN);
    }
    int first,last;group_bounds(&first,&last);
    char position[40];snprintf(position,sizeof(position),"%d / %d",current_page-first+1,last-first+1);lv_label_set_text(pager,position);
    cJSON *dashboard=cJSON_GetObjectItemCaseSensitive(root,"dashboard");
    cJSON *native_page=cJSON_GetObjectItemCaseSensitive(root,"nativePage");
    apply_manual_info(cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(dashboard,"radar"),"manual"));
    apply_manual_info(cJSON_GetObjectItemCaseSensitive(native_page,"manual"));
    bool dashboard_page=!strcmp(string(root,"group"),"overview")&&cJSON_IsObject(dashboard);
    bool native_page_visible=current_group>0&&cJSON_IsObject(native_page)&&monitor_pages_apply(native_page,prefs.show_minmax);
    show_content(dashboard_page,native_page_visible);
    if(dashboard_visible)monitor_dashboard_apply(dashboard,prefs.show_minmax);
    last_frame=esp_timer_get_time();frame_count++;status_tick(NULL);esp_lv_adapter_unlock();*sequence=seq->valueint;cJSON_Delete(root);return true;
}
bool monitor_ui_pop_navigation(int *page) {return xQueueReceive(navigation,page,0)==pdPASS;}
bool monitor_ui_pop_command(char *json) {return xQueueReceive(commands,json,0)==pdPASS;}
